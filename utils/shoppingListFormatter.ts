import { ShoppingItem } from '@/types/schema';

// Items without a store are collected under this section, shown last.
const NO_STORE_LABEL = 'Other';
// Unicode empty checkbox (U+2610) reads as a tappable bullet when pasted into messages.
const BULLET = '☐';

export const formatShoppingListForShare = (items: ShoppingItem[]): string => {
  if (items.length === 0) return '';

  // Group by store first so the output is organized by where you'll shop.
  const byStore = items.reduce((acc, item) => {
    const store = item.store?.trim() || NO_STORE_LABEL;
    (acc[store] ??= []).push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  // Stores alphabetical, but the catch-all "Other" group always comes last.
  const sortedStores = Object.keys(byStore).sort((a, b) => {
    if (a === NO_STORE_LABEL) return 1;
    if (b === NO_STORE_LABEL) return -1;
    return a.localeCompare(b);
  });

  const lines: string[] = ['🛒 Shopping List', ''];

  sortedStores.forEach(store => {
    lines.push(store.toUpperCase());
    lines.push('');

    // store comes from Object.keys(byStore), so byStore[store] is always defined.
    const storeItems = byStore[store]!;
    const byCategory = storeItems.reduce((acc, item) => {
      const category = item.category?.trim() || 'Uncategorized';
      (acc[category] ??= []).push(item);
      return acc;
    }, {} as Record<string, ShoppingItem[]>);

    const sortedCategories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b));

    sortedCategories.forEach(category => {
      lines.push(`${category}:`);
      // category comes from Object.keys(byCategory), so byCategory[category] is always defined.
      byCategory[category]!.forEach(item => {
        let line = `${BULLET} ${item.name}`;
        if (item.quantity) {
          line += ` (${item.quantity})`;
        }
        lines.push(line);
      });
      lines.push(''); // Blank line between categories
    });
  });

  return lines.join('\n').trim();
};
