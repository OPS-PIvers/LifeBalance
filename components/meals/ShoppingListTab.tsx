import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useShopping, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem, QuickStockList } from '@/types/schema';
import { Download, Sparkles, Loader2, Clock, Filter, RotateCcw, X, Settings, Share2, Save, ShoppingCart, MoreHorizontal, ChevronDown } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import type { OptimizableItem } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import GroceryCatalogModal from '@/components/modals/GroceryCatalogModal';
import ShoppingSettingsModal from '@/components/meals/ShoppingSettingsModal';
import { ShoppingItemRow } from '@/components/meals/ShoppingItemRow';
import { QuickRestockRow } from '@/components/meals/QuickRestockRow';
import { ShoppingItemForm } from '@/components/meals/ShoppingItemForm';
import { Drawer } from '@/components/ui/Drawer';
import { Popover } from '@/components/ui/Popover';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';
import { QuickAddBar } from '@/components/ui/QuickAddBar';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/ui/PageHeader';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { haptic } from '@/utils/haptics';
import { generateCsvExport } from '@/utils/exportUtils';
import { formatShoppingListForShare } from '@/utils/shoppingListFormatter';
import { suggestItemDefaults } from '@/utils/grocerySmartDefaults';
import toast from 'react-hot-toast';

interface FilterDropdownProps {
  filterStore: string | null;
  stores: { id: string; name: string }[];
  onSelect: (name: string | null) => void;
  onClose: () => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({ filterStore, stores, onSelect, onClose }) => {
  return (
    <Popover
      isOpen
      onClose={onClose}
      role="menu"
      ariaLabel="Filter by store"
      position="top-full right-0 mt-2"
      className="w-48 overflow-hidden py-1"
    >
      <div className="max-h-60 scroll-contain-y">
        <button
          role="menuitemradio"
          aria-checked={!filterStore}
          onClick={() => onSelect(null)}
          className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-brand-50 dark:hover:bg-brand-700/50 flex items-center justify-between focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-700/50 ${!filterStore ? 'text-accent-600 font-medium bg-accent-50 dark:text-accent-300 dark:bg-accent-900/30' : 'text-brand-700 dark:text-brand-300'}`}
        >
          All items
          {!filterStore && <Filter size={14} />}
        </button>
        {stores.map(store => (
          <button
            key={store.id}
            role="menuitemradio"
            aria-checked={filterStore === store.name}
            onClick={() => onSelect(store.name)}
            className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-brand-50 dark:hover:bg-brand-700/50 flex items-center justify-between focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-700/50 ${filterStore === store.name ? 'text-accent-600 font-medium bg-accent-50 dark:text-accent-300 dark:bg-accent-900/30' : 'text-brand-700 dark:text-brand-300'}`}
          >
            {store.name}
            {filterStore === store.name && <Filter size={14} />}
          </button>
        ))}
        {stores.length === 0 && (
          <div className="px-4 py-2 text-xs text-brand-400 dark:text-brand-450 italic">No stores configured</div>
        )}
      </div>
    </Popover>
  );
};

