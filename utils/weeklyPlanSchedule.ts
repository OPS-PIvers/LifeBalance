/**
 * Cook scheduling + time formatting for the Meal Guide.
 *
 * Ported from the `weekly-meals` web app so LifeBalance renders an identical
 * "cook in order" timeline: given a serve time, every prep/cook step is laid
 * out with an absolute clock time, back-calculated from the meal's total
 * duration. Pure functions — no React, fully unit-testable.
 */
import { WeeklyPlanMeal, WeeklyPlanStep } from '@/types/weeklyPlan';

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SERVE = '18:00';

/** Effort label normalization (Low/Med/High → friendly label). */
export const EFFORT_LABEL: Record<string, string> = {
  low: 'Low effort',
  med: 'Some effort',
  medium: 'Some effort',
  high: 'High effort',
};

export interface ScheduledStep extends WeeklyPlanStep {
  /** Absolute clock time the step begins, minutes since midnight. */
  when: number;
  /** Display label: "P1", "P2"… for prep; "1", "2"… for cook. */
  label: string;
  phase: 'prep' | 'cook';
}

export interface CookSchedule {
  /** Serve time, minutes since midnight. */
  serve: number;
  /** When to start cooking, minutes since midnight (may be the prior day). */
  start: number;
  /** Total wall-clock minutes across all steps. */
  total: number;
  steps: ScheduledStep[];
}

/**
 * Parses an "HH:MM" (24h) string into minutes since midnight.
 * Returns null for malformed or out-of-range input.
 */
export const parseHM = (value: string | undefined | null): number | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

/** Wraps an arbitrary minute count into the [0, 1440) range. */
const wrapMinutes = (min: number): number =>
  ((Math.round(min) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

/** Formats minutes-since-midnight as a 12-hour clock, e.g. "5:40 PM". */
export const fmtClock = (min: number): string => {
  const wrapped = wrapMinutes(min);
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

/** Formats a duration in minutes, e.g. "1h 20m", "45m", "2h". */
export const fmtDur = (min: number): string => {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

/** Sums the wall-clock minutes of a list of steps. */
const sumMinutes = (steps: WeeklyPlanStep[]): number =>
  steps.reduce((acc, s) => acc + (Number.isFinite(s.min) ? Math.max(0, s.min) : 0), 0);

/**
 * Builds the cook timeline for a meal.
 *
 * Combines prep then cook steps in order, totals their durations, and works
 * backwards from the serve time so each step gets an absolute clock time:
 * `start = serve - total`, then each step's `when` is `start + accumulated`.
 *
 * @param meal - The meal to schedule.
 * @param serveOverride - "HH:MM" serve time; falls back to the meal's
 *   `defaultServe`, then 18:00.
 */
export const buildSchedule = (
  meal: Pick<WeeklyPlanMeal, 'prep' | 'cook' | 'defaultServe'>,
  serveOverride?: string,
): CookSchedule => {
  const prep = meal.prep ?? [];
  const cook = meal.cook ?? [];

  const serve =
    parseHM(serveOverride) ??
    parseHM(meal.defaultServe) ??
    parseHM(DEFAULT_SERVE)!;

  const total = sumMinutes(prep) + sumMinutes(cook);
  const start = serve - total;

  const steps: ScheduledStep[] = [];
  let acc = 0;

  prep.forEach((s, i) => {
    steps.push({ ...s, when: start + acc, label: `P${i + 1}`, phase: 'prep' });
    acc += Math.max(0, s.min || 0);
  });
  cook.forEach((s, i) => {
    steps.push({ ...s, when: start + acc, label: `${i + 1}`, phase: 'cook' });
    acc += Math.max(0, s.min || 0);
  });

  return { serve, start, total, steps };
};
