import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { PantryItem } from '@/types/schema';
import { Plus, Trash2, Edit2, Camera, Loader2, Sparkles, X, Layers, CheckSquare, ShoppingCart } from 'lucide-react';
import { analyzePantryImage, OptimizableItem } from '@/services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import { Modal } from '../ui/Modal';
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

const PantryTab: React.FC = () => {
  const { pantry, addPantryItem, updatePantryItem, deletePantryItem, groceryCategories, addShoppingItem } = useHousehold();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);

  // Batch Mode State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  // New Item Form State
  const [newName, setNewName] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newCategory, setNewCategory] = useState('Pantry');
  const [newExpiry, setNewExpiry] = useState('');
  const [newPurchaseDate, setNewPurchaseDate] = useState('');

  // Image Upload State
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // Collect unique existing categories from pantry to guide the AI
  const existingCategories: string[] = Array.from(new Set(pantry.map((p) => p.category).filter((c): c is string => !!c)));

  // Merge defaults, custom categories, and existing pantry categories
  const baseCategories = (groceryCategories && groceryCategories.length > 0) ? groceryCategories : GROCERY_CATEGORIES;
  const availableCategories: string[] = Array.from(new Set([...baseCategories, ...existingCategories]));

  // Use the shared grocery optimizer hook
  const { handleOptimize, isOptimizing } = useGroceryOptimizer({
    items: pantry,
    updateItem: updatePantryItem,
    mapToOptimizable: (item: PantryItem): OptimizableItem => ({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity
      // Pantry items don't have store
    }),
    mapFromOptimizable: (original: PantryItem, optimized: OptimizableItem): PantryItem => ({
      ...original,
      name: optimized.name,
      category: optimized.category || original.category || 'Uncategorized',
      quantity: optimized.quantity || original.quantity
    }),
    availableCategories,
    emptyMessage: "Pantry is empty",
    errorMessage: "Failed to optimize your pantry"
  });

  const resetForm = () => {
    setNewName('');
    setNewQuantity('');
    setNewCategory('Pantry');
    setNewExpiry('');
    setNewPurchaseDate(new Date().toISOString().split('T')[0]);
    setEditingItem(null);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === pantry.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pantry.map(i => i.id)));
    }
  };

  const handleBatchRestock = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => {
        const item = pantry.find(p => p.id === id);
        if (!item) return Promise.resolve();

        // Add to shopping list
        return addShoppingItem({
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          isPurchased: false,
          addedFromMealId: item.id // Traceability: schema uses addedFromMealId generically for source item IDs (including pantry items)
        });
      });

      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        toast.error(`Added ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Added ${selectedIds.size} items to list`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Batch restock failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      const promises = Array.from(selectedIds).map(id => deletePantryItem(id));
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected');

      if (failed.length > 0) {
        toast.error(`Deleted ${selectedIds.size - failed.length}, failed ${failed.length}`);
      } else {
        toast.success(`Deleted ${selectedIds.size} items`);
      }

      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (error) {
      console.error('Batch delete failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;

    try {
      if (editingItem) {
        await updatePantryItem({
          ...editingItem,
          name: newName,
          quantity: newQuantity || '1',
          category: newCategory,
          expiryDate: newExpiry || undefined,
          purchaseDate: newPurchaseDate || undefined,
        });
      } else {
        await addPantryItem({
            name: newName,
            quantity: newQuantity || '1',
            category: newCategory,
            expiryDate: newExpiry || undefined,
            purchaseDate: newPurchaseDate || undefined,
        });
      }
      setIsAddModalOpen(false);
      resetForm();
    } catch (error) {
      console.error(error);
    }
  };

  const handleEdit = (item: PantryItem) => {
    setEditingItem(item);
    setNewName(item.name);
    setNewQuantity(item.quantity);
    setNewCategory(item.category);
    setNewExpiry(item.expiryDate || '');
    setIsAddModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingImage(true);
      const base64 = await fileToBase64(file);
      const items = await analyzePantryImage(base64, availableCategories);

      // Add all found items concurrently, handling partial failures
      const results = await Promise.allSettled(items.map(item => addPantryItem(item)));
      const successCount = results.filter(result => result.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (successCount > 0) {
        toast.success(`Identified and added ${successCount} items!`);
        setIsAddModalOpen(false);
      }

      if (failureCount > 0) {
        console.error('Failed to add some items:', results.filter(r => r.status === 'rejected'));
        toast.error(`Failed to add ${failureCount} items.`);
      }
    } catch (error) {
      toast.error("Failed to analyze image");
      console.error(error);
    } finally {
      setIsProcessingImage(false);
      e.target.value = ''; // Reset file input
    }
  };

  // Group items by category
  const groupedItems = pantry.reduce((acc, item) => {
    const cat = item.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, PantryItem[]>);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-brand-900">My Pantry</h2>
        <div className="flex gap-2">
           {!isSelectionMode && (
             <>
               <button
                 onClick={handleOptimize}
                 disabled={isOptimizing || pantry.length === 0}
                 className="p-2 text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg disabled:opacity-50 transition-colors"
                 title="Optimize your pantry with AI"
                 aria-label="AI Optimize List"
               >
                 {isOptimizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
               </button>
               <label className="btn-secondary flex items-center gap-2 cursor-pointer">
                  {isProcessingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  <span className="hidden sm:inline">Scan Pantry</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={isProcessingImage}
                  />
               </label>
               <button
                 onClick={() => { resetForm(); setIsAddModalOpen(true); }}
                 className="btn-primary flex items-center gap-2"
               >
                 <Plus className="w-4 h-4" /> Add Item
               </button>
             </>
           )}
           <button
             onClick={() => {
                setIsSelectionMode(!isSelectionMode);
                if (isSelectionMode) setSelectedIds(new Set()); // Clear on exit
             }}
             className={`p-2 rounded-lg transition-colors ${isSelectionMode ? 'bg-brand-800 text-white' : 'text-brand-600 bg-brand-50 hover:bg-brand-100'}`}
             title={isSelectionMode ? "Cancel Selection" : "Select Items"}
             aria-label={isSelectionMode ? "Cancel Selection" : "Select Items"}
           >
              {isSelectionMode ? <X className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
           </button>
        </div>
      </div>

      {isSelectionMode && (
        <div className="flex items-center justify-between px-2 text-sm text-brand-600 mb-2">
            <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 font-bold hover:text-brand-800"
                aria-label="Toggle select all pantry items"
            >
                <CheckSquare size={16} className={selectedIds.size === pantry.length && pantry.length > 0 ? 'text-brand-600' : 'text-brand-300'} />
                Select All ({pantry.length})
            </button>
            <span className="text-xs">{selectedIds.size} selected</span>
        </div>
      )}

      {Object.entries(groupedItems).map(([category, items]) => (
        <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-brand-50 px-4 py-2 border-b border-brand-100 font-semibold text-brand-800">
            {category}
          </div>
          <div className="divide-y divide-gray-100">
            {(items as PantryItem[]).map(item => {
              const isSelected = selectedIds.has(item.id);
              return (
              <div
                key={item.id}
                className={`p-4 flex justify-between items-center transition-colors ${isSelectionMode ? 'cursor-pointer hover:bg-brand-50' : 'hover:bg-gray-50'} ${isSelected ? 'bg-brand-50' : ''}`}
                onClick={() => isSelectionMode && toggleSelection(item.id)}
              >
                <div className="flex items-center gap-3">
                  {isSelectionMode && (
                     <div
                        className={`shrink-0 transition-colors ${isSelected ? 'text-brand-600' : 'text-brand-200'}`}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                           if (e.key === ' ' || e.key === 'Enter') {
                             e.preventDefault();
                             toggleSelection(item.id);
                           }
                        }}
                     >
                       {isSelected ? <CheckSquare size={20} /> : <div className="w-5 h-5 border-2 border-current rounded" />}
                     </div>
                  )}
                  <div>
                    <div className="font-medium text-gray-900">{item.name}</div>
                    <div className="text-sm text-gray-500">
                      {item.quantity}
                      {item.expiryDate && <span className="ml-2 text-orange-600 text-xs">Exp: {item.expiryDate}</span>}
                    </div>
                  </div>
                </div>

                {!isSelectionMode && (
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleEdit(item); }} className="p-2 text-gray-400 hover:text-brand-600" aria-label={`Edit ${item.name}`}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deletePantryItem(item.id); }} className="p-2 text-gray-400 hover:text-red-600" aria-label={`Delete ${item.name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )})}
          </div>
        </div>
      ))}

      {pantry.length === 0 && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
            <div className="mb-2 text-4xl">🥫</div>
            <p>Your pantry is empty.</p>
            <p className="text-sm mt-1">Add items manually or snap a photo!</p>
        </div>
      )}

      {/* Floating Action Bar (FAB) for Batch Actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 px-4 md:px-0 flex justify-center z-50 pointer-events-none">
          <div className="bg-brand-900 text-white p-2 rounded-2xl shadow-xl flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-4">
            <div className="px-3 font-bold text-sm border-r border-brand-700">
              {selectedIds.size} selected
            </div>

            <button
              onClick={handleBatchRestock}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-brand-800 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Restock selected items"
            >
              <ShoppingCart size={18} />
              <span className="text-[10px] font-medium">Restock</span>
            </button>

            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              disabled={isBatchProcessing}
              className="flex flex-col items-center gap-0.5 px-3 py-1 hover:bg-red-900 text-red-300 hover:text-red-200 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Delete selected items"
            >
              <Trash2 size={18} />
              <span className="text-[10px] font-medium">Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation */}
      {showBatchDeleteConfirm && (
        <Modal
          isOpen={true}
          onClose={() => !isBatchProcessing && setShowBatchDeleteConfirm(false)}
          disableBackdropClose={isBatchProcessing}
        >
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-brand-800">Batch Delete</h3>
            <p className="text-brand-600">
              Are you sure you want to delete <strong>{selectedIds.size}</strong> items?
            </p>
            <p className="text-sm text-money-neg font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isBatchProcessing}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={isBatchProcessing}
                className="flex-1 py-3 bg-money-neg text-white font-bold rounded-xl hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isBatchProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
                <span>Delete All</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pb-24 sm:pb-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => { resetForm(); setIsAddModalOpen(false); }}
          />

          <div
            className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
              <h3 id="modal-title" className="text-lg font-bold text-brand-800">
                {editingItem ? 'Edit Item' : 'Add Pantry Item'}
              </h3>
              <button
                onClick={() => { resetForm(); setIsAddModalOpen(false); }}
                className="p-2 text-brand-400 hover:bg-brand-50 rounded-full transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label htmlFor="pantry-item-name" className="text-xs font-bold text-brand-400 uppercase">Item Name</label>
                  <input
                    id="pantry-item-name"
                    type="text"
                    required
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    placeholder="e.g., Pasta, Milk"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="pantry-item-quantity" className="text-xs font-bold text-brand-400 uppercase">Quantity (Est.)</label>
                    <input
                      id="pantry-item-quantity"
                      type="text"
                      value={newQuantity}
                      onChange={e => setNewQuantity(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                      placeholder="e.g., 2 boxes, 500g"
                    />
                  </div>
                  <div>
                    <label htmlFor="pantry-item-category" className="text-xs font-bold text-brand-400 uppercase">Category</label>
                    <select
                      id="pantry-item-category"
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    >
                        {availableCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="pantry-item-purchase-date" className="text-xs font-bold text-brand-400 uppercase">Purchase Date (Opt)</label>
                    <input
                      id="pantry-item-purchase-date"
                      type="date"
                      value={newPurchaseDate}
                      onChange={e => setNewPurchaseDate(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="pantry-item-expiry-date" className="text-xs font-bold text-brand-400 uppercase">Expiry Date (Opt)</label>
                    <input
                      id="pantry-item-expiry-date"
                      type="date"
                      value={newExpiry}
                      onChange={e => setNewExpiry(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-brand-100 flex-shrink-0">
                <button
                  type="submit"
                  className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
                >
                  {editingItem ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PantryTab;
