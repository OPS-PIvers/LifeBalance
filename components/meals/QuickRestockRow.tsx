import React from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { GroceryCatalogItem } from '@/types/schema';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { Plus } from 'lucide-react';

export const QuickRestockRow: React.FC = () => {
  const { groceryCatalog, shoppingList, pantry, addShoppingItem } = useHousehold();

  // Logic:
  // 1. Get frequent items from catalog
  // 2. Filter out items currently in Shopping List (not purchased yet)
  // 3. Filter out items currently in Pantry (optional, but good for "Restock" logic)
  // 4. Sort by purchase count
  // 5. Take top 15

  // Create lookup sets for fast filtering
  // We check normalized names
  const shoppingListNames = new Set(
    shoppingList.filter(i => !i.isPurchased).map(i => normalizeToKey(i.name))
  );

  const pantryNames = new Set(
    pantry.map(i => normalizeToKey(i.name))
  );

  const suggestions = groceryCatalog
    .filter(item => {
      const name = normalizeToKey(item.name);
      // Exclude if already in list
      if (shoppingListNames.has(name)) return false;
      // Exclude if currently in pantry (we assume if it's in pantry, you don't need it yet)
      // NOTE: This can be debated. You might want to stock up even if you have some.
      // But for "Smart Restock", assuming "out of stock" is safer to avoid clutter.
      if (pantryNames.has(name)) return false;

      return true;
    })
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 15); // Show top 15

  if (suggestions.length === 0) return null;

  const handleAdd = async (item: GroceryCatalogItem) => {
    await addShoppingItem({
      name: item.name,
      category: item.category,
      quantity: item.defaultQuantity,
      store: item.defaultStore,
      isPurchased: false
    });
  };

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Quick Restock</span>
        <div className="h-px bg-brand-100 flex-1"></div>
      </div>

      <div
        className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1"
        role="group"
        aria-label="Frequently purchased items"
      >
        {suggestions.map(item => (
          <button
            key={item.id}
            onClick={() => handleAdd(item)}
            className="flex-shrink-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 bg-white border border-brand-100 rounded-full shadow-sm hover:border-brand-300 hover:bg-brand-50 active:scale-95 transition-all group"
            aria-label={`Quick add ${item.name}`}
          >
            <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center group-hover:bg-brand-200">
              <Plus size={12} strokeWidth={3} />
            </div>
            <span className="text-xs font-medium text-brand-700">{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
