/**
 * Smart defaults for shopping-list items: infer category (and quantity/store,
 * when known from history) from an item's name.
 *
 * Precedence: exact history match > partial history match (token overlap,
 * highest purchaseCount wins) > preset keyword map > null (no suggestion).
 */
import { GroceryCatalogItem } from '@/types/schema';

/** Tokenize a name into lowercase whole-word tokens, dropping tokens <3 chars. */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(t => t.length >= 3);
}

/**
 * Preset keyword -> category map. Keys are matched as whole-word tokens
 * against the tokenized item name (case-insensitive). Covers the app's fixed
 * category set: Produce, Dairy, Meat, Pantry, Snacks, Beverages, Frozen,
 * Household.
 */
const PRESET_CATEGORY_MAP: Record<string, string> = {
  // Produce
  apple: 'Produce', apples: 'Produce', banana: 'Produce', bananas: 'Produce',
  orange: 'Produce', oranges: 'Produce', grape: 'Produce', grapes: 'Produce',
  lemon: 'Produce', lime: 'Produce', avocado: 'Produce', tomato: 'Produce',
  tomatoes: 'Produce', potato: 'Produce', potatoes: 'Produce', onion: 'Produce',
  onions: 'Produce', garlic: 'Produce', carrot: 'Produce', carrots: 'Produce',
  celery: 'Produce', lettuce: 'Produce', spinach: 'Produce', kale: 'Produce',
  broccoli: 'Produce', cauliflower: 'Produce', cucumber: 'Produce',
  pepper: 'Produce', peppers: 'Produce', mushroom: 'Produce', mushrooms: 'Produce',
  berries: 'Produce', strawberry: 'Produce', strawberries: 'Produce',
  blueberry: 'Produce', blueberries: 'Produce', melon: 'Produce',
  watermelon: 'Produce', pineapple: 'Produce', mango: 'Produce', peach: 'Produce',
  peaches: 'Produce', pear: 'Produce', pears: 'Produce', zucchini: 'Produce',
  squash: 'Produce', corn: 'Produce', cabbage: 'Produce', herbs: 'Produce',
  cilantro: 'Produce', basil: 'Produce', parsley: 'Produce', ginger: 'Produce',
  scallion: 'Produce', scallions: 'Produce', asparagus: 'Produce',

  // Dairy
  milk: 'Dairy', cheese: 'Dairy', cheddar: 'Dairy', mozzarella: 'Dairy',
  yogurt: 'Dairy', yoghurt: 'Dairy', butter: 'Dairy', cream: 'Dairy',
  creamer: 'Dairy', eggs: 'Dairy', egg: 'Dairy', sour: 'Dairy',
  parmesan: 'Dairy', cottage: 'Dairy', halfandhalf: 'Dairy',

  // Meat
  chicken: 'Meat', beef: 'Meat', pork: 'Meat', turkey: 'Meat', bacon: 'Meat',
  sausage: 'Meat', sausages: 'Meat', ham: 'Meat', steak: 'Meat',
  ground: 'Meat', salmon: 'Meat', shrimp: 'Meat', fish: 'Meat', tuna: 'Meat',
  hotdog: 'Meat', hotdogs: 'Meat', ribs: 'Meat', tilapia: 'Meat',
  meatball: 'Meat', meatballs: 'Meat',

  // Pantry
  rice: 'Pantry', pasta: 'Pantry', beans: 'Pantry', flour: 'Pantry',
  sugar: 'Pantry', salt: 'Pantry', oil: 'Pantry', vinegar: 'Pantry',
  ketchup: 'Pantry', mustard: 'Pantry', mayo: 'Pantry', mayonnaise: 'Pantry',
  sauce: 'Pantry', soup: 'Pantry', cereal: 'Pantry', oats: 'Pantry',
  oatmeal: 'Pantry', bread: 'Pantry', tortilla: 'Pantry', tortillas: 'Pantry',
  honey: 'Pantry', syrup: 'Pantry', jam: 'Pantry', jelly: 'Pantry',
  peanut: 'Pantry', spices: 'Pantry', spice: 'Pantry', broth: 'Pantry',
  stock: 'Pantry', canned: 'Pantry', beans2: 'Pantry', quinoa: 'Pantry',
  crackers: 'Pantry', ramen: 'Pantry', noodles: 'Pantry', mac: 'Pantry',
  yeast: 'Pantry', baking: 'Pantry', ketch: 'Pantry', salsa: 'Pantry',

  // Snacks
  chips: 'Snacks', crisps: 'Snacks', cookies: 'Snacks', cookie: 'Snacks',
  candy: 'Snacks', chocolate: 'Snacks', popcorn: 'Snacks', pretzels: 'Snacks',
  nuts: 'Snacks', almonds: 'Snacks', cashews: 'Snacks', granola: 'Snacks',
  bar: 'Snacks', bars: 'Snacks', trail: 'Snacks', gum: 'Snacks',
  chip: 'Snacks',

  // Beverages
  water: 'Beverages', soda: 'Beverages', pop: 'Beverages', juice: 'Beverages',
  coffee: 'Beverages', tea: 'Beverages', beer: 'Beverages', wine: 'Beverages',
  soda2: 'Beverages', lemonade: 'Beverages', gatorade: 'Beverages',
  kombucha: 'Beverages', seltzer: 'Beverages', cola: 'Beverages',

  // Frozen
  frozen: 'Frozen', icecream: 'Frozen', pizza: 'Frozen', waffles: 'Frozen',
  fries: 'Frozen', nuggets: 'Frozen', dumplings: 'Frozen', pierogi: 'Frozen',

  // Household
  paper: 'Household', towels: 'Household', napkins: 'Household',
  tissue: 'Household', tissues: 'Household', detergent: 'Household',
  soap: 'Household', shampoo: 'Household', toothpaste: 'Household',
  toothbrush: 'Household', trash: 'Household', bags: 'Household',
  foil: 'Household', wrap: 'Household', bleach: 'Household',
  sponge: 'Household', sponges: 'Household', batteries: 'Household',
  lightbulb: 'Household', lightbulbs: 'Household', deodorant: 'Household',
  razor: 'Household', razors: 'Household', diapers: 'Household',
  wipes: 'Household', floss: 'Household', conditioner: 'Household',
  cleaner: 'Household', disinfectant: 'Household',
};

