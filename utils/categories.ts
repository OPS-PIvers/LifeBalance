import { BudgetBucket } from '@/types/schema';

/**
 * Sentinel pseudo-category for expenses that are already accounted for as
 * calendar bills (so they don't double-count against a budget bucket).
 * Import this instead of repeating the literal string.
 */
export const BUDGETED_IN_CALENDAR = 'Budgeted in Calendar';

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
