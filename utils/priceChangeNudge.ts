/**
 * Pure helper for the "Pay Bill" price-change nudge (F-MONEY-01): when a
 * variable bill (utilities, variable-rate cards) is paid for more or less
 * than its budgeted/last-paid amount, surface a small toast — e.g.
 * "Up $18 from last time" — instead of silently accepting the drift.
 *
 * Kept separate from `contexts/household/mutations/calendarMutations.ts` so
 * the comparison/formatting logic is unit-testable without Firestore.
 */
import { roundMoney } from '@/utils/money';
import { formatCurrency, DEFAULT_CURRENCY } from '@/utils/formatCurrency';

/** Only nudge when the change is both non-trivial in dollars AND exceeds
 *  this fraction of the reference amount — a $0.50 wobble on a $2 bill is
 *  100% but not worth a toast. */
const RELATIVE_THRESHOLD = 0.1;
/** Guards against a nudge firing on a near-zero reference amount, where even
 *  a one-cent difference is a huge relative swing. */
const MIN_REFERENCE_AMOUNT = 1;

export interface PriceChangeNudge {
  /** Positive = paid more than the reference amount. */
  delta: number;
  message: string;
}

/**
 * Compare the amount actually paid against a reference amount (the
 * recurring item's budgeted `amount`, or the most recent paid instance for a
 * recurring bill) and return a nudge when the difference is material.
 *
 * Returns `null` when there's nothing worth surfacing (no reference, no
 * change, or the change is within the noise threshold).
 */
export function computePriceChangeNudge(
  paidAmount: number,
  referenceAmount: number | undefined,
  currency: string = DEFAULT_CURRENCY
): PriceChangeNudge | null {
  if (referenceAmount === undefined || !Number.isFinite(referenceAmount) || referenceAmount <= 0) {
    return null;
  }
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) return null;

  const delta = roundMoney(paidAmount - referenceAmount);
  if (delta === 0) return null;

  const relativeChange = Math.abs(delta) / Math.max(referenceAmount, MIN_REFERENCE_AMOUNT);
  if (relativeChange <= RELATIVE_THRESHOLD) return null;

  const formattedDelta = formatCurrency(Math.abs(delta), { currency });
  const direction = delta > 0 ? 'Up' : 'Down';
  return {
    delta,
    message: `${direction} ${formattedDelta} from last time`,
  };
}
