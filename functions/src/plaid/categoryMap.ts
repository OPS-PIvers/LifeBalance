/**
 * Maps a Plaid Personal Finance Category (PFC) to one of the household's own
 * budget-bucket names, clamping to the real list exactly like the client's
 * `clampToAllowed` (services/geminiService.ts): the chosen value is always
 * either an existing bucket name or the sentinel `'Uncategorized'` — never an
 * arbitrary bucket. We deliberately do NOT coerce unknowns to `bucketNames[0]`
 * (mislabeling a charge is worse than a clear "Uncategorized").
 *
 * Pure + dependency-free so it unit-tests trivially. Lives in the functions
 * package because the client clamp can't be imported across the workspace.
 */

export const UNCATEGORIZED = 'Uncategorized';

/**
 * Plaid PFC `primary` → a human-friendly candidate label. The candidate is then
 * clamped to the household's actual bucket names; if none match, the sentinel is
 * used. Labels are chosen to match the kinds of bucket names users typically
 * create (Dining, Groceries, Gas, Shopping, Utilities, Transport, …).
 */
const PFC_PRIMARY_TO_LABEL: Record<string, string> = {
  INCOME: 'Income',
  TRANSFER_IN: 'Income',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Loans',
  BANK_FEES: 'Fees',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Dining',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home',
  MEDICAL: 'Medical',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Government',
  TRANSPORTATION: 'Transport',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Utilities',
};

/**
 * Resolve the candidate label for a Plaid PFC primary string (case-insensitive),
 * falling back to the sentinel when the primary is unknown/absent. Exposed for
 * testing; most callers want {@link mapPfcToBucket}.
 */
export function pfcPrimaryToLabel(primary: string | undefined | null): string {
  if (!primary) return UNCATEGORIZED;
  return PFC_PRIMARY_TO_LABEL[primary.trim().toUpperCase()] ?? UNCATEGORIZED;
}

/**
 * Map a Plaid PFC primary to one of `bucketNames` (case-insensitive equality),
 * or `'Uncategorized'` if there's no match. The candidate label itself is also
 * accepted if it happens to be a real bucket name.
 */
export function mapPfcToBucket(
  pfcPrimary: string | undefined | null,
  bucketNames: readonly string[],
): string {
  const candidate = pfcPrimaryToLabel(pfcPrimary);
  if (candidate === UNCATEGORIZED) return UNCATEGORIZED;
  const needle = candidate.toLowerCase();
  const match = bucketNames.find((b) => b.toLowerCase() === needle);
  return match ?? UNCATEGORIZED;
}
