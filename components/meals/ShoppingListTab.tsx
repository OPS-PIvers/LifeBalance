import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useShopping, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem, QuickStockList } from '@/types/schema';
import { Download, Sparkles, Loader2, Clock, Filter, Info, RotateCcw, X, Settings, Share2, Save, ShoppingCart, MoreHorizontal, Zap, ArrowUpDown, Check, Trash2, ClipboardPaste } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { Reorder } from 'framer-motion';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import type { OptimizableItem } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import GroceryCatalogModal from '@/components/modals/GroceryCatalogModal';
import ShoppingSettingsModal from '@/components/meals/ShoppingSettingsModal';
import { ShoppingItemRow } from '@/components/meals/ShoppingItemRow';
import { QuickRestockDrawer } from '@/components/meals/QuickRestockDrawer';
import { PasteImportDrawer } from '@/components/meals/PasteImportDrawer';
import { ShoppingItemForm } from '@/components/meals/ShoppingItemForm';
import { Drawer } from '@/components/ui/Drawer';
import { Popover } from '@/components/ui/Popover';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';
import { UndoToast } from '@/components/ui/UndoToast';
import { QuickAddBar } from '@/components/ui/QuickAddBar';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/ui/PageHeader';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useStackedStickyOffset } from '@/hooks/useStackedStickyOffset';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { useDeepLinkHighlight } from '@/hooks/useDeepLinkHighlight';
import { useScrollToHighlight } from '@/hooks/useScrollToHighlight';
import { haptic } from '@/utils/haptics';
import { generateCsvExport } from '@/utils/exportUtils';
import { formatShoppingListForShare } from '@/utils/shoppingListFormatter';
import { resolveItemDefaults, suggestItemDefaults } from '@/utils/grocerySmartDefaults';
import {
  ShoppingSortMode,
  SHOPPING_SORT_LABELS,
  SHOPPING_SORT_STORAGE_KEY,
  readStoredShoppingSortMode,
  sortShoppingItems,
  shoppingGroupLabel,
} from '@/utils/shoppingSort';
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
          className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-brand-50 dark:hover:bg-brand-600/50 flex items-center justify-between focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-600/50 ${!filterStore ? 'text-accent-600 font-medium bg-accent-50 dark:text-accent-300 dark:bg-accent-900/30' : 'text-brand-700 dark:text-brand-300'}`}
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
            className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-brand-50 dark:hover:bg-brand-600/50 flex items-center justify-between focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-600/50 ${filterStore === store.name ? 'text-accent-600 font-medium bg-accent-50 dark:text-accent-300 dark:bg-accent-900/30' : 'text-brand-700 dark:text-brand-300'}`}
          >
            {store.name}
            {filterStore === store.name && <Filter size={14} />}
          </button>
        ))}
        {stores.length === 0 && (
          <div className="px-4 py-2 text-xs text-brand-400 dark:text-brand-400 italic">No stores configured</div>
        )}
      </div>
    </Popover>
  );
};

interface SortDropdownProps {
  sortMode: ShoppingSortMode;
  onSelect: (mode: ShoppingSortMode) => void;
  onClose: () => void;
}

const SORT_MODE_ORDER: ShoppingSortMode[] = ['entry', 'alpha', 'store', 'section'];

