import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem } from '@/types/schema';
import { Plus, Download, Sparkles, Loader2, Clock, Camera, RotateCcw, X, Settings, Store, Share2 } from 'lucide-react';
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

// Helper for image file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
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
    householdId
  } = useHousehold();

  // Combine default and custom categories
  const categories = useMemo(() => {
    return (groceryCategories && groceryCategories.length > 0)
      ? groceryCategories
      : [...GROCERY_CATEGORIES];
  }, [groceryCategories]);

  // Local state for Reorder.Group
  const [items, setItems] = useState<ShoppingItem[]>([]);

  // Sync local items with context shoppingList, respecting order
  useEffect(() => {
    // Sort items by order field, then by creation or name as fallback
    const sorted = [...shoppingList].sort((a, b) => {
      const orderA = a.order ?? 9999;
      const orderB = b.order ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      // Fallback to name
      return a.name.localeCompare(b.name);
    });
    setItems(sorted);
  }, [shoppingList]);

  // Input State
  const [newItemText, setNewItemText] = useState('');

  // Modal States
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProcessingReceipt, setIsProcessingReceipt] = useState(false);

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
    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.order || 0)) : 0;

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

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        if (!householdId) throw new Error("Household ID not found");
        setIsProcessingReceipt(true);
        const base64 = await fileToBase64(file);
        const { parseGroceryReceipt } = await import('@/services/geminiService');
        const items = await parseGroceryReceipt(householdId, base64, categories);

        // Add all found items to shopping list as purchased
        const results = await Promise.allSettled(items.map(item =>
          addShoppingItem({
            name: item.name,
            quantity: item.quantity || '1',
            category: item.category,
            isPurchased: true,
          })
        ));

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.length - successCount;

        if (successCount > 0) {
          toast.success(`Added ${successCount} items from receipt!`);
        }

        if (failureCount > 0) {
          console.error('Failed to add some items:', results.filter(r => r.status === 'rejected'));
          toast.error(`Failed to add ${failureCount} items.`);
        }

      } catch (error) {
         console.error(error);
         toast.error("Failed to parse receipt");
      } finally {
        setIsProcessingReceipt(false);
        e.target.value = ''; // Reset file input
      }
    };

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

  return (
    <div className="space-y-6 pb-20">
        {/* Header Actions */}
        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold">Shopping List</h1>
            <div className="flex gap-2">
                <button
                    onClick={handleShareList}
                    disabled={!hasPendingItems}
                    className="p-2 text-gray-500 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors disabled:opacity-50"
                    title="Copy list to clipboard"
                    aria-label="Copy list to clipboard"
                >
                    <Share2 className="w-5 h-5" />
                </button>
                <button
                    onClick={handleExport}
                    disabled={shoppingList.length === 0}
                    className="p-2 text-gray-500 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors disabled:opacity-50"
                    aria-label="Export to CSV"
                >
                    <Download className="w-5 h-5" />
                </button>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-gray-500 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors"
                    aria-label="Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Quick Add Input */}
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-3">
             <QuickRestockRow />
             <form onSubmit={handleSmartAdd} className="relative">
                <input
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder="Add item (e.g. Milk)..."
                    className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
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

        {/* Helper Actions Row: AI, History, Scan */}
        <div className="flex items-center gap-2">
             <button
                onClick={handleOptimize}
                disabled={isOptimizing || shoppingList.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 p-2 bg-white border border-gray-200 rounded-lg shadow-sm text-xs font-medium text-gray-600 hover:text-brand-600 hover:bg-gray-50 active:bg-gray-100 transition-all disabled:opacity-50"
                title="AI Optimize List"
             >
                {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Optimize</span>
             </button>

             <button
                onClick={() => setIsCatalogOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 p-2 bg-white border border-gray-200 rounded-lg shadow-sm text-xs font-medium text-gray-600 hover:text-brand-600 hover:bg-gray-50 active:bg-gray-100 transition-all"
                title="View Item History"
             >
                <Clock className="w-3.5 h-3.5" />
                <span>History</span>
             </button>

             <label className="flex-1 flex items-center justify-center gap-1.5 p-2 bg-white border border-gray-200 rounded-lg shadow-sm text-xs font-medium text-gray-600 hover:text-brand-600 hover:bg-gray-50 active:bg-gray-100 transition-all cursor-pointer disabled:opacity-50">
                {isProcessingReceipt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                <span>Scan Receipt</span>
                <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleReceiptUpload}
                    disabled={isProcessingReceipt}
                />
            </label>
        </div>

        {/* Clear Checked */}
        {shoppingList.some(i => i.isPurchased) && (
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
             <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                <div className="mb-2 text-4xl">🛒</div>
                <p>Shopping list is empty.</p>
            </div>
        ) : (
            <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="space-y-2">
                {items.map(item => (
                    <ShoppingItemRow
                        key={item.id}
                        item={item}
                        onCheck={handleCheck}
                        onDelete={handleDelete}
                        onEdit={setEditingItem}
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
            onClose={() => setIsSettingsOpen(false)}
        />

        {/* Edit Modal */}
        {editingItem && (
            <div className="fixed inset-0 z-modal flex items-center justify-center p-4 pb-24 sm:pb-4">
                <div
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    onClick={() => setEditingItem(null)}
                />
                <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
                        <h3 className="text-lg font-bold text-brand-800">Edit Item</h3>
                        <button onClick={() => setEditingItem(null)}><X className="w-5 h-5 text-gray-400" /></button>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="text-xs font-bold text-brand-400 uppercase">Item Name</label>
                            <input
                                type="text"
                                value={editingItem.name}
                                onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="text-xs font-bold text-brand-400 uppercase">Category</label>
                                <select
                                    value={editingItem.category || 'Uncategorized'}
                                    onChange={(e) => setEditingItem({...editingItem, category: e.target.value})}
                                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500"
                                >
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-brand-400 uppercase">Quantity</label>
                                <input
                                    type="text"
                                    value={editingItem.quantity || ''}
                                    onChange={(e) => setEditingItem({...editingItem, quantity: e.target.value})}
                                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-brand-400 uppercase">Store</label>
                            <input
                                type="text"
                                value={editingItem.store || ''}
                                onChange={(e) => setEditingItem({...editingItem, store: e.target.value})}
                                placeholder="Optional"
                                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500"
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
                                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            <Store size={10} /> {store.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="p-4 border-t border-brand-100">
                        <button
                            onClick={handleSaveEdit}
                            disabled={!editingItem.name.trim()}
                            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 disabled:opacity-50"
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
