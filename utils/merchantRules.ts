/**
 * Merchant rules — the pure matching engine behind household-authored
 * descriptor cleanup ("APPLE.COM/BILL 866-712-7753 CA" → "Apple").
 *
 * DISPLAY-TIME, NOT WRITE-TIME. Nothing here ever rewrites a stored
 * `Transaction.merchant`; callers resolve a label at render time via
 * {@link displayMerchant}. That single decision buys three properties a
 * backfill-on-save design cannot have:
 *   - **Retroactive.** Saving a rule relabels every past row instantly, with
 *     zero writes — including rows the household will never open again.
 *   - **Reversible.** Deleting or editing a rule restores the raw bank text.
 *     There is no migration to undo and no half-renamed history.
 *   - **Auditable.** The bank's own words survive, so a suspicious charge can
 *     always be traced back to what actually appeared on the statement.
 *
 * The raw merchant therefore remains the transaction's IDENTITY key.
 * `utils/transactionIdentity.ts` must NOT consult rules: the bank's descriptor
 * is stable, whereas a user-editable label can change (or shadow two genuinely
 * different merchants under one friendly name) at any moment — so letting it
 * decide "are these the same purchase?" would make dedup non-deterministic over
 * time. Search is the one place both spellings matter, which is why
 * {@link merchantSearchTerms} returns raw AND display.
 *
 * This module will be duplicated (not imported) into
 * `functions/src/quickAdd/` in a later PR — same precedent as
 * `utils/habitLogic.ts` ↔ `functions/src/quickAdd/streakLogic.ts`, since the
 * client bundle and the Cloud Functions package are separate builds with no
 * shared runtime. Keep it dependency-light for that reason: types only, no
 * date-fns, no firebase, no clock, no side effects. Every function here is pure
 * and total.
 */
import { MerchantRule } from '@/types/schema';

/**
 * Uppercase + collapse runs of whitespace to a single space + trim.
 * Punctuation is deliberately PRESERVED so "APPLE.COM" matches literally and
 * does not collide with "APPLECOM" — bank descriptors use punctuation as real
 * signal (domains, "/BILL", "ACH PMT"), unlike the token-stripping normalizer
 * in `utils/transactionIdentity.ts` which is comparing human store names.
 * Tolerates a missing/blank value (returns '') so a malformed stored rule can
 * never throw at render time.
 */
export function normalizeForRuleMatch(text: string): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Decimal dollars → integer cents, so amounts never compare with float `===`. */
const amountCents = (amount: number): number => Math.round(amount * 100);

/**
 * Weight of an amount qualifier in {@link ruleSpecificity}. Pattern length can
 * contribute at most `AMOUNT_QUALIFIER_WEIGHT - 1`, which is what guarantees
 * "amount-qualified always outranks bare, regardless of pattern length".
 */
const AMOUNT_QUALIFIER_WEIGHT = 1000;

/**
 * True when this rule applies to the given descriptor (and amount, when the
 * rule qualifies on one).
 *
 *  - The pattern is a case-insensitive CONTAINS match on the normalized
 *    descriptor (see {@link normalizeForRuleMatch} — punctuation significant).
 *  - An empty/whitespace-only pattern NEVER matches anything. A "match
 *    everything" rule would silently relabel the whole ledger, so it is treated
 *    as an unfinished draft rather than a wildcard.
 *  - A rule with `amount` set requires a CENT-EXACT amount match. If the caller
 *    has no amount to offer, an amount-qualified rule cannot match (it has a
 *    condition that is unverifiable, not one that is satisfied). Presence is
 *    tested, not truthiness, so an `amount: 0` qualifier works.
 */
export function ruleMatches(rule: MerchantRule, descriptor: string, amount?: number): boolean {
  const pattern = normalizeForRuleMatch(rule.pattern);
  if (!pattern) return false;

  if (rule.amount !== undefined) {
    if (amount === undefined) return false;
    if (amountCents(rule.amount) !== amountCents(amount)) return false;
  }

  return normalizeForRuleMatch(descriptor).includes(pattern);
}

/**
 * Higher = more specific. An amount-qualified rule outranks every bare rule
 * regardless of pattern length (an amount is a much stronger claim than a few
 * extra characters); among rules that agree on that, the longer normalized
 * pattern wins (it is strictly harder to satisfy).
 *
 * Pure and total — no tie is broken by array order. Pattern length is clamped
 * so an absurdly long bare pattern can never overtake an amount qualifier.
 */