export interface SuggestedDefaults {
  category?: string;
  quantity?: string;
  store?: string;
  source: 'history' | 'preset';
}

/**
 * Suggest category/quantity/store defaults for a new item name, in priority
 * order: exact history match, partial history match (token overlap,
 * preferring the highest purchaseCount, ignoring 'Uncategorized'), preset
 * keyword map, then null.
 */
export function suggestItemDefaults(
  name: string,
  catalog: GroceryCatalogItem[]
): SuggestedDefaults | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lowerName = trimmed.toLowerCase();

  // 1. Exact history match (case-insensitive).
  const exact = catalog.find(c => c.name.toLowerCase() === lowerName);
  if (exact) {
    return {
      category: exact.category,
      quantity: exact.defaultQuantity,
      store: exact.defaultStore,
      source: 'history',
    };
  }

  // 2. Partial history match: token overlap, prefer highest purchaseCount.
  const inputTokens = new Set(tokenize(trimmed));
  if (inputTokens.size > 0) {
    let best: GroceryCatalogItem | null = null;
    for (const item of catalog) {
      if (item.category === 'Uncategorized') continue;
      const itemTokens = tokenize(item.name);
      const overlaps = itemTokens.some(t => inputTokens.has(t));
      if (!overlaps) continue;
      if (!best || item.purchaseCount > best.purchaseCount) {
        best = item;
      }
    }
    if (best) {
      return {
        category: best.category,
        quantity: best.defaultQuantity,
        store: best.defaultStore,
        source: 'history',
      };
    }
  }

  // 3. Preset keyword map.
  for (const token of tokenize(trimmed)) {
    const category = PRESET_CATEGORY_MAP[token];
    if (category) {
      return { category, source: 'preset' };
    }
  }

  return null;
}

export interface ParsedQuantity {
  count: number;
  unit: string;
}

/** Matches a leading numeric literal + trailing free text: "2 lbs" -> ["2", " lbs"]. */
const LEADING_NUMBER_RE = /^(\d+(?:\.\d*)?|\.\d+)\s*(.*)$/;

