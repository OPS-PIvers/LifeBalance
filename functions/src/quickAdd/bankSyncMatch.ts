/**
 * Pure decision layer for the nightly Wells Fargo bank-email sync
 * (`bankEmailSync` endpoint). Given ONE parsed withdrawal line and the
 * household's already-loaded candidate rows (existing bankRefs, Apple Pay
 * stubs, pending-review transactions, expanded unpaid bills), decide what the
 * server should do with it — with NO Firestore access here, so every branch is
 * trivially unit-testable (mirrors reconcile.ts / accountMatch.ts / billMatch.ts).
 *
 * Order of operations (owner-agreed spec — the endpoint applies exactly this
 * precedence per withdrawal line):
 *   a. SKIP    — a transaction already carries this bankRef (idempotent re-file)
 *   b. FILL    — fill a prior Apple Pay $0 `needsAmount` stub (reconcile.ts rules)
 *   c. CONFIRM — mark an existing pending_review transaction verified
 *                (cent-exact amount + date within ±3 days + UNIQUE)
 *   d. PAY     — pay a matching unpaid calendar bill (a household-authored
 *                merchant rule's `billId`, OR a learned alias, OR descriptor
 *                token-overlap with the title; the latter two additionally
 *                require the amount within ±10% or ±$25)
 *   e. CREATE  — otherwise a new verified, `needsCategory` transaction
 *
 * KEEP THE BILL-MATCHING SLICE IN LOCKSTEP with its client twin
 * `utils/billDescriptorMatch.ts` — `significantTokens`, `shareSignificantToken`,
 * `matchesAlias`, `billAmountWithinTolerance`, `pickBillToPay`, the
 * `NOISE_TOKENS` set and the two amount-tolerance constants are duplicated
 * verbatim there so the Action Queue can recognise a screenshot-imported charge
 * as an existing bill (the bank-email road is not the only road in). The app and
 * this package are separate builds with no shared runtime (the root tsconfig
 * excludes `functions/`, and this package pins `rootDir: "src"`), so the
 * duplication follows the established precedent of
 * `utils/habitLogic.ts` ↔ `streakLogic.ts` and
 * `utils/merchantRules.ts` ↔ `merchantRules.ts`. Change both copies together.
 *
 * The account balance is NEVER moved from any of these decisions — the email's
 * available balance already reflects every withdrawal (posted or held), and the
 * endpoint overwrites the account balance with it once (see
 * `buildBalanceUpdate`). That is why neither CONFIRM nor PAY applies a
 * per-line balance delta.
 */

import type { BankEmailWithdrawal } from "./bankEmailParser";
import { merchantSimilar, INCOME_CATEGORY } from "./transactionIdentity";
import { pickFillTarget, type ReconcileCandidate } from "./reconcile";
import { pickMerchantRule, type MerchantRule } from "./merchantRules";

// ---------------------------------------------------------------------------
// Candidate shapes (all pre-loaded by the endpoint; pure in, decision out)
// ---------------------------------------------------------------------------

/** A pending_review transaction considered for CONFIRM (4c). */
export interface PendingConfirmCandidate {
  id: string;
  /** Decimal dollars, stored positive. */
  amount: number;
  /** yyyy-MM-dd. */
  date: string;
  merchant: string;
  /** Account the pending row is tagged to, if any. A checking bank email must
   *  never confirm a row tagged to a DIFFERENT account (especially a credit
   *  card): a candidate is eligible only when its `accountId` matches the
   *  resolved account or is undefined (untagged — the common case for
   *  voice/shortcut captures, which land on the checking pool). */
  accountId?: string;
}

/**
 * An unpaid EXPENSE bill occurrence considered for PAY (4d). For a recurring
 * occurrence `id` is the synthetic instance id and `templateId` is the parent
 * template doc id (where learned aliases are written); for a one-off item `id`
 * is the real doc id and `templateId` is undefined.
 */
export interface BillPayCandidate {
  id: string;
  templateId?: string;
  title: string;
  /** Decimal dollars. */
  amount: number;
  /** yyyy-MM-dd (the occurrence's due date). */
  date: string;
  isRecurringInstance: boolean;
  bankDescriptorAliases?: string[];
}

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests pin them)
// ---------------------------------------------------------------------------

