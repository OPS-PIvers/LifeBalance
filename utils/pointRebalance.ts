/**
 * F-DASH-08 — deterministic point-rebalance suggestions.
 *
 * Replaces the Gemini-backed `analyzeHabitPoints()` as the source for the
 * Dashboard's PointRebalanceCard. The AI version had no sense of scale (it
 * suggested 15 pts in a household where nothing was above 5) and got the
 * DIRECTION backwards — it read "54 completions" as a reason to *raise* the
 * reward.
 *
 * The rule this module encodes instead is the economics of a habit:
 *
 *   - A positive habit you almost always do has become built in. It doesn't
 *     need as much reward any more, so its points come DOWN.
 *   - A positive habit you keep skipping is still hard, so its points may
 *     creep UP a little.
 *   - A negative habit that barely fires isn't the problem it was, so its
 *     penalty MAGNITUDE shrinks toward zero.
 *   - A negative habit that fires constantly needs a bigger sting.
 *
 * Everything here is pure and deterministic: no clock reads, no network. The
 * caller passes "today" (repo convention — see `getLocalDateString`). Returning
 * an EMPTY array is the normal, expected outcome on most days.
 */
import { differenceInCalendarDays, isValid, parseISO, subDays, subWeeks } from 'date-fns';
import type { Habit } from '@/types/schema';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';
import { getLocalDateString } from '@/utils/dateHelpers';
import { habitPeriodStart, habitPointsMagnitude, habitSign } from '@/utils/habitLogic';

// --- Window -----------------------------------------------------------------

/** Rolling judgement window for a daily habit — two months smooths over one bad week without letting last spring's behaviour vote. */
export const DAILY_WINDOW_DAYS = 60;
/** The same span expressed in a weekly habit's own cadence, so weekly habits aren't judged on ~8 opportunities. */
export const WEEKLY_WINDOW_WEEKS = 12;

// --- Noise floor ------------------------------------------------------------

/** A daily habit needs this many observable days before a rate means anything — under three weeks, one missed day swings it 5%+. */
export const MIN_OBSERVED_DAYS = 21;
/** Weekly equivalent: fewer than four weeks and a single skip moves the rate by a quarter. */
export const MIN_OBSERVED_WEEKS = 4;

// --- Direction thresholds ---------------------------------------------------

/** Positive habit done at least this often is effectively automatic — the largest reduction. */
export const AUTOMATIC_RATE = 0.95;
/** Positive habit done at least this often is built in — a small reduction. */
export const BUILT_IN_RATE = 0.8;
/** Positive habit done this rarely is still a genuine stretch — a small increase. */
export const STRUGGLING_RATE = 0.4;
/** Negative habit firing this rarely has essentially stopped — the largest penalty reduction. */
export const NEVER_TRIGGER_RATE = 0.03;
/** Negative habit firing this rarely is no longer much of a problem — a small penalty reduction. */
export const RARE_TRIGGER_RATE = 0.15;
/** Negative habit firing at least this often is a live problem — a small penalty increase. */
export const FREQUENT_TRIGGER_RATE = 0.5;
/** Negative habit firing this often is basically constant — the largest penalty increase. */
export const CONSTANT_TRIGGER_RATE = 0.8;

// --- Scale ------------------------------------------------------------------

/** A single suggestion never moves a habit by more than this. Nudges, not jumps. */
export const MAX_STEP = 2;
/** Floor for any suggested magnitude — a habit is never worth 0 points. */
export const MIN_POINT_MAGNITUDE = 1;
/** Ceiling used only when no habit in the household has a usable basePoints value yet. */
export const DEFAULT_MAX_MAGNITUDE = 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Unique, sorted, well-formed `yyyy-MM-dd` entries. */
const cleanDates = (dates: string[] | undefined): string[] =>
  Array.from(new Set(dates ?? [])).filter(d => DATE_RE.test(d)).sort();

/**
 * The largest point magnitude actually in use by this household. Every
 * suggestion is hard-clamped to it, so we can never propose 15 in a household
 * whose biggest habit is worth 5. A side effect worth knowing: the habit that
 * *sets* the ceiling can only ever be suggested downward.
 */
