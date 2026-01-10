import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { PantryItem } from '@/types/schema';
import { Plus, Trash2, Edit2, Camera, Loader2, Sparkles, X } from 'lucide-react';
import { analyzePantryImage, OptimizableItem } from '@/services/geminiService';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
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
  const { pantry, addPantryItem, updatePantryItem, deletePantryItem } = useHousehold();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);

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
  const availableCategories: string[] = Array.from(new Set([...GROCERY_CATEGORIES, ...existingCategories]));

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
    setNewPurchaseDate('');
    setEditingItem(null);
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
          expiryDate: newExpiry || null,
          purchaseDate: newPurchaseDate || null,
        });
      } else {
        await addPantryItem({
            name: newName,
            quantity: newQuantity || '1',
            category: newCategory,
            expiryDate: newExpiry || null,
            purchaseDate: newPurchaseDate || null,
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
        </div>
      </div>

      {Object.entries(groupedItems).map(([category, items]) => (
        <div key={category} className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-brand-50 px-4 py-2 border-b border-brand-100 font-semibold text-brand-800">
            {category}
          </div>
          <div className="divide-y divide-gray-100">
            {(items as PantryItem[]).map(item => (
              <div key={item.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-sm text-gray-500">
                    {item.quantity}
                    {item.expiryDate && <span className="ml-2 text-orange-600 text-xs">Exp: {item.expiryDate}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(item)} className="p-2 text-gray-400 hover:text-brand-600" aria-label={`Edit ${item.name}`}>
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => deletePantryItem(item.id)} className="p-2 text-gray-400 hover:text-red-600" aria-label={`Delete ${item.name}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
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
                  <label className="text-xs font-bold text-brand-400 uppercase">Item Name</label>
                  <input
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
                    <label className="text-xs font-bold text-brand-400 uppercase">Quantity (Est.)</label>
                    <input
                      type="text"
                      value={newQuantity}
                      onChange={e => setNewQuantity(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                      placeholder="e.g., 2 boxes, 500g"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-brand-400 uppercase">Category</label>
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    >
                        <option value="Produce">Produce</option>
                        <option value="Dairy">Dairy</option>
                        <option value="Meat">Meat</option>
                        <option value="Pantry">Pantry</option>
                        <option value="Snacks">Snacks</option>
                        <option value="Beverages">Beverages</option>
                        <option value="Frozen">Frozen</option>
                        <option value="Household">Household</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-brand-400 uppercase">Purchase Date (Opt)</label>
                    <input
                      type="date"
                      value={newPurchaseDate}
                      onChange={e => setNewPurchaseDate(e.target.value)}
                      className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-brand-400 uppercase">Expiry Date (Opt)</label>
                    <input
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
