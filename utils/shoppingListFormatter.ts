import { ShoppingItem } from '@/types/schema';

// Items without a store are collected under this section, shown last.
// Store headers are uppercased, so this key is uppercase too.
const NO_STORE_LABEL = 'OTHER';
// Unicode empty checkbox (U+2610) reads as a tappable bullet when pasted into messages.
const BULLET = '☐';

export const formatShoppingListForShare = (items: ShoppingItem[]): string => {
  if (items.length === 0) return '';

  // Group by store first so the output is organized by where you'll shop.
  // Store headers are uppercased, so key by the uppercase name to merge
  // case variants (e.g. "Safeway" and "safeway") into one section.
  const byStore = items.reduce((acc, item) => {
    const store = item.store?.trim().toUpperCase() || NO_STORE_LABEL;
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
    lines.push(store);
    lines.push('');

    // store comes from Object.keys(byStore), so byStore[store] is always defined.
    const storeItems = byStore[store]!;

    // Group by category, merging case variants while preserving the first-seen
    // display casing (categories are shown as-is, not uppercased).
    const byCategory = new Map<string, { display: string; items: ShoppingItem[] }>();
    storeItems.forEach(item => {
      const raw = item.category?.trim() || 'Uncategorized';
      const key = raw.toLowerCase();
      const existing = byCategory.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        byCategory.set(key, { display: raw, items: [item] });
      }
    });

    const sortedCategories = [...byCategory.values()].sort((a, b) =>
      a.display.localeCompare(b.display)
    );

    sortedCategories.forEach(({ display, items: categoryItems }) => {
      lines.push(`${display}:`);
      categoryItems.forEach(item => {
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
