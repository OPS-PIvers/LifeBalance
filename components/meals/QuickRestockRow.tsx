import React from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { QuickStockList } from '@/types/schema';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { List } from 'lucide-react';
import toast from 'react-hot-toast';

export const QuickRestockRow: React.FC = () => {
  const { quickStockLists, groceryCatalog, shoppingList, addShoppingItem } = useHousehold();

  if (!quickStockLists || quickStockLists.length === 0) return null;

  const handleRestock = async (list: QuickStockList) => {
    let addedCount = 0;

    // Create lookup for existing items (pending only)
    const existingNames = new Set(
      shoppingList.filter(i => !i.isPurchased).map(i => normalizeToKey(i.name))
    );

    // Process each item in the template
    for (const itemName of list.items) {
      // Skip if already in list
      if (existingNames.has(normalizeToKey(itemName))) continue;

      // Find catalog details for defaults
      const catalogItem = groceryCatalog.find(
        c => normalizeToKey(c.name) === normalizeToKey(itemName)
      );

      await addShoppingItem({
        name: itemName, // Use the name from the list
        category: catalogItem?.category || 'Uncategorized',
        quantity: catalogItem?.defaultQuantity,
        store: catalogItem?.defaultStore,
        isPurchased: false
      });

      addedCount++;
    }

    if (addedCount > 0) {
      toast.success(`Added ${addedCount} items from ${list.name}`);
    } else {
      toast('All items already in list', { icon: 'ℹ️' });
    }
  };

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center gap-2 px-1">
        <span className="text-xxs font-bold text-brand-400 uppercase tracking-wider">Quick Restock</span>
        <div className="h-px bg-brand-100 flex-1"></div>
      </div>

      <div
        className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1"
        role="group"
        aria-label="Quick restock lists"
      >
        {quickStockLists.map(list => (
          <button
            key={list.id}
            onClick={() => handleRestock(list)}
            className="flex-shrink-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 bg-white border border-brand-100 rounded-full shadow-sm hover:border-brand-300 hover:bg-brand-50 active:scale-95 transition-all group"
            aria-label={`Quick add items from ${list.name}`}
          >
            <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center group-hover:bg-brand-200">
              <List size={12} strokeWidth={3} />
            </div>
            <span className="text-xs font-medium text-brand-700">{list.name}</span>
            <span className="text-[10px] text-brand-400 bg-brand-50 px-1 rounded-full">
              {list.items.length}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
