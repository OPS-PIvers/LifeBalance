import { ShoppingItem } from '@/types/schema';

// Internal sentinel key for items without a store. Real store keys are
// uppercased (see below), so this lowercase value can never collide with one.
const NO_STORE_KEY = '__no_store__';
// Display label for the no-store section (headers are uppercased on output).
const NO_STORE_LABEL = 'Other';
// Unicode empty checkbox (U+2610) reads as a tappable bullet when pasted into messages.
const BULLET = '☐';

/** One store section, categories sorted, for structured (HTML) rendering. */
export interface GroupedShoppingStore {
  /** Display label — the store name, or "Other" for items with no store. */
  storeLabel: string;
  categories: { display: string; items: ShoppingItem[] }[];
}

/**
 * Groups shopping items by store (alphabetical, "Other"/no-store last), then
 * by category (alphabetical) within each store. Shared structural grouping
 * used by both the plain-text share formatter and the print view.
 */
export const groupShoppingListByStore = (items: ShoppingItem[]): GroupedShoppingStore[] => {
  if (items.length === 0) return [];

  const byStore = items.reduce((acc, item) => {
    const store = item.store?.trim().toUpperCase() || NO_STORE_KEY;
    (acc[store] ??= []).push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  const sortedStores = Object.keys(byStore).sort((a, b) => {
    if (a === NO_STORE_KEY) return 1;
    if (b === NO_STORE_KEY) return -1;
    return a.localeCompare(b);
  });

  return sortedStores.map(store => {
    // store comes from Object.keys(byStore), so byStore[store] is always defined.
    const storeItems = byStore[store]!;

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

    const categories = [...byCategory.values()].sort((a, b) => a.display.localeCompare(b.display));

    return {
      storeLabel: store === NO_STORE_KEY ? NO_STORE_LABEL.toUpperCase() : store,
      categories,
    };
  });
};

export const formatShoppingListForShare = (items: ShoppingItem[]): string => {
  const grouped = groupShoppingListByStore(items);
  if (grouped.length === 0) return '';

  const lines: string[] = ['Shopping List', ''];

  grouped.forEach(({ storeLabel, categories }) => {
    lines.push(storeLabel);
    lines.push('');

    categories.forEach(({ display, items: categoryItems }) => {
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
