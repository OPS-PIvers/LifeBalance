/**
 * Bill ← bank-descriptor matching, CLIENT side.
 *
 * WHY THIS FILE EXISTS. The three-tier bill matcher (household merchant rule →
 * learned alias → title token-overlap) was built for the nightly bank-EMAIL
 * sync and lives in `functions/src/quickAdd/bankSyncMatch.ts`. But that is only
 * one of the two roads a bank charge takes into this app: the other is
 * screenshot upload → `parseBankStatement` → `pending_review` rows → the
 * Dashboard Action Queue, which is entirely client-side and never reached the
 * matcher. The result was the owner-reported paper cut — a recurring bill the
 * household had entered by hand and the imported charge that pays it both sat
 * in the queue as two unrelated "Review" rows.
 *
 * WHY IT IS A DUPLICATE RATHER THAN AN IMPORT. The app and `functions/` are
 * separate pnpm workspace packages with separate builds: the root
 * `tsconfig.json` EXCLUDES `functions`, and `functions/tsconfig.json` pins
 * `rootDir: "src"`, so neither side can import the other. Every pure rule this
 * project needs on both sides is therefore duplicated with a lockstep contract
 * — `utils/habitLogic.ts` ↔ `functions/src/quickAdd/streakLogic.ts`,
 * `utils/merchantRules.ts` ↔ `functions/src/quickAdd/merchantRules.ts`,
 * `utils/captureReview.ts` ↔ `functions/src/quickAdd/captureReview.ts`. This
 * file follows that precedent rather than inventing a build-level change.
 *
 * **KEEP IN LOCKSTEP with `functions/src/quickAdd/bankSyncMatch.ts`.** The
 * thresholds, the noise-token set, the tier order and the ambiguity rules are
 * copied VERBATIM and must change on both sides together. Deliberately NOT
 * ported: the CONFIRM/FILL/SKIP steps and `decideWithdrawal` (those drive
 * server writes), and `BillPayCandidate.date` / `.isRecurringInstance` (the
 * endpoint carries them into its write step; nothing in the matcher reads
 * them).
 *
 * DO NOT LOOSEN. Every tier is deliberately strict — exact normalized alias
 * equality (never fuzzy/substring/prefix), whole-token overlap with generic
 * bank noise words removed, and a UNIQUE match required within each tier.
 * A false positive here does not merely hide a row: on the server twin the same
 * verdict marks a bill PAID, and here it collapses a real bill out of the review
 * queue. A visible duplicate is a nuisance; a wrong bill silently settled is a
 * money bug. When in doubt this returns null and the user sees both rows.
 *
 * Dependency-light and pure by design (no dates, no Firebase, no clock), so the
 * two copies stay trivially diff-able.
 */
import type { MerchantRule } from '@/types/schema';
import { pickMerchantRule } from '@/utils/merchantRules';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The charge being matched. The server twin passes a `BankEmailWithdrawal`;
 * this side is fed from a `pending_review` transaction, so the matcher takes
 * only the two fields it actually reads. `descriptor` is the RAW stored
 * `Transaction.merchant` (the bank's own words) — never a merchant-rule display
 * name, for the same reason `utils/transactionIdentity.ts` refuses one: a
 * user-editable label must not decide identity.
 */
export interface DescriptorCharge {
  descriptor: string;
  /** Decimal dollars, sign-insensitive. */
  amount: number;
}

/**
 * An unpaid EXPENSE bill occurrence. For a recurring occurrence `id` is the
 * synthetic `templateId_instance_yyyy-MM-dd` instance id and `templateId` is the
 * parent template doc id (which is what a merchant rule's `billId` names, and
 * where learned aliases are written); for a one-off item `id` is the real doc id
 * and `templateId` is undefined.
 */
export interface BillPayCandidate {
  id: string;
  templateId?: string;
  title: string;
  /** Decimal dollars. */
  amount: number;
  bankDescriptorAliases?: string[];
}

/**
 * WHICH tier matched, in descending order of authority:
 *   - `rule`  — a household-authored `MerchantRule.billId` names this bill.
 *   - `alias` — a descriptor previously learned onto the bill.
 *   - `token` — significant-token overlap with the bill's title (a guess).
 */
export type BillMatchSource = 'rule' | 'alias' | 'token';

export interface BillPayMatch {
  bill: BillPayCandidate;
  matchedBy: BillMatchSource;
}

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests pin them)
// ---------------------------------------------------------------------------

/** The bill amount may differ from the actual charge by this fraction… */
export const BILL_AMOUNT_PCT_TOLERANCE = 0.1;
/** …OR by this many dollars, whichever is more forgiving. */
export const BILL_AMOUNT_ABS_TOLERANCE = 25;

/**
 * Generic bank/biller noise tokens that carry no identifying signal — dropped
 * before descriptor↔title token-overlap so "AMERICAN EXPRESS ACH PMT" doesn't
 * match a "Water Bill AUTOPAY" purely on the shared word "PMT"/"BILL".
 */
