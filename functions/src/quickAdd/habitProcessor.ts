/**
 * Server-side habit processing logic
 * Ported from utils/habitLogic.ts for use in Cloud Functions
 */

import {
  format,
  parseISO,
  isSameDay,
  isSameWeek,
  isValid,
  startOfISOWeek,
} from "date-fns";
import { streakForPeriod, getMultiplier } from "./streakLogic";

export interface Habit {
  id: string;
  title: string;
  category: string;
  type: "positive" | "negative";
  basePoints: number;
  scoringType: "incremental" | "threshold";
  period: "daily" | "weekly";
  targetCount: number;
  count: number;
  totalCount: number;
  completedDates: string[];
  streakDays: number;
  lastUpdated: string | Date | { seconds: number; nanoseconds: number };
  isShared?: boolean;
  ownerId?: string;
}

export interface ToggleHabitResult {
  updatedHabit: Partial<Habit>;
  pointsChange: number;
  multiplier: number;
}

/**
 * Normalize the several shapes `lastUpdated` can take (Date, ISO string,
 * Firestore Timestamp, or its plain-object {seconds} form) into a Date, or null
 * when it can't be parsed into a valid date.
 */
function normalizeLastUpdated(
  rawLastUpdated: Habit["lastUpdated"]
): Date | null {
  let lastUpdate: Date | null = null;
  const raw = rawLastUpdated as
    | Date
    | string
    | { toDate?: () => Date; seconds?: number; nanoseconds?: number };

  if (raw instanceof Date) {
    lastUpdate = raw;
  } else if (typeof raw === "string") {
    lastUpdate = parseISO(raw);
  } else if (raw && typeof raw.toDate === "function") {
    // Firestore Timestamp
    lastUpdate = raw.toDate();
  } else if (raw && typeof raw.seconds === "number") {
    // Plain object representation of Timestamp
    lastUpdate = new Date(raw.seconds * 1000);
  }

  return lastUpdate && isValid(lastUpdate) ? lastUpdate : null;
}

/**
 * Check if a habit is stale (last activity was in a previous period).
 *
 * Cloud Functions run in UTC, so any anchor derived from `new Date()` — or from
 * the server-written `lastUpdated` (a UTC ISO instant) — can be a full calendar
 * day AHEAD of the user's local day in the evening UTC-rollover window. Comparing
 * a local-day string `today` against a UTC instant mixes reference frames and is
 * the source of the evening double-credit bug: a habit whose first completion of
 * the local day was written with a next-UTC-day `lastUpdated` looks "stale" on a
 * second trigger the same local evening, gets reset, and re-awards points.
 *
 * The fix: when `today` (caller-local yyyy-MM-dd) is supplied, decide staleness
 * from the habit's MOST-RECENT activity in the local frame. We combine the two
 * available activity signals and treat the habit as stale only if BOTH place the
 * last activity strictly before the current period:
 *
 *   1. `completedDates` — local yyyy-MM-dd strings, the exact local anchor. Their
 *      max is "had activity on/through maxCompletedDate". This is authoritative
 *      for threshold habits and for incremental habits once they cross target.
 *
 *   2. `lastUpdated` instant ≥ local midnight of `today` — rescues the case
 *      `completedDates` can't see: an INCREMENTAL habit with `targetCount > 1`
 *      bumps `count` on the first action WITHOUT appending `today` (it isn't
 *      "completed" yet), and in the UTC-rollover window that write lands on the
 *      NEXT UTC day. Here `count > 0` AND the write happened at/after today's
 *      local start, so it is activity today even though no completedDates entry
 *      exists. We require `count > 0` so a count that was already period-reset
 *      doesn't get rescued by a stale lastUpdated.
 *
 *   Critically, a residual count alone is NOT treated as "today": a threshold
 *   habit completed YESTERDAY and not yet reset overnight has `count > 0` but a
 *   `lastUpdated` from yesterday (< today's local midnight) and a
 *   `maxCompletedDate` of yesterday — so it correctly reads as stale and resets.
 *
 *   - daily  → stale iff maxCompletedDate < today AND not active-today-by-write
 *   - weekly → stale iff ISO-week(maxCompletedDate) < ISO-week(today) AND the
 *              lastUpdated write isn't within today's ISO week with count > 0
 *   - no local signal at all (count 0 and no completedDates) → fall back to the
 *     legacy parseISO(today)-vs-lastUpdated comparison.
 *
 * When `today` is omitted, the prior UTC `new Date()` behavior is preserved.
 *
 * @param habit - id/period/lastUpdated are always read; count/completedDates are
 *   read for the local-frame branch (optional so legacy callers still type-check)
 * @param today - Optional caller-local date (yyyy-MM-dd) to anchor "now" on
 */
