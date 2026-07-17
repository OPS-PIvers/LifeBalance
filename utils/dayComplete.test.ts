import { describe, it, expect } from 'vitest';
import {
  isDueToday,
  getDayCompleteStatus,
  dayCompleteStorageKey,
  hasDayCompleteFired,
  markDayCompleteFired,
  shouldFireDayComplete,
  type DayCompleteHabit,
} from '@/utils/dayComplete';

const TODAY = '2026-07-16';
const YESTERDAY = '2026-07-15';

/** Build a minimal daily positive habit; override any field. */
const habit = (over: Partial<DayCompleteHabit> = {}): DayCompleteHabit => ({
  period: 'daily',
  type: 'positive',
  completedDates: [],
  ...over,
});

/** A tiny in-memory Storage stub (only the methods the module uses). */
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
};

describe('isDueToday', () => {
  it('counts a positive, daily, unassigned, active habit', () => {
    expect(isDueToday(habit(), TODAY)).toBe(true);
  });

  it('excludes weekly habits (due this week, not today)', () => {
    expect(isDueToday(habit({ period: 'weekly' }), TODAY)).toBe(false);
  });

  it('excludes negative habits (never "done")', () => {
    expect(isDueToday(habit({ type: 'negative' }), TODAY)).toBe(false);
  });

  it('excludes assigned kid chores', () => {
    expect(isDueToday(habit({ assignedTo: 'kid_leo' }), TODAY)).toBe(false);
  });

  it('excludes archived habits', () => {
    expect(isDueToday(habit({ archivedAt: TODAY }), TODAY)).toBe(false);
  });

  it('excludes habits on a planned pause covering today', () => {
    expect(isDueToday(habit({ pausedUntil: TODAY }), TODAY)).toBe(false);
    // A pause that ended yesterday no longer excludes the habit.
    expect(isDueToday(habit({ pausedUntil: YESTERDAY }), TODAY)).toBe(true);
  });
});

describe('getDayCompleteStatus', () => {
  it('is not complete when there are no due habits', () => {
    expect(getDayCompleteStatus([], TODAY)).toEqual({ total: 0, done: 0, isComplete: false });
    // Only a weekly + a kid chore + a negative → still no *due* habits.
    const noneDue = [
      habit({ period: 'weekly', completedDates: [TODAY] }),
      habit({ assignedTo: 'kid', completedDates: [TODAY] }),
      habit({ type: 'negative' }),
    ];
    expect(getDayCompleteStatus(noneDue, TODAY).isComplete).toBe(false);
  });

  it('is incomplete while any due habit is unfinished', () => {
    const habits = [habit({ completedDates: [TODAY] }), habit({ completedDates: [] })];
    expect(getDayCompleteStatus(habits, TODAY)).toEqual({ total: 2, done: 1, isComplete: false });
  });

  it('is complete when every due habit is done today', () => {
    const habits = [habit({ completedDates: [TODAY] }), habit({ completedDates: [TODAY] })];
    expect(getDayCompleteStatus(habits, TODAY)).toEqual({ total: 2, done: 2, isComplete: true });
  });

  it('ignores non-due habits when judging completeness', () => {
    const habits = [
      habit({ completedDates: [TODAY] }), // due + done
      habit({ type: 'negative' }), // not due — must not block completion
      habit({ assignedTo: 'kid', completedDates: [] }), // kid chore — not due
    ];
    expect(getDayCompleteStatus(habits, TODAY).isComplete).toBe(true);
  });

  it('treats a weekly completion earlier in the week as done (period-aware)', () => {
    // Weekly habits are not "due today" here, so this is really asserting the
    // helper does not miscount them: a weekly habit is excluded regardless.
    const habits = [habit({ period: 'weekly', completedDates: [YESTERDAY] })];
    expect(getDayCompleteStatus(habits, TODAY)).toEqual({ total: 0, done: 0, isComplete: false });
  });
});

describe('storage helpers', () => {
  it('namespaces the key per local day', () => {
    expect(dayCompleteStorageKey(TODAY)).toBe('lifebalance:day-complete-celebrated:2026-07-16');
    expect(dayCompleteStorageKey(YESTERDAY)).not.toBe(dayCompleteStorageKey(TODAY));
  });

  it('round-trips the fired flag', () => {
    const s = memoryStorage();
    expect(hasDayCompleteFired(TODAY, s)).toBe(false);
    markDayCompleteFired(TODAY, s);
    expect(hasDayCompleteFired(TODAY, s)).toBe(true);
    // A different day is independent.
    expect(hasDayCompleteFired(YESTERDAY, s)).toBe(false);
  });

  it('is null-safe (no storage available)', () => {
    expect(hasDayCompleteFired(TODAY, null)).toBe(false);
    expect(() => markDayCompleteFired(TODAY, null)).not.toThrow();
  });

  it('fails open when getItem throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(hasDayCompleteFired(TODAY, throwing)).toBe(false);
  });
});

describe('shouldFireDayComplete', () => {
  const complete = { total: 2, done: 2, isComplete: true };
  const incomplete = { total: 2, done: 1, isComplete: false };

  it('fires on the false→true transition when not yet fired today', () => {
    const s = memoryStorage();
    expect(
      shouldFireDayComplete({ wasComplete: false, status: complete, today: TODAY, storage: s }),
    ).toBe(true);
  });

  it('does not fire when the day is not complete', () => {
    const s = memoryStorage();
    expect(
      shouldFireDayComplete({ wasComplete: false, status: incomplete, today: TODAY, storage: s }),
    ).toBe(false);
  });

  it('does not fire when it was already complete (no transition)', () => {
    const s = memoryStorage();
    expect(
      shouldFireDayComplete({ wasComplete: true, status: complete, today: TODAY, storage: s }),
    ).toBe(false);
  });

  it('does not re-fire after an undo + re-complete (localStorage latch)', () => {
    const s = memoryStorage();
    // First completion fires…
    expect(
      shouldFireDayComplete({ wasComplete: false, status: complete, today: TODAY, storage: s }),
    ).toBe(true);
    markDayCompleteFired(TODAY, s);
    // …user undoes (complete→incomplete, no fire)…
    expect(
      shouldFireDayComplete({ wasComplete: true, status: incomplete, today: TODAY, storage: s }),
    ).toBe(false);
    // …then re-completes: transition is present again but the latch blocks it.
    expect(
      shouldFireDayComplete({ wasComplete: false, status: complete, today: TODAY, storage: s }),
    ).toBe(false);
  });

  it('fires again on a new day even after firing yesterday', () => {
    const s = memoryStorage();
    markDayCompleteFired(YESTERDAY, s);
    expect(
      shouldFireDayComplete({ wasComplete: false, status: complete, today: TODAY, storage: s }),
    ).toBe(true);
  });
});
