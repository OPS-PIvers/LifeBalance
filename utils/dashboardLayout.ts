/**
 * Dashboard widget customization (F-XCUT-02). Pure ordering/filtering logic
 * for the member-scoped `dashboardLayout` / `dashboardHidden` fields on
 * `HouseholdMember` — kept free of React/Firestore so it's cheaply unit
 * tested and reusable from both Dashboard.tsx and the Settings editor.
 *
 * Only the "optional" widgets a member might reasonably want to reorder or
 * hide are covered here. Structural Dashboard elements — the Action Queue
 * (which intentionally jumps to the top of the stack when non-empty), the
 * pending-voice-command banner, and the modals/sheets — are not
 * customizable and always render in their fixed positions.
 */

export interface DashboardWidgetDef {
  id: string;
  label: string;
  /** Short description shown under the label in the customization list. */
  description: string;
}

// Order here is the default order AND the fallback order for any id missing
// from a member's `dashboardLayout`.
export const DASHBOARD_WIDGETS: readonly DashboardWidgetDef[] = [
  { id: 'pulseStrip', label: 'This Week Pulse', description: 'Money + habits balance at a glance' },
  { id: 'partnerActivity', label: 'Since You Were Here', description: 'What housemates added since your last visit' },
  { id: 'dailyHabits', label: "Today's Habits", description: 'Smart-ranked habit tracker' },
  { id: 'creditCardActivity', label: 'Credit Card Activity', description: 'Charges vs. paydowns this period' },
  { id: 'weeklyRecap', label: 'Weekly Recap', description: 'Sunday summary card' },
  { id: 'moneyRecap', label: 'Monthly Money Recap', description: 'Budget-vs-actual close-out' },
  { id: 'kidsChores', label: "Kids' Chores", description: 'Managed-profile chore overview' },
  { id: 'insight', label: 'AI Insight', description: 'One rotating insight card' },
  { id: 'activityFeed', label: 'Recent Activity', description: 'Compact activity log' },
  { id: 'habitCoach', label: 'Habit Coach', description: 'AI coaching on your habit patterns' },
] as const;

export const DASHBOARD_WIDGET_IDS: readonly string[] = DASHBOARD_WIDGETS.map(w => w.id);

export const DEFAULT_DASHBOARD_WIDGET_ORDER: readonly string[] = DASHBOARD_WIDGET_IDS;

/**
 * Widgets hidden by default for members who have never customized visibility
 * (dashboardHidden === undefined). The lean default keeps the Home screen to
 * a triage core — Action Queue (structural), pulse, today's habits, recap —
 * per the 2026-07 critique's information-overload P1; everything here remains
 * one Settings toggle away. A member's explicit list (even []) always wins.
 */
export const DEFAULT_HIDDEN_DASHBOARD_WIDGETS: readonly string[] = [
  'creditCardActivity',
  'kidsChores',
  'insight',
  'activityFeed',
  'habitCoach',
];

/** A member's effective hidden list: their own when set, else the lean default. */
export function resolveHiddenWidgets(hidden: readonly string[] | undefined): readonly string[] {
  return hidden ?? DEFAULT_HIDDEN_DASHBOARD_WIDGETS;
}

/**
 * Resolve a member's customized order into the full, valid widget-id list:
 * known ids from `layout` first (in the member's chosen order), then any
 * remaining known widgets in default order (covers ids added to the app
 * after the member last customized). Unknown/stale ids are dropped.
 */
export function resolveDashboardOrder(layout: readonly string[] | undefined): string[] {
  const known = new Set(DASHBOARD_WIDGET_IDS);
  const ordered = (layout ?? []).filter((id): id is string => known.has(id));
  const seen = new Set(ordered);
  const rest = DASHBOARD_WIDGET_IDS.filter(id => !seen.has(id));
  return [...ordered, ...rest];
}

/** Ordered, visible widget ids for a member: resolved order minus hidden ids. */
export function getVisibleOrderedWidgetIds(
  layout: readonly string[] | undefined,
  hidden: readonly string[] | undefined
): string[] {
  const hiddenSet = new Set(resolveHiddenWidgets(hidden));
  return resolveDashboardOrder(layout).filter(id => !hiddenSet.has(id));
}

/** Move a widget id one position earlier/later within a full order array. */
export function moveWidget(order: readonly string[], id: string, direction: 'up' | 'down'): string[] {
  const idx = order.indexOf(id);
  if (idx === -1) return [...order];
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= order.length) return [...order];
  const next = [...order];
  const a = next[idx];
  const b = next[swapWith];
  if (a === undefined || b === undefined) return next;
  next[idx] = b;
  next[swapWith] = a;
  return next;
}

/** Toggle a widget id's membership in the hidden list. */
export function toggleWidgetHidden(hidden: readonly string[] | undefined, id: string): string[] {
  const set = new Set(hidden ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}
