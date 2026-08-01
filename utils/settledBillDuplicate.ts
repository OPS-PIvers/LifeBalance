/**
 * "The bank imported the bill I already paid by hand."
 *
 * The reported case: a recurring bill is marked paid on the calendar (which
 * creates a `verified` transaction stamped with `paidCalendarItemId` — see
 * `payCalendarItem`), and then the overnight bank-email sync imports the very
 * same charge as its own `verified` + `needsCategory` row under the bank's raw
 * descriptor. Two rows, one real payment, and no affordance anywhere to say so:
 *
 *  - `getBillLinkCandidates` filters to `!item.isPaid`, so the settled bill has
 *    already vanished from the "Link to bill" picker.
 *  - `isLikelyDuplicate` returns `'distinct'` for the pair three times over —
 *    both rows are `verified` (its very first early return), the merchants
 *    don't match (bank descriptor vs. the bill's title), and the dates can be
 *    further apart than `DUPLICATE_WINDOW_DAYS` allows.
 *
 * So this is a SEPARATE, deliberately narrow predicate rather than a loosening
 * of the shared identity policy: it only ever fires on the exact shape above,
 * and it is computed at render time (there is no stored flag to key off).
 *
 * TWO EVIDENCE TIERS, NOT A BOOLEAN. Amount + date + account alone is NOT
 * evidence that two rows are the same charge — two unrelated $142 charges on
 * one account in one week satisfy all three. But requiring descriptor evidence
 * outright would refuse the exact case that motivated the feature: descriptor
 * `CPENERGY MNGCO` against bill title `Centerpoint Energy (Natural Gas)` shares
 * ZERO significant tokens, which is why the nightly sync couldn't auto-match it
 * either. So the predicate reports WHICH evidence it has and the UI treats the
 * two differently — `descriptor` is a confident one-tap merge that also teaches
 * the bill the descriptor, `amount-only` is a question that must be confirmed
 * and teaches nothing (see `TransactionReviewForm`). Never collapse the tiers
 * back into a boolean: the alias write is what makes a wrong answer permanent
 * (`pickBillToPay`'s alias tier would auto-settle future occurrences, and no UI
 * anywhere reads or clears `bankDescriptorAliases`).
 *
 * Pure — no Firestore, no React (which is why `needsReview` was moved to
 * `utils/reviewQueue.ts`). Data in, decision out.
 */
import { differenceInCalendarDays, parseISO } from 'date-fns';

import { INCOME_CATEGORY, type CalendarItem, type Transaction } from '@/types/schema';
import { isBankSyncTransaction } from '@/utils/accountImpact';
import { matchesAlias, shareSignificantToken } from '@/utils/billDescriptorMatch';
import { subtractMoney } from '@/utils/money';
import { needsReview } from '@/utils/reviewQueue';
import { findSettledBill } from '@/utils/settledBillGuard';

/**
 * Calendar-day window between the manual row and the bank row.
 *
 * SEVEN, not `DUPLICATE_WINDOW_DAYS` (3): the two rows are dated by different
 * clocks. `payCalendarItem` dates the row it creates to the occurrence's DUE
 * date (so the bill files into the right pay period), while the bank row is
 * dated to the CLEARING date the bank reported. A bill due on the 5th that
 * clears on the 9th is 4 days apart with nothing wrong at all, and gas/electric
 * utilities routinely take that long to post.
 *
 * `DUPLICATE_WINDOW_DAYS` itself is deliberately NOT widened: it governs the
 * generic same-purchase verdict, where a wider window starts confusing "the
 * same charge, delayed" with "next week's identical charge". Here the extra
 * slack is safe because the counterpart must ALSO carry a still-paid
 * `paidCalendarItemId` and match to the exact cent.
 */
export const SETTLED_BILL_DUPLICATE_WINDOW_DAYS = 7;

/**
 * How much the app actually knows about this pairing.
 *
 *  - `descriptor` — the bank's raw descriptor matches a learned alias on the
 *    bill, or shares a significant token with the bill's title. The pairing is
 *    supported by the row's own identity, not merely by its arithmetic.
 *  - `amount-only` — the two rows agree on amount, account and timing and
 *    NOTHING else. Plausible, not established.
 */
export type SettledBillEvidence = 'descriptor' | 'amount-only';

export interface SettledBillDuplicateMatch {
  /** The settled bill-payment row (the merge KEEPER — it owns the paid doc). */
  counterpart: Transaction;
  /** The still-paid calendar doc the counterpart settled. */
  bill: CalendarItem;
  evidence: SettledBillEvidence;
}

/**
 * Cent-exact equality on SIGNED amounts, via money.ts's integer-cents math.
 *
 * Signed, not absolute: a `-142` refund/reversal row and a `+142` settled bill
 * are both non-Income, so the polarity guard below passes and an absolute
 * comparison would offer to merge them — deleting the refund record. Every real
 * write path stores expenses positive, so this costs no true positives.
 */
