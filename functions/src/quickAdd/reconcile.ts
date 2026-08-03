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
  /** True if this row was ITSELF created from a bank-notification capture.
   *  Read by the two cross-source dedup pickers with INVERTED guards:
   *  {@link pickDuplicateShortcutRow} (forward path — bank arrives second)
   *  only merges INTO a NON-bank capture (the Apple Pay "Transaction" row),
   *  skipping candidates that are already bank rows; {@link pickReverseDuplicateRow}
   *  (reverse path — bank arrived first) requires the candidate IS a bank row.
   *  Either way a bank-notification row is never folded into another
   *  bank-notification row — otherwise two genuinely-separate identical
   *  purchases captured via the bank-only shortcut would collapse into one and
   *  lose spend data. */
  fromBankNotification?: boolean;
  /** CARD-1: the card last-4 already persisted on this row, if any. Used ONLY
   *  by the `build*Updates` functions below to decide whether an incoming
   *  card digit is safe to write (never overwrite a differing existing
   *  value) — deliberately NOT consulted by any of the `pick*` matching
   *  functions, so adding this field cannot change which row a merge
   *  targets or whether a merge happens at all. */
  cardLast4?: string;
}

/** The incoming capture, already parsed/normalized. Depending on the call site
 *  this is either a bank-notification event (the stub-fill and forward-dup paths)
 *  or a non-bank Apple Pay "Transaction" capture (the reverse-dup path) — the
 *  shape is identical, only the merge DIRECTION differs. */
