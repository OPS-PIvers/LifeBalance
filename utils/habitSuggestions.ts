import { Habit, Transaction } from '@/types/schema';

/**
 * Keywords mapped to habit categories and titles
 * Used for smart habit suggestions based on transaction merchant/description
 */
const HABIT_KEYWORDS: Record<string, string[]> = {
  // Food & Drink
  food: ['restaurant', 'cafe', 'coffee', 'starbucks', 'dunkin', 'pizza', 'burger', 'mcdonalds', 'wendys', 'subway', 'chipotle', 'taco', 'food', 'diner', 'kitchen', 'grill', 'bbq', 'sushi', 'thai', 'chinese', 'italian'],
  fastfood: ['mcdonalds', 'burger king', 'wendys', 'kfc', 'taco bell', 'arbys', 'popeyes', 'chick-fil-a', 'sonic', 'jack in the box', 'del taco', 'carl\'s jr', 'hardees', 'whataburger'],
  snack: ['snack', '7-eleven', 'convenience', 'gas station', 'circle k', 'wawa', 'sheetz'],
  coffee: ['starbucks', 'coffee', 'cafe', 'dunkin', 'peet\'s', 'dutch bros', 'caribou'],
  alcohol: ['bar', 'pub', 'tavern', 'brewery', 'liquor', 'wine', 'beer', 'spirits', 'total wine', 'bevmo'],
  grocery: ['grocery', 'supermarket', 'safeway', 'kroger', 'albertsons', 'whole foods', 'trader joe', 'aldi', 'costco', 'walmart', 'target', 'publix', 'wegmans', 'h-e-b', 'giant', 'food lion', 'harris teeter'],

  // Exercise & Health
  gym: ['gym', 'fitness', '24 hour', 'planet fitness', 'la fitness', 'equinox', 'crunch', 'anytime fitness', 'gold\'s gym', 'ymca', 'orangetheory', 'crossfit', 'f45'],
  sports: ['sports', 'athletic', 'recreation', 'golf', 'tennis', 'swim', 'yoga', 'pilates', 'cycling', 'run', 'marathon'],
  healthcare: ['doctor', 'dentist', 'medical', 'pharmacy', 'cvs', 'walgreens', 'rite aid', 'clinic', 'hospital', 'urgent care', 'health'],

  // Shopping & Entertainment
  shopping: ['amazon', 'target', 'walmart', 'mall', 'shopping', 'retail', 'store', 'outlet'],
  entertainment: ['movie', 'cinema', 'theater', 'concert', 'amc', 'regal', 'spotify', 'netflix', 'hulu', 'disney+', 'apple tv', 'youtube', 'gaming', 'playstation', 'xbox', 'steam'],
  electronics: ['best buy', 'apple', 'microsoft', 'electronics', 'computer', 'tech'],

  // Transportation
  gas: ['gas', 'fuel', 'shell', 'exxon', 'chevron', 'bp', 'mobil', 'arco', 'valero', 'marathon', 'speedway', 'circle k', '76'],
  uber: ['uber', 'lyft', 'taxi', 'ride share', 'rideshare'],
  parking: ['parking', 'park', 'garage'],

  // Personal Care
  salon: ['salon', 'barber', 'haircut', 'hair', 'beauty', 'spa', 'nail', 'massage'],

  // Hobbies & Learning
  books: ['book', 'barnes', 'amazon books', 'bookstore', 'library'],
  education: ['course', 'class', 'tuition', 'school', 'university', 'college', 'udemy', 'coursera', 'masterclass'],
};

/**
 * Analyzes transaction merchant/description for keywords
 * Returns matching habit categories/keywords
 */
function extractKeywords(merchant: string): string[] {
  const normalizedMerchant = merchant.toLowerCase().trim();
  const matchedKeywords: string[] = [];

  for (const [category, keywords] of Object.entries(HABIT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedMerchant.includes(keyword)) {
        matchedKeywords.push(category);
        break; // Only add category once
      }
    }
  }

  return matchedKeywords;
}

// ---------------------------------------------------------------------------
// Merchant identity matching (history learning)
//
// Automated capture paths (bank-alert emails, Plaid, statement scans) rarely
// spell a merchant the same way twice: "TRADER JOE'S #619", "Trader Joes",
// "SQ *BLUE BOTTLE COFFEE" and "Blue Bottle" are all the same place. The old
// history matcher compared raw substrings, which both missed these variants
// and produced false positives ("target" ⊂ "targeted therapy llc"). This
// token-based comparator follows the same normalize-then-token-set approach as
// `merchantSimilar` in utils/transactionIdentity.ts, with two additions suited
// to noisy bank labels: pure-digit tokens (store numbers) carry no identity and
// are ignored, and tokens match across a trailing possessive/plural "s"
// ("joe" ↔ "joes"). It stays separate from that module because duplicate
// detection and habit suggestion tolerate different false-positive costs.
// ---------------------------------------------------------------------------

/** How strongly two merchant labels look like the same real-world merchant. */
export type MerchantMatchStrength = 'exact' | 'similar' | 'none';

