/**
 * Shared "same real-world purchase?" identity logic.
 *
 * A single purchase can enter LifeBalance through up to eight paths (manual
 * entry, receipt scan, bank-statement scan, voice capture, iOS Shortcut
 * quickAdd, bank-alert email, Plaid sync, Apple Pay $0 stub — see
 * advisor-plans/03-transaction-identity-reconciliation.md). Today each pair of
 * paths is reconciled by its own bespoke matcher (`utils/transactionMatch.ts`,
 * `functions/src/quickAdd/reconcile.ts`); this module is the SINGLE shared
 * notion of "are these two rows the same purchase" that those (and future
 * Plaid/quickAdd wire-ins) delegate to.
 *
 * This is PR-1 of plan 03: the identity primitives + absorbing the two
 * existing reconcilers' internals, with ZERO intended behavior change (their
 * existing test suites are the regression gate — see the file-level comments
 * in reconcile.ts / transactionMatch.ts for what still routes through their
 * OWN historical normalizer for that reason).
 *
 * Deliberately duplicated (not imported) from `utils/transactionIdentity.ts`
 * — same precedent as `utils/habitLogic.ts` / `streakLogic.ts`, since the
 * client bundle and the Cloud Functions package are separate builds with no
 * shared runtime. Keep the two copies IDENTICAL when editing either.
 */
import { differenceInCalendarDays, parseISO } from "date-fns";

/** Matches INCOME_CATEGORY in the app (types/schema.ts) — kept local because
 *  the functions package doesn't import client types (same precedent as
 *  functions/src/plaid/mapping.ts). */
export const INCOME_CATEGORY = "Income";

/** Verdict returned by {@link isLikelyDuplicate}. */
export type DuplicateVerdict = "duplicate" | "possible" | "distinct";

/** Minimal shape {@link fingerprint}/{@link isLikelyDuplicate} need from a transaction-like row. */
export interface IdentityTransaction {
  amount: number;
  merchant: string;
  /** yyyy-MM-dd local date string. */
  date: string;
  category: string;
  status: "verified" | "pending_review";
  accountId?: string;
  /** Apple Pay $0 pre-authorization stub awaiting its real amount. */
  needsAmount?: boolean;
  /**
   * The bank's verbatim descriptor text for this purchase, when known — e.g.
   * a statement screenshot's raw row text ("PURCHASE JIMMY JOHNS MINNEAPOLIS
   * MN CARD7752") captured alongside a cleaned display `merchant` ("Jimmy
   * Johns"). Used ONLY for identity comparison ({@link identityNames} /
   * {@link namesSimilar}), never for display.
   */
  bankDescriptor?: string;
}

/** Calendar-day window within which a Plaid post-date can lag the original capture. */
export const DUPLICATE_WINDOW_DAYS = 3;

/**
 * Within this many calendar days a match is confident enough to auto-merge
 * (`'duplicate'`). Between this and {@link DUPLICATE_WINDOW_DAYS} the verdict
 * downgrades to `'possible'` — the plan's known hard case: an identical
 * recurring charge two days apart (daily coffee, a resubscription) is
 * indistinguishable from a lagged post by amount+merchant+date alone, so it
 * must surface as a user choice ("Merge / Keep both"), never silently merge.
 */
export const AUTO_DUPLICATE_WINDOW_DAYS = 1;

/** Convert a stored (always-positive) dollar amount to integer cents, avoiding float drift. */
const amountCents = (amount: number): number => Math.round(Math.abs(amount) * 100);

/**
 * Normalize a merchant/store label for token comparison: lowercase, strip
 * everything but letters/numbers/whitespace (Unicode-aware), collapse
 * whitespace. This is the identity module's OWN normalizer — a conservative
 * superset shape shared by both callers' historical behavior — used only by
 * {@link merchantSimilar} for the new duplicate-verdict policy. It intentionally
 * does NOT replace `normalizeMerchant` (reconcile.ts) or `normalizeStoreName`
 * (storeMatch.ts): those two diverge on punctuation handling (see module
 * comment) and each caller's existing tests pin its own historical behavior.
 */
function normalizeForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-overlap merchant comparison: normalizes both names and considers them
 * similar when they're equal, or one's token set is a subset of the other's
 * (handles "Amatista" vs "Amatista Cookhouse", store-number suffixes, etc.).
 * Empty-vs-empty is NOT similar (nothing to compare).
 */
export function merchantSimilar(a: string, b: string): boolean {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Single-character tokens (e.g. the stray "s" that apostrophe-stripping
  // leaves behind) carry no identifying signal — a {"s"} ⊆ {"trader","joe","s"}
  // subset hit would be a false positive. They only count via the exact-equality
  // path above (which still matches short names like "H M" to themselves).
  const tokensA = new Set(na.split(" ").filter((t) => t.length >= 2));
  const tokensB = new Set(nb.split(" ").filter((t) => t.length >= 2));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

/**
 * The names a row can be recognised by: its display `merchant` plus, when
 * known, the bank's verbatim `bankDescriptor`. Drops empty/whitespace-only
 * values and de-duplicates exact repeats (e.g. a row that never had its
 * merchant cleaned, so both fields hold the same raw text).
 *
 * A cleaned display name and the bank's raw text carry DIFFERENT tokens —
 * cleaning drops noise ("PURCHASE", "CARD7752") and sometimes invents a
 * canonical brand name absent from the raw string ("AMZN Mktp US*2H4KL" →
 * "Amazon"). Neither name alone is guaranteed to `merchantSimilar`-match
 * every other system's own name for the same purchase, so a row must be
 * recognisable by BOTH.
 */
export function identityNames(row: { merchant?: string; bankDescriptor?: string }): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of [row.merchant, row.bankDescriptor]) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    names.push(trimmed);
  }
  return names;
}