export interface IncomingExpense {
  amount: number;
  merchant: string;
  /** Optional category; only overwrites the stub's when non-default. */
  category?: string;
  /** Account resolved from the card last-4 (Wells Fargo email path), if any.
   *  When set, a candidate tagged to a *different* account is ineligible, and
   *  a filled stub inherits this account. */
  accountId?: string;
  /** CARD-1: the normalized card last-4 parsed from this event, if any (see
   *  `accountMatch.ts#normalizeCardLast4`). Threaded through the reconcile
   *  builders below so a fill/merge doesn't discard it — a later PR uses it
   *  to attribute a transaction-fired habit completion to whoever's card was
   *  charged. Never consulted by the `pick*` matching functions. */
  cardLast4?: string;
  /** CARD-1 (finding 3): true when this incoming record IS the bank
   *  notification itself — the same signal the caller already gates the
   *  amount/merchant overwrite decision on (`fromBankNotification` on the
   *  quickAddExpense request body; always true for the nightly Wells Fargo
   *  sync, which is bank data by construction). Used ONLY by the
   *  `build*Updates` functions below to decide the `cardLast4` conflict
   *  policy — bank-sourced data overwrites a differing existing value,
   *  anything else only fills an absent one. Deliberately NOT consulted by
   *  any `pick*` matching function, so it can never change which row a
   *  merge targets. */
  fromBankNotification?: boolean;
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

/** Convert a stored (always-positive) dollar amount to integer cents, avoiding float drift. */
const amountCents = (amount: number): number => Math.round(Math.abs(amount) * 100);

/**
 * CARD-1 (finding 3): the single `cardLast4` conflict-resolution rule shared
 * by all three `build*Updates` functions below — "bank wins".
 *
 *  - No incoming card digit → nothing to write.
 *  - Incoming matches the target's existing value → no-op (nothing to write;
 *    re-stamping an identical value is pointless churn).
 *  - Incoming differs from an existing value (including "target has none"):
 *    - the incoming record is itself bank-sourced (`fromBankNotification`) →
 *      it WINS and overwrites, matching this module's existing convention
 *      that bank data always overwrites `amount`/`merchant` too. Bank data is
 *      the more trustworthy source: unlike `accountId` (resolved server-side
 *      from a matched card), `cardLast4` is a raw field ANY capture path can
 *      supply, so an early Apple-Pay-side value can be wrong.
 *    - otherwise → only fill when the target had no value at all (the prior,
 *      conservative "never clobber an existing value" behavior).
 *
 * Returns the value to write, or `undefined` when nothing should be written.
 */
function resolveCardLast4Update(
  incoming: IncomingExpense,
  target: ReconcileCandidate | undefined,
): string | undefined {
  if (!incoming.cardLast4) return undefined;
  const existing = target?.cardLast4;
  if (existing === incoming.cardLast4) return undefined; // identical → no-op
  if (incoming.fromBankNotification || !existing) return incoming.cardLast4;
  return undefined; // non-bank incoming, existing value present → never clobber
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
 *
 * `target` (optional, the {@link ReconcileCandidate} `pickFillTarget` chose)
 * is used ONLY to decide the `cardLast4` write below — omitting it keeps this
 * function's existing signature/behavior for any caller that predates CARD-1.
 */
export function buildFillUpdates(
  incoming: IncomingExpense,
  target?: ReconcileCandidate,
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
  // CARD-1 (finding 1 + finding 3): carry the resolved card last-4 through
  // the fill so a later PR can attribute the purchase. Conflict policy is
  // "bank wins" — see {@link resolveCardLast4Update}: a bank-sourced incoming
  // value overwrites a differing existing one; anything else only fills an
  // absent value, never clobbering it.
  const cardLast4Update = resolveCardLast4Update(incoming, target);
  if (cardLast4Update !== undefined) {
    updates.cardLast4 = cardLast4Update;
  }
  return updates;
}

/**
 * Choose an EXISTING real-amount shortcut row that this incoming bank
 * notification is a cross-source duplicate of, or `null` to write a new row.
 *
 * This is the sibling of {@link pickFillTarget} for the case the stub-fill path
 * can't reach: the Apple Pay "Transaction" automation captured the purchase at
 * its FULL amount (not a $0 pre-auth hold), so it landed as a normal
 * `pending_review` row rather than a `needsAmount` stub. Moments later the
 * bank-notification shortcut reports the SAME purchase under a different
 * merchant string ("Target" vs "TARGET T-2189") and — because the two captures
 * are frequently untagged — the shared identity check can only rank the pair as
 * `'possible'`, so a second row survives. This collapses that pair.
 *
 * Money-safety (mirrors pickFillTarget's model — never over-merge two genuinely
 * separate purchases):
 *  - Only a NON-stub candidate is eligible (stubs are pickFillTarget's job).
 *  - Only a candidate NOT itself from a bank notification is eligible — a merge
 *    must be cross-source (Apple Pay row ← bank notification). This is what
 *    keeps two real identical purchases captured via the bank-only shortcut from
 *    collapsing into one.
 *  - Account must not conflict (a different tagged card ⇒ a different purchase).
 *  - Amount must match to the cent and the merchant must be {@link merchantSimilar}.
 *  - EXACTLY ONE candidate must qualify. Zero → new row; two or more → ambiguous,
 *    so we under-merge (new row the user reconciles) rather than guess.
 *
 * Combined with the caller's tight {@link RECONCILE_WINDOW_MS} createdAt window,
 * a false merge would require two real purchases of the identical amount at a
 * similar-named merchant within ~30 minutes with exactly one prior Apple Pay
 * row — and the "exactly one" guard blocks even that (a second such purchase
 * yields two candidates ⇒ no merge).
 */
export function pickDuplicateShortcutRow(
  incoming: IncomingExpense,
  candidates: readonly ReconcileCandidate[],
): ReconcileCandidate | null {
  const eligible = candidates.filter((c) => {
    // Stubs are pickFillTarget's domain — never absorb one here.
    if (c.needsAmount || c.amount === 0) return false;
    // Only merge a bank notification INTO a non-bank (Apple Pay) capture.
    if (c.fromBankNotification) return false;
    // A different tagged card means a different purchase.
    if (incoming.accountId && c.accountId && c.accountId !== incoming.accountId) {
      return false;
    }
    if (amountCents(c.amount) !== amountCents(incoming.amount)) return false;
    return merchantSimilar(c.merchant, incoming.merchant);
  });
  return eligible.length === 1 ? (eligible[0] ?? null) : null;
}

/**
 * Build the Firestore patch that folds a bank-notification duplicate into the
 * existing Apple Pay row chosen by {@link pickDuplicateShortcutRow}. Unlike
 * {@link buildFillUpdates}, this deliberately does NOT overwrite the amount or
 * merchant: the existing row already carries the real amount, and its merchant
 * ("Target") is usually cleaner than the bank's store-numbered string
 * ("TARGET T-2189"). The only enrichment is back-filling the resolved account
 * onto a row that was captured untagged — a strict improvement for review.
 */
export function buildDuplicateMergeUpdates(
  incoming: IncomingExpense,
  target: ReconcileCandidate,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (incoming.accountId && !target.accountId) {
    updates.accountId = incoming.accountId;
  }
  // CARD-1 (finding 1 + finding 3): "bank wins" conflict policy — see
  // {@link resolveCardLast4Update}. This builder is only ever invoked on the
  // forward (bank-arrives-second) path, where the incoming record IS the
  // bank notification, so a differing existing value is overwritten rather
  // than preserved.
  const cardLast4Update = resolveCardLast4Update(incoming, target);
  if (cardLast4Update !== undefined) {
    updates.cardLast4 = cardLast4Update;
  }
  return updates;
}

/**
 * Mirror of {@link pickDuplicateShortcutRow} for the REVERSE capture ordering.
 *
 * {@link pickDuplicateShortcutRow} only fires when the bank push arrives SECOND
 * (an Apple Pay "Transaction" row is already on file). When the bank push lands
 * FIRST it becomes a `fromBankNotification: true` real-amount row, and the Apple
 * Pay automation then reports the SAME purchase moments later under a cleaner
 * merchant string ("Target" vs the bank's "TARGET T-2189"). That pair is again
 * only `'possible'` to the shared identity check (both captures are usually
 * untagged), so without this a second row would survive. This picks the existing
 * bank-notification row the INCOMING non-bank capture should fold into, or `null`
 * to write a new row.
 *
 * Money-safety is identical to the forward path (never over-merge two genuinely
 * separate purchases) — only the cross-source direction is flipped:
 *  - Only a NON-stub candidate is eligible (stubs are pickFillTarget's job).
 *  - Only a candidate that IS itself from a bank notification is eligible — the
 *    merge must be cross-source (bank row ← Apple Pay capture), the mirror of the
 *    forward path's non-bank requirement. This keeps two real identical purchases
 *    captured via the bank-only shortcut from collapsing into one.
 *  - Account must not conflict (a different tagged card ⇒ a different purchase).
 *  - Amount must match to the cent and the merchant must be {@link merchantSimilar}.
 *  - EXACTLY ONE candidate must qualify. Zero → new row; two or more → ambiguous,
 *    so we under-merge (new row the user reconciles) rather than guess.
 *
 * The caller invokes this ONLY for a non-bank (Apple Pay) incoming capture, so
 * the surviving row ends up being the Apple Pay capture's data (see
 * {@link buildReverseDuplicateMergeUpdates}) — the same invariant the forward
 * path preserves, since the bank descriptor is the uglier of the two.
 */
export function pickReverseDuplicateRow(
  incoming: IncomingExpense,
  candidates: readonly ReconcileCandidate[],
): ReconcileCandidate | null {
  const eligible = candidates.filter((c) => {
    // Stubs are pickFillTarget's domain — never absorb one here.
    if (c.needsAmount || c.amount === 0) return false;
    // Only merge an Apple Pay capture INTO a bank-notification row (the exact
    // mirror of pickDuplicateShortcutRow's `!c.fromBankNotification` guard).
    if (!c.fromBankNotification) return false;
    // A different tagged card means a different purchase.
    if (incoming.accountId && c.accountId && c.accountId !== incoming.accountId) {
      return false;
    }
    if (amountCents(c.amount) !== amountCents(incoming.amount)) return false;
    return merchantSimilar(c.merchant, incoming.merchant);
  });
  return eligible.length === 1 ? (eligible[0] ?? null) : null;
}

/**
 * Build the Firestore patch that folds an incoming non-bank Apple Pay capture
 * INTO the existing bank-notification row chosen by {@link pickReverseDuplicateRow},
 * rewriting that row so it becomes the Apple Pay capture — exactly one row
 * survives and it carries the Apple Pay data.
 *
 * Unlike {@link buildDuplicateMergeUpdates} (where the surviving row was ALREADY
 * the Apple Pay capture, so it kept its data untouched), the surviving document
 * here is the BANK row, so we:
 *  - overwrite its merchant with the incoming Apple Pay descriptor ("Target"
 *    beats the bank's store-numbered "TARGET T-2189"), and
 *  - clear the `fromBankNotification` flag so the row now reads as the Apple Pay
 *    capture — preserving the forward path's invariant that the Apple Pay capture
 *    is the surviving row (and letting a later stray bank notification for the
 *    same purchase fold in via {@link pickDuplicateShortcutRow} rather than add a
 *    third row).
 *
 * The amount is left untouched (pickReverseDuplicateRow guaranteed an exact-cent
 * match). The resolved account is back-filled only when the bank row was captured
 * untagged — a bank-resolved account (from the card last-4) is more reliable than
 * an untagged Apple Pay capture, so it is never clobbered. Category is overwritten
 * only when the incoming capture carries a non-default one.
 */
export function buildReverseDuplicateMergeUpdates(
  incoming: IncomingExpense,
  target: ReconcileCandidate,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    merchant: incoming.merchant,
    fromBankNotification: false,
  };
  if (incoming.category && incoming.category !== "Uncategorized") {
    updates.category = incoming.category;
  }
  if (incoming.accountId && !target.accountId) {
    updates.accountId = incoming.accountId;
  }
  // CARD-1 (finding 1 + finding 3): "bank wins" conflict policy — see
  // {@link resolveCardLast4Update}. This builder is only ever invoked on the
  // reverse (bank-arrives-first) path, where the incoming record is the
  // NON-bank Apple Pay capture and `target` is the existing bank row — so
  // `incoming.fromBankNotification` is false/absent here and the surviving
  // row's bank-resolved cardLast4 is never clobbered by the less-reliable
  // Apple Pay data; a differing value is only ever a fill of an absent one.
  const cardLast4Update = resolveCardLast4Update(incoming, target);
  if (cardLast4Update !== undefined) {
    updates.cardLast4 = cardLast4Update;
  }
  return updates;
}
