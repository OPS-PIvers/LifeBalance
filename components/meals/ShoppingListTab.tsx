import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMeals, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem, QuickStockList } from '@/types/schema';
import { Plus, Download, Sparkles, Loader2, Clock, Filter, RotateCcw, X, Settings, Share2, Save, ShoppingCart } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import { OptimizableItem } from '@/services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import GroceryCatalogModal from '@/components/modals/GroceryCatalogModal';
import ShoppingSettingsModal from '@/components/meals/ShoppingSettingsModal';
import { ShoppingItemRow } from '@/components/meals/ShoppingItemRow';
import { QuickRestockRow } from '@/components/meals/QuickRestockRow';
import { ShoppingItemForm } from '@/components/meals/ShoppingItemForm';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { haptic } from '@/utils/haptics';
import { generateCsvExport } from '@/utils/exportUtils';
import { formatShoppingListForShare } from '@/utils/shoppingListFormatter';
import toast from 'react-hot-toast';

interface FilterDropdownProps {
  filterStore: string | null;
  stores: { id: string; name: string }[];
  onSelect: (name: string | null) => void;
  onClose: () => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({ filterStore, stores, onSelect, onClose }) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />
      <div
        ref={dropdownRef}
        role="listbox"
        aria-label="Filter by store"
        className="absolute top-full right-0 mt-2 w-48 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-xl shadow-glass ring-1 ring-black/5 dark:ring-white/5 z-20 py-1 overflow-hidden animate-in zoom-in-95 duration-200"
      >
        <div className="max-h-60 scroll-contain-y">
          <button
            role="option"
            aria-selected={!filterStore}
            onClick={() => onSelect(null)}
            className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-between ${!filterStore ? 'text-brand-600 font-medium bg-brand-50/50 dark:text-brand-300 dark:bg-brand-700/30' : 'text-slate-700 dark:text-slate-300'}`}
          >
            All Items
            {!filterStore && <Filter size={14} />}
          </button>
          {stores.map(store => (
            <button
              key={store.id}
              role="option"
              aria-selected={filterStore === store.name}
              onClick={() => onSelect(store.name)}
              className={`w-full text-left px-4 py-2 min-h-[44px] text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-between ${filterStore === store.name ? 'text-brand-600 font-medium bg-brand-50/50 dark:text-brand-300 dark:bg-brand-700/30' : 'text-slate-700 dark:text-slate-300'}`}
            >
              {store.name}
              {filterStore === store.name && <Filter size={14} />}
            </button>
          ))}
          {stores.length === 0 && (
            <div className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500 italic">No stores configured</div>
          )}
        </div>
      </div>
    </>
  );
};

const ShoppingListTab: React.FC = () => {
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
    updateQuickStockList,
  } = useMeals();
  const { householdId } = useHouseholdCore();

  const isDesktop = useMediaQuery('(min-width: 640px)');

  // Combine default and custom categories
  const categories = useMemo(() => {
    return (groceryCategories && groceryCategories.length > 0)
      ? groceryCategories
      : [...GROCERY_CATEGORIES];
  }, [groceryCategories]);

  // Pre-calculate active quick list for each item name to avoid expensive find in each row
  const itemQuickListMap = useMemo(() => {
    const map = new Map<string, QuickStockList>();
    if (!quickStockLists || !groceryCatalog) return map;

    // 1. Map Catalog ID -> QuickStockList
    const idToListMap = new Map<string, QuickStockList>();
    for (const list of quickStockLists) {
      if (!list.items) continue;
      for (const itemId of list.items) {
        if (!idToListMap.has(itemId)) {
          idToListMap.set(itemId, list);
        }
      }
    }

    // 2. Map Name -> QuickStockList
    for (const item of groceryCatalog) {
      const list = idToListMap.get(item.id);
      if (list) {
        map.set(item.name.toLowerCase(), list);
      }
    }
    return map;
  }, [quickStockLists, groceryCatalog]);

  // Local state for Reorder.Group
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [filterStore, setFilterStore] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

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

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(sorted);
  }, [shoppingList, filterStore]);

  // Input State
  const [newItemText, setNewItemText] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

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

  // Derive hasPendingItems to optimize render loop for disabled state
  const hasPendingItems = shoppingList.some(i => !i.isPurchased);

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

    const handleUpdateItem = useCallback((item: ShoppingItem) => {
        updateShoppingItem(item);
    }, [updateShoppingItem]);

    const handleQuickListChange = useCallback(async (item: ShoppingItem, newListId: string) => {
        if (!householdId) return;

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

            // 2. Update Membership using Context Actions (compatible with Mock Mode)

            // First, remove from any OTHER lists
            for (const list of quickStockLists) {
                const hasItem = list.items?.includes(catalogItemId);

                if (list.id === newListId) {
                    // This is the target list.
                    // If it doesn't have it, add it.
                    if (!hasItem) {
                        await updateQuickStockList({
                            ...list,
                            items: [...(list.items || []), catalogItemId]
                        });
                    }
                } else {
                    // This is NOT the target list.
                    // If it has it, remove it.
                    if (hasItem) {
                        await updateQuickStockList({
                            ...list,
                            items: (list.items || []).filter(id => id !== catalogItemId)
                        });
                    }
                }
            }

            // Note: If newListId is empty string, the loop correctly just removes from all.

            toast.success(newListId ? 'List updated' : 'Removed from list');
        } catch (error) {
            console.error('Failed to update quick list:', error);
            toast.error('Failed to update list');
        }
    }, [householdId, groceryCatalog, quickStockLists, addGroceryCatalogItem, updateQuickStockList]);

  return (
    <div className="space-y-6 pb-20">
        {/* Header Actions */}
        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Shopping List</h1>
            <div className="flex gap-2">
                <button
                    onClick={handleSaveAsTemplate}
                    disabled={shoppingList.length === 0}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                    title="Save as Template"
                    aria-label="Save as Template"
                >
                    <Save className="w-5 h-5" />
                </button>
                <button
                    onClick={handleShareList}
                    disabled={!hasPendingItems}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                    title="Copy list to clipboard"
                    aria-label="Copy list to clipboard"
                >
                    <Share2 className="w-5 h-5" />
                </button>
                <button
                    onClick={handleExport}
                    disabled={shoppingList.length === 0}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                    aria-label="Export to CSV"
                >
                    <Download className="w-5 h-5" />
                </button>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                    aria-label="Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Quick Add Input */}
        <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl p-4 rounded-xl shadow-glass ring-1 ring-black/5 dark:ring-white/5 space-y-3">
             <QuickRestockRow />
             <form onSubmit={handleSmartAdd} className="relative">
                <input
                    ref={addInputRef}
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder="Add item (e.g. Milk)..."
                    className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none placeholder:text-slate-400 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500"
                    autoFocus
                />
                <button
                    type="submit"
                    disabled={!newItemText.trim()}
                    aria-label="Add item to shopping list"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-brand-800 text-white rounded-xl hover:bg-brand-900 disabled:opacity-50 disabled:bg-gray-300 transition-colors dark:bg-brand-600 dark:hover:bg-brand-500 dark:disabled:bg-slate-600"
                >
                    <Plus size={20} />
                </button>
             </form>
        </div>

        {/* Helper Actions Row: AI, History, Scan */}
        <div className="flex items-center gap-2">
             <button
                onClick={handleOptimize}
                disabled={isOptimizing || shoppingList.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700 rounded-xl shadow-sm text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-violet-600 hover:bg-violet-50/50 hover:border-violet-200/50 dark:hover:text-violet-300 dark:hover:bg-violet-500/15 dark:hover:border-violet-500/30 active:scale-95 transition-all disabled:opacity-50"
                title="AI Optimize List"
             >
                {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Optimize</span>
             </button>

             <button
                onClick={() => setIsCatalogOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700 rounded-xl shadow-sm text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 hover:bg-indigo-50/50 hover:border-indigo-200/50 dark:hover:text-indigo-300 dark:hover:bg-indigo-500/15 dark:hover:border-indigo-500/30 active:scale-95 transition-all"
                title="View Item History"
             >
                <Clock className="w-3.5 h-3.5" />
                <span>History</span>
             </button>

             <div className="relative flex-1">
               <button
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  aria-label={filterStore ? `Filter by store: ${filterStore}` : 'Filter by store'}
                  aria-expanded={isFilterOpen}
                  aria-haspopup="listbox"
                  className={`w-full flex items-center justify-center gap-1.5 p-2.5 border rounded-xl shadow-sm text-xs font-medium transition-all ${
                    filterStore
                      ? 'bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-700/30 dark:border-brand-500/40 dark:text-brand-200'
                      : 'bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-slate-200/50 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-50 dark:hover:text-slate-100 dark:hover:bg-slate-700/50'
                  }`}
               >
                  <Filter className="w-3.5 h-3.5" />
                  <span>{filterStore ? filterStore : 'Filter'}</span>
               </button>

               {isFilterOpen && (
                 <FilterDropdown
                   filterStore={filterStore}
                   stores={stores}
                   onSelect={(name) => { setFilterStore(name); setIsFilterOpen(false); }}
                   onClose={() => setIsFilterOpen(false)}
                 />
               )}
             </div>
        </div>

        {/* Clear Filter Indicator */}
        {filterStore && (
            <div className="flex justify-center -mt-2">
                <button
                    onClick={() => setFilterStore(null)}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:underline bg-brand-50 px-2 py-1 rounded-full border border-brand-100 dark:text-brand-300 dark:bg-brand-700/30 dark:border-brand-500/30"
                >
                    <X size={10} />
                    Clear filter: {filterStore}
                </button>
            </div>
        )}

        {/* Clear Checked */}
        {shoppingList.some(i => i.isPurchased) && (
            <div className="flex justify-end">
                <button
                    onClick={() => setIsClearCheckedConfirmOpen(true)}
                    className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-800 px-3 py-1 bg-brand-50 hover:bg-brand-100 rounded-full transition-colors dark:text-brand-300 dark:hover:text-brand-200 dark:bg-brand-700/30 dark:hover:bg-brand-700/50"
                >
                    <RotateCcw className="w-3 h-3" />
                    Clear Checked
                </button>
            </div>
        )}

        {/* Main List */}
        {items.length === 0 ? (
             <div className="text-center py-16 px-6 bg-white/50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200/60 dark:border-slate-700">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 dark:text-slate-500">
                    <ShoppingCart className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {filterStore ? `Nothing for ${filterStore}` : 'Your list is empty'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">
                    {filterStore ? 'No items match this store filter.' : 'Add items above to start your shopping list.'}
                </p>
                {filterStore ? (
                    <Button variant="secondary" onClick={() => setFilterStore(null)}>
                        Clear Filter
                    </Button>
                ) : (
                    <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => addInputRef.current?.focus()}>
                        Add Item
                    </Button>
                )}
            </div>
        ) : filterStore ? (
             <div className="space-y-2">
                {items.map(item => (
                    <ShoppingItemRow
                        key={item.id}
                        item={item}
                        stores={stores}
                        quickStockLists={quickStockLists}
                        activeQuickList={itemQuickListMap.get(item.name.toLowerCase())}
                        onCheck={handleCheck}
                        onDelete={handleDelete}
                        onEdit={setEditingItem}
                        onUpdate={handleUpdateItem}
                        onQuickListChange={handleQuickListChange}
                        isReorderable={false}
                    />
                ))}
            </div>
        ) : (
            <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="space-y-2">
                {items.map(item => (
                    <ShoppingItemRow
                        key={item.id}
                        item={item}
                        stores={stores}
                        quickStockLists={quickStockLists}
                        activeQuickList={itemQuickListMap.get(item.name.toLowerCase())}
                        onCheck={handleCheck}
                        onDelete={handleDelete}
                        onEdit={setEditingItem}
                        onUpdate={handleUpdateItem}
                        onQuickListChange={handleQuickListChange}
                        onReorderDragStart={handleReorderDragStart}
                        onReorderDragEnd={handleReorderDragEnd}
                    />
                ))}
            </Reorder.Group>
        )}

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

        {/* Edit Modal / Drawer */}
        {editingItem && (() => {
          const itemForm = (
            <ShoppingItemForm
              item={editingItem}
              onChange={setEditingItem}
              onSave={handleSaveEdit}
              stores={stores}
              categories={categories}
            />
          );

          const WrapperComponent = isDesktop ? Modal : Drawer;
          const wrapperProps = {
            isOpen: !!editingItem,
            onClose: () => setEditingItem(null),
            ...(isDesktop ? { className: "overflow-visible" } : { title: "Edit Item" })
          };

          return (
            <WrapperComponent {...wrapperProps}>
              {isDesktop && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/50 dark:border-slate-700">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Edit Item</h3>
                  <button onClick={() => setEditingItem(null)}><X className="w-5 h-5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" /></button>
                </div>
              )}
              {itemForm}
            </WrapperComponent>
          );
        })()}

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