const ShoppingListTab: React.FC = () => {
  const powerToolsEnabled = usePowerToolsEnabled();
  const {
    shoppingList,
    addShoppingItem,
    deleteShoppingItem,
    toggleShoppingItemPurchased,
    updateShoppingItem,
    reorderShoppingItems,
    clearPurchasedShoppingItems,
    stores,
    groceryCategories,
    groceryCatalog,
    quickStockLists,
    addGroceryCatalogItem,
    updateQuickStockLists,
  } = useShopping();
  const { householdId, isLoading } = useHouseholdCore();

  // Combine default and custom categories
  const categories = useMemo(() => {
    return (groceryCategories && groceryCategories.length > 0)
      ? groceryCategories
      : [...GROCERY_CATEGORIES];
  }, [groceryCategories]);

  // Pre-calculate ALL quick-list memberships for each item name to avoid
  // expensive finds in each row. Maps lowercased name -> every QuickStockList
  // the item belongs to, in quickStockLists order.
  const itemQuickListMap = useMemo(() => {
    const map = new Map<string, QuickStockList[]>();
    if (!quickStockLists || !groceryCatalog) return map;

    // 1. Map Catalog ID -> QuickStockList[] (a catalog item can be in multiple lists)
    const idToListsMap = new Map<string, QuickStockList[]>();
    for (const list of quickStockLists) {
      if (!list.items) continue;
      for (const itemId of list.items) {
        const existing = idToListsMap.get(itemId);
        if (existing) {
          existing.push(list);
        } else {
          idToListsMap.set(itemId, [list]);
        }
      }
    }

    // 2. Map Name -> QuickStockList[]
    for (const item of groceryCatalog) {
      const lists = idToListsMap.get(item.id);
      if (lists) {
        map.set(item.name.toLowerCase(), lists);
      }
    }
    return map;
  }, [quickStockLists, groceryCatalog]);

  // Local state for Reorder.Group
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [filterStore, setFilterStore] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // Overflow ("...") menu of secondary/bulk actions, and the collapsed
  // quick-restock disclosure (closed by default — see the render).
  const [menuOpen, setMenuOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);

  // Use a ref for drag state to prevent re-renders and potential race conditions
  // caused by the dependency array in useEffect.
  const isDraggingRef = useRef(false);

  // Sync local items with context shoppingList, respecting order
  // Note: This effect synchronizes external state (shoppingList from context) with local state
  // (items) required by the Reorder.Group drag-and-drop component. The isDraggingRef prevents
  // infinite loops, and this pattern is necessary for react-use-gesture/framer-motion integration.
  useEffect(() => {
    // Avoid resetting items while user is dragging
    if (isDraggingRef.current) return;

    // Sort items by order field, then by creation or name as fallback
    let sorted = [...shoppingList].sort((a, b) => {
      const orderA = a.order ?? 9999;
      const orderB = b.order ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      // Fallback to name
      return a.name.localeCompare(b.name);
    });

    if (filterStore) {
      sorted = sorted.filter(item => item.store === filterStore);
    }

     
    setItems(sorted);
  }, [shoppingList, filterStore]);

  // Input State
  const [newItemText, setNewItemText] = useState('');
  // Focus the quick-add field on desktop only. On touch devices this would pop
  // the iOS keyboard every time the tab/page mounts (this component is shared by
  // the Lists "Shopping" tab, the Meals "Shopping List" tab, and the standalone
  // Shopping page), shifting the view up — see the Capture drawer fix.
  const addInputRef = useAutoFocus<HTMLInputElement>();

  // Modal States
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTemplate, setSettingsInitialTemplate] = useState<Partial<QuickStockList> | null>(null);
  const [isClearCheckedConfirmOpen, setIsClearCheckedConfirmOpen] = useState(false);

  // Optimizer Hook
  const { handleOptimize, isOptimizing } = useGroceryOptimizer({
    householdId,
    items: shoppingList,
    updateItem: updateShoppingItem,
    mapToOptimizable: (item: ShoppingItem): OptimizableItem => ({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      store: item.store
    }),
    mapFromOptimizable: (original: ShoppingItem, optimized: OptimizableItem): ShoppingItem => ({
      ...original,
      name: optimized.name,
      category: optimized.category || original.category,
      quantity: optimized.quantity || original.quantity,
      store: optimized.store || original.store
    }),
    availableCategories: categories,
    availableStores: stores.map(s => s.name),
    emptyMessage: "List is empty",
    errorMessage: "Failed to optimize your shopping list"
  });

  // Handle Smart Add
  const handleSmartAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawName = newItemText.trim();
    if (!rawName) return;

    // Reset input immediately
    setNewItemText('');

    // 1. Smart Lookup in History (Grocery Catalog)
    // Find exact or close match (case-insensitive)
    const match = groceryCatalog.find(
        c => c.name.toLowerCase() === rawName.toLowerCase()
    );

    let category = 'Uncategorized';
    let store = undefined;
    let quantity = undefined;

    if (match) {
        category = match.category;
        store = match.defaultStore;
        quantity = match.defaultQuantity;
    } else {
        // No exact history hit — fall back to partial-history/preset smart defaults.
        const suggestion = suggestItemDefaults(rawName, groceryCatalog);
        if (suggestion) {
            category = suggestion.category || 'Uncategorized';
            store = suggestion.store;
            quantity = suggestion.quantity;
        }
    }

    // 2. Add Item
    // Calculate new order (last + 1)
    // Use full shoppingList to ensure correct ordering even when filtered
    const maxOrder = shoppingList.length > 0 ? Math.max(...shoppingList.map(i => i.order || 0)) : 0;

    await addShoppingItem({
        name: rawName,
        category,
        store,
        quantity,
        isPurchased: false,
        order: maxOrder + 1
    });
    haptic('success');

    // If we inferred metadata, maybe show a toast?
    if (store || (category !== 'Uncategorized')) {
        // Optional feedback, skipping to keep UI clean
    }
  };

  // Memoized flags derived from shoppingList to avoid two O(N) scans on every render
  const { hasPendingItems, hasPurchasedItems } = useMemo(() => {
    let hasPendingItems = false;
    let hasPurchasedItems = false;
    for (const item of shoppingList) {
      if (item.isPurchased) {
        hasPurchasedItems = true;
      } else {
        hasPendingItems = true;
      }
      if (hasPendingItems && hasPurchasedItems) break;
    }
    return { hasPendingItems, hasPurchasedItems };
  }, [shoppingList]);

  const handleReorder = (newOrder: ShoppingItem[]) => {
    setItems(newOrder);
    // Debounce or just call it?
    // For smoother UX, we update local state immediately (above).
    // Then we trigger the context update.
    // Ideally we should debounce this if the user is dragging around a lot,
    // but Reorder.Group onReorder fires once per drag operation usually?
    // Actually framer-motion calls onReorder on every swap.
    // We should probably rely on onDragEnd, but Reorder.Group manages the array.

    // We will call the API. The context function creates a batch.
    // Note: Frequent writes might be rate limited or costly.
    // But for a shopping list reorder, it's acceptable.
    reorderShoppingItems(newOrder);
  };

  const handleReorderDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleReorderDragEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

    // Smart-default suggestion for the item currently open in the edit drawer.
    const editingItemSuggestion = useMemo(
        () => (editingItem ? suggestItemDefaults(editingItem.name, groceryCatalog) : null),
        [editingItem, groceryCatalog]
    );

    const handleSaveEdit = async () => {
        if (!editingItem) return;
        if (!editingItem.name.trim()) return;

        await updateShoppingItem(editingItem);
        setEditingItem(null);
        toast.success('Updated');
    };

    const handleExport = () => {
        if (shoppingList.length === 0) return;
        const exportData = shoppingList.map(item => ({
          Name: item.name,
          Category: item.category || 'Uncategorized',
          Quantity: item.quantity || '',
          Store: item.store || '',
          Status: item.isPurchased ? 'Purchased' : 'Pending'
        }));
        generateCsvExport(exportData, 'shopping-list-export');
        toast.success("Export started");
    };

    const handleSaveAsTemplate = async () => {
        if (shoppingList.length === 0) return;

        // Optimistically show loading
        const toastId = toast.loading('Preparing template...');

        try {
            // 1. Resolve to Catalog IDs
            const itemIds: string[] = [];
            const itemsToCreateMap = new Map<string, ShoppingItem>();

            for (const item of shoppingList) {
                const catalogItem = groceryCatalog.find(c => c.name.toLowerCase() === item.name.toLowerCase());
                if (catalogItem) {
                    itemIds.push(catalogItem.id);
                } else {
                    // Deduplicate by name
                    const key = item.name.toLowerCase();
                    if (!itemsToCreateMap.has(key)) {
                        itemsToCreateMap.set(key, item);
                    }
                }
            }

            // 2. Create missing catalog items in parallel
            const createdIds = await Promise.all(
                Array.from(itemsToCreateMap.values()).map(item =>
                    addGroceryCatalogItem({
                        name: item.name,
                        category: item.category || 'Uncategorized',
                        lastPurchased: new Date().toISOString(),
                        purchaseCount: 0 // Start at 0 as this is just a template creation reference
                    })
                )
            );

            // 3. Combine all IDs
            const allIds = [...itemIds, ...createdIds];

            toast.dismiss(toastId);

            // Open Modal with data
            setSettingsInitialTemplate({
                name: '',
                items: allIds,
                icon: 'ShoppingBag',
                color: 'slate'
            });
            setIsSettingsOpen(true);
        } catch (error) {
            console.error("Failed to prepare template:", error);
            toast.error("Failed to prepare template", { id: toastId });
        }
    };

    const handleShareList = async () => {
        // Share pending items only
        const itemsToShare = shoppingList.filter(i => !i.isPurchased);
        if (itemsToShare.length === 0) {
          toast('No pending items to share', { icon: 'ℹ️' });
          return;
        }

        const text = formatShoppingListForShare(itemsToShare);
        try {
          await navigator.clipboard.writeText(text);
          toast.success('Shopping list copied to clipboard!');
        } catch (err) {
          console.error('Failed to copy:', err);
          toast.error('Failed to copy to clipboard');
        }
    };

    const handleCheck = useCallback((item: ShoppingItem) => {
        toggleShoppingItemPurchased(item.id);
    }, [toggleShoppingItemPurchased]);

    const handleDelete = useCallback((item: ShoppingItem) => {
        deleteShoppingItem(item.id);
    }, [deleteShoppingItem]);

    // Toggles a single list's membership for an item, leaving every OTHER
    // list untouched (the old handler forced exclusive single-list membership;
    // the redesigned drawer supports belonging to multiple quick lists at once).
    const handleQuickListToggle = useCallback(async (item: ShoppingItem, listId: string, member: boolean) => {
        if (!householdId || !quickStockLists?.length || !groceryCatalog) return;
        // Never create an empty-named catalog item (name cleared mid-edit).
        if (!item.name.trim()) {
            toast.error('Item name cannot be empty');
            return;
        }

        try {
            // 1. Find or Create Catalog Item
            let catalogItemId: string;
            const match = groceryCatalog.find(c => c.name.toLowerCase() === item.name.toLowerCase());

            if (match) {
                catalogItemId = match.id;
            } else {
                const newItem = {
                    name: item.name,
                    category: item.category || 'Uncategorized',
                    lastPurchased: new Date().toISOString(),
                    purchaseCount: 1 // Start at 1 since we're explicitly adding it
                };
                catalogItemId = await addGroceryCatalogItem(newItem);
            }

            // 2. Update ONLY the target list's membership, in a SINGLE write.
            const newLists = quickStockLists.map(list => {
                if (list.id !== listId) return list;
                const items = list.items || [];
                const hasItem = items.includes(catalogItemId);

                if (member) {
                    return hasItem ? list : { ...list, items: [...items, catalogItemId] };
                }
                return hasItem ? { ...list, items: items.filter(id => id !== catalogItemId) } : list;
            });

            await updateQuickStockLists(newLists);

            toast.success(member ? 'List updated' : 'Removed from list');
        } catch (error) {
            console.error('Failed to update quick list:', error);
            toast.error('Failed to update list');
        }
    }, [householdId, groceryCatalog, quickStockLists, addGroceryCatalogItem, updateQuickStockLists]);

  // Secondary/bulk actions, collapsed into one overflow "..." menu so they stop
  // eating a full button row + a 4-icon header cluster. Filter and Clear-checked
  // stay out of here (they need a persistent / contextual visible state). Every
  // handler + disabled guard is reused verbatim — logic unchanged.
  const menuItems: MenuItem[] = [
    // Gated behind powerToolsEnabled (Plan 17) — the hook call above stays
    // unconditional so hooks-order rules aren't affected; only the entry point
    // to the AI optimize flow is hidden.
    ...(powerToolsEnabled
      ? [
          {
            key: 'optimize',
            label: 'Optimize with AI',
            icon: <Sparkles size={16} />,
            tone: 'primary' as const,
            onSelect: handleOptimize,
            disabled: isOptimizing || shoppingList.length === 0,
          },
        ]
      : []),
    {
      key: 'history',
      label: 'History',
      icon: <Clock size={16} />,
      onSelect: () => setIsCatalogOpen(true),
    },
    {
      key: 'template',
      label: 'Save as template',
      icon: <Save size={16} />,
      onSelect: handleSaveAsTemplate,
      disabled: shoppingList.length === 0,
    },
    {
      key: 'share',
      label: 'Share / copy',
      icon: <Share2 size={16} />,
      onSelect: handleShareList,
      disabled: !hasPendingItems,
    },
    {
      key: 'export',
      label: 'Export CSV',
      icon: <Download size={16} />,
      onSelect: handleExport,
      disabled: shoppingList.length === 0,
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: <Settings size={16} />,
      onSelect: () => setIsSettingsOpen(true),
    },
  ];

  return (
    <div className="space-y-3 pb-20">
        {/* Title row — NOT sticky (scrolls away). Every secondary/bulk action
            collapses into one top-right overflow menu (Reminders/Todoist/To-Do
            pattern), reclaiming the old 4-icon cluster + the 3-button row. The
            trigger shows a spinner while AI Optimize runs so feedback survives a
            closed menu. */}
        <PageHeader
            className="px-0 pt-4 pb-2"
            title="Shopping list"
            actions={
                <div className="flex items-center gap-1">
                    {/* Store filter — lives in the title row (owner decision:
                        filtering is about VIEWING the list, so it belongs with
                        the page-level controls, not the add row). Quiet icon at
                        rest; an accent pill with the store name + inline clear
                        when active, so the scoped view stays glanceable. */}
                    <div className="relative flex-none">
                        {filterStore ? (
                            <div className="flex items-center bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200 rounded-full">
                                <button
                                    type="button"
                                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                                    aria-label={`Filter by store: ${filterStore}`}
                                    aria-expanded={isFilterOpen}
                                    aria-haspopup="menu"
                                    className="flex items-center gap-1.5 pl-3 pr-1.5 py-2 text-xs font-medium max-w-[38vw]"
                                >
                                    <Filter className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{filterStore}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFilterStore(null)}
                                    aria-label="Clear store filter"
                                    className="pr-2.5 py-2 hover:text-accent-900 dark:hover:text-accent-50 transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                                aria-label="Filter by store"
                                aria-expanded={isFilterOpen}
                                aria-haspopup="menu"
                                className="p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
                            >
                                <Filter className="w-5 h-5" />
                            </button>
                        )}

                        {isFilterOpen && (
                            <FilterDropdown
                                filterStore={filterStore}
                                stores={stores}
                                onSelect={(name) => { setFilterStore(name); setIsFilterOpen(false); }}
                                onClose={() => setIsFilterOpen(false)}
                            />
                        )}
                    </div>
                    <div className="relative">
                    <button
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-label="Shopping list actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        className="p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
                    >
                        {isOptimizing
                            ? <Loader2 className="w-5 h-5 animate-spin" />
                            : <MoreHorizontal className="w-5 h-5" />}
                    </button>
                    {/* Mounted only while open: Menu builds its button elements
                        eagerly (JSX children evaluate before Popover discards them
                        when closed), so gating here keeps add-input keystrokes from
                        re-walking the menu tree. */}
                    {menuOpen && (
                        <Menu
                            isOpen={menuOpen}
                            onClose={() => setMenuOpen(false)}
                            ariaLabel="Shopping list actions"
                            position="top-full right-0 mt-2"
                            className="min-w-[208px]"
                            items={menuItems}
                        />
                    )}
                    </div>
                </div>
            }
        />

        {/* Quick restock — demoted from an always-on top strip to a collapsed
            disclosure (rarely used; must not eat prime real estate). One tap
            reveals the unchanged horizontally-scrollable chip row. Hidden
            entirely when no quick-stock lists exist (zero footprint). */}
        {quickStockLists && quickStockLists.length > 0 && (
            <div>
                <button
                    type="button"
                    onClick={() => setRestockOpen((o) => !o)}
                    aria-expanded={restockOpen}
                    className="flex items-center gap-1.5 px-1 text-xxs font-bold uppercase tracking-wider text-brand-400 hover:text-brand-600 dark:text-brand-450 dark:hover:text-brand-300 transition-colors"
                >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-(--duration-fast) ease-(--ease-standard) ${restockOpen ? '' : '-rotate-90'}`} />
                    Quick restock
                </button>
                {restockOpen && (
                    <div className="mt-2">
                        <QuickRestockRow showHeader={false} />
                    </div>
                )}
            </div>
        )}

        {/* Clear Checked */}
        {hasPurchasedItems && (
            <div className="flex justify-end">
                <Button
                    variant="subtle"
                    size="sm"
                    leftIcon={<RotateCcw className="w-3 h-3" />}
                    onClick={() => setIsClearCheckedConfirmOpen(true)}
                    className="rounded-full"
                >
                    Clear checked
                </Button>
            </div>
        )}

        {/* Main List — the add bar + store filter are now the first row INSIDE
            this same rounded surface (owner request: the add field should be
            row one of the list, not a detached floating band above it). The
            row scrolls with the card (no longer sticky/pinned) — the global
            Capture FAB covers add-while-scrolled. Reorder.Group (the drag
            layer) is nested as a plain sibling below the add row inside one
            shared rounded container, so it never owns the outer radius/border
            itself — only the item rows drag. */}
        <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
            <div className="flex items-center gap-2 hairline-divider">
                <QuickAddBar
                    attached
                    onSubmit={handleSmartAdd}
                    inputRef={addInputRef}
                    value={newItemText}
                    onChange={setNewItemText}
                    placeholder="Add item..."
                    disabled={!newItemText.trim()}
                    submitLabel="Add item to shopping list"
                />
            </div>

            {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 hairline-divider">
                        <Skeleton className="w-3 h-5 shrink-0" />
                        <Skeleton className="w-5 h-5 rounded-full shrink-0" />
                        <Skeleton className="h-5 flex-1" />
                    </div>
                ))
            ) : items.length === 0 ? (
                <div className="hairline-divider">
                    <EmptyState
                        size="compact"
                        icon={<ShoppingCart className="w-7 h-7" />}
                        title={filterStore ? `Nothing for ${filterStore}` : 'Your list is empty'}
                        description={filterStore ? 'No items match this store filter.' : 'Add an item above to start your shopping list.'}
                        action={filterStore ? (
                            <Button variant="secondary" onClick={() => setFilterStore(null)}>
                                Clear Filter
                            </Button>
                        ) : undefined}
                    />
                </div>
            ) : filterStore ? (
                items.map(item => (
                    <ShoppingItemRow
                        key={item.id}
                        item={item}
                        stores={stores}
                        activeQuickList={itemQuickListMap.get(item.name.toLowerCase())?.[0]}
                        onCheck={handleCheck}
                        onDelete={handleDelete}
                        onEdit={setEditingItem}
                        isReorderable={false}
                    />
                ))
            ) : (
                // as="ul" so the li Reorder.Items nest validly; list-none kills marker styling
                <Reorder.Group axis="y" values={items} onReorder={handleReorder} as="ul" className="list-none">
                    {items.map(item => (
                        <ShoppingItemRow
                            key={item.id}
                            item={item}
                            stores={stores}
                            activeQuickList={itemQuickListMap.get(item.name.toLowerCase())?.[0]}
                            onCheck={handleCheck}
                            onDelete={handleDelete}
                            onEdit={setEditingItem}
                            onReorderDragStart={handleReorderDragStart}
                            onReorderDragEnd={handleReorderDragEnd}
                        />
                    ))}
                </Reorder.Group>
            )}
        </div>

        {/* Modals */}
        <GroceryCatalogModal
            isOpen={isCatalogOpen}
            onClose={() => setIsCatalogOpen(false)}
        />
        <ShoppingSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => {
              setIsSettingsOpen(false);
              setSettingsInitialTemplate(null);
            }}
            initialTemplateData={settingsInitialTemplate}
        />

        {/* Edit Item Drawer */}
        {editingItem && (
          <Drawer
            isOpen={!!editingItem}
            onClose={() => setEditingItem(null)}
            title="Edit item"
          >
            <ShoppingItemForm
              item={editingItem}
              onChange={setEditingItem}
              onSave={handleSaveEdit}
              onDelete={() => {
                deleteShoppingItem(editingItem.id);
                setEditingItem(null);
              }}
              stores={stores}
              categories={categories}
              quickStockLists={quickStockLists}
              activeQuickLists={itemQuickListMap.get(editingItem.name.toLowerCase())}
              onQuickListToggle={handleQuickListToggle}
              suggestion={editingItemSuggestion}
            />
          </Drawer>
        )}

        {/* Clear Checked Confirmation Dialog */}
        <ConfirmDialog
          isOpen={isClearCheckedConfirmOpen}
          onClose={() => setIsClearCheckedConfirmOpen(false)}
          onConfirm={() => {
            setIsClearCheckedConfirmOpen(false);
            clearPurchasedShoppingItems();
          }}
          title="Clear Checked Items"
          message="Clear all checked items?"
          confirmLabel="Clear"
          confirmVariant="destructive"
        />
    </div>
  );
};

export default ShoppingListTab;
