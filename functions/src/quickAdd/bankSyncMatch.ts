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
 *   d. PAY     — pay a matching unpaid calendar bill (descriptor token-overlap
 *                with the title OR a learned alias; amount within ±10% or ±$25)
 *   e. CREATE  — otherwise a new verified, `needsCategory` transaction
 *
 * The account balance is NEVER moved from any of these decisions — the email's
 * ending balance already reflects every withdrawal, and the endpoint overwrites
 * the account balance with it once (see `buildEndingBalanceUpdate`). That is why
 * neither CONFIRM nor PAY applies a per-line balance delta.
 */

import type { BankEmailWithdrawal } from "./bankEmailParser";
import { merchantSimilar } from "./transactionIdentity";
import { pickFillTarget, type ReconcileCandidate } from "./reconcile";

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
export function pickPendingToConfirm(
  withdrawal: BankEmailWithdrawal,
  candidates: readonly PendingConfirmCandidate[]
): PendingConfirmCandidate | null {
  const w = cents(withdrawal.amount);
  const near = candidates.filter(
    (c) =>
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

export interface BillPayMatch {
  bill: BillPayCandidate;
  /** True when matched via a learned alias; false when via title token-overlap
   *  (the endpoint then LEARNS the descriptor onto the bill's aliases). */
  matchedByAlias: boolean;
}

/**
 * Choose the single bill this withdrawal pays, or null. Alias matches take
 * precedence over title token-overlap; within each tier the amount must be
 * within tolerance and the match must be UNIQUE (ambiguity → null → CREATE).
 */
export function pickBillToPay(
  withdrawal: BankEmailWithdrawal,
  candidates: readonly BillPayCandidate[]
): BillPayMatch | null {
  const inTol = candidates.filter((c) =>
    billAmountWithinTolerance(c.amount, withdrawal.amount)
  );
  if (inTol.length === 0) return null;

  const aliasMatches = inTol.filter((c) =>
    matchesAlias(withdrawal.descriptor, c.bankDescriptorAliases)
  );
  if (aliasMatches.length === 1) return { bill: aliasMatches[0]!, matchedByAlias: true };
  if (aliasMatches.length > 1) return null; // ambiguous alias → don't guess

  const tokenMatches = inTol.filter((c) =>
    shareSignificantToken(withdrawal.descriptor, c.title)
  );
  if (tokenMatches.length === 1) return { bill: tokenMatches[0]!, matchedByAlias: false };
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

  // c. Confirm an existing pending transaction.
  const pending = pickPendingToConfirm(withdrawal, pendingCandidates);
  if (pending) return { kind: "confirm_pending", transactionId: pending.id };

  // d. Pay a matching unpaid bill.
  const bill = pickBillToPay(withdrawal, billCandidates);
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

/**
 * The Firestore patch that OVERWRITES an account's balance with the email's
 * ending balance (5). It is an absolute set, never an increment — the ending
 * balance already reflects every withdrawal, so this is the single source of
 * balance truth for the sync.
 */
export function buildEndingBalanceUpdate(endingBalance: number): { balance: number } {
  return { balance: endingBalance };
}