const sameAmountToTheCent = (a: number, b: number): boolean => subtractMoney(a, b) === 0;

/**
 * The calendar doc a learned descriptor belongs on for a paid doc: the recurring
 * TEMPLATE when the paid doc is an instance of one AND that template still
 * exists, else the paid doc itself.
 *
 * The template check is not defensive noise. `makeDeleteCalendarItem` hard-deletes
 * a template and leaves its paid instances behind, so `parentRecurringId` can
 * name a document that is gone — and `mergeBatch.update()` on a missing doc
 * rejects the WHOLE batch with `not-found`, which would take the keeper patch and
 * the dupe delete down with it and make Merge fail forever on that pair.
 */
function aliasDocFor(
  paidDoc: CalendarItem,
  calendarItems: readonly CalendarItem[],
): CalendarItem {
  const templateId = paidDoc.parentRecurringId;
  if (!templateId) return paidDoc;
  return calendarItems.find(i => i.id === templateId) ?? paidDoc;
}

/** Does the bank's raw descriptor say anything about this bill? */
function evidenceFor(
  candidate: Transaction,
  bill: CalendarItem,
  calendarItems: readonly CalendarItem[],
): SettledBillEvidence {
  // The RAW stored merchant, never a merchant-rule display name — a
  // user-editable label must not decide identity (see transactionIdentity.ts).
  const descriptor = candidate.merchant;
  // Aliases live on the alias TARGET (the template for a recurring occurrence),
  // which is where every alias writer puts them.
  const aliases = aliasDocFor(bill, calendarItems).bankDescriptorAliases;
  if (matchesAlias(descriptor, aliases)) return 'descriptor';
  if (shareSignificantToken(descriptor, bill.title)) return 'descriptor';
  return 'amount-only';
}

/**
 * Could `tx` be the BANK half of such a pair at all? Row-level tests only —
 * nothing here compares two rows.
 */
function isBankHalf(tx: Transaction): boolean {
  return isBankSyncTransaction(tx) && needsReview(tx) && !tx.paidCalendarItemId;
}

/**
 * Could `tx` be the SETTLED half? It must carry a bill reference and must NOT
 * already carry a `bankRef`: `buildMergeUpdates` inherits the dupe's `bankRef`
 * onto the keeper, so a settled row that already absorbed one bank copy is
 * self-marking, and refusing it is what stops a SECOND bank row merging into
 * the same payment (a real charge deleted). The sequential half of the
 * two-rows-one-bill hazard; the symmetric scan below covers the concurrent half.
 */
function isSettledHalf(tx: Transaction): boolean {
  return !!tx.paidCalendarItemId && !tx.bankRef;
}

/**
 * The pair-level tests, applied identically in BOTH directions. Kept in one
 * function precisely so the "is there a rival candidate for this counterpart?"
 * scan can't drift from the "is there a rival counterpart for this candidate?"
 * loop — a one-sided guard is how two bank rows both got offered the same
 * settled bill.
 */
function pairQualifies(bankHalf: Transaction, settledHalf: Transaction): boolean {
  if (bankHalf.id === settledHalf.id) return false;
  // "Keep both", scoped to the counterpart it was asked about.
  if (bankHalf.duplicateDismissedFor === settledHalf.id) return false;
  if ((settledHalf.category === INCOME_CATEGORY) !== (bankHalf.category === INCOME_CATEGORY)) return false;
  if (!sameAmountToTheCent(settledHalf.amount, bankHalf.amount)) return false;
  // BOTH accounts must be present and equal. Treating an unknown account as
  // "not a conflict" was unsafe in exactly the shape that occurs in practice:
  // `settleBillWithTransaction` writes `accountId` only when one was requested,
  // so an untagged settled row is a normal product of the calendar-side link
  // picker — and `buildMergeUpdates` would then re-tag that keeper to the bank's
  // account while the merge reverses only the DUPE's delta, leaving the original
  // account debited for a charge that moved elsewhere. The sync always tags its
  // own rows, so requiring both costs almost nothing.
  if (!bankHalf.accountId || !settledHalf.accountId) return false;
  if (bankHalf.accountId !== settledHalf.accountId) return false;

  const bankDay = parseISO(bankHalf.date);
  const settledDay = parseISO(settledHalf.date);
  if (Number.isNaN(bankDay.getTime()) || Number.isNaN(settledDay.getTime())) return false;
  return Math.abs(differenceInCalendarDays(bankDay, settledDay)) <= SETTLED_BILL_DUPLICATE_WINDOW_DAYS;
}

