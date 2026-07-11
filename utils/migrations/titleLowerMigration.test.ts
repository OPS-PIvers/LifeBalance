import { describe, it, expect, vi } from 'vitest';
import { needsTitleLowerMigration } from './titleLowerMigration';
import { Habit } from '@/types/schema';

// Mock firebase config to prevent initialization
vi.mock('@/firebase.config', () => ({
  db: {}
}));

describe('needsTitleLowerMigration', () => {
  const createHabit = (overrides: Partial<Habit>): Habit => ({
    id: 'test-habit',
    title: 'Test Habit',
    category: 'Health',
    type: 'positive',
    basePoints: 1,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides
  } as Habit);

  it('should return false when every habit already has titleLower', () => {
    const habits = [
      createHabit({ title: 'Read', titleLower: 'read' }),
      createHabit({ title: 'Run', titleLower: 'run' }),
    ];
    expect(needsTitleLowerMigration(habits)).toBe(false);
  });

  it('should return true when a habit is missing titleLower', () => {
    const habits = [
      createHabit({ title: 'Read', titleLower: 'read' }),
      createHabit({ title: 'Run' }),
    ];
    expect(needsTitleLowerMigration(habits)).toBe(true);
  });

  it('should return true when titleLower is an empty string (falsy)', () => {
    const habits = [createHabit({ title: 'Read', titleLower: '' })];
    expect(needsTitleLowerMigration(habits)).toBe(true);
  });

  it('should handle empty habits array', () => {
    expect(needsTitleLowerMigration([])).toBe(false);
  });
});