export const householdMaxMagnitude = (habits: Pick<Habit, 'basePoints'>[]): number => {
  let max = 0;
  for (const habit of habits) {
    const magnitude = Math.abs(habit.basePoints);
    if (Number.isFinite(magnitude) && magnitude > max) max = magnitude;
  }
  return max >= MIN_POINT_MAGNITUDE ? Math.round(max) : DEFAULT_MAX_MAGNITUDE;
};

interface WindowStats {
  /** Observable periods — days for a daily habit, weeks for a weekly one. */
  observed: number;
  /** How many of those periods the habit was logged in. */
  hits: number;
  /** `hits / observed`, clamped to 0..1. */
  rate: number;
}

/**
 * Daily habits: one opportunity per calendar day since the habit was first
 * logged (bounded by the window). Frozen days are removed from the denominator
 * — a freeze token absorbed that miss, so it isn't evidence of skipping.
 */
const dailyStats = (habit: Habit, todayDate: Date, today: string): WindowStats | null => {
  const completed = cleanDates(habit.completedDates);
  const earliest = completed[0];
  if (!earliest) return null;

  const windowStart = getLocalDateString(subDays(todayDate, DAILY_WINDOW_DAYS - 1));
  const start = earliest > windowStart ? earliest : windowStart;
  const startDate = parseISO(start);
  if (!isValid(startDate)) return null;

  const frozenInWindow = cleanDates(habit.frozenDates).filter(d => d >= start && d <= today).length;
  const observed = differenceInCalendarDays(todayDate, startDate) + 1 - frozenInWindow;
  if (observed < MIN_OBSERVED_DAYS) return null;

  const hits = completed.filter(d => d >= start && d <= today).length;
  return { observed, hits, rate: clamp(hits / observed, 0, 1) };
};

/**
 * Weekly habits are judged in weeks, matching how their streaks are measured:
 * a week counts as a hit if it holds at least one completion.
 */
const weeklyStats = (habit: Habit, todayDate: Date, today: string): WindowStats | null => {
  const completed = cleanDates(habit.completedDates);
  const earliest = completed[0];
  if (!earliest) return null;

  const windowStartWeek = habitPeriodStart(
    'weekly',
    getLocalDateString(subWeeks(todayDate, WEEKLY_WINDOW_WEEKS - 1))
  );
  const earliestWeek = habitPeriodStart('weekly', earliest);
  const startWeek = earliestWeek > windowStartWeek ? earliestWeek : windowStartWeek;
  const currentWeek = habitPeriodStart('weekly', today);

  const startWeekDate = parseISO(startWeek);
  const currentWeekDate = parseISO(currentWeek);
  if (!isValid(startWeekDate) || !isValid(currentWeekDate)) return null;

  const observed = Math.floor(differenceInCalendarDays(currentWeekDate, startWeekDate) / 7) + 1;
  if (observed < MIN_OBSERVED_WEEKS) return null;

  const hitWeeks = new Set(
    completed.filter(d => d >= startWeek && d <= today).map(d => habitPeriodStart('weekly', d))
  );
  return { observed, hits: hitWeeks.size, rate: clamp(hitWeeks.size / observed, 0, 1) };
};

/**
 * How far the habit's point MAGNITUDE should move, in whole points. Positive
 * = worth more, negative = worth less. Direction is the whole point of this
 * module — read the module header before touching the signs.
 */
const magnitudeDelta = (isPenalty: boolean, rate: number): number => {
  if (isPenalty) {
    // Rarely triggered => less penalty needed. Constantly triggered => more.
    if (rate <= NEVER_TRIGGER_RATE) return -MAX_STEP;
    if (rate <= RARE_TRIGGER_RATE) return -1;
    if (rate >= CONSTANT_TRIGGER_RATE) return MAX_STEP;
    if (rate >= FREQUENT_TRIGGER_RATE) return 1;
    return 0;
  }
  // Almost always done => it's built in, needs less reward. Rarely done => it's
  // still hard, so the reward may rise a little.
  if (rate >= AUTOMATIC_RATE) return -MAX_STEP;
  if (rate >= BUILT_IN_RATE) return -1;
  if (rate <= STRUGGLING_RATE) return 1;
  return 0;
};