/**
 * The settled bill-payment row that `candidate` (a freshly-synced bank row)
 * appears to be a second copy of, with the evidence that supports it — or
 * `undefined` when there is no such row.
 *
 * EVERY one of these must hold:
 *  - `candidate` is a bank-sync row that is still awaiting review, and is not
 *    itself already linked to a bill;
 *  - the counterpart carries a `paidCalendarItemId` that still resolves to a
 *    paid, non-deleted calendar item (via the shared `findSettledBill`), and
 *    carries no `bankRef` of its own;
 *  - the amounts are equal TO THE CENT, signed — no tolerance, and deliberately
 *    not `billAmountWithinTolerance`: a ±10%/±$25 band on a pair that would be
 *    merged (deleting one row) is far too loose;
 *  - both rows name the SAME account;
 *  - the dates are within {@link SETTLED_BILL_DUPLICATE_WINDOW_DAYS};
 *  - income never matches expense (same rule `isLikelyDuplicate` applies);
 *  - the candidate hasn't been dismissed against this counterpart via
 *    "Keep both" (`Transaction.duplicateDismissedFor`).
 *
 * AMBIGUITY RETURNS NOTHING, IN BOTH DIRECTIONS. Two qualifying counterparts
 * for one bank row (a household that really does pay the same amount to two
 * settled bills in one week) yields `undefined` rather than a guess — and so
 * does two qualifying bank rows for ONE counterpart (pay a bill by hand while
 * autopay also fires, and the bank draws twice; merging either row away deletes
 * a real charge). This is the repo's established stance everywhere a merge
 * could pick wrong (`reconcile.ts`'s stub fill, `pickBillToPay`): a missed
 * merge is a nuisance, a wrong merge deletes a real record.
 */
export function findSettledBillDuplicate(
  candidate: Transaction,
  transactions: readonly Transaction[],
  calendarItems: readonly CalendarItem[],
): SettledBillDuplicateMatch | undefined {
  if (!isBankHalf(candidate)) return undefined;

  let match: SettledBillDuplicateMatch | undefined;
  for (const other of transactions) {
    // Cheap field checks first; the calendar resolution (an O(calendarItems)
    // scan) is left for last so it runs only for a row that already matches.
    if (!isSettledHalf(other)) continue;
    if (!pairQualifies(candidate, other)) continue;

    const bill = findSettledBill(other, calendarItems);
    if (!bill) continue;

    // Under-merge rather than mis-merge: a second qualifying counterpart makes
    // the pairing ambiguous, so stop and report nothing.
    if (match) return undefined;
    match = { counterpart: other, bill, evidence: evidenceFor(candidate, bill, calendarItems) };
  }

  // Bound to a const so the closure below narrows (and so the scan can never
  // read a later reassignment of the loop's accumulator).
  const resolved = match;
  if (!resolved) return undefined;

  // …and the mirror image: some OTHER un-reviewed bank row would qualify against
  // this very counterpart just as well. Whichever of the two we offered, merging
  // it would delete a charge the bank really made.
  const rivalCandidate = transactions.some(
    other => other.id !== candidate.id && isBankHalf(other) && pairQualifies(other, resolved.counterpart),
  );
  if (rivalCandidate) return undefined;

  return resolved;
}

/**
 * The calendar doc a learned bank descriptor belongs on for a settled row: the
 * recurring TEMPLATE when the settled doc is a paid instance and that template
 * still exists, else the paid doc itself (a one-off bill is its own alias
 * target). `undefined` when the paid doc itself is gone — the caller must then
 * merge WITHOUT learning anything rather than writing to a missing document.
 *
 * A paid instance is a ONE-SHOT document — an alias written there teaches
 * nothing about next month's occurrence, which is the entire point of learning
 * it. Mirrors every existing alias writer (`calendarMutations.ts`'s
 * `linkBankTransactionToBill` / `settleBillWithTransaction`, and
 * `functions/src/quickAdd/bankEmailSync.ts`).
 *
 * NEVER return the stamped id un-resolved. `mergeBatch.update()` on a document
 * that does not exist rejects the entire batch (`not-found`), taking the keeper
 * patch and the dupe delete with it — and `makeDeleteCalendarItem` hard-deletes
 * templates, so a dangling `parentRecurringId` is reachable through the app's
 * own UI. That made every future tap of Merge fail with a generic toast.
 */
export function aliasTargetForSettledRow(
  settledRow: Pick<Transaction, 'paidCalendarItemId'>,
  calendarItems: readonly CalendarItem[],
): string | undefined {
  const paidId = settledRow.paidCalendarItemId;
  if (!paidId) return undefined;
  const paidDoc = calendarItems.find(i => i.id === paidId);
  if (!paidDoc) return undefined;
  return aliasDocFor(paidDoc, calendarItems).id;
}
