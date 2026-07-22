/**
 * Deterministic natural-language parsing for shopping-list capture (Phase 2a
 * of the capture-review project). Replaces the old path of parking the raw
 * utterance and asking Gemini to structure it later — this is pure,
 * dependency-light, and fully unit-tested, mirroring todoParser.ts's
 * philosophy: a phrase either matches a documented heuristic or falls back to
 * a safe default. The capture-review drawer (Phase 1) is the net that catches
 * whatever this parser gets wrong, so heuristics here favor predictability
 * over cleverness.
 *
 * NOT wired into any endpoint yet — that's Phase 2b. This module is isolated
 * on purpose.
 *
 * Pipeline per segment: strip a leading imperative verb ("buy"/"get"/"grab"/
 * "pick up"/"need"/"add", optionally "add to list"), strip a trailing "to the
 * (shopping/grocery) list" phrase, extract an optional leading quantity, then
 * whatever's left is the item name. Category is a best-effort keyword lookup
 * against the caller-supplied bucket list.
 *
 * Known limitations (documented so the review drawer's job is clear):
 *  - Segmentation splits on " and " unconditionally, so a single logical item
 *    like "salt and pepper" is over-split into two rows ("salt", "pepper").
 *    This is accepted, not a bug — see the dedicated test below — because the
 *    alternative (never splitting on "and") would under-split far more often
 *    ("milk and eggs and bread" is the common case). Fixable in review.
 *  - The category keyword table is intentionally modest (common groceries
 *    only); anything else lands in "Uncategorized" for the user to fix.
 *  - Quantity words are limited to one/a/an through twelve, "a couple", "a
 *    dozen", and "half a dozen" — no support for compound numbers ("twenty
 *    two") or digits spelled with hyphens.
 */

export interface ParsedShoppingItem {
  item: string;
  quantity: number;
  category: string;
}

export interface ParsedShoppingPhrase {
  items: ParsedShoppingItem[];
}

