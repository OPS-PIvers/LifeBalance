/**
 * "Was this a no-spend day?" — the pure classifier behind the no-spend habit
 * triggers (see `HabitTriggers.noSpend` in types/schema.ts).
 *
 * A no-spend day is a day with no UNPLANNED spending, which is deliberately not
 * the same as "the nightly bank email had no withdrawals":
 *
 *  - A day whose only withdrawal was a scheduled bill or a transfer to savings
 *    IS a no-spend day. The habit measures the spending you chose to do; autopay
 *    you set up months ago isn't a decision you made that day, and moving your
 *    own money between your own accounts isn't spending at all. Without this,
 *    the ~8-10 nights a month that carry a recurring charge would all be
 *    disqualified.
 *  - A day you spent on a credit card is NOT a no-spend day, even though
 *    nothing left checking. Otherwise the habit is trivially satisfied by
 *    reaching for a different card.
 *
 * So the question is asked of TRANSACTIONS DATED TO THE DAY, across every
 * account, rather than of the email's emptiness. That also fixes an attribution
 * bug the email-emptiness test has no answer for: Wells Fargo reports card
 * AUTHORIZATION dates, and a charge authorized on Thursday can appear in
 * Saturday's email — so an empty Friday email does not mean Thursday was clean.
 * The parser already resolves each withdrawal to its real date, and this reads
 * those dates.
 *
 * KNOWN LIMITS, by design:
 *  - Spending on an account LifeBalance can't see (a card that is neither
 *    Plaid-linked nor captured by the iOS Shortcut) is invisible here and will
 *    produce a false no-spend day.
 *  - A recurring charge that is not linked to a calendar bill reads as
 *    unplanned, so it breaks the day until you link it. That is a nudge to
 *    finish the calendar, not a bug.
 *  - A late-arriving charge (a Plaid sync, or a withdrawal that posts two days
 *    later) can land after the day was already credited. The credit is not
 *    revoked; the day stands.
 *
 * Pure: no date-fns beyond ISO-week/day arithmetic, no Firestore, no admin SDK.
 */

import { format, parseISO, subDays, getISODay } from "date-fns";

/**
 * Category constants, mirroring types/schema.ts and utils/categories.ts.
 *
 * NOTE: these strings are already duplicated in several places under
 * functions/src (moneyRecap/dataAssembly.ts, plaid/mapping.ts,
 * quickAdd/transactionIdentity.ts, quickAdd/index.ts). Consolidating all of them
 * is out of scope here; `bankEmailSync.ts` imports `BUDGETED_IN_CALENDAR` from
 * this module specifically so the two files that MUST agree about what a bill
 * looks like cannot drift apart.
 */
export const INCOME_CATEGORY = "Income";
export const CREDIT_CARD_CATEGORY = "Credit Card";
export const BUDGETED_IN_CALENDAR = "Budgeted in Calendar";

/**
 * A transfer between the user's own accounts. Wells Fargo writes these as
 * "ONLINE TRANSFER TO IVERS,PAUL SAVINGS REF #IB0…", and a hand-entered one is
 * usually "Transfer to savings", so the bare word carries the signal.
 *
 * Word-bounded rather than a substring so it can't fire on an unrelated
 * merchant, though it will still exempt a merchant that genuinely has "transfer"
 * in its name (e.g. a money-transfer service). That direction of error is the
 * safer one: it can only make a day count as no-spend that arguably shouldn't,
 * never break a day that should count.
 */
const TRANSFER_DESCRIPTOR_RE = /\btransfer\b/i;

/** The transaction fields the classifier reads. */
export interface SpendCandidate {
  amount: number;
  merchant: string;
  category: string;
  creditPayment?: boolean;
  needsAmount?: boolean;
}

/** Why a transaction does not count against a no-spend day. */
export type SpendExemption = "income" | "bill" | "card-payment" | "transfer" | "zero-amount";

/**
 * Why `tx` doesn't count as unplanned spend, or `null` when it does.
 *
 * Returns the REASON rather than a boolean so the sync can log why a day failed
 * to qualify — "yesterday wasn't a no-spend day" is otherwise an unexplainable
 * verdict from the user's point of view.
 */
export function spendExemption(tx: SpendCandidate): SpendExemption | null {
  if (tx.category === INCOME_CATEGORY) return "income";
  // A bill the nightly sync matched to a calendar item is filed under this
  // category (see bankEmailSync's pay_bill branch), which is what makes
  // "scheduled spending doesn't break the day" implementable at 3am: a
  // brand-new unmatched row is still `Uncategorized` at that point, so
  // exempting by category only ever exempts something already recognized as
  // planned.
  if (tx.category === BUDGETED_IN_CALENDAR) return "bill";
  if (tx.creditPayment === true || tx.category === CREDIT_CARD_CATEGORY) return "card-payment";
  if (TRANSFER_DESCRIPTOR_RE.test(tx.merchant)) return "transfer";
  // An Apple Pay pre-authorization stub is a real purchase whose amount isn't
  // known yet, so it counts despite its placeholder 0. Everything else with no
  // positive amount is not spending. `!(amount > 0)` also rejects NaN.
  if (tx.needsAmount !== true && !(tx.amount > 0)) return "zero-amount";
  return null;
}

/** The subset of `transactions` that counts as unplanned spend. */
export function unplannedSpend<T extends SpendCandidate>(transactions: T[]): T[] {
  return transactions.filter((tx) => spendExemption(tx) === null);
}

/**
 * True when none of `transactions` counts as unplanned spend.
 *
 * The caller is responsible for passing EVERY transaction dated to the day in
 * question — an empty array means "nothing was spent", so passing an
 * incompletely-loaded set silently manufactures a no-spend day.
 */
export function wasNoSpendDay(transactions: SpendCandidate[]): boolean {
  return unplannedSpend(transactions).length === 0;
}

// ---------------------------------------------------------------------------
// Weekend rule
// ---------------------------------------------------------------------------

/** ISO day-of-week: 1 = Monday … 6 = Saturday, 7 = Sunday. */
export const ISO_SATURDAY = 6;
export const ISO_SUNDAY = 7;

/** ISO day-of-week (1=Mon … 7=Sun) for a yyyy-MM-dd date. */
export function isoDayOfWeek(date: string): number {
  return getISODay(parseISO(date));
}

/**
 * The other half of the weekend that ends on `date`, or `null` when `date` isn't
 * a Sunday.
 *
 * A "no-spend weekend" is Saturday AND Sunday both clean, so it can only be
 * decided once Sunday is over — i.e. from Monday's nightly email, credited to
 * Sunday. Crediting Sunday also puts the completion in the correct ISO week
 * (Mon-Sun) for a weekly habit's streak and multiplier, which crediting Monday
 * would not.
 */
export function weekendPartnerDate(date: string): string | null {
  if (isoDayOfWeek(date) !== ISO_SUNDAY) return null;
  return format(subDays(parseISO(date), 1), "yyyy-MM-dd");
}
