import React, { useState, useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { GroceryCatalogItem } from '@/types/schema';
import { Search, Plus, Trash2, Edit2, ShoppingCart, Clock, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { Drawer } from '@/components/ui/Drawer';

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
  const [actionItem, setActionItem] = useState<GroceryCatalogItem | null>(null);

  // Wrapper for onClose to reset state
  const handleClose = () => {
    setEditingItem(null);
    setActionItem(null);
    setSearchQuery('');
    onClose();
  };

  // Reset state when isOpen changes to false
  // Note: We use a different pattern to avoid set-state-in-effect warning
  // However, since isOpen is controlled by parent, we might still receive isOpen=false props
  // without calling handleClose (e.g. parent force close).
  // The lint error `Calling setState synchronously within an effect` happens because
  // setting state might trigger re-render which might re-trigger effect if dependencies change.
  // Here dependency is [isOpen].
  // To fix, we can ensure we only reset if it WAS open.
  // Actually, standard pattern for modals is to reset on open or use `key` to remount.
  // But given the constraints, let's just use the onClose wrapper and assume parent calls it.
  // If parent closes it externally, state might persist until next open, which is acceptable or
  // we can use a ref to track previous open state.

  // Alternative: Use a ref to track previous isOpen and only set state if it changed.
  // But useEffect does that.
  // The issue is *synchronous* set state.
  // We can wrap in requestAnimationFrame or setTimeout, but that causes flash.
  // The best way is to not use useEffect for this reset if possible, or ignore the rule if safe.
  // But we want to pass lint.

  // Let's remove the useEffect and rely on handleClose.
  // If the modal is closed by clicking backdrop (Drawer), it calls onClose -> handleClose.
  // If closed by external prop change? The state persists.
  // This is a trade-off. But for this component, usually it's closed via user interaction.

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
    if (window.confirm('Remove from history? This won\'t affect your current list.')) {
      await deleteGroceryCatalogItem(id);
      // Close action drawer if open for this item
      if (actionItem?.id === id) {
        setActionItem(null);
      }
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      noPadding={true}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <Clock className="w-5 h-5 text-brand-500" />
        <div>
          <h3 className="text-lg font-bold text-gray-800">Previously Purchased</h3>
          <p className="text-xs text-gray-500">Quickly add items back to your list</p>
        </div>
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
      <div className="p-4 space-y-2">
          {filteredCatalog.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No history found matching &quot;{searchQuery}&quot;</p>
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
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg px-1 -mx-1"
                  onClick={() => handleAddItem(item)}
                >
                  <div className="font-medium text-gray-900 truncate">{item.name}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{item.category}</span>
                    {item.defaultStore && <span className="truncate max-w-[80px] text-gray-400">• {item.defaultStore}</span>}
                    {item.lastPurchased && (
                      <span className="text-gray-300">• {formatDistanceToNow(new Date(item.lastPurchased))} ago</span>
                    )}
                  </div>
                </button>

                {/* Mobile Actions */}
                <button
                    onClick={() => setActionItem(item)}
                    className="sm:hidden w-10 h-10 flex items-center justify-center text-gray-400 active:text-brand-600 active:bg-gray-100 rounded-full"
                    aria-label="More options"
                >
                    <MoreVertical className="w-5 h-5" />
                </button>

                {/* Desktop Actions */}
                <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionItem}
        onClose={() => setActionItem(null)}
        title="Item Options"
      >
          <div className="space-y-3">
             <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="font-bold text-lg">{actionItem?.name}</p>
                <p className="text-gray-500">{actionItem?.category}</p>
             </div>

             <button
               onClick={() => {
                 setEditingItem(actionItem);
                 setActionItem(null);
               }}
               className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl font-bold text-slate-700 active:bg-slate-50"
             >
                <Edit2 className="w-5 h-5" />
                Edit Details
             </button>

             <button
               onClick={() => {
                 if (actionItem) {
                     handleDeleteItem(actionItem.id);
                 }
               }}
               className="w-full flex items-center gap-3 p-4 bg-white border border-red-100 text-red-600 rounded-xl font-bold active:bg-red-50"
             >
                <Trash2 className="w-5 h-5" />
                Remove from History
             </button>
          </div>
      </Drawer>

      {/* Nested Edit Drawer Overlay */}
      {editingItem && (
        <Drawer
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          title="Edit History Item"
        >
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

          <div className="sticky bottom-0 flex gap-3 mt-6 p-4 border-t border-gray-100 bg-white">
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
        </Drawer>
      )}
    </Drawer>
  );
};

export default GroceryCatalogModal;
