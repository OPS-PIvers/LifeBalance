import { describe, it, expect, vi, afterEach } from 'vitest';
import { presetToHabit, buildCheckingAccount, generateId } from './onboardingSeed';
import type { PresetHabit } from '@/data/presetHabits';

const positivePreset: PresetHabit = {
  id: 'preset_make_bed',
  title: 'Make bed',
  category: 'Household',
  type: 'positive',
  effortLevel: 'easy', // easy = 1 point
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  weatherSensitive: false,
  description: 'Start the day with a tidy bed',
};

const negativePreset: PresetHabit = {
  id: 'preset_dinner_out',
  title: 'Go out to dinner',
  category: 'Negative / Avoidance',
  type: 'negative',
  effortLevel: 'very_hard', // very_hard = 5 points
  scoringType: 'incremental',
  period: 'daily',
  targetCount: 1,
  weatherSensitive: false,
};

describe('presetToHabit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts a positive preset into a fresh, empty-state Habit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 10, 30)); // 2026-06-07 local

    const habit = presetToHabit(positivePreset, () => 'fixed-id');

    expect(habit).toEqual({
      id: 'fixed-id',
      title: 'Make bed',
      category: 'Household',
      type: 'positive',
      basePoints: 1, // easy, positive
      scoringType: 'threshold',
      period: 'daily',
      targetCount: 1,
      count: 0,
      totalCount: 0,
      completedDates: [],
      streakDays: 0,
      lastUpdated: '2026-06-07',
      weatherSensitive: false,
      presetId: 'preset_make_bed',
      isCustom: false,
      effortLevel: 'easy',
    });
  });

  it('negates base points for a negative preset', () => {
    const habit = presetToHabit(negativePreset, () => 'id2');
    expect(habit.basePoints).toBe(-5); // very_hard, negative
    expect(habit.type).toBe('negative');
    expect(habit.presetId).toBe('preset_dinner_out');
  });

  it('starts with no streak/history regardless of preset', () => {
    const habit = presetToHabit(positivePreset, () => 'id3');
    expect(habit.count).toBe(0);
    expect(habit.totalCount).toBe(0);
    expect(habit.streakDays).toBe(0);
    expect(habit.completedDates).toEqual([]);
    expect(habit.isCustom).toBe(false);
  });

  it('uses the injected id factory for the client-side id', () => {
    const habit = presetToHabit(positivePreset, () => 'custom-123');
    expect(habit.id).toBe('custom-123');
  });
});

describe('buildCheckingAccount', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a checking account with the given dollar balance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 10, 30));

    const account = buildCheckingAccount(1234.56, () => 'acct-id');

    expect(account).toEqual({
      id: 'acct-id',
      name: 'Checking',
      type: 'checking',
      balance: 1234.56,
      lastUpdated: '2026-06-07',
    });
  });

  it('supports a zero starting balance', () => {
    const account = buildCheckingAccount(0, () => 'acct-zero');
    expect(account.balance).toBe(0);
    expect(account.type).toBe('checking');
  });
});

describe('generateId', () => {
  it('returns a non-empty unique-ish string', () => {
    const a = generateId();
    const b = generateId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
