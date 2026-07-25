/**
 * Merchant rules — SERVER copy of the pure matching engine in
 * `utils/merchantRules.ts`.
 *
 * A duplicate, not an import: the client bundle and the Cloud Functions package
 * are separate builds with no shared runtime, exactly as
 * `utils/habitLogic.ts` ↔ `functions/src/quickAdd/streakLogic.ts`. Like that
 * pair, this is a SUBSET port — only the functions the server actually needs are
 * carried over (see "Deliberately not ported" below), so the duplicated surface
 * stays as small as the job allows.
 *
 * Parity is enforced by a test, not by discipline: `merchantRules.test.ts`
 * imports BOTH this module and `@/utils/merchantRules` and asserts identical
 * output over a shared table. functions/tsconfig excludes `*.test.ts` and the
 * suite runs under the root vitest config, so the `@/` alias resolves there.
 * If the two ever diverge, that test fails instead of a household's rules
 * quietly behaving differently at 3am than they do on screen.
 *
 * DISPLAY-TIME, NOT WRITE-TIME — and on the server that invariant is load-
 * bearing. Nothing here (and nothing calling it) may write a rule's `name` into
 * a stored `Transaction.merchant`: the raw bank descriptor is the transaction's
 * permanent identity key, which is what makes rules retroactive, reversible and
 * auditable, and why `transactionIdentity.ts` deliberately does not consult
 * rules. Rules may drive CLASSIFICATION (category, bill link, no-spend
 * exemption); they may never rewrite identity.
 *
 * Deliberately NOT ported (all editor-only affordances with no server caller):
 * `merchantSearchTerms`, `findShadowingRule`, `suggestPatternFromDescriptor`.
 * Port one the day a server path needs it — and add it to the parity table.
 *
 * Dependency-light on purpose: types only, no date-fns, no firebase, no clock,
 * no side effects. Every function here is pure and total.
 */

/**
 * The stored rule shape, declared locally because Cloud Functions cannot import
 * client types at runtime. Structurally identical to `MerchantRule` in
 * types/schema.ts; the parity test type-checks this copy against the real one.
 */
export interface MerchantRule {
  /** Client-generated stable key. */
  id: string;
  /** Case-insensitive CONTAINS match against the raw bank descriptor. */
  pattern: string;
  /** Optional cent-exact qualifier, in decimal dollars (never cents). */
  amount?: number;
  /** Friendly display name (display-time only — never written to a document). */
  name?: string;
  /** Budget category auto-assigned to matching transactions. */
  category?: string;
  /** Calendar item / recurring template id this descriptor should auto-pay. */
  billId?: string;
  /** Matching charges don't break a no-spend day. */
  exempt?: boolean;
  /** ISO timestamp; also the tie-breaker when two rules are equally specific. */
  createdAt: string;
}

/**
 * Uppercase + collapse runs of whitespace to a single space + trim.
 * Punctuation is deliberately PRESERVED so "APPLE.COM" matches literally and
 * does not collide with "APPLECOM" — bank descriptors use punctuation as real
 * signal (domains, "/BILL", "ACH PMT"), unlike the token-stripping normalizer
 * in `transactionIdentity.ts` which is comparing human store names.
 * Tolerates a missing/blank value (returns '') so a malformed stored rule can
 * never throw.
 */
export function normalizeForRuleMatch(text: string): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Decimal dollars → integer cents, so amounts never compare with float `===`. */
function amountCents(amount: number): number {
  return Math.round(amount * 100);
}

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
  return matchesNormalized(rule, normalizeForRuleMatch(descriptor), amount);
}

/**
 * {@link ruleMatches} against an ALREADY-normalized descriptor.
 *
 * The descriptor is constant across a single {@link pickMerchantRule} lookup, so
 * normalizing it inside the loop would repeat identical work once per rule —
 * and this copy runs it for every transaction in a nightly sync batch.
 */
function matchesNormalized(
  rule: MerchantRule,
  normalizedDescriptor: string,
  amount?: number
): boolean {
  const pattern = normalizeForRuleMatch(rule.pattern);
  if (!pattern) return false;

  if (rule.amount !== undefined) {
    if (amount === undefined) return false;
    if (amountCents(rule.amount) !== amountCents(amount)) return false;
  }

  return normalizedDescriptor.includes(pattern);
}

/**
 * Higher = more specific. An amount-qualified rule outranks every bare rule
 * regardless of pattern length; among rules that agree on that, the longer
 * normalized pattern wins (it is strictly harder to satisfy).
 */
export function ruleSpecificity(rule: MerchantRule): number {
  const patternWeight = Math.min(
    normalizeForRuleMatch(rule.pattern).length,
    AMOUNT_QUALIFIER_WEIGHT - 1
  );
  const amountWeight = rule.amount !== undefined ? AMOUNT_QUALIFIER_WEIGHT : 0;
  return amountWeight + patternWeight;
}

/**
 * Total order used to break an exact specificity tie: the older rule wins, and
 * `id` is the final arbiter so the result never depends on array order.
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
 * Most specific wins; an exact specificity tie goes to the earlier `createdAt`.
 *
 * Exactly one rule wins on purpose: rules carry side-effects (category, bill
 * link, no-spend exemption), and merging two rules' effects would produce
 * combinations no one authored.
 */
export function pickMerchantRule(
  descriptor: string,
  amount: number | undefined,
  rules: readonly MerchantRule[] | undefined
): MerchantRule | null {
  if (!rules || rules.length === 0) return null;

  // Normalized once, not once per rule — see matchesNormalized.
  const normalizedDescriptor = normalizeForRuleMatch(descriptor);

  let winner: MerchantRule | null = null;
  for (const rule of rules) {
    if (!matchesNormalized(rule, normalizedDescriptor, amount)) continue;
    if (winner === null || outranks(rule, winner)) winner = rule;
  }
  return winner;
}

/** The friendly name a winning rule contributes, or '' when it contributes none. */
function ruleDisplayName(rule: MerchantRule | null): string {
  return rule?.name?.trim() ?? "";
}

/**
 * The name to SHOW for a transaction-like row: the winning rule's `name`, else
 * the raw merchant. A winning rule with no `name` (a category-only or bill-only
 * rule) still returns the raw merchant — such a rule exists to classify, not to
 * relabel.
 *
 * SERVER CAUTION: this is a rendering helper (log lines, human-facing copy). Its
 * return value must never be persisted into a `merchant` field — see the module
 * header. Every write path in this package stores `withdrawal.descriptor`.
 */
export function displayMerchant(
  row: { merchant: string; amount?: number },
  rules: readonly MerchantRule[] | undefined
): string {
  const name = ruleDisplayName(pickMerchantRule(row.merchant, row.amount, rules));
  return name || row.merchant;
}
