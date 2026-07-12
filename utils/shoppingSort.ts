/**
 * Shopping-list sort modes (Plan: shopping list optimizations).
 *
 * The user-selected mode persists across sessions in localStorage. 'entry' is
 * the historical behavior (the `order` field, i.e. order added / manual drag
 * order) and is the only mode where drag-to-reorder makes sense — the other
 * modes are derived views over the same data and never write `order` back.
 */
import { ShoppingItem } from '@/types/schema';

export type ShoppingSortMode = 'entry' | 'alpha' | 'store' | 'section';

export const SHOPPING_SORT_STORAGE_KEY = 'shopping-sort-mode';

export const SHOPPING_SORT_LABELS: Record<ShoppingSortMode, string> = {
  entry: 'Order added',
  alpha: 'Alphabetical',
  store: 'By store',
  section: 'By store section',
};

const VALID_MODES: ShoppingSortMode[] = ['entry', 'alpha', 'store', 'section'];

export function isShoppingSortMode(value: unknown): value is ShoppingSortMode {
  return typeof value === 'string' && (VALID_MODES as string[]).includes(value);
}

/** Read the persisted sort mode; falls back to 'entry' on absence or error. */
export function readStoredShoppingSortMode(): ShoppingSortMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(SHOPPING_SORT_STORAGE_KEY);
      if (isShoppingSortMode(stored)) return stored;
    }
  } catch (_error) {
    // Ignore localStorage errors (private browsing, etc.)
  }
  return 'entry';
}

const byName = (a: ShoppingItem, b: ShoppingItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const byEntryOrder = (a: ShoppingItem, b: ShoppingItem) => {
  const orderA = a.order ?? 9999;
  const orderB = b.order ?? 9999;
  if (orderA !== orderB) return orderA - orderB;
  return byName(a, b);
};

/**
 * Return a new array sorted per `mode`. `categoryOrder` defines the store-walk
 * order for 'section' mode (the household's grocery categories, whose default
 * order already reads like a typical store: Produce → Dairy → Meat → Pantry →
 * … → Uncategorized); categories not in the list sort after known ones,
 * alphabetically, so custom/legacy categories still group together.
 */
export function sortShoppingItems(
  items: ShoppingItem[],
  mode: ShoppingSortMode,
  categoryOrder: readonly string[] = []
): ShoppingItem[] {
  const sorted = [...items];

  switch (mode) {
    case 'alpha':
      sorted.sort(byName);
      break;
    case 'store':
      sorted.sort((a, b) => {
        const storeA = a.store?.trim();
        const storeB = b.store?.trim();
        // Items without a store sink to the bottom.
        if (!storeA && !storeB) return byName(a, b);
        if (!storeA) return 1;
        if (!storeB) return -1;
        const cmp = storeA.localeCompare(storeB, undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : byName(a, b);
      });
      break;
    case 'section': {
      // Case-insensitive index into the category walk order.
      const indexByCategory = new Map<string, number>();
      categoryOrder.forEach((cat, i) => {
        const key = cat.toLowerCase();
        if (!indexByCategory.has(key)) indexByCategory.set(key, i);
      });
      sorted.sort((a, b) => {
        const catA = (a.category || 'Uncategorized').toLowerCase();
        const catB = (b.category || 'Uncategorized').toLowerCase();
        const idxA = indexByCategory.get(catA) ?? Number.MAX_SAFE_INTEGER;
        const idxB = indexByCategory.get(catB) ?? Number.MAX_SAFE_INTEGER;
        if (idxA !== idxB) return idxA - idxB;
        // Both unknown → keep unknown categories grouped, alphabetically.
        if (idxA === Number.MAX_SAFE_INTEGER && catA !== catB) {
          return catA.localeCompare(catB);
        }
        return byName(a, b);
      });
      break;
    }
    case 'entry':
    default:
      sorted.sort(byEntryOrder);
      break;
  }

  return sorted;
}

/**
 * Group label for an item under the given mode — used to render section
 * headers between groups. Returns null for flat modes (entry/alpha).
 */
export function shoppingGroupLabel(item: ShoppingItem, mode: ShoppingSortMode): string | null {
  if (mode === 'store') return item.store?.trim() || 'No store';
  if (mode === 'section') return item.category || 'Uncategorized';
  return null;
}