const NOISE_TOKENS = new Set<string>([
  'ACH', 'PMT', 'PYMT', 'PYMNT', 'PAYMENT', 'AUTOPAY', 'AUTO', 'WEB', 'ONLINE',
  'BILL', 'BILLPAY', 'SVCS', 'SVC', 'SERVICE', 'SERVICES', 'DES', 'INDN', 'CCD',
  'PPD', 'CO', 'ID', 'REF', 'TRANSFER', 'XFER', 'PURCHASE', 'RECURRING',
  'AUTHORIZED', 'CARD', 'THE', 'AND',
]);

// ---------------------------------------------------------------------------
// Token / alias helpers
// ---------------------------------------------------------------------------

/** Convert a stored dollar amount to integer cents (float-drift safe). */
function cents(amount: number): number {
  return Math.round(Math.abs(amount) * 100);
}

/**
 * Significant, upper-cased alphanumeric tokens (length ≥ 3, not noise words) of
 * a descriptor/title, for the bill token-overlap match. Digits-only tokens are
 * dropped (store numbers, reference ids carry no bill identity).
 */
export function significantTokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t.length >= 3 && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** True when two texts share at least one significant token. */
export function shareSignificantToken(a: string, b: string): boolean {
  const setB = new Set(significantTokens(b));
  return significantTokens(a).some(t => setB.has(t));
}

/** Normalize a descriptor/alias for equality comparison (upper, collapse ws). */
function normalizeAlias(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when the descriptor matches a previously-learned alias on a bill. Exact
 * normalized equality ONLY — the alias we persist is the raw descriptor, so a
 * later identical descriptor re-matches deterministically without risking a
 * fuzzy false positive. Substring/prefix/edit-distance matching is off the table
 * here by design; see the DO NOT LOOSEN note at the top of this file.
 */
export function matchesAlias(descriptor: string, aliases: string[] | undefined): boolean {
  if (!aliases || aliases.length === 0) return false;
  const norm = normalizeAlias(descriptor);
  return aliases.some(a => normalizeAlias(a) === norm);
}

/** True when the actual charge is within tolerance of the bill's amount. */
export function billAmountWithinTolerance(billAmount: number, actual: number): boolean {
  const diff = Math.abs(cents(billAmount) - cents(actual));
  const pct = cents(billAmount) * BILL_AMOUNT_PCT_TOLERANCE;
  const abs = BILL_AMOUNT_ABS_TOLERANCE * 100;
  return diff <= Math.max(pct, abs);
}

/**
 * Every candidate a rule's `billId` names. A recurring rule points at the
 * TEMPLATE id, while the candidate pool holds expanded occurrences whose own
 * `id` is synthetic, so both are checked.
 */
function billsNamedByRule(
  billId: string,
  candidates: readonly BillPayCandidate[],
): BillPayCandidate[] {
  return candidates.filter(c => c.id === billId || c.templateId === billId);
}

/**
 * Choose the single bill this charge pays, or null.
 *
 * Three tiers, most authoritative first — rule, then learned alias, then title
 * token-overlap. Within every tier the match must be UNIQUE; ambiguity returns
 * null rather than guessing, and an ambiguous rule does NOT fall through to a
 * weaker signal: if the strongest evidence available can't settle it, weaker
 * evidence has no business doing so.
 *
 * The rule tier deliberately BYPASSES the amount tolerance. That guard exists to
 * stop a *guess* from mis-matching a bill; `billId` is not a guess, it is an
 * explicit statement by the household that this descriptor IS that bill. The
 * variable-amount bill — a utility, a credit-card statement — is exactly the
 * case the ±10%/±$25 window gets wrong, and making those matchable is the point
 * of the feature. The other two tiers keep the guard.
 *
 * A rule whose `billId` names nothing in the pool falls through to alias/token
 * rather than forcing a match: the household said "this is that bill", not
 * "match something regardless".
 */
export function pickBillToPay(
  charge: DescriptorCharge,
  candidates: readonly BillPayCandidate[],
  rules?: readonly MerchantRule[],
): BillPayMatch | null {
  const rule = pickMerchantRule(charge.descriptor, charge.amount, rules);
  if (rule?.billId) {
    const named = billsNamedByRule(rule.billId, candidates);
    if (named.length > 1) return null; // ambiguous rule → don't guess
    // Destructured rather than indexed so `noUncheckedIndexedAccess` narrows
    // without a non-null assertion; length === 0 means the bill isn't in this
    // pool, and we fall through to the weaker tiers.
    const [namedBill] = named;
    if (namedBill) return { bill: namedBill, matchedBy: 'rule' };
  }

  const inTol = candidates.filter(c => billAmountWithinTolerance(c.amount, charge.amount));
  if (inTol.length === 0) return null;

  const aliasMatches = inTol.filter(c => matchesAlias(charge.descriptor, c.bankDescriptorAliases));
  if (aliasMatches.length > 1) return null; // ambiguous alias → don't guess
  const [aliasBill] = aliasMatches;
  if (aliasBill) return { bill: aliasBill, matchedBy: 'alias' };

  const tokenMatches = inTol.filter(c => shareSignificantToken(charge.descriptor, c.title));
  if (tokenMatches.length > 1) return null;
  const [tokenBill] = tokenMatches;
  return tokenBill ? { bill: tokenBill, matchedBy: 'token' } : null;
}
