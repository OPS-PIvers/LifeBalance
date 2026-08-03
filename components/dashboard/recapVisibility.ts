import type { WeeklyRecap, MonthlyMoneyRecap } from '@/types/schema';

/**
 * Shared card-visibility logic for the two recap cards (WeeklyRecapCard /
 * MoneyRecapCard) and the RecapSlot that arbitrates between them. A recap
 * card should render when its latest recap is fresh (within the window, with
 * a sane timestamp) and not dismissed (localStorage, keyed per period).
 * Module-level (not inline in the components) so the impure reads — clock +
 * localStorage — stay out of render bodies, and so RecapSlot can ask "would
 * this card show?" without rendering it.
 */

/** How long after generation the weekly recap card stays on the Dashboard. */
export const WEEKLY_RECAP_FRESHNESS_MS = 4 * 24 * 60 * 60 * 1000;
/** How long after generation the monthly money recap card stays on the Dashboard. */
export const MONEY_RECAP_FRESHNESS_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * ARCH-1 — how many CLOSED weeks the "Past weeks" archive offers, unlike the
 * ephemeral card above this stays reachable forever (no freshness window),
 * just bounded in HOW FAR BACK it browses. 12 weeks (~3 months) is chosen to
 * mostly stay inside the live 90-day transaction window
 * (`TRANSACTION_WINDOW_DAYS`), so browsing the archive rarely needs the
 * on-demand `loadAllTransactions()` fallback for money figures.
 */
export const RECAP_ARCHIVE_WEEKS = 12;

export const weeklyRecapDismissKey = (isoWeek: string) => `lb_recap_dismissed_${isoWeek}`;
export const moneyRecapDismissKey = (month: string) => `lb_money_recap_dismissed_${month}`;

/**
 * ARCH-1 — separate from `weeklyRecapDismissKey`: that key tracks whether the
 * DASHBOARD CARD has been dismissed (a display-only decision, replayed every
 * time a fresh recap generates); this one tracks whether the just-closed
 * week's recap has ever been AUTO-OPENED as a popup, forever, independent of
 * whether the card itself is later shown/hidden/dismissed. Same
 * localStorage-per-ISO-week convention, different concern.
 */
export const weeklyRecapAutoOpenedKey = (isoWeek: string) => `lb_recap_autoopened_${isoWeek}`;

/** Has the just-closed week's recap already been auto-opened once? */
export function wasRecapAutoOpened(isoWeek: string): boolean {
  try {
    return window.localStorage.getItem(weeklyRecapAutoOpenedKey(isoWeek)) === '1';
  } catch {
    // Best-effort: treat an unreadable store as "not yet opened" — the worst
    // case is a repeat popup, not a missed one.
    return false;
  }
}

/** Marks the just-closed week's recap as auto-opened, so it never fires again. */
export function markRecapAutoOpened(isoWeek: string): void {
  try {
    window.localStorage.setItem(weeklyRecapAutoOpenedKey(isoWeek), '1');
  } catch {
    // Best-effort — the in-session state (the caller's own guard) still
    // prevents a second popup for the rest of this session.
  }
}

function isFreshAndUndismissed(generatedAt: string, windowMs: number, dismissKey: string): boolean {
  const ageMs = Date.now() - new Date(generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > windowMs) return false;
  try {
    return window.localStorage.getItem(dismissKey) !== '1';
  } catch {
    return true;
  }
}

export function weeklyRecapCardVisible(recap: WeeklyRecap | undefined): boolean {
  return (
    recap !== undefined &&
    isFreshAndUndismissed(recap.generatedAt, WEEKLY_RECAP_FRESHNESS_MS, weeklyRecapDismissKey(recap.isoWeek))
  );
}

export function moneyRecapCardVisible(recap: MonthlyMoneyRecap | undefined): boolean {
  return (
    recap !== undefined &&
    isFreshAndUndismissed(recap.generatedAt, MONEY_RECAP_FRESHNESS_MS, moneyRecapDismissKey(recap.month))
  );
}
