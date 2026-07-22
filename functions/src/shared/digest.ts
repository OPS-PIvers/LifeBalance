/**
 * F-NOTIF-03 (digest mode) — pure aggregation + message-building helpers shared
 * by the `senddigest` scheduled job (functions/src/index.ts). Kept separate
 * from index.ts (and unit-tested standalone) so the counting logic can be
 * exercised without Firestore/admin SDK mocking.
 *
 * These deliberately mirror — but do not replace — the per-type "is there
 * anything to send" checks already inline in sendhabitreminders /
 * sendactionqueuereminders / sendstreakwarnings / sendbillreminders: the four
 * hourly jobs skip a member entirely when `digestMode.enabled` is true (see
 * index.ts), and this module is what `senddigest` uses instead to build one
 * consolidated push out of whichever categories that member still has
 * individually enabled.
 */

/** Minimal shape of a habit doc needed for digest counting. */
export interface DigestHabit {
  period?: string;
  streakDays?: number;
  completedDates?: string[];
}

/** Minimal shape of a todo doc needed for digest counting. */
export interface DigestTodo {
  assignedTo?: string;
  isCompleted?: boolean;
  completeByDate?: string;
  // Held-for-review capture (captureReview) — must not count toward the
  // digest's "N to-dos today" line until approved. See types/schema.ts's
  // `ToDo.needsReview`.
  needsReview?: boolean;
}

/**
 * Count of daily habits not yet completed today — the same "still to do"
 * notion sendhabitreminders' generic nudge implies, made concrete for the
 * digest line.
 */
export function computeHabitsPending(habits: DigestHabit[], today: string): number {
  return habits.filter(
    (h) => h.period === "daily" && !(h.completedDates ?? []).includes(today)
  ).length;
}

/**
 * Count of daily habits with a 3+ day streak not yet completed today —
 * mirrors the `habitsAtRisk` filter in sendstreakwarnings.
 */
export function computeStreaksAtRisk(habits: DigestHabit[], today: string): number {
  return habits.filter(
    (h) =>
      h.period === "daily" &&
      (h.streakDays ?? 0) >= 3 &&
      !(h.completedDates ?? []).includes(today)
  ).length;
}

/**
 * Count of a specific member's incomplete todos due today — mirrors the
 * `todayTodos` filter in sendactionqueuereminders. Held-for-review captures
 * (`needsReview === true`) are excluded — they haven't been approved into the
 * real to-do list yet, so they must not trigger a reminder.
 */
export function computeTodosToday(todos: DigestTodo[], uid: string, today: string): number {
  return todos.filter(
    (t) =>
      t.assignedTo === uid &&
      !t.isCompleted &&
      t.completeByDate === today &&
      t.needsReview !== true
  ).length;
}

/** Which digest lines a given member has opted into (their per-type toggles). */
export interface DigestEnabledCategories {
  habits: boolean;
  todos: boolean;
  streaks: boolean;
  bills: boolean;
}

export interface DigestCounts {
  habitsPending: number;
  todosToday: number;
  streaksAtRisk: number;
  billsDueCount: number;
  /** Pre-formatted currency string (e.g. "$120.00"), only read when billsDueCount > 0. */
  billsDueTotalFormatted: string;
}

/**
 * Builds the digest push title/body from pre-computed counts, respecting
 * which categories the member has enabled (a count for a disabled category
 * must never leak into the digest). Returns null when there is nothing to
 * report — matches every other scheduled job's "skip the send" behavior
 * rather than pushing an empty digest.
 */
export function buildDigestMessage(
  counts: DigestCounts,
  enabled: DigestEnabledCategories
): { title: string; body: string } | null {
  const parts: string[] = [];

  if (enabled.bills && counts.billsDueCount > 0) {
    parts.push(
      `${counts.billsDueCount} bill${counts.billsDueCount > 1 ? "s" : ""} due (${counts.billsDueTotalFormatted})`
    );
  }
  if (enabled.habits && counts.habitsPending > 0) {
    parts.push(`${counts.habitsPending} habit${counts.habitsPending > 1 ? "s" : ""} pending`);
  }
  if (enabled.streaks && counts.streaksAtRisk > 0) {
    parts.push(`${counts.streaksAtRisk} streak${counts.streaksAtRisk > 1 ? "s" : ""} at risk`);
  }
  if (enabled.todos && counts.todosToday > 0) {
    parts.push(`${counts.todosToday} to-do${counts.todosToday > 1 ? "s" : ""} today`);
  }

  if (parts.length === 0) return null;

  return {
    title: "Your daily digest",
    body: parts.join(", "),
  };
}
