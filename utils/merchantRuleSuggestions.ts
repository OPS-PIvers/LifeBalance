/**
 * Merchant-rule SUGGESTIONS — "you've seen `APPLE.COM/BILL …` five times and
 * never named it; want a rule?"
 *
 * A rule only pays off once it exists, and nobody opens Settings to author one
 * pre-emptively. This module closes that gap by reading the history the
 * household already has: it finds raw bank descriptors that recur but that no
 * existing rule touches, and proposes a seed rule for each.
 *
 * Everything here composes the shipped primitives rather than restating them:
 *  - {@link suggestPatternFromDescriptor} derives the stable part of a noisy
 *    descriptor (the same seed the inline "rename this merchant" affordance
 *    uses, so a suggestion and a manual rename produce the same pattern).
 *  - {@link pickMerchantRule} decides "is this already covered?" — the real
 *    engine, never string equality, so a CONTAINS pattern the household wrote
 *    suppresses every descriptor it actually matches.
 *  - {@link merchantSimilar} clusters variant spellings, using the same greedy
 *    first-match grouping as `utils/subscriptionDetection.ts`.
 *
 * Pure and total: no React, no Firestore, no clock, no date-fns. Dates are
 * compared as `yyyy-MM-dd` strings, which sort lexicographically.
 */
import { normalizeForRuleMatch, pickMerchantRule, suggestPatternFromDescriptor } from '@/utils/merchantRules';
import { merchantSimilar } from '@/utils/transactionIdentity';

import type { MerchantRule, Transaction } from '@/types/schema';

/**
 * How many times a descriptor must appear before it is worth interrupting the
 * household about. Two sightings is a coincidence; three is a habit.
 */
export const SUGGESTION_MIN_OCCURRENCES = 3;

/** Default cap on returned suggestions — a shortlist, not a backlog. */
export const SUGGESTION_LIMIT = 5;

export interface MerchantRuleSuggestion {
  /** The proposed `pattern` for a new rule — the stable part of the descriptor. */
  pattern: string;
  /** The representative raw descriptor shown to the user as evidence. */
  sampleDescriptor: string;
  occurrences: number;
  /** yyyy-MM-dd of the most recent occurrence — for ordering/recency. */
  lastDate: string;
  /** The most common category across the matched rows, if any — prefills the form. */
  suggestedCategory?: string;
}

/** The only fields a suggestion needs from a transaction. */
type SuggestibleTransaction = Pick<Transaction, 'merchant' | 'date' | 'category'>;

/** A surviving row plus the pattern its descriptor seeds. */
interface Candidate {
  /** Raw descriptor, trimmed but otherwise untouched — this is the evidence. */
  merchant: string;
  /** Already normalized (uppercase, single-spaced) by the seeder. */
  pattern: string;
  date: string;
  category: string;
}

/**
 * Input order must not decide the output. The greedy clustering below elects
 * each cluster's first member as its representative, so the row order feeds
 * straight into which rows group together — and transactions reach this
 * function in Firestore listener order, which is not stable across sessions.
 * Sorting by (date, descriptor) first makes the representative the OLDEST
 * spelling of a merchant and the whole result a pure function of the input
 * SET. This is the one deliberate refinement over `subscriptionDetection`'s
 * grouping, which consumes its input in the order given.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.merchant !== b.merchant) return a.merchant < b.merchant ? -1 : 1;
  return 0;
}

/**
 * Greedy merchant clustering, following `utils/subscriptionDetection.ts`: each
 * row joins the first cluster whose representative it resembles, else starts a
 * new one. Two differences, both forced by what is being compared:
 *
 *  - Similarity is measured on the SEEDED PATTERN, not the raw descriptor.
 *    `merchantSimilar` is token-subset based, and the trailing reference
 *    numbers that make one merchant's descriptors differ ("APPLE.COM/BILL
 *    866-712-7753 CA" vs "APPLE.COM/BILL 240725") are exactly the tokens that
 *    break a subset test. Stripping them first is what lets the same merchant
 *    cluster at all.
 *  - Identical patterns cluster unconditionally. `merchantSimilar` normalizes
 *    punctuation away and returns false when nothing survives, so a descriptor
 *    made only of symbols would otherwise never join even its own twin.
 */