export function ruleSpecificity(rule: MerchantRule): number {
  const patternWeight = Math.min(
    normalizeForRuleMatch(rule.pattern).length,
    AMOUNT_QUALIFIER_WEIGHT - 1,
  );
  const amountWeight = rule.amount !== undefined ? AMOUNT_QUALIFIER_WEIGHT : 0;
  return amountWeight + patternWeight;
}

/**
 * Total order used to break an exact specificity tie: the older rule wins, and
 * `id` is the final arbiter so the result never depends on array order (two
 * rules written in the same millisecond would otherwise be ambiguous).
 * Returns < 0 when `a` wins.
 */
function compareTieBreak(a: MerchantRule, b: MerchantRule): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** True when `candidate` should replace `incumbent` as the winning rule. */
function outranks(candidate: MerchantRule, incumbent: MerchantRule): boolean {
  const candidateSpecificity = ruleSpecificity(candidate);
  const incumbentSpecificity = ruleSpecificity(incumbent);
  if (candidateSpecificity !== incumbentSpecificity) {
    return candidateSpecificity > incumbentSpecificity;
  }
  return compareTieBreak(candidate, incumbent) < 0;
}

/**
 * The single winning rule for a descriptor (+ amount), or null when none match.
 * Most specific wins; an exact specificity tie goes to the earlier `createdAt`
 * (stable, and the editor's shadowing warning — {@link findShadowingRule} —
 * keeps households out of that situation in the first place).
 *
 * Exactly one rule wins on purpose: rules carry side-effects (category, bill
 * link, no-spend exemption), and merging two rules' effects would produce
 * combinations no one authored.
 */
export function pickMerchantRule(
  descriptor: string,
  amount: number | undefined,
  rules: readonly MerchantRule[] | undefined,
): MerchantRule | null {
  if (!rules || rules.length === 0) return null;

  let winner: MerchantRule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, descriptor, amount)) continue;
    if (winner === null || outranks(rule, winner)) winner = rule;
  }
  return winner;
}

/** The friendly name a winning rule contributes, or '' when it contributes none. */
function ruleDisplayName(rule: MerchantRule | null): string {
  return rule?.name?.trim() ?? '';
}

/**
 * The name to SHOW for a transaction-like row: the winning rule's `name`, else
 * the raw merchant. A winning rule with no `name` (a category-only or
 * bill-only rule) still returns the raw merchant — such a rule exists to
 * classify, not to relabel.
 */
export function displayMerchant(
  row: { merchant: string; amount?: number },
  rules: readonly MerchantRule[] | undefined,
): string {
  const name = ruleDisplayName(pickMerchantRule(row.merchant, row.amount, rules));
  return name || row.merchant;
}

/**
 * Raw + display name, deduped, for search and habit-keyword matching — the
 * user must be able to find a row by EITHER spelling ("Apple" they typed, or
 * the "APPLE.COM/BILL" they remember from the statement). The raw merchant is
 * always included, even when a rule renames it. Dedup is case-insensitive and
 * whitespace-insensitive (search already is), and blank terms are dropped.
 */
export function merchantSearchTerms(
  row: { merchant: string; amount?: number },
  rules: readonly MerchantRule[] | undefined,
): string[] {
  const name = ruleDisplayName(pickMerchantRule(row.merchant, row.amount, rules));

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [row.merchant, name]) {
    const key = normalizeForRuleMatch(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push(candidate);
  }
  return terms;
}

/**
 * Would `other`'s amount qualifier still let it match everywhere `rule` does?
 * A bare rule qualifies on nothing, so it subsumes any amount. An
 * amount-qualified rule only subsumes a rule pinned to the SAME cents —
 * otherwise the two qualifiers distinguish them and neither shadows the other.
 */
function amountQualifierSubsumes(other: MerchantRule, rule: MerchantRule): boolean {
  if (other.amount === undefined) return true;
  if (rule.amount === undefined) return false;
  return amountCents(other.amount) === amountCents(rule.amount);
}

