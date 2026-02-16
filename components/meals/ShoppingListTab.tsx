import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem, QuickStockList } from '@/types/schema';
import { Plus, Download, Sparkles, Loader2, Clock, Filter, RotateCcw, X, Settings, Store, Share2, Save, CheckSquare, Trash2, Check } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import { OptimizableItem } from '@/services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import GroceryCatalogModal from '@/components/modals/GroceryCatalogModal';
import ShoppingSettingsModal from '@/components/meals/ShoppingSettingsModal';
import { ShoppingItemRow } from '@/components/meals/ShoppingItemRow';
import { QuickRestockRow } from '@/components/meals/QuickRestockRow';
import { generateCsvExport } from '@/utils/exportUtils';
import { formatShoppingListForShare } from '@/utils/shoppingListFormatter';
import toast from 'react-hot-toast';

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
    householdId
  } = useHousehold();

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

  // Selection Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // Use a ref for drag state to prevent re-renders and potential race conditions
  // caused by the dependency array in useEffect.
  const isDraggingRef = useRef(false);

  // Sync local items with context shoppingList, respecting order
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

  // Modal States
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTemplate, setSettingsInitialTemplate] = useState<Partial<QuickStockList> | null>(null);

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
  };

  // Derive hasPendingItems to optimize render loop for disabled state
  const hasPendingItems = shoppingList.some(i => !i.isPurchased);

  const handleReorder = (newOrder: ShoppingItem[]) => {
    setItems(newOrder);
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

            toast.success(newListId ? 'List updated' : 'Removed from list');
        } catch (error) {
            console.error('Failed to update quick list:', error);
            toast.error('Failed to update list');
        }
    }, [householdId, groceryCatalog, quickStockLists, addGroceryCatalogItem, updateQuickStockList]);

    // Batch Action Handlers
    const toggleSelection = useCallback((item: ShoppingItem) => {
        setSelectedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(item.id)) {
                newSet.delete(item.id);
            } else {
                newSet.add(item.id);
            }
            return newSet;
        });
    }, []);

    const handleBatchPurchase = async () => {
        if (selectedItems.size === 0) return;
        setIsBatchProcessing(true);
        try {
            // We want to force purchase=true for all selected
            const promises = Array.from(selectedItems).map(id => {
                const item = shoppingList.find(i => i.id === id);
                if (item && !item.isPurchased) {
                    return updateShoppingItem({ ...item, isPurchased: true });
                }
                return Promise.resolve();
            });
            await Promise.allSettled(promises);
            toast.success(`${selectedItems.size} items marked purchased`);
            setSelectedItems(new Set());
            setIsSelectionMode(false);
        } catch (error) {
            console.error("Batch purchase failed", error);
            toast.error("Failed to update items");
        } finally {
            setIsBatchProcessing(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedItems.size === 0) return;
        if (!window.confirm(`Delete ${selectedItems.size} items?`)) return;

        setIsBatchProcessing(true);
        try {
            const promises = Array.from(selectedItems).map(id => deleteShoppingItem(id));
            await Promise.allSettled(promises);
            toast.success(`${selectedItems.size} items deleted`);
            setSelectedItems(new Set());
            setIsSelectionMode(false);
        } catch (error) {
            console.error("Batch delete failed", error);
            toast.error("Failed to delete items");
        } finally {
            setIsBatchProcessing(false);
        }
    };

  return (
    <div className="space-y-6 pb-20">
        {/* Header Actions */}
        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shopping List</h1>
            <div className="flex gap-2">
                <button
                    onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        setSelectedItems(new Set());
                    }}
                    className={`p-2 rounded-full transition-colors ${
                        isSelectionMode ? 'bg-brand-100 text-brand-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Select Multiple Items"
                    aria-label="Select Multiple Items"
                >
                    <CheckSquare className="w-5 h-5" />
                </button>
                <button
                    onClick={handleSaveAsTemplate}
                    disabled={shoppingList.length === 0 || isSelectionMode}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                    title="Save as Template"
                    aria-label="Save as Template"
                >
                    <Save className="w-5 h-5" />
                </button>
                <button
                    onClick={handleShareList}
                    disabled={!hasPendingItems || isSelectionMode}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                    title="Copy list to clipboard"
                    aria-label="Copy list to clipboard"
                >
                    <Share2 className="w-5 h-5" />
                </button>
                <button
                    onClick={handleExport}
                    disabled={shoppingList.length === 0 || isSelectionMode}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                    aria-label="Export to CSV"
                >
                    <Download className="w-5 h-5" />
                </button>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    disabled={isSelectionMode}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                    aria-label="Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Quick Add Input (Hidden in Selection Mode) */}
        {!isSelectionMode && (
            <div className="bg-white/80 backdrop-blur-xl p-4 rounded-xl shadow-glass ring-1 ring-black/5 space-y-3">
                <QuickRestockRow />
                <form onSubmit={handleSmartAdd} className="relative">
                    <input
                        type="text"
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        placeholder="Add item (e.g. Milk)..."
                        className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none placeholder:text-slate-400"
                        autoFocus
                    />
                    <button
                        type="submit"
                        disabled={!newItemText.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-brand-800 text-white rounded-lg hover:bg-brand-900 disabled:opacity-50 disabled:bg-gray-300 transition-colors"
                    >
                        <Plus size={18} />
                    </button>
                </form>
            </div>
        )}

        {/* Helper Actions Row: AI, History, Scan (Hidden in Selection Mode) */}
        {!isSelectionMode && (
            <div className="flex items-center gap-2">
                <button
                    onClick={handleOptimize}
                    disabled={isOptimizing || shoppingList.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-white/60 backdrop-blur-sm border border-slate-200/50 rounded-xl shadow-sm text-xs font-medium text-slate-600 hover:text-violet-600 hover:bg-violet-50/50 hover:border-violet-200/50 active:scale-95 transition-all disabled:opacity-50"
                    title="AI Optimize List"
                >
                    {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Optimize</span>
                </button>

                <button
                    onClick={() => setIsCatalogOpen(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 p-2.5 bg-white/60 backdrop-blur-sm border border-slate-200/50 rounded-xl shadow-sm text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/50 hover:border-indigo-200/50 active:scale-95 transition-all"
                    title="View Item History"
                >
                    <Clock className="w-3.5 h-3.5" />
                    <span>History</span>
                </button>

                <div className="relative flex-1">
                <button
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    className={`w-full flex items-center justify-center gap-1.5 p-2.5 border rounded-xl shadow-sm text-xs font-medium transition-all ${
                        filterStore
                        ? 'bg-brand-50 border-brand-200 text-brand-700'
                        : 'bg-white/60 backdrop-blur-sm border-slate-200/50 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                >
                    <Filter className="w-3.5 h-3.5" />
                    <span>{filterStore ? filterStore : 'Filter'}</span>
                </button>

                {isFilterOpen && (
                    <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                    <div className="absolute top-full right-0 mt-2 w-48 bg-white/90 backdrop-blur-xl rounded-xl shadow-glass ring-1 ring-black/5 z-20 py-1 overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="max-h-60 overflow-y-auto">
                            <button
                            onClick={() => {
                                setFilterStore(null);
                                setIsFilterOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${!filterStore ? 'text-brand-600 font-medium bg-brand-50/50' : 'text-slate-700'}`}
                            >
                            All Items
                            {!filterStore && <Filter size={14} />}
                            </button>
                            {stores.map(store => (
                            <button
                                key={store.id}
                                onClick={() => {
                                setFilterStore(store.name);
                                setIsFilterOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${filterStore === store.name ? 'text-brand-600 font-medium bg-brand-50/50' : 'text-slate-700'}`}
                            >
                                {store.name}
                                {filterStore === store.name && <Filter size={14} />}
                            </button>
                            ))}
                            {stores.length === 0 && (
                            <div className="px-4 py-2 text-xs text-slate-400 italic">No stores configured</div>
                            )}
                        </div>
                    </div>
                    </>
                )}
                </div>
            </div>
        )}

        {/* Selection Instructions */}
        {isSelectionMode && items.length > 0 && (
             <div className="text-center pb-2">
                 <p className="text-sm text-brand-600 font-medium">Select items to batch process</p>
                 <button
                    onClick={() => setSelectedItems(new Set(items.map(i => i.id)))}
                    className="text-xs text-brand-500 hover:text-brand-700 underline mt-1"
                 >
                    Select All
                 </button>
             </div>
        )}

        {/* Clear Filter Indicator */}
        {filterStore && !isSelectionMode && (
            <div className="flex justify-center -mt-2">
                <button
                    onClick={() => setFilterStore(null)}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:underline bg-brand-50 px-2 py-1 rounded-full border border-brand-100"
                >
                    <X size={10} />
                    Clear filter: {filterStore}
                </button>
            </div>
        )}

        {/* Clear Checked (Hidden in Selection Mode) */}
        {shoppingList.some(i => i.isPurchased) && !isSelectionMode && (
            <div className="flex justify-end">
                <button
                    onClick={() => {
                        if (window.confirm('Clear all checked items?')) {
                            clearPurchasedShoppingItems();
                        }
                    }}
                    className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-800 px-3 py-1 bg-brand-50 hover:bg-brand-100 rounded-full transition-colors"
                >
                    <RotateCcw className="w-3 h-3" />
                    Clear Checked
                </button>
            </div>
        )}

        {/* Main List */}
        {items.length === 0 ? (
             <div className="text-center py-12 text-slate-400 bg-white/50 rounded-xl border border-dashed border-slate-200/60">
                <div className="mb-3 text-4xl opacity-50">🛒</div>
                <p className="text-sm font-medium">{filterStore ? `No items for ${filterStore}` : 'Shopping list is empty.'}</p>
                {filterStore && (
                    <button onClick={() => setFilterStore(null)} className="mt-2 text-brand-600 font-medium text-xs hover:underline">
                        Clear Filter
                    </button>
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
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedItems.has(item.id)}
                        onToggleSelection={toggleSelection}
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
                        isReorderable={!isSelectionMode}
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedItems.has(item.id)}
                        onToggleSelection={toggleSelection}
                    />
                ))}
            </Reorder.Group>
        )}

        {/* Floating Action Bar (FAB) for Batch Actions */}
        {isSelectionMode && selectedItems.size > 0 && (
            <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-dropdown pointer-events-none">
                <div className="bg-brand-900 text-white p-2 rounded-2xl shadow-xl flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
                    <div className="px-3 font-bold text-sm border-r border-brand-700">
                        {selectedItems.size} selected
                    </div>

                    <button
                        onClick={handleBatchPurchase}
                        disabled={isBatchProcessing}
                        className="flex flex-col items-center justify-center h-auto gap-0.5 px-3 py-1 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        {isBatchProcessing ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                        <span className="text-[10px] font-medium uppercase tracking-wide">Bought</span>
                    </button>

                    <button
                        onClick={handleBatchDelete}
                        disabled={isBatchProcessing}
                        className="flex flex-col items-center justify-center h-auto gap-0.5 px-3 py-1 hover:bg-white/10 rounded-lg text-red-300 hover:text-red-200 transition-colors"
                    >
                        {isBatchProcessing ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                        <span className="text-[10px] font-medium uppercase tracking-wide">Delete</span>
                    </button>

                    <button
                        onClick={() => {
                            setSelectedItems(new Set());
                            setIsSelectionMode(false);
                        }}
                        disabled={isBatchProcessing}
                        className="flex flex-col items-center justify-center h-auto gap-0.5 px-3 py-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors border-l border-brand-700 ml-1"
                    >
                        <X size={18} />
                        <span className="text-[10px] font-medium uppercase tracking-wide">Cancel</span>
                    </button>
                </div>
            </div>
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

        {/* Edit Modal */}
        {editingItem && (
            <div className="fixed inset-0 z-modal flex items-center justify-center p-4 pb-24 sm:pb-4">
                <div
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    onClick={() => setEditingItem(null)}
                />
                <div className="relative w-full max-w-md bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/50">
                        <h3 className="text-lg font-bold text-slate-900 tracking-tight">Edit Item</h3>
                        <button onClick={() => setEditingItem(null)}><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Item Name</label>
                            <input
                                type="text"
                                value={editingItem.name}
                                onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                                className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-900 font-medium"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Category</label>
                                <select
                                    value={editingItem.category || 'Uncategorized'}
                                    onChange={(e) => setEditingItem({...editingItem, category: e.target.value})}
                                    className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700"
                                >
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quantity</label>
                                <input
                                    type="text"
                                    value={editingItem.quantity || ''}
                                    onChange={(e) => setEditingItem({...editingItem, quantity: e.target.value})}
                                    className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Store</label>
                            <input
                                type="text"
                                value={editingItem.store || ''}
                                onChange={(e) => setEditingItem({...editingItem, store: e.target.value})}
                                placeholder="Optional"
                                className="w-full mt-1 p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 text-slate-700"
                            />
                             {/* Quick Store Chips in Edit Modal */}
                             {stores.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {stores.map(store => (
                                        <button
                                            key={store.id}
                                            type="button"
                                            onClick={() => setEditingItem({...editingItem, store: store.name})}
                                            className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                                                editingItem.store === store.name
                                                ? 'bg-brand-100 text-brand-800 border-brand-200'
                                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            <Store size={10} /> {store.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="p-4 border-t border-slate-200/50 bg-white/50">
                        <button
                            onClick={handleSaveEdit}
                            disabled={!editingItem.name.trim()}
                            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 disabled:opacity-50 hover:bg-brand-900 transition-all"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default ShoppingListTab;
