import { BudgetBucket } from '@/types/schema';

/**
 * Sentinel pseudo-category for expenses that are already accounted for as
 * calendar bills (so they don't double-count against a budget bucket).
 * Import this instead of repeating the literal string.
 */
export const BUDGETED_IN_CALENDAR = 'Budgeted in Calendar';

/**
 * Legacy category once assigned by `payCalendarItem` to a paid calendar bill
 * that wasn't matched to a bucket. New paid bills use `BUDGETED_IN_CALENDAR`
 * instead, but historical transactions still carry this value — recognized here
 * so they, too, are treated as calendar-budgeted rather than "unbudgeted".
 */
export const LEGACY_BILLS_CATEGORY = 'Bills';

/**
 * True when a transaction's category marks it as already accounted for by the
 * calendar (either the explicit "Budgeted in Calendar" sentinel a user can pick,
 * or the legacy "Bills" tag from paid calendar bills). Such spend is intentionally
 * not discretionary, so it must be excluded from the "Unbudgeted & Other" bucket.
 *
 * Note: this is a fallback classifier only. A transaction whose category exactly
 * matches a real bucket name (e.g. a household that literally named a bucket
 * "Bills") is matched to that bucket first and never reaches this check.
 */
const CALENDAR_BUDGETED_SET = new Set([
  BUDGETED_IN_CALENDAR.toLowerCase(),
  LEGACY_BILLS_CATEGORY.toLowerCase(),
]);

export function isCalendarBudgetedCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return CALENDAR_BUDGETED_SET.has(category.toLowerCase());
}

/**
 * Canonical option list for every transaction category picker: each bucket
 * name (in stored order, or alphabetized with `sort`) followed by the
 * "Budgeted in Calendar" sentinel, which always sorts last.
 */
export function buildTransactionCategoryOptions(
  buckets: ReadonlyArray<Pick<BudgetBucket, 'name'>>,
  opts: { sort?: boolean } = {}
): string[] {
  // Dedupe bucket names so callers rendering React lists keyed on the name
  // string don't hit duplicate keys when two buckets share a name.
  const names = [...new Set(buckets.map(b => b.name))];
  if (opts.sort) names.sort((a, b) => a.localeCompare(b));
  return [...names, BUDGETED_IN_CALENDAR];
}
