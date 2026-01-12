import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem } from '@/types/schema';
import { Plus, Trash2, Check, Camera, Loader2, Edit2, X, Store, Sparkles, ChevronDown, Clock, RotateCcw, Settings } from 'lucide-react';
import { parseGroceryReceipt, OptimizableItem } from '@/services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import GroceryCatalogModal from '@/components/modals/GroceryCatalogModal';
import ShoppingSettingsModal from '@/components/meals/ShoppingSettingsModal';
import { QuickRestockRow } from '@/components/meals/QuickRestockRow';
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
    addPantryItem,
    clearPurchasedShoppingItems,
    stores,
    groceryCategories
  } = useHousehold();

  // Combine default and custom categories
  const categories = useMemo(() => {
    return (groceryCategories && groceryCategories.length > 0)
      ? groceryCategories
      : [...GROCERY_CATEGORIES];
  }, [groceryCategories]);

  // Add Form State
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Uncategorized');
  const [newItemStoreId, setNewItemStoreId] = useState<string>('');

  // Modal States
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Filter State
  const [filterStoreId, setFilterStoreId] = useState<string>('all');

  const [isProcessingReceipt, setIsProcessingReceipt] = useState(false);

  // Use the shared grocery optimizer hook
  const { handleOptimize, isOptimizing } = useGroceryOptimizer({
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

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName) return;

    // Resolve store name from ID
    const selectedStore = stores.find(s => s.id === newItemStoreId);

    await addShoppingItem({
      name: newItemName,
      category: newItemCategory,
      isPurchased: false,
      store: selectedStore ? selectedStore.name : undefined
    });
    setNewItemName('');
    // Keep category and store as is for successive adds
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        setIsProcessingReceipt(true);
        const base64 = await fileToBase64(file);
        const items = await parseGroceryReceipt(base64, categories);

        // Add all found items concurrently for better performance
        const results = await Promise.allSettled(items.map(item =>
          addPantryItem({
            name: item.name,
            quantity: item.quantity || '1',
            category: item.category
          })
        ));

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.length - successCount;

        if (successCount > 0) {
          toast.success(`Added ${successCount} items to Pantry from Receipt!`);
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

  const handleSaveEdit = useCallback(async () => {
      if (!editingItem) return;
      const trimmedName = editingItem.name?.trim();
      if (!trimmedName) return;

      // Trim and normalize optional fields
      const trimmedQuantity = editingItem.quantity?.trim();
      const normalizedQuantity = trimmedQuantity === '' ? undefined : trimmedQuantity;

      const trimmedStore = editingItem.store?.trim();
      // Normalize store name against existing stores if possible
      let normalizedStore = trimmedStore === '' ? undefined : trimmedStore;

      if (normalizedStore) {
        const matchingStore = stores.find(s => s.name.toLowerCase() === normalizedStore!.toLowerCase());
        if (matchingStore) {
            normalizedStore = matchingStore.name;
        }
      }

      await updateShoppingItem({
        ...editingItem,
        name: trimmedName,
        quantity: normalizedQuantity,
        store: normalizedStore,
      });
      setEditingItem(null);
      toast.success('Item updated');
  }, [editingItem, updateShoppingItem]);

  // Keyboard support for edit modal
  useEffect(() => {
    if (!editingItem) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingItem(null);
      } else if (e.key === 'Enter' && !e.shiftKey && editingItem.name?.trim()) {
        e.preventDefault();
        handleSaveEdit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingItem, handleSaveEdit]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (filterStoreId === 'all') return shoppingList;

    // Find the store name to filter by
    const storeToFilter = stores.find(s => s.id === filterStoreId);
    if (!storeToFilter) return shoppingList; // Should not happen, but safe fallback

    return shoppingList.filter(item =>
        item.store && item.store.toLowerCase() === storeToFilter.name.toLowerCase()
    );
  }, [shoppingList, filterStoreId, stores]);

  // Group by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    const cat = item.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  // Sort categories alphabetically or custom order
  const sortedCategories = Object.keys(groupedItems).sort();

  return (
    <div className="space-y-6 pb-20">
        <div className="flex justify-between items-center">
             {/* Filter Bar */}
            {stores.length > 0 && (
                <div
                    className="flex items-center gap-2 overflow-x-auto pb-1 max-w-[85%] no-scrollbar"
                    role="group"
                    aria-label="Filter by store"
                >
                    <button
                        onClick={() => setFilterStoreId('all')}
                        aria-pressed={filterStoreId === 'all'}
                        className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            filterStoreId === 'all'
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        All Stores
                    </button>
                    {stores.map(store => (
                        <button
                            key={store.id}
                            onClick={() => setFilterStoreId(store.id)}
                            aria-pressed={filterStoreId === store.id}
                            aria-label={`Filter by ${store.name}`}
                            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                                filterStoreId === store.id
                                ? 'bg-brand-600 text-white border-brand-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <Store className="w-3 h-3" />
                            {store.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Settings Button */}
            <div className={`flex justify-end ${stores.length === 0 ? 'w-full' : ''}`}>
                 <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-gray-500 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors"
                    aria-label="Shopping List Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Quick Add Form */}
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-3">
            <QuickRestockRow />
            <form onSubmit={handleAddSubmit} className="space-y-3">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="Add to list..."
                        className="flex-1 min-w-0 rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500 text-sm py-2"
                    />
                    <div className="relative w-28 sm:w-40 shrink-0">
                        <select
                            value={newItemCategory}
                            onChange={(e) => setNewItemCategory(e.target.value)}
                            className="w-full appearance-none rounded-lg border-gray-300 bg-white focus:ring-brand-500 focus:border-brand-500 text-xs sm:text-sm pl-2 pr-6 py-2 truncate"
                            aria-label="Category"
                        >
                            {categories.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 text-gray-400 pointer-events-none" />
                    </div>
                </div>

                <div className="flex items-center justify-between">
                     {/* Store Chips */}
                                    <div
                        className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-[calc(100%-3rem)]"
                        role="group"
                        aria-label="Select store"
                    >
                        {stores.length > 0 ? (
                            stores.map(store => (
                                <button
                                    key={store.id}
                                    type="button"
                                    onClick={() => setNewItemStoreId(newItemStoreId === store.id ? '' : store.id)}
                                    aria-pressed={newItemStoreId === store.id}
                                    aria-label={`Tag item for ${store.name}`}
                                    className={`shrink-0 px-2 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                                        newItemStoreId === store.id
                                        ? 'bg-brand-100 text-brand-800 border-brand-200'
                                        : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'
                                    }`}
                                >
                                    <Store className="w-3 h-3" />
                                    {store.name}
                                </button>
                            ))
                        ) : (
                             <span className="text-xs text-gray-400 italic pl-1">Add stores in settings to tag items</span>
                        )}
                    </div>

                    <button
                        type="submit"
                        className="btn-primary p-2 shrink-0 rounded-lg ml-auto"
                        aria-label="Add item to shopping list"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>

        <div className="grid grid-cols-2 gap-3">
             <button
                onClick={handleOptimize}
                disabled={isOptimizing || shoppingList.length === 0}
                className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm text-sm font-medium text-brand-700 hover:bg-gray-50 active:bg-gray-100 transition-all w-full"
                title="Optimize your shopping list with AI"
                aria-label="AI Optimize List"
             >
                {isOptimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>AI Optimize</span>
             </button>
             <button
                onClick={() => setIsCatalogOpen(true)}
                className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm text-sm font-medium text-brand-700 hover:bg-gray-50 active:bg-gray-100 transition-all w-full"
                aria-label="Open previously purchased items"
             >
                <Clock className="w-4 h-4" />
                <span>History</span>
             </button>
        </div>

        <label className="flex items-center justify-center gap-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm text-sm font-medium text-brand-700 hover:bg-gray-50 active:bg-gray-100 transition-all w-full cursor-pointer">
          {isProcessingReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          <span>Scan Receipt to Pantry</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReceiptUpload}
            disabled={isProcessingReceipt}
          />
        </label>

        {/* Actions Row */}
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

        {/* List */}
        {shoppingList.length === 0 ? (
             <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                <div className="mb-2 text-4xl">🛒</div>
                <p>Shopping list is empty.</p>
            </div>
        ) : (
            <div className="space-y-4">
                {sortedCategories.map(category => (
                    <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
                        <div className="bg-brand-50 px-4 py-2 border-b border-brand-100 font-semibold text-brand-800 flex justify-between">
                            <span>{category}</span>
                            <span className="text-xs font-normal text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full">
                                {groupedItems[category].filter(i => !i.isPurchased).length} items
                            </span>
                        </div>
                        <div className="divide-y divide-gray-100">
    {groupedItems[category].map(item => (
                                <div key={item.id} className={`p-3 flex items-center gap-3 hover:bg-gray-50 ${item.isPurchased ? 'bg-gray-50' : ''}`}>
                                    <button
                                        onClick={() => toggleShoppingItemPurchased(item.id)}
                                        className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors shrink-0
                                            ${item.isPurchased
                                                ? 'bg-green-500 border-green-500 text-white'
                                                : 'border-gray-300 hover:border-brand-500 text-transparent'}`}
                                        aria-label={item.isPurchased ? `Mark ${item.name} as not purchased` : `Mark ${item.name} as purchased`}
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>

                                    <div className="flex-1 group min-w-0">
                                        <div className={`font-medium truncate ${item.isPurchased ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                            {item.name}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-1">
                                            {item.quantity && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{item.quantity}</span>}
                                            {item.store && (
                                                <span className="flex items-center gap-1 bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded border border-brand-100">
                                                    <Store className="w-3 h-3" /> {item.store}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setEditingItem(item)}
                                            className="p-2 text-gray-400 hover:text-brand-500 rounded-full hover:bg-brand-50"
                                            aria-label={`Edit ${item.name}`}
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => deleteShoppingItem(item.id)}
                                            className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50"
                                            aria-label={`Delete ${item.name}`}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        )}

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
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pb-24 sm:pb-4">
                <div
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    onClick={() => setEditingItem(null)}
                />

                <div
                    className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="edit-item-title"
                >
                    <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
                        <h3 id="edit-item-title" className="text-lg font-bold text-brand-800">Edit Item</h3>
                        <button
                            onClick={() => setEditingItem(null)}
                            className="p-2 text-brand-400 hover:bg-brand-50 rounded-full transition-colors"
                            aria-label="Close edit modal"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div>
                            <label htmlFor="edit-item-name" className="text-xs font-bold text-brand-400 uppercase">Item Name</label>
                            <input
                                id="edit-item-name"
                                type="text"
                                value={editingItem.name}
                                onChange={(e) => setEditingItem({...editingItem, name: e.target.value})}
                                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label htmlFor="edit-item-category" className="text-xs font-bold text-brand-400 uppercase">Category</label>
                                <select
                                    id="edit-item-category"
                                    value={editingItem.category || 'Uncategorized'}
                                    onChange={(e) => setEditingItem({...editingItem, category: e.target.value})}
                                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                                >
                                    {categories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="edit-item-quantity" className="text-xs font-bold text-brand-400 uppercase">Quantity</label>
                                <input
                                    id="edit-item-quantity"
                                    type="text"
                                    value={editingItem.quantity || ''}
                                    onChange={(e) => setEditingItem({...editingItem, quantity: e.target.value})}
                                    placeholder="e.g. 2, 500g"
                                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="edit-item-store" className="text-xs font-bold text-brand-400 uppercase">Store (Optional)</label>
                            <div className="space-y-2 mt-2">
                                <input
                                    id="edit-item-store"
                                    type="text"
                                    value={editingItem.store || ''}
                                    onChange={(e) => setEditingItem({...editingItem, store: e.target.value})}
                                    placeholder="e.g. Costco, Trader Joe's"
                                    className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                                />

                                {/* Quick Store Chips in Edit Modal */}
                                {stores.length > 0 && (
                                    <div
                                        className="flex flex-wrap gap-2"
                                        role="group"
                                        aria-label="Select store"
                                    >
                                        {stores.map(store => (
                                            <button
                                                key={store.id}
                                                type="button"
                                                onClick={() => setEditingItem({...editingItem, store: store.name})}
                                                aria-pressed={editingItem.store === store.name}
                                                aria-label={`Tag item for ${store.name}`}
                                                className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                                                    editingItem.store === store.name
                                                    ? 'bg-brand-100 text-brand-800 border-brand-200'
                                                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                                }`}
                                            >
                                                <Store className="w-3 h-3" />
                                                {store.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t border-brand-100 flex-shrink-0">
                        <button
                            onClick={handleSaveEdit}
                            disabled={!editingItem.name?.trim()}
                            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
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
