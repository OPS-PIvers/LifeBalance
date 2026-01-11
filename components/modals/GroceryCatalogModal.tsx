import React, { useState, useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { GroceryCatalogItem } from '@/types/schema';
import { X, Search, Plus, Trash2, Edit2, ShoppingCart, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

interface GroceryCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const GroceryCatalogModal: React.FC<GroceryCatalogModalProps> = ({ isOpen, onClose }) => {
  const {
    groceryCatalog,
    shoppingList,
    addShoppingItem,
    updateGroceryCatalogItem,
    deleteGroceryCatalogItem
  } = useHousehold();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState<GroceryCatalogItem | null>(null);

  // Filter and sort catalog items
  const filteredCatalog = useMemo(() => {
    return groceryCatalog
      .filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        // Sort by frequency (descending) then by recency (descending)
        if (b.purchaseCount !== a.purchaseCount) {
          return b.purchaseCount - a.purchaseCount;
        }
        if (a.lastPurchased && b.lastPurchased) {
          return new Date(b.lastPurchased).getTime() - new Date(a.lastPurchased).getTime();
        }
        return a.name.localeCompare(b.name);
      });
  }, [groceryCatalog, searchQuery]);

  const handleAddItem = async (catalogItem: GroceryCatalogItem) => {
    // Check if already in shopping list (unpurchased)
    const isInList = shoppingList.some(
      i => !i.isPurchased && i.name.toLowerCase() === catalogItem.name.toLowerCase()
    );

    if (isInList) {
      toast('Already in your list!', { icon: '🛒' });
      return;
    }

    await addShoppingItem({
      name: catalogItem.name,
      category: catalogItem.category,
      quantity: catalogItem.defaultQuantity,
      store: catalogItem.defaultStore,
      isPurchased: false
    });
    // Toast is handled by addShoppingItem, but let's give a specific visual cue if needed
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;

    await updateGroceryCatalogItem(editingItem.id, {
      name: editingItem.name,
      category: editingItem.category,
      defaultQuantity: editingItem.defaultQuantity,
      defaultStore: editingItem.defaultStore
    });

    setEditingItem(null);
  };

  const handleDeleteItem = async (id: string) => {
    if (window.confirm('Remove from history? This won\'t affect your current list or pantry.')) {
      await deleteGroceryCatalogItem(id);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pb-24 sm:pb-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0 bg-white z-10">
          <div>
            <h3 id="catalog-title" className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand-500" />
              Previously Purchased
            </h3>
            <p className="text-xs text-gray-500">Quickly add items back to your list</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredCatalog.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No history found matching "{searchQuery}"</p>
              <p className="text-xs mt-1">Items you check off your shopping list will appear here.</p>
            </div>
          ) : (
            filteredCatalog.map(item => (
              <div
                key={item.id}
                className="group flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl hover:border-brand-200 hover:shadow-sm transition-all"
              >
                {/* Add Button Area */}
                <button
                  onClick={() => handleAddItem(item)}
                  className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center hover:bg-brand-100 hover:scale-105 transition-all shrink-0"
                  aria-label={`Add ${item.name} to list`}
                >
                  <Plus className="w-5 h-5" />
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleAddItem(item)}>
                  <div className="font-medium text-gray-900 truncate">{item.name}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{item.category}</span>
                    {item.defaultStore && <span className="truncate max-w-[80px] text-gray-400">• {item.defaultStore}</span>}
                    {item.lastPurchased && (
                      <span className="text-gray-300">• {formatDistanceToNow(new Date(item.lastPurchased))} ago</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingItem(item)}
                    className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-full"
                    aria-label="Edit history item"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full"
                    aria-label="Delete from history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Nested Edit Modal */}
      {editingItem && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-in zoom-in-95">
            <h4 className="text-lg font-bold text-gray-800 mb-4">Edit History Item</h4>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Name</label>
                <input
                  type="text"
                  value={editingItem.name}
                  onChange={e => setEditingItem({...editingItem, name: e.target.value})}
                  className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Category</label>
                <input
                  type="text"
                  value={editingItem.category}
                  onChange={e => setEditingItem({...editingItem, category: e.target.value})}
                  className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                   <label className="text-xs font-bold text-gray-400 uppercase">Default Qty</label>
                   <input
                    type="text"
                    value={editingItem.defaultQuantity || ''}
                    onChange={e => setEditingItem({...editingItem, defaultQuantity: e.target.value})}
                    placeholder="e.g. 1"
                    className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                   <label className="text-xs font-bold text-gray-400 uppercase">Default Store</label>
                   <input
                    type="text"
                    value={editingItem.defaultStore || ''}
                    onChange={e => setEditingItem({...editingItem, defaultStore: e.target.value})}
                    placeholder="Optional"
                    className="w-full mt-1 p-2 border rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingItem(null)}
                className="flex-1 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateItem}
                className="flex-1 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroceryCatalogModal;
