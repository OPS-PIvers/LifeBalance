import React, { useState, useMemo } from 'react';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { GroceryCatalogItem } from '@/types/schema';
import { Search, Plus, Trash2, Edit2, ShoppingCart, Clock, ChevronLeft, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import { SurfaceList, Row } from '@/components/ui/Section';

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
  } = useShopping();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState<GroceryCatalogItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Wrapper for onClose to reset state
  const handleClose = () => {
    setEditingItem(null);
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

  const handleDeleteItem = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleDeleteItemConfirmed = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    await deleteGroceryCatalogItem(id);
    // Close the edit view if it was open for the deleted item.
    setEditingItem(prev => (prev?.id === id ? null : prev));
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      noPadding={true}
      ariaLabelledBy="grocery-catalog-title"
      header={
        editingItem ? (
          <div className="px-4 py-3 flex items-center gap-1 border-b border-brand-200 dark:border-brand-700">
            <button
              type="button"
              onClick={() => setEditingItem(null)}
              aria-label="Back to history"
              className="p-2.5 -ml-1 text-brand-500 hover:text-brand-700 hover:bg-brand-50 rounded-full transition-colors dark:text-brand-400 dark:hover:text-brand-200 dark:hover:bg-brand-700/50"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 id="grocery-catalog-title" className="flex-1 font-display text-lg font-semibold text-brand-900 dark:text-brand-100 tracking-tight">
              Edit History Item
            </h3>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="p-2.5 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-brand-200 dark:border-brand-700 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700/50 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-brand-500 dark:text-brand-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="grocery-catalog-title" className="font-display text-lg font-semibold text-brand-900 dark:text-brand-100 tracking-tight">Previously Purchased</h3>
                <p className="text-xs text-brand-500 dark:text-brand-400">Quickly add items back to your list</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="p-2.5 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b border-brand-200 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-700/30">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search history..."
                icon={<Search className="w-4 h-4" />}
                autoFocus
              />
            </div>
          </>
        )
      }
      footer={
        editingItem ? (
          <div className="flex gap-3 p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
            <Button variant="ghost" className="flex-1" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" onClick={handleUpdateItem}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      {editingItem ? (
        /* In-sheet edit view — swaps in place of the list, no second Drawer. */
        <div className="p-4 space-y-4">
          <Input
            label="Name"
            type="text"
            value={editingItem.name}
            onChange={e => setEditingItem({...editingItem, name: e.target.value})}
          />
          <Input
            label="Category"
            type="text"
            value={editingItem.category}
            onChange={e => setEditingItem({...editingItem, category: e.target.value})}
          />
          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <Input
              label="Default Qty"
              type="text"
              value={editingItem.defaultQuantity || ''}
              onChange={e => setEditingItem({...editingItem, defaultQuantity: e.target.value})}
              placeholder="e.g. 1"
            />
            <Input
              label="Default Store"
              type="text"
              value={editingItem.defaultStore || ''}
              onChange={e => setEditingItem({...editingItem, defaultStore: e.target.value})}
              placeholder="Optional"
            />
          </div>
        </div>
      ) : (
        /* List */
        <div className="p-4 bg-brand-50/30 dark:bg-brand-700/20 min-h-[50vh]">
            {filteredCatalog.length === 0 ? (
              <EmptyState
                icon={<ShoppingCart size={28} />}
                title={<>No history found matching &quot;{searchQuery}&quot;</>}
                description="Items you check off your shopping list will appear here."
              />
            ) : (
              <SurfaceList>
                {filteredCatalog.map(item => (
                  <Row key={item.id}>
                    {/* Add Button Area */}
                    <button
                      onClick={() => handleAddItem(item)}
                      className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 flex items-center justify-center hover:bg-brand-200 dark:hover:bg-brand-700 transition-colors shrink-0"
                      aria-label={`Add ${item.name} to list`}
                    >
                      <Plus className="w-5 h-5" />
                    </button>

                    {/* Content */}
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-lg px-1 -mx-1"
                      onClick={() => handleAddItem(item)}
                    >
                      <div className="font-medium text-brand-900 dark:text-brand-100 truncate">{item.name}</div>
                      <div className="text-xs text-brand-500 dark:text-brand-400 flex items-center gap-2 mt-0.5">
                        <span className="bg-brand-100 dark:bg-brand-700/50 px-2 py-0.5 rounded-full text-brand-600 dark:text-brand-300 font-medium">{item.category}</span>
                        {item.defaultStore && <span className="truncate max-w-[80px] text-brand-400 dark:text-brand-500">• {item.defaultStore}</span>}
                        {item.lastPurchased && (
                          <span className="text-brand-300 dark:text-brand-600">• {formatDistanceToNow(new Date(item.lastPurchased))} ago</span>
                        )}
                      </div>
                    </button>

                    {/* Actions — always visible (touch-friendly), no separate action sheet */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="p-2 text-brand-300 dark:text-brand-600 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-700/50 rounded-full transition-colors"
                        aria-label={`Edit ${item.name}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-2 text-brand-300 dark:text-brand-600 hover:text-money-neg hover:bg-money-neg/10 rounded-full transition-colors"
                        aria-label={`Delete ${item.name} from history`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Row>
                ))}
              </SurfaceList>
            )}
        </div>
      )}

      {/* Delete from History Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={handleDeleteItemConfirmed}
        title="Remove from History"
        message="Remove from history? This won't affect your current list."
        confirmLabel="Remove"
        confirmVariant="destructive"
      />
    </Drawer>
  );
};

export default GroceryCatalogModal;
