import { describe, it, expect, vi } from 'vitest';
import type { Habit } from '@/types/schema';
import {
  buildMemberPointsLedger,
  buildSharedPointsLedger,
  groupPointsLedgerByDate,
  sumPointsLedger,
} from '@/utils/pointsLedger';
import { calculateMemberPointsForDateRange } from '@/utils/habitAttribution';
import { calculateHouseholdShareForDateRange } from '@/utils/scoreboardWidget';
import { calculatePointsForDateRange } from '@/utils/habitLogic';

// Thursday inside the Mon Jul 27 – Sun Aug 2 week.
const TODAY = '2026-07-30';

// `calculatePointsForDateRange` (the chore scorer these assertions compare
// against) reads "today" from the module rather than taking it as a parameter,
// so pin it to the same day the ledger is built for.
vi.mock('@/utils/dateHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/dateHelpers')>();
  return { ...actual, getLocalDateString: () => '2026-07-30' };
});

const WEEK_START = '2026-07-27';
const WEEK_END = '2026-08-02';

const makeHabit = (overrides: Partial<Habit> & Pick<Habit, 'id' | 'title'>): Habit =>
  ({
    category: 'Health',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as unknown as Habit);

/** Shared habit Paul completed Mon + Wed, Jen completed Tue. */
const sharedHabit = makeHabit({
  id: 'h-run',
  title: 'Morning run',
  completedDates: ['2026-07-27', '2026-07-28', '2026-07-29'],
  completedBy: {
    '2026-07-27': { paul: 1 },
    '2026-07-28': { jen: 1 },
    '2026-07-29': { paul: 1 },
  },
});

/** A chore assigned to Paul — its points route to his own member doc. */
const choreHabit = makeHabit({
  id: 'h-trash',
  title: 'Take out trash',
  basePoints: 5,
  assignedTo: 'paul',
  completedDates: ['2026-07-28'],
});

/** Pre-attribution history: a completion nobody holds. */
const legacyHabit = makeHabit({
  id: 'h-dishes',
  title: 'Dishes',
  basePoints: 8,
  completedDates: ['2026-07-29'],
});

const habits = [sharedHabit, choreHabit, legacyHabit];

describe('buildMemberPointsLedger', () => {
  it('itemizes each attributed completion with its own date', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY);
    const attributed = entries.filter(e => e.source === 'attributed');

    expect(attributed.map(e => e.date)).toEqual(['2026-07-29', '2026-07-27']);
    expect(attributed.every(e => e.habitTitle === 'Morning run')).toBe(true);
    expect(attributed.every(e => e.units === 1)).toBe(true);
  });

  it('sums to the same figure the row above it reports (attribution + chores)', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY);

    // The two sources a member's stored points.weekly is built from — see
    // computeMemberPointsReset.
    const attribution = calculateMemberPointsForDateRange(habits, 'paul', WEEK_START, WEEK_END, TODAY);
    const chores = calculatePointsForDateRange(habits, WEEK_START, WEEK_END, 'paul');

    expect(attribution).toBeGreaterThan(0);
    expect(chores).toBeGreaterThan(0);
    expect(sumPointsLedger(entries)).toBe(attribution + chores);
  });

  it('omits chores when the row was derived from attribution alone (past weeks)', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY, undefined, {
      includeChores: false,
    });

    expect(entries.some(e => e.source === 'chore')).toBe(false);
    expect(sumPointsLedger(entries)).toBe(
      calculateMemberPointsForDateRange(habits, 'paul', WEEK_START, WEEK_END, TODAY),
    );
  });

  it('credits an assigned chore to its assignee, not to whoever else logged that day', () => {
    const paul = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY);
    const jen = buildMemberPointsLedger(habits, 'jen', WEEK_START, WEEK_END, TODAY);

    expect(paul.filter(e => e.source === 'chore').map(e => e.habitTitle)).toEqual(['Take out trash']);
    expect(jen.some(e => e.source === 'chore')).toBe(false);
  });

  it('never itemizes points that belong to nobody', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY);
    expect(entries.some(e => e.habitTitle === 'Dishes')).toBe(false);
  });

  it('excludes completions outside the range', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', '2026-07-29', '2026-07-29', TODAY);
    expect(entries.map(e => e.date)).toEqual(['2026-07-29']);
  });

  it('keeps a logged completion that earned nothing extra, so no tap goes unaccounted for', () => {
    // Weekly threshold habit: the week's ONE award lands on Jen's first
    // attributed day, so Wednesday's completion is real but scores 0.
    const weekly = makeHabit({
      id: 'h-meal-prep',
      title: 'Meal prep',
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 2,
      basePoints: 12,
      count: 2,
      completedDates: ['2026-07-27', '2026-07-29'],
      completedBy: {
        '2026-07-27': { jen: 1 },
        '2026-07-29': { jen: 1 },
      },
    });

    const entries = buildMemberPointsLedger([weekly], 'jen', WEEK_START, WEEK_END, TODAY);

    expect(entries.map(e => [e.date, e.points])).toEqual([
      ['2026-07-29', 0],
      ['2026-07-27', 12],
    ]);
    expect(sumPointsLedger(entries)).toBe(
      calculateMemberPointsForDateRange([weekly], 'jen', WEEK_START, WEEK_END, TODAY),
    );
  });

  it('reports the attributed unit count so a repeated completion reads as one line', () => {
    const incremental = makeHabit({
      id: 'h-water',
      title: 'Glass of water',
      scoringType: 'incremental',
      basePoints: 2,
      count: 3,
      completedDates: ['2026-07-29'],
      completedBy: { '2026-07-29': { paul: 3 } },
    });

    const entries = buildMemberPointsLedger([incremental], 'paul', WEEK_START, WEEK_END, TODAY);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.units).toBe(3);
    expect(entries[0]?.points).toBe(6);
  });
});

