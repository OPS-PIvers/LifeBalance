/**
 * Engagement gate for the PWA install banner (F-PLAT-01): don't show it on
 * the very first visit. Fires after either the first habit completion
 * (`FIRST_HABIT_FLAG` from `utils/firstTimeFlags.ts`) or the third session,
 * whichever comes first. Pure/localStorage-only so it can be unit tested
 * without mounting React.
 */

import { FIRST_HABIT_FLAG } from '@/utils/firstTimeFlags';

const SESSION_COUNT_KEY = 'lb_session_count';
const SESSION_COUNTED_THIS_LOAD_KEY = 'lb_session_counted_this_load'; // sessionStorage: once per tab lifetime
const MIN_SESSIONS_FOR_INSTALL_PROMPT = 3;

/**
 * Increments the persistent (localStorage) session counter at most once per
 * browser tab lifetime (guarded via sessionStorage, cleared on tab close),
 * then returns the up-to-date count. Call once near app boot.
 */
export function recordSessionAndGetCount(): number {
  try {
    if (window.sessionStorage.getItem(SESSION_COUNTED_THIS_LOAD_KEY) !== '1') {
      const current = Number(window.localStorage.getItem(SESSION_COUNT_KEY) ?? '0');
      const next = Number.isFinite(current) ? current + 1 : 1;
      window.localStorage.setItem(SESSION_COUNT_KEY, String(next));
      window.sessionStorage.setItem(SESSION_COUNTED_THIS_LOAD_KEY, '1');
      return next;
    }
    const current = Number(window.localStorage.getItem(SESSION_COUNT_KEY) ?? '0');
    return Number.isFinite(current) ? current : 0;
  } catch {
    return 0;
  }
}

/** Whether engagement is deep enough to show the install banner. */
export function hasMetInstallEngagementGate(sessionCount: number): boolean {
  if (sessionCount >= MIN_SESSIONS_FOR_INSTALL_PROMPT) return true;
  try {
    return window.localStorage.getItem(FIRST_HABIT_FLAG) !== null;
  } catch {
    return false;
  }
}
