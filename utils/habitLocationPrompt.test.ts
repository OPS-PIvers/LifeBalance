import { describe, it, expect } from 'vitest';
import { findLocationMatches } from '@/utils/habitLocationPrompt';
import { Habit, HabitLocationTrigger } from '@/types/schema';

const baseHabit: Habit = {
  id: 'h1',
  title: 'Went into Target',
  category: 'Household',
  type: 'positive',
  basePoints: 5,
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-22T00:00:00.000Z',
};

const target: HabitLocationTrigger = {
  id: 'loc-target',
  name: 'Target',
  lat: 44.9778,
  lng: -93.2650,
  radiusMeters: 150,
};

describe('findLocationMatches', () => {
  it('returns no matches for a habit with no saved locations', () => {
    const matches = findLocationMatches([baseHabit], { lat: 44.9778, lng: -93.2650 }, '2026-07-22', []);
    expect(matches).toEqual([]);
  });

  it('matches a habit whose location contains the current point', () => {
    const habit: Habit = { ...baseHabit, triggers: { locations: [target] } };
    const matches = findLocationMatches([habit], { lat: 44.9778, lng: -93.2650 }, '2026-07-22', []);
    expect(matches).toEqual([
      { habitId: 'h1', habitTitle: 'Went into Target', locationId: 'loc-target', locationName: 'Target' },
    ]);
  });

  it('excludes a location whose radius does not contain the current point', () => {
    const habit: Habit = { ...baseHabit, triggers: { locations: [target] } };
    // ~1.1km away — well outside the 150m radius.
    const matches = findLocationMatches([habit], { lat: 44.9878, lng: -93.2650 }, '2026-07-22', []);
    expect(matches).toEqual([]);
  });

  it('excludes a location already prompted today (dedup)', () => {
    const habit: Habit = { ...baseHabit, triggers: { locations: [target] } };
    const matches = findLocationMatches(
      [habit],
      { lat: 44.9778, lng: -93.2650 },
      '2026-07-22',
      [`geo:${target.id}:2026-07-22`],
    );
    expect(matches).toEqual([]);
  });

  it('re-allows the prompt on a new day (dedup key includes the date)', () => {
    const habit: Habit = { ...baseHabit, triggers: { locations: [target] } };
    const matches = findLocationMatches(
      [habit],
      { lat: 44.9778, lng: -93.2650 },
      '2026-07-23',
      [`geo:${target.id}:2026-07-22`],
    );
    expect(matches).toHaveLength(1);
  });

  it('matches multiple habits sharing overlapping coordinates independently', () => {
    const habitA: Habit = { ...baseHabit, id: 'h1', triggers: { locations: [target] } };
    const habitB: Habit = {
      ...baseHabit,
      id: 'h2',
      title: 'Impulse purchase',
      triggers: { locations: [{ ...target, id: 'loc-target-2' }] },
    };
    const matches = findLocationMatches([habitA, habitB], { lat: 44.9778, lng: -93.2650 }, '2026-07-22', []);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.habitId)).toEqual(['h1', 'h2']);
  });
});