/**
 * Match a leading numeric literal at the start of an already-trimmed string,
 * returning the parsed count/unit, or `null` when the string doesn't start
 * with a number (e.g. "dozen"). Shared by `parseQuantity` (which always needs
 * a displayable count, defaulting non-numeric text to count 1) and
 * `mergeQuantity` (which needs to tell "no leading number" apart from "an
 * explicit 1" so it knows whether adding a count is even meaningful).
 */
function matchLeadingNumber(trimmed: string): ParsedQuantity | null {
  const match = trimmed.match(LEADING_NUMBER_RE);
  if (!match) return null;
  const [, numStr, rest] = match;
  const count = Number(numStr);
  if (!Number.isFinite(count)) return null;
  return { count, unit: (rest ?? '').trim() };
}

/**
 * Parse a free-text quantity string into a numeric count + unit.
 * "2 lbs" -> {2, 'lbs'}; "3" -> {3, ''}; ""/undefined/non-numeric-leading
 * ("dozen") -> {1, original text (or '')}.
 *
 * Accepts `string | number` because `ShoppingItem.quantity` is typed `string`
 * but some documents hold a raw Firestore number for this field (rows written
 * by the quickAdd Cloud Function before this fix, or approved via
 * ShoppingReviewForm without editing the quantity) — no migration; this reads
 * that legacy shape correctly rather than throwing (`(2).trim is not a
 * function`) when a caller like `ShoppingItemForm` passes `item.quantity`
 * straight through.
 */
export function parseQuantity(q: string | number | undefined): ParsedQuantity {
  if (q === undefined || q === null) return { count: 1, unit: '' };
  const trimmed = String(q).trim();
  if (!trimmed) return { count: 1, unit: '' };

  return matchLeadingNumber(trimmed) ?? { count: 1, unit: trimmed };
}

/** Format a parsed quantity back to its display string. */
export function formatQuantity({ count, unit }: ParsedQuantity): string {
  if (count === 1 && unit === '') return '';
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${count} ${trimmedUnit}` : `${count}`;
}

/**
 * Resolve the quantity field to write on a brand-new shopping-list row:
 * `undefined` (write NO field at all) when the caller supplied no quantity,
 * otherwise the formatted string — which itself collapses a bare count of 1
 * back to `undefined`, matching the "no explicit quantity means one"
 * convention used everywhere else (a captured single item shouldn't display
 * an invented "1"). Client twin of `functions/src/quickAdd/quantityLogic.ts`'s
 * `resolveNewQuantityField`, kept in lockstep by the shared parity test in
 * `functions/src/quickAdd/quantityLogic.test.ts`.
 */
export function resolveNewQuantityField(quantity: number | undefined): string | undefined {
  if (quantity === undefined) return undefined;
  const formatted = formatQuantity({ count: quantity, unit: '' });
  return formatted === '' ? undefined : formatted;
}

/**
 * Merge an incoming count into an existing shopping-item quantity, preserving
 * the unit: "2 lbs" + 1 -> "3 lbs". Used whenever a duplicate capture (voice
 * command, iOS Shortcut) needs to bump a matched item instead of creating a
 * second row.
 *
 * A missing/blank existing quantity counts as 1 for accumulation (mirroring
 * the "no explicit quantity means one" convention baked into `formatQuantity`
 * above), so two bare "milk" captures merge into "2" rather than the bump
 * silently vanishing. A quantity with no leading numeric literal (e.g.
 * "dozen") is left untouched — there's no unit-preserving way to add a count
 * to free text, and mangling it (the historical bug: string concatenation via
 * `+`/Firestore's `increment()`, e.g. "2 lbs" + 1 -> "2 lbs1") is worse than a
 * no-op.
 *
 * Accepts `string | number` because some existing documents hold a raw
 * Firestore number for this field despite the schema typing it as a string
 * (server-written rows before this fix) — no migration; this reads that
 * legacy shape correctly rather than requiring a backfill.
 */
export function mergeQuantity(
  existing: string | number | null | undefined,
  addCount: number
): string {
  if (existing === null || existing === undefined) {
    return formatQuantity({ count: 1 + addCount, unit: '' });
  }
  const trimmed = String(existing).trim();
  if (trimmed === '') {
    return formatQuantity({ count: 1 + addCount, unit: '' });
  }
  const parsed = matchLeadingNumber(trimmed);
  if (!parsed) {
    return trimmed;
  }
  return formatQuantity({ count: parsed.count + addCount, unit: parsed.unit });
}