const plural = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`;

/** Deterministic, no-AI explanation built straight from the numbers we measured. */
const buildReasoning = (
  isPenalty: boolean,
  isWeekly: boolean,
  stats: WindowStats,
  delta: number
): string => {
  const unit = isWeekly ? 'week' : 'day';
  const span = `the last ${plural(stats.observed, unit)}`;

  if (isPenalty) {
    const fired = `Slipped ${isWeekly ? `in ${plural(stats.hits, 'week')}` : plural(stats.hits, 'time')} in ${span}`;
    return delta < 0
      ? `${fired} — barely an issue any more, so the penalty can ease off.`
      : `${fired} — still a regular slip, so it should sting a little more.`;
  }

  const done = isWeekly
    ? `Done in ${stats.hits} of ${span}`
    : `Done ${stats.hits} of ${span}`;
  return delta < 0
    ? `${done} — this one's become routine, so it needs less reward.`
    : `${done} — still a stretch, so a slightly bigger reward could help.`;
};

/**
 * Build zero or more point-rebalance suggestions for a household's habits.
 *
 * Pure: the only clock read is the default value of `today`, evaluated at the
 * call boundary. Pass `today` explicitly for deterministic tests.
 */
export const generatePointRebalanceSuggestions = (
  habits: Habit[],
  today: string = getLocalDateString()
): HabitPointAdjustmentSuggestion[] => {
  const todayDate = parseISO(today);
  if (!DATE_RE.test(today) || !isValid(todayDate)) return [];

  // The ceiling must describe the household's LIVE point economy. Archived
  // habits are retired, so a long-dead 20-pt habit must not raise the bound
  // and let suggestions escape the scale that's meant to contain them —
  // which is the exact failure this module exists to prevent.
  //
  // Paused habits DO still count: a planned break is temporary, the habit
  // returns at its stored value, and that value is still part of what this
  // household treats as a big reward. They're excluded from being *scored*
  // below (their recent rate describes the break) but not from the scale.
  const maxMagnitude = householdMaxMagnitude(habits.filter(h => !h.archivedAt));
  const suggestions: HabitPointAdjustmentSuggestion[] = [];

  for (const habit of habits) {
    if (!habit.id || !habit.title) continue;
    // Retired habits and habits on a planned break aren't candidates: their
    // recent rate describes the break, not the habit.
    if (habit.archivedAt) continue;
    if (habit.pausedUntil && habit.pausedUntil >= today) continue;

    const current = habitPointsMagnitude(habit);
    if (!Number.isFinite(current) || current < MIN_POINT_MAGNITUDE) continue;

    const isWeekly = habit.period === 'weekly';
    const stats = isWeekly
      ? weeklyStats(habit, todayDate, today)
      : dailyStats(habit, todayDate, today);
    if (!stats) continue;

    const isPenalty = habitSign(habit) === -1;
    const rawDelta = magnitudeDelta(isPenalty, stats.rate);
    if (rawDelta === 0) continue;

    const nextMagnitude = clamp(
      Math.round(current) + rawDelta,
      MIN_POINT_MAGNITUDE,
      Math.max(maxMagnitude, MIN_POINT_MAGNITUDE)
    );
    // A delta that clamps away to nothing is not a suggestion.
    if (nextMagnitude === Math.round(current)) continue;

    // Preserve the STORED sign so a household that keeps negative habits as a
    // negative `basePoints` stays negative, and one that keeps them positive
    // stays positive. A suggestion never flips a habit's sign.
    const storedSign = habit.basePoints < 0 ? -1 : 1;

    suggestions.push({
      habitId: habit.id,
      habitTitle: habit.title,
      currentPoints: habit.basePoints,
      suggestedPoints: storedSign * nextMagnitude,
      reasoning: buildReasoning(isPenalty, isWeekly, stats, nextMagnitude - Math.round(current)),
    });
  }

  // Biggest correction first; habit id breaks ties so the order is stable.
  return suggestions.sort((a, b) => {
    const byDelta =
      Math.abs(b.suggestedPoints - b.currentPoints) - Math.abs(a.suggestedPoints - a.currentPoints);
    return byDelta !== 0 ? byDelta : a.habitId.localeCompare(b.habitId);
  });
};