describe('buildSharedPointsLedger', () => {
  it('itemizes only what belongs to nobody, and sums to the Shared habits row', () => {
    const entries = buildSharedPointsLedger(habits, WEEK_START, WEEK_END, TODAY);

    expect(entries.map(e => [e.habitTitle, e.date])).toEqual([['Dishes', '2026-07-29']]);
    expect(sumPointsLedger(entries)).toBe(
      calculateHouseholdShareForDateRange(habits, WEEK_START, WEEK_END, TODAY),
    );
  });

  it('itemizes a household-credit completion, which writes no attribution at all', () => {
    const together = makeHabit({
      id: 'h-dinner',
      title: 'Cook dinner together',
      basePoints: 15,
      creditMode: 'household',
      completedDates: ['2026-07-28'],
    });

    const entries = buildSharedPointsLedger([together], WEEK_START, WEEK_END, TODAY);

    expect(entries).toEqual([
      expect.objectContaining({ habitTitle: 'Cook dinner together', date: '2026-07-28', points: 15 }),
    ]);
  });

  it('leaves assigned chores out — their points never reach the household pool', () => {
    const entries = buildSharedPointsLedger([choreHabit], WEEK_START, WEEK_END, TODAY);
    expect(entries).toEqual([]);
  });

  it('returns nothing for a week with no unattributed points', () => {
    const entries = buildSharedPointsLedger([sharedHabit], WEEK_START, WEEK_END, TODAY);
    expect(entries).toEqual([]);
    expect(sumPointsLedger(entries)).toBe(
      calculateHouseholdShareForDateRange([sharedHabit], WEEK_START, WEEK_END, TODAY),
    );
  });
});

describe('groupPointsLedgerByDate', () => {
  it('groups newest date first with a per-day subtotal', () => {
    const entries = buildMemberPointsLedger(habits, 'paul', WEEK_START, WEEK_END, TODAY);
    const days = groupPointsLedgerByDate(entries);

    expect(days.map(d => d.date)).toEqual(['2026-07-29', '2026-07-28', '2026-07-27']);
    expect(days.map(d => d.points).reduce((a, b) => a + b, 0)).toBe(sumPointsLedger(entries));
    expect(days.find(d => d.date === '2026-07-28')?.entries.map(e => e.habitTitle)).toEqual([
      'Take out trash',
    ]);
  });

  it('returns nothing for an empty ledger', () => {
    expect(groupPointsLedgerByDate([])).toEqual([]);
  });
});