/** Splits an utterance into candidate item segments (see the over-split note above). */
function segmentPhrase(text: string): string[] {
  return text
    .split(/,|\r?\n|\s+and\s+|&/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Leading imperative verb/phrase ("buy"/"get"/"grab"/"pick up"/"need"/"add",
// optionally preceded by "please"/"we"/"i need to"). `\s*` (not `\s+`) after
// the alternation so a bare "add to the list" — where the ENTIRE remainder is
// itself the list clause below, leaving nothing after the verb — still
// strips the verb instead of failing to match.
const LEAD_VERB_PATTERN =
  /^(?:please\s+)?(?:(?:we|i)\s+)?(?:need\s+to\s+)?(?:buy|get|grab|pick\s*up|need|add)\s*/i;

// A "to (the) (shopping/grocery) list" clause, wherever it landed: leading
// (from "add to list milk") or trailing (from "milk to the list").
const LEADING_LIST_PATTERN = /^to\s+(?:the\s+)?(?:shopping\s+|grocery\s+)?list\.?\s*/i;
const TRAILING_LIST_PATTERN = /\s+to\s+(?:the\s+)?(?:shopping\s+|grocery\s+)?list\.?\s*$/i;

function stripLeadAndTrailing(segment: string): string {
  let s = segment.trim();
  s = s.replace(LEAD_VERB_PATTERN, "").trim();
  s = s.replace(LEADING_LIST_PATTERN, "").trim();
  s = s.replace(TRAILING_LIST_PATTERN, "").trim();
  return s;
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

interface QuantityExtraction {
  quantity: number;
  item: string;
}

/**
 * Extracts a leading quantity from an already verb-stripped segment. Tried
 * most-specific first so e.g. "half a dozen eggs" doesn't get caught by the
 * plain "dozen" pattern first. Falls through to quantity 1 (never 0) when
 * nothing matches.
 */
function extractQuantity(segment: string): QuantityExtraction {
  let m = segment.match(/^half\s+(?:a\s+|one\s+)?dozen(?:\s+of)?\s+(.+)$/i);
  if (m && m[1]) return { quantity: 6, item: m[1] };

  m = segment.match(/^(?:a\s+|one\s+)?dozen(?:\s+of)?\s+(.+)$/i);
  if (m && m[1]) return { quantity: 12, item: m[1] };

  m = segment.match(/^(?:a\s+|one\s+)?couple(?:\s+of)?\s+(.+)$/i);
  if (m && m[1]) return { quantity: 2, item: m[1] };

  // "<N> <unit> of <item>" — e.g. "2 lbs of milk". Tried before the bare
  // leading-integer pattern so the unit word ("lbs", "bag", ...) is stripped
  // from the item name rather than kept as part of it.
  m = segment.match(/^(\d+)\s+[a-z]+\s+of\s+(.+)$/i);
  if (m && m[1] && m[2]) {
    const n = parseInt(m[1], 10);
    return { quantity: n > 0 ? n : 1, item: m[2] };
  }

  // "a/an <unit> of <item>" — e.g. "a bag of chips".
  m = segment.match(/^(?:a|an)\s+[a-z]+\s+of\s+(.+)$/i);
  if (m && m[1]) return { quantity: 1, item: m[1] };

  // Bare leading integer — "2 milk".
  m = segment.match(/^(\d+)\s+(.+)$/);
  if (m && m[1] && m[2]) {
    const n = parseInt(m[1], 10);
    return { quantity: n > 0 ? n : 1, item: m[2] };
  }

  // Number words two..twelve — "two apples".
  m = segment.match(/^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(.+)$/i);
  if (m && m[1] && m[2]) {
    const n = NUMBER_WORDS[m[1].toLowerCase()];
    if (n) return { quantity: n, item: m[2] };
  }

  // Bare "a"/"an" = 1 — "a lemon".
  m = segment.match(/^(?:a|an)\s+(.+)$/i);
  if (m && m[1]) return { quantity: 1, item: m[1] };

  return { quantity: 1, item: segment };
}

/**
 * Modest keyword → category lookup covering common groceries. Order matters:
 * the first matching category wins, so a keyword must only appear in one
 * entry (e.g. "pepper" is filed under Pantry as the spice; the produce
 * vegetable is only recognized as "bell pepper" to avoid the ambiguity).
 * Anything not covered here — the long tail — is left "Uncategorized" for the
 * review drawer.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<{ category: string; keywords: readonly string[] }> = [
  { category: "Dairy", keywords: ["milk", "cheese", "egg", "eggs", "yogurt", "butter", "cream"] },
  {
    category: "Produce",
    keywords: [
      "apple", "apples", "banana", "bananas", "lettuce", "tomato", "tomatoes",
      "onion", "onions", "potato", "potatoes", "carrot", "carrots", "spinach",
      "broccoli", "garlic", "avocado", "avocados", "grape", "grapes",
      "orange", "oranges", "bell pepper", "cucumber", "lemon", "lemons",
    ],
  },
  { category: "Bakery", keywords: ["bread", "bagel", "bagels", "muffin", "muffins", "bun", "buns", "tortilla", "tortillas"] },
  { category: "Meat", keywords: ["chicken", "beef", "pork", "turkey", "bacon", "sausage", "ham", "steak"] },
  { category: "Beverages", keywords: ["water", "soda", "juice", "coffee", "tea", "beer", "wine"] },
  { category: "Snacks", keywords: ["chips", "crackers", "pretzels", "popcorn", "cookies", "candy"] },
  { category: "Frozen", keywords: ["frozen", "ice cream"] },
  { category: "Pantry", keywords: ["rice", "pasta", "flour", "sugar", "cereal", "beans", "oil", "sauce", "soup", "salt", "pepper"] },
  { category: "Household", keywords: ["paper towels", "toilet paper", "detergent", "soap", "trash bags", "napkins"] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word/phrase containment check — a plain `.includes()` would let a
 * keyword like "oil" false-positive inside an unrelated word ("toilet"). */
function containsKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text);
}

/** Best-effort category for an item name; falls back to "Uncategorized" when
 * nothing matches OR when the matched category isn't in the caller's list. */
function categorize(item: string, categories: readonly string[]): string {
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => containsKeyword(item, kw))) {
      return categories.includes(category) ? category : "Uncategorized";
    }
  }
  return "Uncategorized";
}

function parseSegment(rawSegment: string, categories: readonly string[]): ParsedShoppingItem | null {
  const stripped = stripLeadAndTrailing(rawSegment.trim());
  if (!stripped) return null;

  const { quantity, item: rawItem } = extractQuantity(stripped);
  const item = rawItem.replace(/\s+/g, " ").trim();
  if (!item) return null;

  return { item, quantity, category: categorize(item, categories) };
}

/**
 * Parses a free-text shopping utterance into structured item rows. Never
 * throws; returns `{ items: [] }` for empty/no-item input.
 */
export function parseShoppingPhrase(text: string, categories: string[]): ParsedShoppingPhrase {
  const items = segmentPhrase(text)
    .map((segment) => parseSegment(segment, categories))
    .filter((item): item is ParsedShoppingItem => item !== null);
  return { items };
}
