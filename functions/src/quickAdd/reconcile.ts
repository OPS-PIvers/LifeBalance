/**
 * Reconciliation logic for the two iOS Apple Pay capture paths.
 *
 * A single purchase can reach `quickAddExpense` via TWO independent iOS
 * Shortcuts when the user enables both:
 *
 *   1. The Apple Pay "Transaction" automation — fires on the AUTHORIZATION
 *      event, which for tipped/hotel/gas purchases is often a $0 pre-auth hold.
 *      Stored as a `needsAmount` stub (amount 0) awaiting the real total.
 *   2. A bank-notification automation — triggers on the bank's push
 *      ("$13.31 at Amatista Cookhouse"), parses out the REAL settled amount,
 *      and POSTs it with `fromBankNotification: true`.
 *
 * The catch: the two systems report DIFFERENT merchant strings for the same
 * purchase ("Loews Sapphire Falls Fb" from Apple Pay vs "Amatista Cookhouse"
 * from the bank) and share no transaction id, so they can only be correlated by
 * TIME + the $0-stub structure. This module is the pure decision layer: given
 * the incoming bank event and the household's recent Shortcut-created pending
 * rows, decide which awaiting-amount stub (if any) the real amount should fill.
 *
 * Money-safety principle (owner-chosen — "bank-primary, safe auto-merge"): fill
 * a stub ONLY when the match is unambiguous; when in doubt UNDER-merge (write a
 * separate row the user reconciles in review) rather than risk stamping the
 * wrong amount onto the wrong purchase. A filled row stays `pending_review`, so
 * it still flows through the normal review path and never moves a balance until
 * the user verifies it.
 *
 * Pure + dependency-light on purpose (mirrors `utils/transactionMatch.ts` on the
 * client): data in, decision out — no Firestore here, trivially unit-testable.
 *
 * `pickFillTarget`'s merchant-match decision delegates to `merchantSimilar`
 * from `./transactionIdentity` (plan 03 PR-1) — the shared token-overlap
 * comparator now used across all reconciliation call sites. `normalizeMerchant`
 * stays HERE (not delegated) because it is itself directly unit-tested for
 * exact string output in reconcile.test.ts, and its punctuation handling
 * differs from the identity module's own normalizer (see the divergence note
 * in transactionIdentity.ts) — swapping its output would be an unrelated
 * behavior change this PR does not make.
 */
import { merchantSimilar } from "./transactionIdentity";

/**
 * How close in time the two triggers must fire to be considered the same
 * purchase. They normally arrive seconds apart (Apple Pay on-device at the
 * register, the bank push moments later), so a tight window bounds how many
 * unrelated rows can collide in the time-only fallback below.
 */
export const RECONCILE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/** A recent pending transaction considered as a reconciliation candidate. */
export interface ReconcileCandidate {
  id: string;
  amount: number;
  merchant: string;
  /** True for an Apple Pay $0 awaiting-amount stub. */
  needsAmount: boolean;
  /** Account the stub is tagged to, if any. Apple Pay stubs are usually
   *  untagged (the Wallet automation sends no card), so this is normally
   *  absent — but when present it's used to avoid merging a purchase from one
   *  card into a stub belonging to a different card. */
  accountId?: string;
}

/** The incoming bank-notification event, already parsed/normalized. */
export interface IncomingExpense {
  amount: number;
  merchant: string;
  /** Optional category; only overwrites the stub's when non-default. */
  category?: string;
  /** Account resolved from the card last-4 (Wells Fargo email path), if any.
   *  When set, a candidate tagged to a *different* account is ineligible, and
   *  a filled stub inherits this account. */
  accountId?: string;
}

/**
 * Normalize a merchant/store label for equality comparison: lowercase, strip
 * everything but alphanumerics + spaces, collapse whitespace. Deliberately
 * conservative — a false MERCHANT match is the only way the strong path can
 * mis-merge, so we would rather miss a fuzzy match (and fall back to the
 * time-only path's "exactly one" guard) than over-match two different stores.
 */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choose the awaiting-amount stub a real bank amount should fill, or `null` to
 * write a new row instead. Only the stubs (`needsAmount` + amount 0) among the
 * recent candidates are eligible.
 *
 *  - exactly one stub whose normalized merchant matches → that stub (strong)
 *  - two or more merchant-matching stubs                → null (ambiguous)
 *  - no merchant match BUT exactly one stub in the window → that stub
 *    (time-only; this is the cross-system case where the bank and Apple Pay
 *    descriptors differ, e.g. "Amatista Cookhouse" vs "Loews Sapphire Falls Fb")
 *  - no merchant match and zero or 2+ stubs             → null (under-merge)
 *
 * The time-only fallback is the only path that can mis-associate, and only when
 * a second purchase produced a lone unfilled stub inside the same window; the
 * tight {@link RECONCILE_WINDOW_MS} and the "exactly one" guard keep that rare.
 */
export function pickFillTarget(
  incoming: IncomingExpense,
  candidates: readonly ReconcileCandidate[],
): ReconcileCandidate | null {
  const stubs = candidates.filter((c) => {
    if (!c.needsAmount || c.amount !== 0) return false;
    // Never fill a stub that's explicitly tagged to a DIFFERENT account than
    // the incoming purchase. Untagged stubs (the usual Apple Pay case) stay
    // eligible so this is a strict tighten, never a regression.
    if (incoming.accountId && c.accountId && c.accountId !== incoming.accountId) {
      return false;
    }
    return true;
  });
  if (stubs.length === 0) return null;

  const key = normalizeMerchant(incoming.merchant);
  if (key) {
    const byMerchant = stubs.filter((s) => merchantSimilar(s.merchant, incoming.merchant));
    if (byMerchant.length === 1) return byMerchant[0] ?? null; // strong match
    if (byMerchant.length > 1) return null; // ambiguous → don't guess
  }

  // Cross-system fallback: the bank and Apple Pay merchant strings never match
  // by name, so correlate on time alone — but only when there is exactly ONE
  // outstanding stub, so we can never put the amount on the wrong purchase.
  return stubs.length === 1 ? (stubs[0] ?? null) : null;
}

/**
 * Build the Firestore patch that fills an awaiting-amount stub from the real
 * bank event. Replaces the Apple Pay merchant descriptor with the (more
 * recognizable) bank merchant, sets the real amount, and clears the stub flag.
 * Status is intentionally left untouched (stays `pending_review`) so the merged
 * row still surfaces in the review/Action-Queue path. Category is only
 * overwritten when the incoming event carries a non-default one.
 */
export function buildFillUpdates(
  incoming: IncomingExpense,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    amount: incoming.amount,
    merchant: incoming.merchant,
    needsAmount: false,
  };
  if (incoming.category && incoming.category !== "Uncategorized") {
    updates.category = incoming.category;
  }
  // Tag the filled stub with the resolved account (card last-4 match) whenever
  // the incoming event carries one. pickFillTarget has already guaranteed the
  // chosen stub is either untagged or the SAME account, so this only ever sets
  // or re-affirms the correct account for the review/verify step.
  if (incoming.accountId) {
    updates.accountId = incoming.accountId;
  }
  return updates;
}