/**
 * The existing rule that would ALWAYS beat `rule`, making it unreachable — or
 * null. Used by the Settings editor to warn "this rule can never fire".
 *
 * A rule is shadowed when some OTHER rule (a) is at least as specific, (b) would
 * match every descriptor this one matches — i.e. the other's normalized pattern
 * is a SUBSTRING of this one's, so any text containing this pattern necessarily
 * contains that one — and (c) has an amount qualifier that doesn't distinguish
 * them. The rule itself is excluded by `id`, so a draft being edited can be
 * checked against the saved list.
 *
 * Note the substring direction: because a longer pattern is *more* specific,
 * a broad rule never shadows a narrower one — "APPLE" does not shadow
 * "APPLE.COM/BILL", it loses to it. In practice the warning fires on duplicate
 * (equal-specificity) patterns.
 *
 * One refinement over a literal "≥ specificity" test: on an EXACT specificity
 * tie, `pickMerchantRule` awards the win to the earlier `createdAt`, so only
 * the loser of that tie is genuinely unreachable. Reporting both members of a
 * duplicate pair as shadowed would flag a rule that in fact still fires, so the
 * tie is resolved with the same comparator the picker uses. A rule whose own
 * pattern is empty returns null: it can never fire, but shadowing is not the
 * reason, and the editor has a clearer message for a blank pattern.
 */
export function findShadowingRule(
  rule: MerchantRule,
  rules: readonly MerchantRule[],
): MerchantRule | null {
  const pattern = normalizeForRuleMatch(rule.pattern);
  if (!pattern) return null;

  const specificity = ruleSpecificity(rule);
  let shadow: MerchantRule | null = null;

  for (const other of rules) {
    if (other.id === rule.id) continue;

    const otherPattern = normalizeForRuleMatch(other.pattern);
    if (!otherPattern) continue; // A blank pattern matches nothing, so it shadows nothing.
    if (!pattern.includes(otherPattern)) continue;
    if (!amountQualifierSubsumes(other, rule)) continue;

    const otherSpecificity = ruleSpecificity(other);
    if (otherSpecificity < specificity) continue;
    if (otherSpecificity === specificity && compareTieBreak(other, rule) > 0) continue;

    if (shadow === null || outranks(other, shadow)) shadow = other;
  }
  return shadow;
}

/**
 * US state / territory codes. A trailing two-letter token in a card descriptor
 * is the transaction locality ("… 866-712-7753 CA"), never part of the merchant
 * — but only when it is actually a state code, so a real name ending in two
 * letters is left alone.
 */
const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

/**
 * Is this trailing token noise rather than part of the merchant's name?
 * Two shapes qualify:
 *   - A number-ish token: nothing but digits and separators, carrying at least
 *     two digits — reference numbers, `#4021` store numbers, `240725` posting
 *     dates, `866-712-7753` phone numbers, `07/25/26`. The two-digit floor
 *     keeps a meaningful single digit (a "… CO 2" style suffix) intact.
 *   - A US state/territory code (see {@link STATE_CODES}).
 */
function isNoiseToken(token: string): boolean {
  if (STATE_CODES.has(token)) return true;
  if (!/^[\d\-/.#()+*]+$/.test(token)) return false;
  return (token.match(/\d/g) ?? []).length >= 2;
}

/**
 * Seed a pattern from a raw descriptor for the inline "rename this merchant"
 * affordance: strip the trailing reference numbers, phone numbers, dates, store
 * numbers and state codes that make one merchant's descriptors differ from each
 * other, leaving the stable prefix a CONTAINS pattern should key on.
 *
 *   "APPLE.COM/BILL 866-712-7753 CA"  → "APPLE.COM/BILL"
 *   "AMERICAN EXPRESS ACH PMT 240725" → "AMERICAN EXPRESS ACH PMT"
 *
 * Only TRAILING tokens are stripped — an interior number is usually load-bearing
 * ("7-ELEVEN 22371", "76 GAS") and over-stripping would produce a pattern that
 * matches other merchants. Never returns empty: if every token looks like noise
 * the whole (normalized) descriptor is returned, since a blank pattern would
 * never match and a too-broad suggestion is safer than none. A blank input
 * yields '' — there is nothing to seed from.
 */
export function suggestPatternFromDescriptor(descriptor: string): string {
  const normalized = normalizeForRuleMatch(descriptor);
  if (!normalized) return '';

  const tokens = normalized.split(' ');
  let end = tokens.length;
  // `end > 1` keeps at least one token: stripping everything would leave a
  // pattern that matches nothing at all.
  while (end > 1 && isNoiseToken(tokens[end - 1] ?? '')) end -= 1;

  const kept = tokens.slice(0, end);
  if (kept.length === 1 && isNoiseToken(kept[0] ?? '')) return normalized;
  return kept.join(' ');
}
