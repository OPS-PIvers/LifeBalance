import React, { useEffect, useMemo, useState } from 'react';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { QuickStockList } from '@/types/schema';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { ShoppingBag, ChevronDown, Check, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { ShoppingItem } from '@/types/schema';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { Drawer } from '@/components/ui/Drawer';
import clsx from 'clsx';

// Create map for O(1) icon lookup
const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

interface QuickRestockDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet listing every quick-restock template. Tapping a row adds all of
 * its (not-already-listed) items — the same one-tap semantics the old inline
 * chip strip had — while the chevron expands a read-only preview of the foods
 * in that template, with items already on the pending list shown checked.
 */
export const QuickRestockDrawer: React.FC<QuickRestockDrawerProps> = ({ isOpen, onClose }) => {
  const { quickStockLists, groceryCatalog, shoppingList, addShoppingItems, loadFullGroceryCatalog } = useShopping();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // The live catalog listener is windowed; templates can reference items
  // outside that window, so hydrate the full catalog while the drawer is open
  // so previews resolve every name (and restock doesn't silently skip items).
  useEffect(() => {
    if (isOpen) void loadFullGroceryCatalog();
  }, [isOpen, loadFullGroceryCatalog]);

  const catalogById = useMemo(
    () => new Map(groceryCatalog.map(c => [c.id, c])),
    [groceryCatalog]
  );

  // Normalized names of items already pending on the list (checked-off items
  // don't count — restocking them again is the whole point).
  const pendingNames = useMemo(
    () => new Set(shoppingList.filter(i => !i.isPurchased).map(i => normalizeToKey(i.name))),
    [shoppingList]
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRestock = async (list: QuickStockList) => {
    const itemsToAdd: Omit<ShoppingItem, 'id'>[] = [];
    const addedNames = new Set<string>(); // Track items being added in this batch

    // Process each item in the template (list.items contains catalog IDs)
    for (const itemId of list.items) {
      const catalogItem = catalogById.get(itemId);
      if (!catalogItem) continue; // Skip if catalog item no longer exists

      const normalizedName = normalizeToKey(catalogItem.name);

      // Skip if already in shopping list or already added in this batch
      if (pendingNames.has(normalizedName) || addedNames.has(normalizedName)) continue;

      itemsToAdd.push({
        name: catalogItem.name,
        category: catalogItem.category || 'Uncategorized',
        quantity: catalogItem.defaultQuantity,
        store: catalogItem.defaultStore,
        isPurchased: false
      });

      addedNames.add(normalizedName);
    }

    if (itemsToAdd.length > 0) {
      await addShoppingItems(itemsToAdd);
      toast.success(`Added ${itemsToAdd.length} items from ${list.name}`);
    } else {
      toast('All items already in list', { icon: 'ℹ️' });
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Quick restock">
      <div className="space-y-2">
        <p className="text-xs text-brand-400 dark:text-brand-450 px-1 pb-1">
          Tap a list to add everything you don&apos;t already have on your list.
        </p>
        {quickStockLists?.map(list => {
          const colorKey = list.color || DEFAULT_STORE_COLOR;
          const color = STORE_COLORS[colorKey] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!; // DEFAULT_STORE_COLOR is always present
          const ListIcon = (list.icon && templateIconMap.get(list.icon)) || ShoppingBag;
          const isExpanded = expandedIds.has(list.id);
          const previewItems = list.items
            .map(id => catalogById.get(id))
            .filter((c): c is NonNullable<typeof c> => !!c);

          return (
            <div
              key={list.id}
              className="rounded-card border border-brand-200 dark:border-brand-700 overflow-hidden"
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => handleRestock(list)}
                  aria-label={`Quick add items from ${list.name}`}
                  className="flex-1 flex items-center gap-3 px-3 py-3 text-left min-h-[56px] hover:bg-brand-50 dark:hover:bg-brand-700/30 active:bg-brand-100 dark:active:bg-brand-700/50 transition-colors"
                >
                  <span className={clsx(
                    'shrink-0 w-9 h-9 rounded-full border flex items-center justify-center',
                    `${color.bg} ${color.text} ${color.border}`
                  )}>
                    <ListIcon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold tracking-tight text-sm text-brand-800 dark:text-brand-100 truncate">
                      {list.name}
                    </span>
                    <span className="block text-xxs text-brand-400 dark:text-brand-450">
                      {list.items.length} {list.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 flex items-center gap-1 text-xs font-medium text-accent-600 dark:text-accent-300">
                    <Plus size={14} />
                    Add
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleExpanded(list.id)}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Hide' : 'Show'} items in ${list.name}`}
                  className="shrink-0 px-3 min-w-11 flex items-center justify-center text-brand-400 hover:text-brand-600 dark:text-brand-450 dark:hover:text-brand-200 border-l border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-700/30 transition-colors"
                >
                  <ChevronDown
                    size={16}
                    className={clsx(
                      'transition-transform duration-(--duration-fast) ease-(--ease-standard)',
                      !isExpanded && '-rotate-90'
                    )}
                  />
                </button>
              </div>

              {isExpanded && (
                <ul className="border-t border-brand-200 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-900/20 py-1 animate-in fade-in slide-in-from-top-2 duration-(--duration-fast)">
                  {previewItems.length === 0 ? (
                    <li className="px-4 py-2 text-xs text-brand-400 dark:text-brand-450 italic">
                      No items in this list
                    </li>
                  ) : previewItems.map(item => {
                    const inList = pendingNames.has(normalizeToKey(item.name));
                    return (
                      <li
                        key={item.id}
                        className={clsx(
                          'flex items-center gap-2 px-4 py-1.5 text-sm',
                          inList
                            ? 'text-brand-400 dark:text-brand-450'
                            : 'text-brand-700 dark:text-brand-300'
                        )}
                      >
                        <span className="truncate">{item.name}</span>
                        {inList && (
                          <span className="shrink-0 flex items-center gap-1 text-xxs text-accent-600 dark:text-accent-300">
                            <Check size={12} />
                            On list
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Drawer>
  );
};