/** CONFIRM: how far the pending row's date may sit from the withdrawal date. */
export const CONFIRM_DATE_TOLERANCE_DAYS = 3;

/** FILL: how far a stub's date may sit from the withdrawal date to be eligible. */
export const STUB_DATE_TOLERANCE_DAYS = 3;

/** PAY: the bill amount may differ from the actual charge by this fraction… */
export const BILL_AMOUNT_PCT_TOLERANCE = 0.1;
/** …OR by this many dollars, whichever is more forgiving. */
export const BILL_AMOUNT_ABS_TOLERANCE = 25;

/**
 * Generic bank/biller noise tokens that carry no identifying signal — dropped
 * before descriptor↔title token-overlap so "AMERICAN EXPRESS ACH PMT" doesn't
 * match a "Water Bill AUTOPAY" purely on the shared word "PMT"/"BILL".
 */
const NOISE_TOKENS = new Set<string>([
  "ACH",
  "PMT",
  "PYMT",
  "PYMNT",
  "PAYMENT",
  "AUTOPAY",
  "AUTO",
  "WEB",
  "ONLINE",
  "BILL",
  "BILLPAY",
  "SVCS",
  "SVC",
  "SERVICE",
  "SERVICES",
  "DES",
  "INDN",
  "CCD",
  "PPD",
  "CO",
  "ID",
  "REF",
  "TRANSFER",
  "XFER",
  "PURCHASE",
  "RECURRING",
  "AUTHORIZED",
  "CARD",
  "THE",
  "AND",
]);

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** Convert a stored dollar amount to integer cents (float-drift safe). */
function cents(amount: number): number {
  return Math.round(Math.abs(amount) * 100);
}

/** Absolute whole-day gap between two yyyy-MM-dd strings (NaN-safe → Infinity). */
export function dayGap(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(Math.round((ta - tb) / 86_400_000));
}

/**
 * Significant, upper-cased alphanumeric tokens (length ≥ 3, not noise words) of
 * a descriptor/title, for the bill token-overlap match. Digits-only tokens are
 * dropped (store numbers, reference ids carry no bill identity).
 */
export function significantTokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter(
      (t) => t.length >= 3 && !NOISE_TOKENS.has(t) && !/^\d+$/.test(t)
    );
}

/** True when two texts share at least one significant token. */
export function shareSignificantToken(a: string, b: string): boolean {
  const setB = new Set(significantTokens(b));
  return significantTokens(a).some((t) => setB.has(t));
}