export function isHabitStale(
  habit: Pick<Habit, "id" | "period" | "lastUpdated"> &
    Partial<Pick<Habit, "count" | "completedDates">>,
  today?: string
): boolean {
  try {
    if (!habit.lastUpdated) return true;

    const hasLocalToday = !!today && /^\d{4}-\d{2}-\d{2}$/.test(today);

    // ---- Local-frame branch (preferred when a caller-local date is given) ----
    if (hasLocalToday && today) {
      const completedDates = habit.completedDates;
      const hasCompletions =
        Array.isArray(completedDates) && completedDates.length > 0;

      // Signal 2: an unreset incremental count whose backing write landed at/after
      // today's local start. parseISO(today) is local midnight of `today`; a UTC
      // lastUpdated in the evening rollover window is >= that instant.
      const lastUpdatedInstant = normalizeLastUpdated(habit.lastUpdated);
      const activeTodayByWrite =
        typeof habit.count === "number" &&
        habit.count > 0 &&
        lastUpdatedInstant !== null &&
        lastUpdatedInstant.getTime() >= parseISO(today).getTime();

      if (hasCompletions || activeTodayByWrite) {
        const maxCompleted = hasCompletions
          ? completedDates!.reduce((a, b) => (a > b ? a : b))
          : null;

        if (habit.period === "daily") {
          // Lexical compare is valid for zero-padded yyyy-MM-dd.
          const completedToday = maxCompleted !== null && maxCompleted >= today;
          return !(completedToday || activeTodayByWrite);
        } else if (habit.period === "weekly") {
          const todayWeek = startOfISOWeek(parseISO(today)).getTime();
          const completedThisWeek =
            maxCompleted !== null &&
            startOfISOWeek(parseISO(maxCompleted)).getTime() >= todayWeek;
          const activeThisWeekByWrite =
            activeTodayByWrite &&
            lastUpdatedInstant !== null &&
            startOfISOWeek(lastUpdatedInstant).getTime() >= todayWeek;
          return !(completedThisWeek || activeThisWeekByWrite);
        }
        return true;
      }
      // No local signal (count 0 / no relevant write and no completedDates):
      // fall through to the legacy lastUpdated comparison, anchored on `today`.
    }

    // ---- Legacy / fallback branch (UTC instant comparison) ----
    // Anchor "now" on the caller-local date when provided (parsed as a local
    // wall-clock date), otherwise fall back to the UTC server clock.
    const now = hasLocalToday && today ? parseISO(today) : new Date();
    const lastUpdate = normalizeLastUpdated(habit.lastUpdated);

    if (!lastUpdate) {
      return true;
    }

    if (habit.period === "daily") {
      return !isSameDay(now, lastUpdate);
    } else if (habit.period === "weekly") {
      return !isSameWeek(now, lastUpdate, { weekStartsOn: 1 });
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * Process a habit toggle and calculate resulting state changes
 */
export function processToggleHabit(
  habit: Habit,
  direction: "up" | "down",
  // The caller's LOCAL date (yyyy-MM-dd). Cloud Functions run in UTC, so when a
  // local date is available (e.g. from the Shortcut payload) it must be passed
  // in to avoid recording completions on the wrong day for non-UTC users.
  // Defaults to the server's date to preserve prior behavior.
  today: string = format(new Date(), "yyyy-MM-dd")
): ToggleHabitResult | null {

  let newCount = habit.count;
  let newTotalCount = habit.totalCount;
  let newCompletedDates = [...habit.completedDates];
  let pointsChange = 0;

  // 1. Update Counts
  if (direction === "up") {
    newCount++;
    newTotalCount++;
  } else {
    if (habit.count === 0) {
      return null; // Can't go below 0
    }
    if (newCount > 0) newCount--;
    if (newTotalCount > 0) newTotalCount--;
  }

  // 2. Calculate Points
  // The multiplier must reflect the streak INCLUDING the current completion
  // (the "prospective" streak), matching the client (utils/habitLogic.ts).
  // We dispatch by period so weekly habits use the ISO-week streak rather than
  // the day-based one (which would reset on every ~7-day gap).
  const prospectiveDates = habit.completedDates.includes(today)
    ? habit.completedDates
    : [...habit.completedDates, today];
  const completionStreak = streakForPeriod(prospectiveDates, habit.period, today);
  const multiplier = getMultiplier(
    completionStreak,
    habit.type === "positive",
    habit.period
  );
  const sign = habit.type === "positive" ? 1 : -1;

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  if (habit.scoringType === "incremental") {
    // Incremental: Points on every action
    if (direction === "up") {
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else {
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
    }
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;
  } else {
    // Threshold: Points only when target hit
    const target = habit.targetCount;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    if (isCompletedNow && !wasCompletedBefore) {
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
    }
  }

  // 3. Update Completion History
  if (isCompletedNow) {
    if (!newCompletedDates.includes(today)) {
      newCompletedDates.push(today);
      newCompletedDates.sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );
    }
  } else {
    newCompletedDates = newCompletedDates.filter((d) => d !== today);
  }

  return {
    updatedHabit: {
      count: newCount,
      totalCount: newTotalCount,
      completedDates: newCompletedDates,
      streakDays: streakForPeriod(newCompletedDates, habit.period, today),
      lastUpdated: new Date().toISOString(),
    },
    pointsChange,
    multiplier,
  };
}

/**
 * Reset a stale habit to 0 count while preserving history.
 *
 * Mirrors the client's `getHabitResetUpdate` (utils/habitLogic.ts) when a
 * caller-local `today` is supplied: it strips `today` from `completedDates` and
 * recomputes the period-aware `streakDays`, preserving the invariant
 * "completedDates contains today ⟺ count reflects today". Without dropping
 * `today`, a habit completed earlier in the user's local day (still in
 * completedDates) would be reset to count 0 yet remain in completedDates, and
 * the subsequent toggle would see `wasCompletedBefore === false` and re-award
 * points for a day already scored (the evening double-credit bug).
 *
 * On a genuine new-day reset, `today` is not in `completedDates` (the completion
 * was on a prior day), so the filter is a no-op and history is preserved.
 *
 * When `today` is omitted, the prior behavior is preserved: count is zeroed and
 * completedDates/streakDays are left untouched (recalculated on the next toggle).
 *
 * @param habit - The habit being reset (completedDates and period are read)
 * @param today - Optional caller-local date (yyyy-MM-dd)
 */
export function resetStaleHabit(habit: Habit, today?: string): Partial<Habit> {
  if (today) {
    const completedDates = habit.completedDates.filter((d) => d !== today);
    return {
      count: 0,
      completedDates,
      // Period-aware: daily → day-based streak, weekly → ISO-week-based streak
      // (so a weekly habit isn't collapsed to ~0 on reset).
      streakDays: streakForPeriod(completedDates, habit.period, today),
      lastUpdated: new Date().toISOString(),
    };
  }

  return {
    count: 0,
    lastUpdated: new Date().toISOString(),
    // Keep completedDates and streakDays - they'll be recalculated on next toggle
  };
}

/**
 * Fuzzy match a habit by title
 * Returns the best matching habit or null
 */
export function fuzzyMatchHabit(
  habits: Habit[],
  searchTerm: string
): Habit | null {
  const normalizedSearch = searchTerm.toLowerCase().trim();

  // Exact match first
  const exactMatch = habits.find(
    (h) => h.title.toLowerCase() === normalizedSearch
  );
  if (exactMatch) return exactMatch;

  // Contains match
  const containsMatch = habits.find((h) =>
    h.title.toLowerCase().includes(normalizedSearch)
  );
  if (containsMatch) return containsMatch;

  // Starts with match
  const startsWithMatch = habits.find((h) =>
    h.title.toLowerCase().startsWith(normalizedSearch)
  );
  if (startsWithMatch) return startsWithMatch;

  return null;
}