function clusterByMerchant(candidates: readonly Candidate[]): Candidate[][] {
  const clusters: Candidate[][] = [];
  for (const candidate of candidates) {
    const cluster = clusters.find((group) => {
      const representative = group[0];
      if (representative === undefined) return false;
      return (
        representative.pattern === candidate.pattern ||
        merchantSimilar(representative.pattern, candidate.pattern)
      );
    });
    if (cluster) {
      cluster.push(candidate);
    } else {
      clusters.push([candidate]);
    }
  }
  return clusters;
}

/**
 * How many of a cluster's descriptors a candidate pattern would actually match.
 * Mirrors the engine's CONTAINS semantics exactly — `pattern` already comes out
 * of {@link suggestPatternFromDescriptor} normalized, so only the descriptor
 * needs normalizing here.
 */
function coverageOf(pattern: string, cluster: readonly Candidate[]): number {
  return cluster.filter((row) => normalizeForRuleMatch(row.merchant).includes(pattern)).length;
}

/**
 * The longest leading run of whole TOKENS shared by every pattern in a cluster,
 * or '' when they share no first token. Patterns are already normalized, so a
 * token-wise prefix is also a character-wise one — "SUPERAMERICA" is a valid
 * CONTAINS pattern for both "SUPERAMERICA A" and "SUPERAMERICA B", whereas a
 * character-wise prefix could stop mid-word and match unrelated merchants.
 */
function commonTokenPrefix(patterns: readonly string[]): string {
  const first = patterns[0];
  if (first === undefined) return '';

  let prefix = first.split(' ');
  for (const pattern of patterns.slice(1)) {
    const tokens = pattern.split(' ');
    let shared = 0;
    while (shared < prefix.length && shared < tokens.length && prefix[shared] === tokens[shared]) {
      shared += 1;
    }
    prefix = prefix.slice(0, shared);
    if (prefix.length === 0) break;
  }
  return prefix.join(' ');
}

/**
 * The pattern to propose for a cluster: the one that would relabel the MOST of
 * its rows.
 *
 * Coverage beats popularity because the two disagree in the common case. Given
 * two "TRADER JOES 710 ST PAUL" rows and one "TRADER JOES", the popular pattern
 * is the long one — which leaves the third row raw — while the short one
 * relabels all three. Ties fall back to the more frequently-seeded pattern
 * (a spelling the bank actually produced beats a synthesized one), then the
 * shorter pattern (a shorter CONTAINS pattern is strictly broader), then
 * alphabetically so the result never depends on iteration order.
 *
 * The candidates are the cluster's own seeded patterns PLUS their
 * {@link commonTokenPrefix}. Without that extra candidate a cluster whose
 * members diverge on a trailing token ("SUPERAMERICA A" / "SUPERAMERICA B")
 * would have no candidate that covers all of it, and the suggestion's
 * `occurrences` would promise more than the pattern delivers. Broadening to the
 * shared prefix is safe by construction: every member of the cluster already
 * starts with it, and the cluster was only formed from descriptors
 * {@link merchantSimilar} judged to be the same merchant.
 */
function choosePattern(cluster: readonly Candidate[]): string {
  const seededCounts = new Map<string, number>();
  for (const row of cluster) {
    seededCounts.set(row.pattern, (seededCounts.get(row.pattern) ?? 0) + 1);
  }

  const prefix = commonTokenPrefix([...seededCounts.keys()]);
  // '' would be a wildcard under CONTAINS semantics — never a candidate.
  if (prefix && !seededCounts.has(prefix)) seededCounts.set(prefix, 0);

  let best = '';
  let bestCoverage = -1;
  let bestSeeded = -1;
  for (const [pattern, seeded] of seededCounts) {
    const coverage = coverageOf(pattern, cluster);
    const better =
      coverage > bestCoverage ||
      (coverage === bestCoverage &&
        (seeded > bestSeeded ||
          (seeded === bestSeeded &&
            (pattern.length < best.length ||
              (pattern.length === best.length && pattern < best)))));
    if (better) {
      best = pattern;
      bestCoverage = coverage;
      bestSeeded = seeded;
    }
  }
  return best;
}

/**
 * The most common value in a list, or undefined when the list is empty. An
 * exact tie is broken alphabetically rather than by first-seen, so the result
 * cannot depend on iteration order.
 */
