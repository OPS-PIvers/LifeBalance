import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { ShoppingItem } from '@/types/schema';
import { Plus, Trash2, Check, Camera, Loader2, RefreshCw } from 'lucide-react';
import { parseGroceryReceipt } from '@/services/geminiService';
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
  const { shoppingList, addShoppingItem, deleteShoppingItem, toggleShoppingItemPurchased, updateShoppingItem } = useHousehold();
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Produce');
  const [isProcessingReceipt, setIsProcessingReceipt] = useState(false);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName) return;

    await addShoppingItem({
      name: newItemName,
      category: newItemCategory,
      isPurchased: false
    });
    setNewItemName('');
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingReceipt(true);
      const base64 = await fileToBase64(file);
      const items = await parseGroceryReceipt(base64);

      // Add all found items directly to pantry if user desires, but spec says "image upload... items are added to pantry"
      // Wait, the prompt said: "there should be an image upload option where I could upload an itemized receipt... added to the pantry"
      // AND "Mark as Purchased... moves to Pantry".
      // Let's implement this as "Scan to Shopping List" OR "Scan to Pantry".
      // The requirement under Shopping List says: "When returned, all of the food items from the receipt are added to the pantry"
      // It seems the user wants receipt scanning to bypass the shopping list and go straight to pantry ("I bought something... indicate if I bought something").
      // Actually, scanning a receipt implies you ALREADY bought it. So it should go to Pantry.
      // But maybe we should verify them first?
      // I'll stick to the strict request: "items from receipt are added to the pantry".
      // However, it's in the Shopping List section of the prompt.
      // I will put the button here, but the action adds to Pantry (and maybe clears matching shopping list items?).
      // Let's stick to adding to Pantry as requested.

      // BUT, I need access to `addPantryItem` here.
      // I don't have it destructured from useHousehold yet. Let's get it.
    } catch (error) {
       console.error(error);
       toast.error("Failed to parse receipt");
    } finally {
      setIsProcessingReceipt(false);
    }
  };

  // Wrapper to access addPantryItem (since I need to refactor the destructuring above if I want to use it cleanly without re-render issues or just grab context)
  const { addPantryItem } = useHousehold();

  const handleReceiptUploadReal = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        setIsProcessingReceipt(true);
        const base64 = await fileToBase64(file);
        const items = await parseGroceryReceipt(base64);

        let addedCount = 0;
        for (const item of items) {
           await addPantryItem({
               name: item.name,
               quantity: item.quantity || '1',
               category: item.category
           });
           addedCount++;
        }

        toast.success(`Added ${addedCount} items to Pantry from Receipt!`);

      } catch (error) {
         console.error(error);
         toast.error("Failed to parse receipt");
      } finally {
        setIsProcessingReceipt(false);
      }
    };

  // Group by category
  const groupedItems = shoppingList.reduce((acc, item) => {
    const cat = item.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  // Sort categories alphabetically or custom order
  const sortedCategories = Object.keys(groupedItems).sort();

  return (
    <div className="space-y-6 pb-20">
        {/* Quick Add Form */}
        <div className="bg-white p-4 rounded-xl shadow-sm">
            <form onSubmit={handleAddSubmit} className="flex gap-2">
                <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Add to list..."
                    className="flex-1 rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500"
                />
                <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-32 rounded-lg border-gray-300 focus:ring-brand-500 focus:border-brand-500 text-sm hidden sm:block"
                >
                    <option value="Produce">Produce</option>
                    <option value="Dairy">Dairy</option>
                    <option value="Meat">Meat</option>
                    <option value="Pantry">Pantry</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Household">Household</option>
                </select>
                <button type="submit" className="btn-primary p-2">
                    <Plus className="w-6 h-6" />
                </button>
            </form>
        </div>

        <div className="flex justify-end">
             <label className="btn-secondary flex items-center gap-2 cursor-pointer text-sm">
                {isProcessingReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                <span>Scan Receipt to Pantry</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleReceiptUploadReal}
                  disabled={isProcessingReceipt}
                />
             </label>
        </div>

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
                                {groupedItems[category].filter(i => !i.isPurchased).length} remaining
                            </span>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {groupedItems[category].map(item => (
                                <div key={item.id} className={`p-3 flex items-center gap-3 hover:bg-gray-50 ${item.isPurchased ? 'bg-gray-50' : ''}`}>
                                    <button
                                        onClick={() => toggleShoppingItemPurchased(item.id)}
                                        className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors
                                            ${item.isPurchased
                                                ? 'bg-green-500 border-green-500 text-white'
                                                : 'border-gray-300 hover:border-brand-500 text-transparent'}`}
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>

                                    <div className="flex-1 group">
                                        <input
                                            type="text"
                                            value={item.name}
                                            disabled={item.isPurchased}
                                            onChange={(e) => updateShoppingItem({...item, name: e.target.value})}
                                            className={`font-medium bg-transparent border-transparent hover:border-gray-200 focus:border-brand-500 rounded px-1 w-full ${item.isPurchased ? 'text-gray-400 line-through' : 'text-gray-900'}`}
                                        />
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={item.quantity || ''}
                                                disabled={item.isPurchased}
                                                placeholder="Qty"
                                                onChange={(e) => updateShoppingItem({...item, quantity: e.target.value})}
                                                className={`text-sm bg-transparent border-transparent hover:border-gray-200 focus:border-brand-500 rounded px-1 w-20 text-gray-500 ${item.isPurchased ? 'hidden' : 'block'}`}
                                            />
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => deleteShoppingItem(item.id)}
                                        className="text-gray-400 hover:text-red-500 p-2"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
  );
};

export default ShoppingListTab;