/**
 * True when ANY pairing of the two rows' {@link identityNames} is
 * {@link merchantSimilar}. This is what makes a cleaned display name on one
 * side match a raw bank descriptor on the other (or vice versa) — comparing
 * only `merchant` vs `merchant` would miss it since the two names carry
 * different tokens (see {@link identityNames}).
 *
 * Matches `merchantSimilar`'s empty-vs-empty contract: false when either row
 * has no usable name at all.
 */
export function namesSimilar(
  a: { merchant?: string; bankDescriptor?: string },
  b: { merchant?: string; bankDescriptor?: string }
): boolean {
  const namesA = identityNames(a);
  const namesB = identityNames(b);
  if (namesA.length === 0 || namesB.length === 0) return false;
  return namesA.some((na) => namesB.some((nb) => merchantSimilar(na, nb)));
}

/**
 * Candidate key for cheaply finding *possible* duplicates — NOT a unique id
 * (two distinct purchases can share one; a real duplicate check must still
 * run {@link isLikelyDuplicate}). Uses `'none'` for an unknown account so two
 * untagged rows still group together.
 */
export function fingerprint(txn: IdentityTransaction): string {
  const accountKey = txn.accountId ?? "none";
  return `${accountKey}|${amountCents(txn.amount)}|${txn.date}`;
}

/**
 * Decide whether two transaction-like rows likely represent the SAME
 * real-world purchase. Pairwise only — never chain through a third row.
 *
 * Policy (see advisor-plans/03-transaction-identity-reconciliation.md):
 *  - Never match two rows that are both `verified` (each already represents
 *    a settled, user-confirmed entry).
 *  - Never match across income vs. expense (`category === INCOME_CATEGORY`
 *    on one side only).
 *  - `needsAmount` stub on either side: amount is a wildcard (the stub's
 *    amount is a 0 placeholder, not a real value to compare) — match on
 *    account (when both known and differ, no match) and merchant similarity;
 *    this mirrors reconcile.ts's stub-fill contract at the policy level
 *    without changing reconcile.ts's own decision path.
 *  - Otherwise: same account (both known) + same amount-cents + date within
 *    {@link AUTO_DUPLICATE_WINDOW_DAYS} calendar days + `merchantSimilar` →
 *    `'duplicate'` (safe to auto-merge/annotate).
 *  - Same amount-cents + within {@link DUPLICATE_WINDOW_DAYS} but any
 *    confidence signal missing — merchant dissimilar, either account
 *    unknown, or the dates are 2–3 days apart (could be a genuine second
 *    charge from a recurring merchant) → `'possible'` (surface a
 *    Merge / Keep-both choice, never auto-merge).
 *  - Otherwise → `'distinct'`. This is also the outcome for two identical
 *    recurring subscriptions posted a few days apart when they're NOT within
 *    the window, or — the documented hard case — when they're both
 *    unambiguously separate charges the window can't tell apart; callers
 *    that need subscription-cadence awareness must use their own recurrence
 *    metadata, since amount+merchant+date alone cannot safely distinguish
 *    "the same $9.99 charge, delayed" from "next month's $9.99 charge".
 */
export function isLikelyDuplicate(a: IdentityTransaction, b: IdentityTransaction): DuplicateVerdict {
  if (a.status === "verified" && b.status === "verified") return "distinct";

  const aIsIncome = a.category === INCOME_CATEGORY;
  const bIsIncome = b.category === INCOME_CATEGORY;
  if (aIsIncome !== bIsIncome) return "distinct";

  const aDay = parseISO(a.date);
  const bDay = parseISO(b.date);
  if (Number.isNaN(aDay.getTime()) || Number.isNaN(bDay.getTime())) return "distinct";
  const dayDistance = Math.abs(differenceInCalendarDays(aDay, bDay));
  if (dayDistance > DUPLICATE_WINDOW_DAYS) return "distinct";

  const accountsKnown = Boolean(a.accountId && b.accountId);
  const accountsConflict = Boolean(a.accountId && b.accountId && a.accountId !== b.accountId);
  if (accountsConflict) return "distinct";

  const eitherIsStub = Boolean(a.needsAmount || b.needsAmount);
  const similar = namesSimilar(a, b);

  const withinAutoWindow = dayDistance <= AUTO_DUPLICATE_WINDOW_DAYS;

  if (eitherIsStub) {
    // Amount is a wildcard for a stub — only merchant + account can decide.
    if (similar) return accountsKnown && withinAutoWindow ? "duplicate" : "possible";
    return "possible";
  }

  const amountsMatch = amountCents(a.amount) === amountCents(b.amount);
  if (!amountsMatch) return "distinct";

  if (similar && accountsKnown && withinAutoWindow) return "duplicate";
  return "possible";
}