/** Lowercase, strip punctuation (Unicode-aware), collapse whitespace. */
function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identity-bearing token SET of a normalized merchant label (de-duplicated —
 * a repeated token adds no identity, and would skew the size comparison in
 * {@link matchMerchantNames}). Single characters (apostrophe shrapnel like the
 * "s" of "joe s") and pure-digit tokens (store numbers, register ids) are
 * dropped — they only ever match via the exact-equality path.
 */
function merchantTokens(normalized: string): string[] {
  return Array.from(new Set(normalized.split(' ').filter(t => t.length >= 2 && !/^\d+$/.test(t))));
}

/**
 * Token equality tolerant of a trailing possessive/plural "s" ("joe" ↔ "joes").
 * The plural fold only applies to base tokens of 3+ characters — a 2-char base
 * carries too little signal for it ("ga" must not match "gas").
 */
function tokensEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && `${a}s` === b) return true;
  if (b.length >= 3 && a === `${b}s`) return true;
  return false;
}

/**
 * Compare two merchant labels:
 *  - `'exact'`   — the same label once noise is stripped: identical after
 *                  normalization ("Starbucks" ↔ "STARBUCKS "), or identical
 *                  identity-token sets ("STARBUCKS #1234" ↔ "Starbucks",
 *                  "TRADER JOE'S #619" ↔ "trader joes")
 *  - `'similar'` — one label's token set is STRICTLY contained in the other's
 *                  (processor prefixes, added descriptors):
 *                  "SQ *BLUE BOTTLE COFFEE" ↔ "Blue Bottle"
 *  - `'none'`    — anything else (empty labels never match)
 */
export function matchMerchantNames(a: string, b: string): MerchantMatchStrength {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 'none';
  if (na === nb) return 'exact';
  const ta = merchantTokens(na);
  const tb = merchantTokens(nb);
  if (ta.length === 0 || tb.length === 0) return 'none';
  const [smaller, larger] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const contained = smaller.every(t => larger.some(l => tokensEquivalent(t, l)));
  if (!contained) return 'none';
  return ta.length === tb.length ? 'exact' : 'similar';
}

interface HabitHistoryStats {
  /** Ranking weight: exact-merchant tags count 3, similar-merchant tags 2. */
  weight: number;
  /** Matching decided transactions that tagged this habit. */
  taggedCount: number;
  /** Of those, how many matched the merchant exactly (post-normalization). */
  taggedExactCount: number;
}

interface MerchantHistory {
  /**
   * Matching transactions where the user has made a habit decision: verified
   * (reviewed) rows, plus pending rows the user already tagged at capture.
   * Untagged pending rows are undecided and count for nothing — otherwise a
   * queue of unreviewed automated imports would dilute consistency to zero.
   */
  decidedMatches: number;
  perHabit: Map<string, HabitHistoryStats>;
}

/**
 * Learns from previous transaction-habit associations for merchants that look
 * like the same real-world merchant as `merchant` (see {@link matchMerchantNames}).
 */
function collectMerchantHistory(merchant: string, transactions: Transaction[]): MerchantHistory {
  let decidedMatches = 0;
  const perHabit = new Map<string, HabitHistoryStats>();

  for (const tx of transactions) {
    const strength = matchMerchantNames(merchant, tx.merchant);
    if (strength === 'none') continue;

    const habitIds = tx.relatedHabitIds ?? [];
    const isDecided = tx.status === 'verified' || habitIds.length > 0;
    if (!isDecided) continue;
    decidedMatches++;

    const weight = strength === 'exact' ? 3 : 2;
    for (const habitId of habitIds) {
      const stats = perHabit.get(habitId) ?? { weight: 0, taggedCount: 0, taggedExactCount: 0 };
      stats.weight += weight;
      stats.taggedCount++;
      if (strength === 'exact') stats.taggedExactCount++;
      perHabit.set(habitId, stats);
    }
  }

  return { decidedMatches, perHabit };
}

/**
 * Auto-select gate: the fraction of decided matching transactions that tagged
 * the habit must be at least this before we pre-select it. Below the bar the
 * habit still surfaces as a (non-selected) suggestion chip.
 */
const AUTO_SELECT_MIN_CONSISTENCY = 0.6;

/**
 * A habit qualifies for pre-selection when the user tags it consistently for
 * this merchant AND the evidence is solid: at least one exact-merchant tag, or
 * two similar-merchant tags (one fuzzy hit alone could be a mis-match).
 */
function qualifiesForAutoSelect(stats: HabitHistoryStats, decidedMatches: number): boolean {
  if (decidedMatches === 0) return false;
  if (stats.taggedCount / decidedMatches < AUTO_SELECT_MIN_CONSISTENCY) return false;
  return stats.taggedExactCount >= 1 || stats.taggedCount >= 2;
}

/**
 * Checks if a habit matches the extracted keywords
 */
function habitMatchesKeywords(habit: Habit, keywords: string[]): boolean {
  const habitTitle = habit.title.toLowerCase();
  const habitCategory = habit.category.toLowerCase();

  return keywords.some(keyword => {
    const keywordLower = keyword.toLowerCase();
    return habitTitle.includes(keywordLower) ||
           habitCategory.includes(keywordLower) ||
           keywordLower.includes(habitTitle.split(' ')[0] ?? '') || // Match first word of habit
           keywordLower.includes(habitCategory);
  });
}

