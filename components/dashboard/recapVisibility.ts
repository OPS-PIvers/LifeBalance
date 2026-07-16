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

export const weeklyRecapDismissKey = (isoWeek: string) => `lb_recap_dismissed_${isoWeek}`;
export const moneyRecapDismissKey = (month: string) => `lb_money_recap_dismissed_${month}`;

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
