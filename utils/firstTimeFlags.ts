/**
 * First-time activation events (`first_transaction_added`,
 * `first_habit_completed`) are derived client-side — no server state. A first
 * event fires at most once per device: only when the relevant in-memory list
 * was empty before the write AND the localStorage flag is not yet set.
 * Approximate by design (a partner's device or a cleared storage undercounts);
 * this is analytics, not accounting.
 */

export const FIRST_TRANSACTION_FLAG = 'lb_first_txn_tracked';
export const FIRST_HABIT_FLAG = 'lb_first_habit_tracked';

/**
 * Returns true exactly once per device for a given flag, and only when the
 * caller observed an empty list before its write. Sets the flag as a side
 * effect. Storage failures (private browsing, quota) return false so the
 * event can never fire repeatedly.
 */
export function shouldTrackFirstTime(flagKey: string, wasEmptyBefore: boolean): boolean {
  if (!wasEmptyBefore) return false;
  try {
    if (window.localStorage.getItem(flagKey) !== null) return false;
    window.localStorage.setItem(flagKey, '1');
    return true;
  } catch {
    return false;
  }
}