function modeOf(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The raw descriptor to show as evidence: the most recent one the chosen
 * pattern actually matches (ties broken alphabetically). Restricting to matched
 * rows keeps the card honest — the user must never read "we'd rename THIS" next
 * to a descriptor the proposed pattern would leave alone.
 */
function chooseSample(pattern: string, cluster: readonly Candidate[]): string {
  let best: Candidate | undefined;
  for (const row of cluster) {
    if (!normalizeForRuleMatch(row.merchant).includes(pattern)) continue;
    if (
      best === undefined ||
      row.date > best.date ||
      (row.date === best.date && row.merchant < best.merchant)
    ) {
      best = row;
    }
  }
  return best?.merchant ?? '';
}

/** Strongest first: occurrences, then recency, then pattern for determinism. */
function compareSuggestions(a: MerchantRuleSuggestion, b: MerchantRuleSuggestion): number {
  if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
  if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
  if (a.pattern !== b.pattern) return a.pattern < b.pattern ? -1 : 1;
  return 0;
}

/**
 * Propose merchant rules the household hasn't authored yet.
 *
 * Algorithm:
 *  1. Drop blank descriptors, then drop every descriptor an existing rule
 *     already matches (step 2 below).
 *  2. Seed a pattern per surviving row and cluster variant spellings.
 *  3. Keep clusters with at least `minOccurrences` rows — counting EVERY row,
 *     including two visits to the same store on the same day. Unlike
 *     subscription detection (which dedupes by day because a second same-day
 *     charge is noise for a cadence test), a repeat visit is a genuine second
 *     sighting of the descriptor, and the descriptor is what the rule renames.
 *  4. Emit the best-covering pattern, its most recent matching descriptor, and
 *     the cluster's modal category.
 *
 * INCOME IS NOT EXCLUDED. Rules apply to deposits as well as withdrawals
 * ("DIRECT DEP PAYROLL 240725" is exactly the kind of descriptor worth naming),
 * so nothing here filters on category or sign.
 *
 * COVERAGE AND AMOUNT-QUALIFIED RULES. Suppression asks
 * {@link pickMerchantRule} with NO amount, so an amount-qualified rule never
 * suppresses anything — the suggestion stands even for a descriptor that has
 * such a rule. That is deliberate, and it is also why the input row type
 * carries no amount: an amount-qualified rule fires only on the rows at that
 * exact cent value, so it covers a SUBSET of a descriptor's history by
 * construction and can never make the remaining rows labelled. A household
 * that mapped "APPLE.COM @ $2.99 → iCloud+" still has every $79 Apple charge
 * showing raw bank text, and should still be offered a bare "APPLE.COM" rule
 * for them. The two rules coexist happily: the engine already ranks the
 * amount-qualified one above any bare rule, so accepting the suggestion cannot
 * shadow what they authored. A BARE rule, by contrast, matches regardless of
 * amount and therefore does fully cover its descriptors — it suppresses.
 */
export function suggestMerchantRules(
  transactions: readonly SuggestibleTransaction[],
  existingRules: readonly MerchantRule[],
  options?: { minOccurrences?: number; limit?: number },
): MerchantRuleSuggestion[] {
  // A floor of 1 keeps a caller-supplied 0 or negative from meaning "suggest
  // every descriptor ever seen once".
  const minOccurrences = Math.max(1, options?.minOccurrences ?? SUGGESTION_MIN_OCCURRENCES);
  const limit = Math.max(0, options?.limit ?? SUGGESTION_LIMIT);
  if (limit === 0) return [];

  const candidates: Candidate[] = [];
  for (const transaction of transactions) {
    const merchant = transaction.merchant.trim();
    if (!merchant) continue;
    if (pickMerchantRule(merchant, undefined, existingRules) !== null) continue;

    const pattern = suggestPatternFromDescriptor(merchant);
    // Unreachable for a non-blank descriptor (the seeder never returns '' for
    // one), but a blank pattern would match nothing, so never propose it.
    if (!pattern) continue;

    candidates.push({ merchant, pattern, date: transaction.date, category: transaction.category });
  }

  candidates.sort(compareCandidates);

  const suggestions: MerchantRuleSuggestion[] = [];
  for (const cluster of clusterByMerchant(candidates)) {
    if (cluster.length < minOccurrences) continue;

    const pattern = choosePattern(cluster);
    if (!pattern) continue;

    // Candidates are sorted date-ascending and clustering preserves that order.
    const lastDate = cluster[cluster.length - 1]?.date ?? '';
    const suggestedCategory = modeOf(cluster.map((row) => row.category).filter((c) => c.trim() !== ''));

    suggestions.push({
      pattern,
      sampleDescriptor: chooseSample(pattern, cluster),
      occurrences: cluster.length,
      lastDate,
      ...(suggestedCategory === undefined ? {} : { suggestedCategory }),
    });
  }

  return suggestions.sort(compareSuggestions).slice(0, limit);
}