/** Normalize a descriptor/alias for equality comparison (upper, collapse ws). */
function normalizeAlias(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * True when the withdrawal descriptor matches a previously-learned alias on a
 * bill. Exact normalized equality only — the alias we persist is the raw
 * descriptor, so a later identical descriptor re-matches deterministically
 * without risking a fuzzy false positive.
 */
export function matchesAlias(descriptor: string, aliases: string[] | undefined): boolean {
  if (!aliases || aliases.length === 0) return false;
  const norm = normalizeAlias(descriptor);
  return aliases.some((a) => normalizeAlias(a) === norm);
}

// ---------------------------------------------------------------------------
// 4c — CONFIRM an existing pending transaction
// ---------------------------------------------------------------------------

/**
 * Choose the single pending transaction this withdrawal confirms, or null.
 *
 * Requirement: cent-exact amount AND date within ±3 days. Merchant similarity
 * is ONLY a tie-breaker among multiple such candidates, never a requirement:
 *  - exactly one amount+date candidate → that one
 *  - several → keep only the merchant-similar ones; a unique survivor wins,
 *    otherwise null (ambiguous → the endpoint falls through to CREATE)
 *  - none → null
 */
/**
 * Is an ALREADY-VERIFIED stored transaction eligible to be confirmed by a
 * nightly withdrawal line?
 *
 * The endpoint originally offered only `pending_review` rows as confirm
 * candidates, which made review speed the enemy of correctness: reviewing an
 * Apple Pay / Shortcut capture flips it to `verified`, removing it from the
 * pool, so the bank email arriving afterwards could not recognise the purchase
 * and filed a duplicate. Reviewing a row does not change what it IS, and
 * CONFIRM asks an identity question — so a verified row is an equally valid
 * target. Confirming stamps its `bankRef`, which is what makes it immune to
 * re-creation by every later email.
 *
 * The exclusions are the whole substance of this predicate:
 *  - not `verified` — `pending_review` rows come from the endpoint's own
 *    unbounded status query; anything else is not a settled purchase.
 *  - already has a `bankRef` — the row IS a bank line. It is already covered
 *    by the 4a skip, and re-matching it could steal the target from a
 *    genuinely new purchase sharing its amount and date.
 *  - income — stored positive exactly like a withdrawal, so a same-amount
 *    deposit would otherwise be "confirmed" by a debit.
 *  - a credit-card payment — the account gate exists to stop a checking email
 *    touching card rows; this closes the same hole for rows the gate can't see
 *    because they carry no `accountId`.
 *  - a non-positive amount — a $0 Apple Pay stub belongs to the FILL step
 *    (4b), which knows how to populate it; matching one here would verify a
 *    row whose amount is still a placeholder.
 *
 * Takes an unvalidated Firestore document shape rather than a typed row: the
 * caller reads raw `DocumentData`, and narrowing here keeps the rule and its
 * justification in one place instead of split across the query site.
 */
export function isVerifiedConfirmCandidate(tx: {
  status?: unknown;
  bankRef?: unknown;
  category?: unknown;
  creditPayment?: unknown;
  amount?: unknown;
}): boolean {
  if (tx.status !== "verified") return false;
  if (typeof tx.bankRef === "string" && tx.bankRef !== "") return false;
  if (tx.category === INCOME_CATEGORY) return false;
  if (tx.creditPayment === true) return false;
  return typeof tx.amount === "number" && Number.isFinite(tx.amount) && tx.amount > 0;
}

export function pickPendingToConfirm(
  withdrawal: BankEmailWithdrawal,
  candidates: readonly PendingConfirmCandidate[],
  resolvedAccountId?: string
): PendingConfirmCandidate | null {
  const w = cents(withdrawal.amount);
  const near = candidates.filter(
    (c) =>
      // Account gate: only an untagged row or one tagged to THIS account is
      // eligible — never verify a row belonging to a different account (a
      // credit-card pending row must not be cleared by a checking email).
      (c.accountId === undefined || c.accountId === resolvedAccountId) &&
      cents(c.amount) === w &&
      dayGap(c.date, withdrawal.date) <= CONFIRM_DATE_TOLERANCE_DAYS
  );
  if (near.length === 0) return null;
  if (near.length === 1) return near[0] ?? null;

  // Ambiguous on amount+date alone → break the tie with merchant similarity.
  const similar = near.filter((c) => merchantSimilar(c.merchant, withdrawal.descriptor));
  return similar.length === 1 ? (similar[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// 4d — PAY a calendar bill
// ---------------------------------------------------------------------------

/** True when the actual charge is within tolerance of the bill's amount. */
export function billAmountWithinTolerance(billAmount: number, actual: number): boolean {
  const diff = Math.abs(cents(billAmount) - cents(actual));
  const pct = cents(billAmount) * BILL_AMOUNT_PCT_TOLERANCE;
  const abs = BILL_AMOUNT_ABS_TOLERANCE * 100;
  return diff <= Math.max(pct, abs);
}

/**
 * WHICH tier matched, in descending order of authority:
 *   - `rule`  — a household-authored `MerchantRule.billId` names this bill.
 *   - `alias` — a descriptor previously learned onto the bill.
 *   - `token` — significant-token overlap with the bill's title (a guess).
 *
 * Replaces the older boolean `matchedByAlias`: with three tiers a boolean can
 * no longer say which one won, and a second boolean beside it would make
 * "rule AND alias" representable when it never happens. The endpoint keys the
 * alias-learning write on `token` — see {@link BillPayMatch}.
 */
export type BillMatchSource = "rule" | "alias" | "token";

export interface BillPayMatch {
  bill: BillPayCandidate;
  /**
   * How the bill was found. The endpoint LEARNS the descriptor onto the bill's
   * aliases only for `token` — an alias match already knows the descriptor, and
   * a `rule` match is already recorded by the rule the household wrote. Writing
   * an alias for a rule match would create a second, redundant source of truth
   * that outlives deleting the rule, so the link could not be undone by undoing
   * the thing that made it.
   */
  matchedBy: BillMatchSource;
}

/**
 * Every candidate a rule's `billId` names. A recurring rule points at the
 * TEMPLATE id, while the candidate pool holds expanded occurrences whose own
 * `id` is synthetic, so both are checked.
 */
function billsNamedByRule(
  billId: string,
  candidates: readonly BillPayCandidate[]
): BillPayCandidate[] {
  return candidates.filter((c) => c.id === billId || c.templateId === billId);
}

/**
 * Choose the single bill this withdrawal pays, or null.
 *
 * Three tiers, most authoritative first — rule, then learned alias, then title
 * token-overlap. Within every tier the match must be UNIQUE; ambiguity returns
 * null rather than guessing, and (as with the alias tier) an ambiguous rule does
 * NOT fall through to a weaker signal: if the strongest evidence available can't
 * settle it, weaker evidence has no business doing so.
 *
 * The rule tier deliberately BYPASSES the amount tolerance. That guard exists to
 * stop a *guess* from mis-paying a bill; `billId` is not a guess, it is an
 * explicit statement by the household that this descriptor IS that bill. The
 * variable-amount bill — a utility, a credit-card statement — is exactly the
 * case the ±10%/±$25 window gets wrong, and making those payable is the point of
 * the feature. The other two tiers keep the guard.
 *
 * A rule whose `billId` names nothing in the pool (already paid, or outside the
 * expansion window) falls through to alias/token rather than forcing a match:
 * the household said "this is that bill", not "pay something regardless".
 */
export function pickBillToPay(
  withdrawal: BankEmailWithdrawal,
  candidates: readonly BillPayCandidate[],
  rules?: readonly MerchantRule[]
): BillPayMatch | null {
  const rule = pickMerchantRule(withdrawal.descriptor, withdrawal.amount, rules);
  if (rule?.billId) {
    const named = billsNamedByRule(rule.billId, candidates);
    if (named.length === 1) return { bill: named[0]!, matchedBy: "rule" };
    if (named.length > 1) return null; // ambiguous rule → don't guess
    // named.length === 0 → the bill isn't payable right now; fall through.
  }

  const inTol = candidates.filter((c) =>
    billAmountWithinTolerance(c.amount, withdrawal.amount)
  );
  if (inTol.length === 0) return null;

  const aliasMatches = inTol.filter((c) =>
    matchesAlias(withdrawal.descriptor, c.bankDescriptorAliases)
  );
  if (aliasMatches.length === 1) return { bill: aliasMatches[0]!, matchedBy: "alias" };
  if (aliasMatches.length > 1) return null; // ambiguous alias → don't guess

  const tokenMatches = inTol.filter((c) =>
    shareSignificantToken(withdrawal.descriptor, c.title)
  );
  if (tokenMatches.length === 1) return { bill: tokenMatches[0]!, matchedBy: "token" };
  return null;
}

// ---------------------------------------------------------------------------
// Combined per-line decision (the order-of-operations core)
// ---------------------------------------------------------------------------

export type WithdrawalDecision =
  | { kind: "skip_bankref" }
  | { kind: "fill_stub"; stubId: string }
  | { kind: "confirm_pending"; transactionId: string }
  | { kind: "pay_bill"; match: BillPayMatch }
  | { kind: "create" };

export interface DecideWithdrawalInput {
  withdrawal: BankEmailWithdrawal;
  /** Every bankRef already present on a household transaction (4a dedup). */
  existingBankRefs: ReadonlySet<string>;
  /** Apple Pay $0 stub candidates (mapped to reconcile.ts's shape). */
  stubs: readonly ReconcileCandidate[];
  /** Pending_review confirm candidates. */
  pendingCandidates: readonly PendingConfirmCandidate[];
  /** Unpaid expense bill occurrences. */
  billCandidates: readonly BillPayCandidate[];
  /** Account the email resolved to (used to gate stub-fill by account). */
  resolvedAccountId?: string;
  /**
   * The household's merchant rules. Only the PAY step reads them (a rule's
   * `billId`); omitting them reproduces the pre-rules behaviour exactly.
   *
   * They deliberately do NOT reach the earlier steps: skip/fill/confirm are
   * IDENTITY questions ("is this the same purchase?"), and identity is answered
   * from the raw bank descriptor alone. A user-editable label must never decide
   * whether two rows are the same charge.
   */
  merchantRules?: readonly MerchantRule[];
}

/**
 * Apply the a→e precedence for one withdrawal line. Pure: returns the decision;
 * the endpoint performs the corresponding writes.
 */
export function decideWithdrawal(input: DecideWithdrawalInput): WithdrawalDecision {
  const { withdrawal, existingBankRefs, stubs, pendingCandidates, billCandidates } = input;

  // a. Already recorded under this bankRef → skip (idempotent).
  if (existingBankRefs.has(withdrawal.bankRef)) {
    return { kind: "skip_bankref" };
  }

  // b. Fill a prior Apple Pay $0 stub. Restrict to date-proximate stubs so the
  //    time-only fallback in pickFillTarget can't reach across days.
  const nearStubs = stubs.filter(
    (s) => dayGapForStub(s, withdrawal.date) <= STUB_DATE_TOLERANCE_DAYS
  );
  const stub = pickFillTarget(
    {
      amount: withdrawal.amount,
      merchant: withdrawal.descriptor,
      accountId: input.resolvedAccountId,
    },
    nearStubs
  );
  if (stub) return { kind: "fill_stub", stubId: stub.id };

  // c. Confirm an existing pending transaction (account-gated).
  const pending = pickPendingToConfirm(withdrawal, pendingCandidates, input.resolvedAccountId);
  if (pending) return { kind: "confirm_pending", transactionId: pending.id };

  // d. Pay a matching unpaid bill (rule > learned alias > title token-overlap).
  const bill = pickBillToPay(withdrawal, billCandidates, input.merchantRules);
  if (bill) return { kind: "pay_bill", match: bill };

  // e. Otherwise create a new verified, needs-category transaction.
  return { kind: "create" };
}

/**
 * A ReconcileCandidate carries no date, so the endpoint attaches one via the
 * optional `date` field below when it maps stubs. Absent → treated as
 * in-window (matches quickAddExpense's own duck-typed createdAt handling).
 */
function dayGapForStub(
  stub: ReconcileCandidate & { date?: string },
  withdrawalDate: string
): number {
  return stub.date ? dayGap(stub.date, withdrawalDate) : 0;
}

// ---------------------------------------------------------------------------
// Account resolution (2) — bank-account last-4 match
// ---------------------------------------------------------------------------

/** The minimal account shape the bank-account matcher needs. */
export interface AccountLast4Like {
  id: string;
  accountLast4?: string;
}

/**
 * Resolve the account by the email's parsed bank-account last-4 against
 * `Account.accountLast4`. Returns the id only on a UNIQUE match — zero matches
 * (unknown account) or a tie both return null so the endpoint no-ops rather than
 * writing to a guessed account.
 */
export function matchAccountByAccountLast4(
  last4: string,
  accounts: readonly AccountLast4Like[]
): string | null {
  const matches = accounts.filter((a) => a.accountLast4 === last4);
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

// ---------------------------------------------------------------------------
// Idempotency + ending-balance (small pure helpers, unit-tested)
// ---------------------------------------------------------------------------

/** True when this messageId has already been processed (ledger fast-skip, 3). */
export function isMessageAlreadyProcessed(
  messageId: string,
  processedIds: ReadonlySet<string>
): boolean {
  return processedIds.has(messageId);
}

/** Minimal income-calendar-item shape for bill retro-attribution. */
export interface PaidIncomeLike {
  type: "income" | "expense";
  isPaid: boolean;
  isDeleted?: boolean;
  /** yyyy-MM-dd. */
  date: string;
}

/**
 * Pay-period id for a PAID BILL, mirroring the client `payCalendarItem`
 * retro-filing convention (contexts/household/mutations/calendarMutations.ts):
 * a bill files under the period covering its DUE date, and a bill dated before
 * the current period start (an overdue bill paid after the period rolled) files
 * under the pay period it was due in — the latest APPROVED paycheck (paid,
 * non-deleted income calendar item) on/before the due date (yyyy-MM-dd compares
 * lexically). No such paycheck → '' (untracked history), matching the client.
 *
 * NOTE: pass the bill's DUE date, not the withdrawal's clearing date — the whole
 * point of the retro-file is that a July email paying an overdue June bill lands
 * in the June period.
 */
export function getBillPayPeriodId(
  billDueDate: string,
  lastPaycheckDate: string | undefined,
  calendarItems: readonly PaidIncomeLike[]
): string {
  const direct = getPayPeriodForTransactionLexical(billDueDate, lastPaycheckDate);
  if (direct) return direct;
  return calendarItems.reduce(
    (latest, i) =>
      i.type === "income" &&
      i.isPaid &&
      !i.isDeleted &&
      i.date <= billDueDate &&
      i.date > latest
        ? i.date
        : latest,
    ""
  );
}

/**
 * Local lexical port of getPayPeriodForTransaction (plaid/payPeriod.ts) — a bill
 * on/after the last paycheck files under it, else '' for pre-period. Kept inline
 * (yyyy-MM-dd lexical compare) so this pure helper needs no date-fns import.
 */
function getPayPeriodForTransactionLexical(
  transactionDate: string,
  lastPaycheckDate: string | undefined
): string {
  if (!lastPaycheckDate) return "";
  return transactionDate >= lastPaycheckDate ? lastPaycheckDate : "";
}

/**
 * The Firestore patch that OVERWRITES an account's balance with the email's
 * AVAILABLE balance (5). It is an absolute set, never an increment — the
 * available balance already reflects every withdrawal AND every
 * authorized-but-unposted hold, so this is the single source of balance truth
 * for the sync. (The email's "Ending balance" is the posted-only figure; it
 * runs HIGH by the sum of pending card holds, which is exactly the money the
 * user can no longer spend — so Available, not Ending, is what the account
 * balance must mirror.)
 */
export function buildBalanceUpdate(availableBalance: number): { balance: number } {
  return { balance: availableBalance };
}

// ---------------------------------------------------------------------------
// Only-if-newer balance overwrite guard (out-of-order email safeguard)
// ---------------------------------------------------------------------------

/**
 * The email's "balance as-of" date, in descending order of trust:
 *   1. `emailAsOf` — the date the email ITSELF states in its "As of MM/DD/YYYY"
 *      footer (`BankEmailParseResult.asOf`). This is the only signal tied to
 *      when the bank actually captured the balance, so it must win whenever
 *      present — a backfill can deliver an old email well after its "as of"
 *      date, and neither of the other two signals reflects that skew.
 *   2. the LATEST withdrawal date in the parsed email (the ending balance
 *      reflects everything up through that date) — used only when the email
 *      didn't state its own as-of date.
 *   3. `today` (the request's processing date) — the WEAKEST signal, since it
 *      reflects when we happened to process the email, not when the bank
 *      captured the balance. Using this as anything but a last resort corrupts
 *      ordering during a backfill: an old, withdrawal-free, balance-only email
 *      processed today would otherwise compute an as-of of today, beat a
 *      correctly-dated stored balanceAsOf, overwrite it with a stale balance,
 *      and stamp a bogus future balanceAsOf that then blocks genuinely newer
 *      emails from ever taking effect.
 */
export function computeBalanceAsOf(
  withdrawalDates: readonly string[],
  today: string,
  emailAsOf?: string
): string {
  if (emailAsOf) return emailAsOf;
  if (withdrawalDates.length === 0) return today;
  return withdrawalDates.reduce((max, d) => (d > max ? d : max));
}

/**
 * True when the account's stored `balanceAsOf` is strictly newer than the
 * incoming email's as-of date — i.e. this email is OUT OF ORDER (e.g. a
 * first-install backfill processing several historical emails newest-first)
 * and must NOT overwrite the balance. yyyy-MM-dd strings compare lexically.
 * Same-or-newer incoming dates (the normal case) are never skipped, and an
 * account with no stored `balanceAsOf` yet (first sync) is never skipped.
 */
export function shouldSkipBalanceOverwrite(
  storedBalanceAsOf: string | undefined,
  incomingBalanceAsOf: string
): boolean {
  return storedBalanceAsOf !== undefined && storedBalanceAsOf > incomingBalanceAsOf;
}
