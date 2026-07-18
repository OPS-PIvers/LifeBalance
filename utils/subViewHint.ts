// One-time latch for the sub-view tab coach hint (SubViewHint). The first
// time a user lands on a page whose tab bar has multi-view tabs (Money,
// Habits) we show a small "tabs with a caret hold more views" hint; ANY
// dismissal — opening a tab menu, the explicit ×, or navigating away — sets
// this latch so the hint never reappears, on either page.
export const SUB_VIEW_HINT_KEY = 'lifebalance-subview-hint-seen';

/**
 * True once the hint has been dismissed (in any way) on this device.
 * Fails CLOSED (treated as seen) when storage is unavailable — a hint that
 * can't be remembered would otherwise nag on every visit.
 */
export const hasSeenSubViewHint = (): boolean => {
  try {
    return localStorage.getItem(SUB_VIEW_HINT_KEY) === 'true';
  } catch {
    return true;
  }
};

/** Idempotently set the one-time latch. Safe to call repeatedly. */
export const markSubViewHintSeen = (): void => {
  try {
    localStorage.setItem(SUB_VIEW_HINT_KEY, 'true');
  } catch {
    // Storage unavailable — the hint may show again next session; harmless.
  }
};
