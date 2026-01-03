import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { PantryItem } from '@/types/schema';
import { Plus, Trash2, Edit2, Camera, Loader2 } from 'lucide-react';
import { analyzePantryImage } from '@/services/geminiService';
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
          quantity: newQuantity,
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
      const items = await analyzePantryImage(base64);

      // Add all found items concurrently
      await Promise.all(items.map(item => addPantryItem(item)));

      toast.success(`Identified and added ${items.length} items!`);
      setIsAddModalOpen(false); // Close modal if open, though usually this is a separate action
    } catch (error) {
      toast.error("Failed to analyze image");
      console.error(error);
    } finally {
      setIsProcessingImage(false);
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
                  <button onClick={() => handleEdit(item)} className="p-2 text-gray-400 hover:text-brand-600">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => deletePantryItem(item.id)} className="p-2 text-gray-400 hover:text-red-600">
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editingItem ? 'Edit Item' : 'Add Pantry Item'}</h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="e.g., Pasta, Milk"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (Est.)</label>
                    <input
                      type="text"
                      value={newQuantity}
                      onChange={e => setNewQuantity(e.target.value)}
                      className="w-full rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
                      placeholder="e.g., 2 boxes, 500g"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      className="w-full rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date (Opt)</label>
                  <input
                    type="date"
                    value={newPurchaseDate}
                    onChange={e => setNewPurchaseDate(e.target.value)}
                    className="w-full rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (Opt)</label>
                  <input
                    type="date"
                    value={newExpiry}
                    onChange={e => setNewExpiry(e.target.value)}
                    className="w-full rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 text-white bg-brand-600 rounded-lg hover:bg-brand-700"
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
