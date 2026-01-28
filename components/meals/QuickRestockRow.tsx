import React from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { QuickStockList } from '@/types/schema';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import { ShoppingItem } from '@/types/schema';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import clsx from 'clsx';

// Create map for O(1) icon lookup
const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

export const QuickRestockRow: React.FC = () => {
  const { quickStockLists, groceryCatalog, shoppingList, addShoppingItems } = useHousehold();

  if (!quickStockLists || quickStockLists.length === 0) return null;

  const handleRestock = async (list: QuickStockList) => {
    // Create lookup for existing items (pending only)
    const existingNames = new Set(
      shoppingList.filter(i => !i.isPurchased).map(i => normalizeToKey(i.name))
    );

    const itemsToAdd: Omit<ShoppingItem, 'id'>[] = [];
    const addedNames = new Set<string>(); // Track items being added in this batch

    // Process each item in the template (list.items now contains catalog IDs)
    for (const itemId of list.items) {
      // Find catalog item by ID
      const catalogItem = groceryCatalog.find(c => c.id === itemId);
      if (!catalogItem) continue; // Skip if catalog item no longer exists

      const normalizedName = normalizeToKey(catalogItem.name);

      // Skip if already in shopping list or already added in this batch
      if (existingNames.has(normalizedName) || addedNames.has(normalizedName)) continue;

      itemsToAdd.push({
        name: catalogItem.name,
        category: catalogItem.category || 'Uncategorized',
        quantity: catalogItem.defaultQuantity,
        store: catalogItem.defaultStore,
        isPurchased: false
      });

      addedNames.add(normalizedName); // Track to prevent duplicates within this batch
    }

    if (itemsToAdd.length > 0) {
      await addShoppingItems(itemsToAdd);
      toast.success(`Added ${itemsToAdd.length} items from ${list.name}`);
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
        {quickStockLists.map(list => {
          const colorKey = list.color || DEFAULT_STORE_COLOR;
          const color = STORE_COLORS[colorKey] || STORE_COLORS[DEFAULT_STORE_COLOR];
          const ListIcon = (list.icon && templateIconMap.get(list.icon)) || ShoppingBag;

          return (
            <button
              key={list.id}
              onClick={() => handleRestock(list)}
              className={clsx(
                "flex-shrink-0 flex items-center gap-1.5 text-xs px-1.5 py-0.5 rounded border whitespace-nowrap transition-all active:scale-95",
                `${color.bg} ${color.text} ${color.border}`,
                "hover:brightness-95"
              )}
              aria-label={`Quick add items from ${list.name}`}
            >
              <ListIcon size={12} />
              <span className="font-medium">{list.name}</span>
              <span className="opacity-70 font-bold ml-0.5">
                {list.items.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