const SortDropdown: React.FC<SortDropdownProps> = ({ sortMode, onSelect, onClose }) => {
  return (
    <Popover
      isOpen
      onClose={onClose}
      role="menu"
      ariaLabel="Sort shopping list"
      position="top-full right-0 mt-2"
      className="w-52 overflow-hidden py-1"
    >
      {SORT_MODE_ORDER.map(mode => (
        <button
          key={mode}
          role="menuitemradio"
          aria-checked={sortMode === mode}
          onClick={() => onSelect(mode)}
          className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-brand-50 dark:hover:bg-brand-600/50 flex items-center justify-between focus:outline-hidden focus:bg-brand-50 dark:focus:bg-brand-600/50 ${sortMode === mode ? 'text-accent-600 font-medium bg-accent-50 dark:text-accent-300 dark:bg-accent-900/30' : 'text-brand-700 dark:text-brand-300'}`}
        >
          {SHOPPING_SORT_LABELS[mode]}
          {sortMode === mode && <Check size={14} />}
        </button>
      ))}
    </Popover>
  );
};

interface DeleteUndoToastProps {
  itemName: string;
  onUndo: () => void;
}

// Thin wrapper over the shared `UndoToast` (components/ui/UndoToast.tsx,
// generalized in F-TODO-11) that formats the delete-specific message. Kept
// as its own export so existing call sites/tests don't need to change.
export const DeleteUndoToast: React.FC<DeleteUndoToastProps> = ({ itemName, onUndo }) => (
  <UndoToast message={`Deleted "${itemName}"`} onUndo={onUndo} />
);

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
    loadFullGroceryCatalog,
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

  // Store name (lowercased) -> household-configured visit order, for 'store'
  // sort mode (F-MEALS-07). Stores without an explicit `order` are omitted so
  // sortShoppingItems falls back to alphabetical for them.
  const storeOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const store of stores) {
      if (store.order !== undefined) map.set(store.name.toLowerCase(), store.order);
    }
    return map;
  }, [stores]);

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
  // User-selected sort mode — a PREFERENCE persisted across sessions (same
  // localStorage pattern as ListsPage's tab memory). 'entry' is the classic
  // order-added/manual view and the only mode where drag-to-reorder is live.
  const [sortMode, setSortMode] = useState<ShoppingSortMode>(() => readStoredShoppingSortMode());
  const [isSortOpen, setIsSortOpen] = useState(false);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(SHOPPING_SORT_STORAGE_KEY, sortMode);
      }
    } catch (_error) {
      // Ignore persistence errors
    }
  }, [sortMode]);
  // Overflow ("...") menu of secondary/bulk actions, and the quick-restock
  // drawer (opened from the lightning-bolt icon in the title row).
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRestockDrawerOpen, setIsRestockDrawerOpen] = useState(false);
  const [isPasteImportOpen, setIsPasteImportOpen] = useState(false);

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

    // Sort per the persisted user preference ('entry' = order field, the
    // classic behavior); pure logic lives in utils/shoppingSort.ts.
    let sorted = sortShoppingItems(shoppingList, sortMode, categories, storeOrder);

    if (filterStore) {
      sorted = sorted.filter(item => item.store === filterStore);
    }


    setItems(sorted);
  }, [shoppingList, filterStore, sortMode, categories, storeOrder]);

  // --- Global search deep-link (v1.2) ---------------------------------------
  // A shopping result navigates to `/lists` with `state: { tab: 'shopping',
  // highlightId }`; ListsPage switches the tab and this scrolls to + flashes
  // the row. Deliberately DEFERRED until the list has actually arrived: the
  // first commit after a cold navigation has an empty `shoppingList`, and
  // `useScrollToHighlight` fires once per id — a rAF against an empty list
  // would consume the highlight and find nothing. Passing `null` until the
  // data lands means the effect re-runs with the real id when it does.
  const incomingHighlightId = useDeepLinkHighlight();
  const highlightId = !isLoading && shoppingList.length > 0 ? incomingHighlightId : null;
  // The target may be filtered out of view by an active store filter. Clear the
  // filter ONLY when the target actually fails it — a deep link must never
  // silently discard a scoping choice it didn't need to. Looked up in the full
  // `shoppingList`, not the filtered `items`, precisely because a failing target
  // is absent from the latter. The Reorder.Group's mirrored `items` state is
  // left alone: it is load-bearing for drag, and a deep link never races one.
  const revealHighlightedItem = useCallback(() => {
    if (!highlightId || !filterStore) return;
    const target = shoppingList.find(item => item.id === highlightId);
    if (target && target.store !== filterStore) setFilterStore(null);
  }, [highlightId, filterStore, shoppingList]);
  useScrollToHighlight(highlightId, revealHighlightedItem);

  // Input State
  const [newItemText, setNewItemText] = useState('');
  // The live grocery-catalog listener is bounded (top items by purchaseCount).
  // Smart Add matches typed names against the FULL catalog, so lazily pull in
  // the rest on the first keystroke (idempotent per household).
  useEffect(() => {
    if (newItemText.trim()) void loadFullGroceryCatalog();
  }, [newItemText, loadFullGroceryCatalog]);
  // Focus the quick-add field on desktop only. On touch devices this would pop
  // the iOS keyboard every time the tab/page mounts (this component is shared by
  // the Lists "Shopping" tab, the Meals "Shopping List" tab, and the standalone
  // Shopping page), shifting the view up — see the Capture drawer fix.
  const addInputRef = useAutoFocus<HTMLInputElement>();

  // Stacked sticky header (owner decision, shared with the To-Dos tab): tab
  // strip, then the title row, then the add row all pin; list rows scroll
  // beneath. The hook measures the title row and publishes
  // --lists-sticky-top-2 (strip + title height) for the add row's offset.
  const { containerRef: stickyContainerRef, titleRowRef: stickyTitleRowRef } =
    useStackedStickyOffset<HTMLDivElement, HTMLDivElement>();

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

    // 1. Smart Lookup in History (Grocery Catalog), then partial-history /
    // preset keywords. Extracted to `resolveItemDefaults` so the Capture
    // drawer's one-field Shopping tab resolves defaults IDENTICALLY — the page
    // and the drawer share this helper rather than each carrying a copy.
    const { category, store, quantity } = resolveItemDefaults(rawName, groceryCatalog);

    // 2. Add Item
    // Calculate new order (last + 1)
    // Use full shoppingList to ensure correct ordering even when filtered
    const maxOrder = shoppingList.length > 0 ? Math.max(...shoppingList.map(i => i.order || 0)) : 0;

    // Haptic at gesture time: after the await, transient user activation has
    // expired and the iOS transport silently no-ops (see utils/haptics.ts).
    haptic('success');
    await addShoppingItem({
        name: rawName,
        category,
        store,
        quantity,
        isPurchased: false,
        order: maxOrder + 1
    });

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
          toast('No pending items to share', { icon: toastIcon(Info) });
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

    // Deletes stay instant (no confirm on the swipe path) — the undo toast is
    // the safety net. Undo re-adds the item; a new id is acceptable.
    const showDeleteUndoToast = useCallback((item: ShoppingItem) => {
        const { id: _id, ...restored } = item;
        toast(
            (t) => (
                <DeleteUndoToast
                    itemName={item.name}
                    onUndo={() => {
                        toast.dismiss(t.id);
                        void addShoppingItem(restored);
                    }}
                />
            ),
            { duration: 5000, icon: toastIcon(Trash2) }
        );
    }, [addShoppingItem]);

    const handleDelete = useCallback((item: ShoppingItem) => {
        deleteShoppingItem(item.id);
        showDeleteUndoToast(item);
    }, [deleteShoppingItem, showDeleteUndoToast]);

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
      key: 'import',
      label: 'Import list',
      icon: <ClipboardPaste size={16} />,
      onSelect: () => setIsPasteImportOpen(true),
    },
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
    <div ref={stickyContainerRef} className="space-y-3 pb-20">
        {/* Title row — STICKY (owner decision, matching the To-Dos tab): pins
            flush below the tab strip at --lists-sticky-top, with the add row
            pinned below it in turn; the opaque page background masks rows
            scrolling beneath. Every secondary/bulk action collapses into one
            top-right overflow menu (Reminders/Todoist/To-Do pattern),
            reclaiming the old 4-icon cluster + the 3-button row. The trigger
            shows a spinner while AI Optimize runs so feedback survives a
            closed menu. */}
        <div
            ref={stickyTitleRowRef}
            className="sticky top-[var(--lists-sticky-top,0px)] z-30 bg-brand-50 dark:bg-brand-900"
        >
        <PageHeader
            as="h2"
            className="px-0 pt-4 pb-2"
            title="Shopping list"
            actions={
                <div className="flex items-center gap-1">
                    {/* Quick restock — a lightning-bolt icon in the title row
                        (owner decision: the old inline disclosure ate a row of
                        prime space even when collapsed). Opens a drawer of
                        restock templates; hidden when none exist. */}
                    {quickStockLists && quickStockLists.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setIsRestockDrawerOpen(true)}
                            aria-label="Quick restock"
                            aria-haspopup="dialog"
                            className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
                        >
                            <Zap className="w-5 h-5" />
                        </button>
                    )}
                    {/* Sort — persists across sessions; icon tinted when a
                        non-default mode is active so the derived view is
                        glanceable (mirrors the filter affordance). */}
                    <div className="relative flex-none">
                        <button
                            type="button"
                            onClick={() => setIsSortOpen(!isSortOpen)}
                            aria-label={`Sort: ${SHOPPING_SORT_LABELS[sortMode]}`}
                            aria-expanded={isSortOpen}
                            aria-haspopup="menu"
                            className={`relative before:absolute before:-inset-1 before:content-[''] p-2 rounded-full transition-colors hover:bg-brand-100 dark:hover:bg-brand-700/50 ${
                                sortMode !== 'entry'
                                    ? 'text-accent-600 dark:text-accent-300'
                                    : 'text-brand-500 hover:text-accent-600 dark:text-brand-400 dark:hover:text-accent-300'
                            }`}
                        >
                            <ArrowUpDown className="w-5 h-5" />
                        </button>
                        {isSortOpen && (
                            <SortDropdown
                                sortMode={sortMode}
                                onSelect={(mode) => { setSortMode(mode); setIsSortOpen(false); }}
                                onClose={() => setIsSortOpen(false)}
                            />
                        )}
                    </div>
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
                                className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
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
                        className="relative before:absolute before:-inset-1 before:content-[''] p-2 text-brand-500 hover:text-accent-600 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-400 dark:hover:text-accent-300 dark:hover:bg-brand-700/50"
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
        </div>

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

        {/* Main List — the add bar is row one of the list surface AND sticky
            (owner request: keep it in sight while scrolling a long list). It
            lives in its own top card because `position: sticky` dies inside
            an `overflow-hidden` ancestor — so the surface is split into a
            sticky top card (add row, bottom border = the divider) and a
            flush list card below (border-t-0, rounded-t-none) that together
            read as one rounded section. The sticky offset tucks it under
            the pinned title row via --lists-sticky-top-2 (strip + title
            height, published by useStackedStickyOffset; 0px fallback when
            neither renders). The wrapper's page-colored background masks
            rows scrolling past the card's rounded top corners. */}
        <div>
            <div className="sticky top-[var(--lists-sticky-top-2,0px)] z-20 bg-brand-50 dark:bg-brand-900">
                <div className="surface-section rounded-b-none overflow-hidden">
                    <div className="flex items-center gap-2">
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
                </div>
            </div>

            {/* Reorder.Group (the drag layer) is nested as a plain child inside
                the shared rounded container, so it never owns the outer
                radius/border itself — only the item rows drag. Drag reorder is
                only live in 'entry' (order added) sort with no store filter;
                the other sorts are derived views that never write `order`. */}
            <div className="surface-section rounded-t-none border-t-0 overflow-hidden [&>*:first-child]:border-t-0">
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
                        // h3: nests under the "Shopping list" h2 above (the
                        // page h1 is the Plan masthead in ListsPage).
                        headingLevel="h3"
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
            ) : sortMode !== 'entry' || filterStore ? (
                items.map((item, index) => {
                    const label = shoppingGroupLabel(item, sortMode);
                    const prev = index > 0 ? items[index - 1] : undefined;
                    const prevLabel = prev ? shoppingGroupLabel(prev, sortMode) : null;
                    // Case-insensitive: the sort already groups "Target"/"target"
                    // adjacently, so casing drift must not split the header.
                    const isNewGroup = label !== null &&
                        label.toLowerCase() !== prevLabel?.toLowerCase();
                    return (
                        <React.Fragment key={item.id}>
                            {/* Section header between groups (store / store-section
                                modes only — shoppingGroupLabel is null for flat modes) */}
                            {isNewGroup && (
                                /* h2 (not div): these group labels are the only
                                   heading level between the page h1 and row
                                   content, so give them real heading semantics
                                   for screen-reader navigation. Same classes —
                                   no visual change. */
                                <h2 className="hairline-divider px-3 pt-2.5 pb-1 text-xxs font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400 bg-brand-50/60 dark:bg-brand-900/40">
                                    {label}
                                </h2>
                            )}
                            <ShoppingItemRow
                                item={item}
                                onCheck={handleCheck}
                                onDelete={handleDelete}
                                onEdit={setEditingItem}
                                isReorderable={false}
                            />
                        </React.Fragment>
                    );
                })
            ) : (
                // as="ul" so the li Reorder.Items nest validly; list-none kills marker styling
                // The ul is the card's direct child, so the parent's first-child
                // border strip misses the li rows one level down — re-apply it
                // here so the add-row card's bottom border stays the single seam
                // line (no doubled hairline).
                <Reorder.Group axis="y" values={items} onReorder={handleReorder} as="ul" className="list-none [&>*:first-child]:border-t-0">
                    {items.map(item => (
                        <ShoppingItemRow
                            key={item.id}
                            item={item}
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
        </div>

        {/* Modals */}
        <QuickRestockDrawer
            isOpen={isRestockDrawerOpen}
            onClose={() => setIsRestockDrawerOpen(false)}
        />
        <PasteImportDrawer
            isOpen={isPasteImportOpen}
            onClose={() => setIsPasteImportOpen(false)}
            householdId={householdId}
        />
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
            footer={
              <div className="p-4 border-t border-brand-200 dark:border-brand-700 flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost-danger"
                  size="lg"
                  aria-label="Delete item"
                  onClick={() => {
                    deleteShoppingItem(editingItem.id);
                    showDeleteUndoToast(editingItem);
                    setEditingItem(null);
                  }}
                >
                  <Trash2 size={20} />
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleSaveEdit}
                  disabled={!editingItem.name.trim()}
                  className="flex-1"
                >
                  Save changes
                </Button>
              </div>
            }
          >
            <ShoppingItemForm
              item={editingItem}
              onChange={setEditingItem}
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
