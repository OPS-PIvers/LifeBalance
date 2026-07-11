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
  /**
   * Plan 25: dates protected by an auto-applied streak freeze (YYYY-MM-DD).
   * Read from the Firestore habit doc (never from the request body). A frozen
   * date preserves streak continuity but is NOT a completion and earns no
   * points. Mirrors `Habit.frozenDates` in types/schema.ts.
   */
  frozenDates?: string[];
  /**
   * Denormalized lowercased/trimmed `title` (see `normalizeHabitTitle` below),
   * written by the client's addHabit/updateHabit. Mirrors `Habit.titleLower`
   * in types/schema.ts. Optional/absent on un-backfilled docs.
   */
  titleLower?: string;
}

/**
 * Normalizes a habit title into the denormalized `titleLower` field:
 * lowercased and trimmed. Duplicated from (not shared with) the client's
 * `normalizeHabitTitle` in utils/habitLogic.ts — Cloud Functions is a
 * separate package with no cross-package import path; change both together.
 */
export function normalizeHabitTitle(title: string): string {
  return title.toLowerCase().trim();
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
 * Check if a habit is stale (last completion was in a previous period).
 *
 * Cloud Functions run in UTC, so any anchor derived from `new Date()` — or from
 * the server-written `lastUpdated` (a UTC ISO instant) — can sit a full calendar
 * day away from the user's local day in the evening UTC-rollover window. Comparing
 * a local-day string `today` against a UTC instant mixes reference frames and was
 * the source of the evening double-credit bug.
 *
 * The fix: when `today` (caller-local yyyy-MM-dd) is supplied AND the habit has
 * completion history, decide staleness SOLELY from `completedDates` — the only
 * data already stored in the user's LOCAL frame (the `today` strings the client/
 * server push). `lastUpdated` is never consulted for "today" here, because a UTC
 * instant cannot reliably be classified into a local day without the user's
 * timezone.
 *
 *   - daily  → stale iff maxCompletedDate < today
 *              (lexical compare is valid for zero-padded yyyy-MM-dd)
 *   - weekly → stale iff ISO-week(maxCompletedDate) < ISO-week(today)
 *   - completedDates empty (no local signal) → fall back to the legacy
 *     parseISO(today)-vs-lastUpdated comparison.
 *
 * When `today` is omitted, the prior UTC `new Date()` behavior is preserved.
 *
 * Why completedDates alone is correct and sufficient:
 *   - The reported bug was THRESHOLD habits double-crediting. A threshold habit
 *     appends `today` to completedDates exactly when it crosses target (i.e.
 *     exactly when points are awarded), so maxCompleted >= today whenever today
 *     was already scored ⇒ not stale ⇒ no reset ⇒ no re-award — with NO timezone
 *     guess.
 *   - INCREMENTAL habits award points on EVERY action regardless of reset, so a
 *     reset can NEVER double-credit incremental points; at most a target>1
 *     incremental's display COUNT could reset mid-evening in a rare rollover edge
 *     — a cosmetic tally issue, not a points bug, and no worse than before.
 *   - Not consulting `lastUpdated` for "today" avoids the never-reset regression:
 *     on a genuine new local day every completedDate is < today (or in a prior
 *     ISO week), so the habit is correctly stale and resets.
 *
 * @param habit - id/period/lastUpdated are always read; completedDates drives the
 *   local-frame branch (optional so legacy callers still type-check)
 * @param today - Optional caller-local date (yyyy-MM-dd) to anchor "now" on
 */
export function isHabitStale(
  habit: Pick<Habit, "id" | "period" | "lastUpdated"> &
    Partial<Pick<Habit, "completedDates">>,
  today?: string
): boolean {
  try {
    if (!habit.lastUpdated) return true;

    const hasLocalToday = !!today && /^\d{4}-\d{2}-\d{2}$/.test(today);

    // ---- Local-frame branch: anchor on completedDates (local yyyy-MM-dd) ----
    if (hasLocalToday && today) {
      const completedDates = habit.completedDates;
      if (Array.isArray(completedDates) && completedDates.length > 0) {
        const maxCompleted = completedDates.reduce((a, b) => (a > b ? a : b));

        if (habit.period === "daily") {
          // Lexical compare is valid for zero-padded yyyy-MM-dd.
          return maxCompleted < today;
        } else if (habit.period === "weekly") {
          return (
            startOfISOWeek(parseISO(maxCompleted)).getTime() <
            startOfISOWeek(parseISO(today)).getTime()
          );
        }
        return true;
      }
      // completedDates empty (no local signal): fall through to the legacy
      // lastUpdated comparison below, anchored on `today`.
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
  // The multiplier must reflect the streak the habit will have AFTER this
  // action (the "prospective" streak), matching the client (utils/habitLogic.ts)
  // branch-for-branch: `today` only enters the streak input when this action
  // actually completes the habit today. We dispatch by period so weekly habits
  // use the ISO-week streak rather than the day-based one (which would reset
  // on every ~7-day gap).
  // Sign from `type`, magnitude from |basePoints| — mirrors the client's
  // habitSign/habitPointsMagnitude (utils/habitLogic.ts). Two client creation
  // paths historically stored negative habits with opposite basePoints signs,
  // so reading basePoints raw awards points for one convention.
  const sign = habit.type === "positive" ? 1 : -1;
  const baseMagnitude = Math.abs(habit.basePoints);
  let multiplier = 1.0;

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  const streakFor = (dates: string[]): number =>
    streakForPeriod(dates, habit.period, today, habit.frozenDates ?? []);

  if (habit.scoringType === "incremental") {
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    // Only include today in the prospective dates when this 'up' toggle makes
    // the habit newly complete today — a below-target action must not inflate
    // the streak (and multiplier) by a day/week the habit hasn't earned yet.
    const prospectiveDates =
      direction === "up" &&
      isCompletedNow &&
      !habit.completedDates.includes(today)
        ? [...habit.completedDates, today]
        : habit.completedDates;
    multiplier = getMultiplier(
      streakFor(prospectiveDates),
      habit.type === "positive",
      habit.period
    );

    // Incremental: Points on every action
    if (direction === "up") {
      pointsChange = sign * Math.floor(baseMagnitude * multiplier);
    } else {
      pointsChange = -sign * Math.floor(baseMagnitude * multiplier);
    }
  } else {
    // Threshold: Points only when target hit
    const target = habit.targetCount;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    if (isCompletedNow && !wasCompletedBefore) {
      // Just hit target → award using the NEW streak (including today).
      const prospectiveDates = habit.completedDates.includes(today)
        ? habit.completedDates
        : [...habit.completedDates, today];
      multiplier = getMultiplier(
        streakFor(prospectiveDates),
        habit.type === "positive",
        habit.period
      );
      pointsChange = sign * Math.floor(baseMagnitude * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      // Just lost target → remove using the OLD streak (today still present).
      multiplier = getMultiplier(
        streakFor(habit.completedDates),
        habit.type === "positive",
        habit.period
      );
      pointsChange = -sign * Math.floor(baseMagnitude * multiplier);
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
      streakDays: streakForPeriod(newCompletedDates, habit.period, today, habit.frozenDates ?? []),
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
      streakDays: streakForPeriod(completedDates, habit.period, today, habit.frozenDates ?? []),
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