export interface SuggestedHabit {
  habit: Habit;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /**
   * True when the user's history for this merchant is consistent enough that
   * the habit should be PRE-SELECTED (not just suggested) on a fresh
   * transaction — e.g. an automated pending import from a merchant they always
   * tag the same way. Consumers only apply this to transactions that don't
   * already carry `relatedHabitIds`.
   */
  autoSelect: boolean;
}

/**
 * Returns smart habit suggestions for a transaction
 * Combines fuzzy merchant history learning with keyword matching
 *
 * @param merchant - Transaction merchant name
 * @param habits - All available habits
 * @param transactions - Transaction history for learning
 * @param maxSuggestions - Maximum number of high-confidence suggestions to show (default: 5)
 * @returns Array of habits sorted by relevance (suggested first, then others)
 */
export function suggestHabitsForTransaction(
  merchant: string,
  habits: Habit[],
  transactions: Transaction[],
  maxSuggestions: number = 5
): SuggestedHabit[] {
  if (!merchant.trim() || habits.length === 0) {
    return habits.map(habit => ({
      habit,
      confidence: 'low' as const,
      reason: 'No suggestions',
      autoSelect: false,
    }));
  }

  // Extract keywords from merchant
  const keywords = extractKeywords(merchant);

  // Learn from historical associations (fuzzy merchant identity)
  const history = collectMerchantHistory(merchant, transactions);
  const rankedHistoricalIds = Array.from(history.perHabit.entries())
    .sort((a, b) =>
      b[1].weight - a[1].weight ||
      b[1].taggedCount - a[1].taggedCount ||
      (a[0] < b[0] ? -1 : 1) // stable final tiebreak by id
    )
    .map(([habitId]) => habitId);

  // Score each habit
  const scoredHabits = habits.map(habit => {
    let score = 0;
    let reason = '';
    let confidence: 'high' | 'medium' | 'low' = 'low';
    let autoSelect = false;

    // Historical match (highest priority)
    const historicalIndex = rankedHistoricalIds.indexOf(habit.id);
    if (historicalIndex !== -1) {
      // Higher score for habits that appear earlier in historical matches
      score += Math.max(10, 100 - (historicalIndex * 10));
      reason = 'Previously used';
      confidence = 'high';
      const stats = history.perHabit.get(habit.id);
      autoSelect = stats ? qualifiesForAutoSelect(stats, history.decidedMatches) : false;
    }

    // Keyword match
    if (keywords.length > 0 && habitMatchesKeywords(habit, keywords)) {
      score += 50;
      if (!reason) {
        reason = 'Keyword match';
        confidence = 'medium';
      }
    }

    // Boost negative habits for spending-related transactions
    if (habit.type === 'negative' && keywords.some(k =>
      ['food', 'fastfood', 'snack', 'coffee', 'shopping', 'entertainment'].includes(k)
    )) {
      score += 20;
    }

    // Boost positive habits for health/exercise
    if (habit.type === 'positive' && keywords.some(k =>
      ['gym', 'sports', 'healthcare', 'grocery'].includes(k)
    )) {
      score += 20;
    }

    return {
      habit,
      score,
      confidence,
      reason: reason || 'Other',
      autoSelect,
    };
  });

  // Sort by score (descending) and limit high-confidence suggestions
  scoredHabits.sort((a, b) => b.score - a.score);

  // Mark top suggestions as high/medium confidence, rest as low. autoSelect
  // survives the cap untouched — pre-selection is a history judgment, not a
  // display-slot one.
  let suggestionCount = 0;
  return scoredHabits.map(item => {
    if (item.score > 50 && suggestionCount < maxSuggestions) {
      suggestionCount++;
      return item;
    } else if (item.score > 20 && suggestionCount < maxSuggestions) {
      suggestionCount++;
      return { ...item, confidence: 'medium' as const };
    } else {
      return { ...item, confidence: 'low' as const };
    }
  });
}

/**
 * Habit ids that should be PRE-SELECTED for a fresh transaction at this
 * merchant, based on consistent user history (see {@link SuggestedHabit.autoSelect}).
 * Callers must only apply this to transactions without existing
 * `relatedHabitIds` — a user's explicit tags always win.
 */
export function getAutoSelectedHabitIds(
  merchant: string,
  habits: Habit[],
  transactions: Transaction[],
): string[] {
  if (!merchant.trim() || habits.length === 0) return [];
  return suggestHabitsForTransaction(merchant, habits, transactions)
    .filter(s => s.autoSelect)
    .map(s => s.habit.id);
}

/**
 * Returns only high-confidence habit suggestions
 */
export function getTopHabitSuggestions(
  merchant: string,
  habits: Habit[],
  transactions: Transaction[],
  limit: number = 5
): Habit[] {
  const suggestions = suggestHabitsForTransaction(merchant, habits, transactions, limit);
  return suggestions
    .filter(s => s.confidence === 'high' || s.confidence === 'medium')
    .slice(0, limit)
    .map(s => s.habit);
}
