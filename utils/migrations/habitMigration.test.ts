import { describe, it, expect, vi } from 'vitest';
import { needsHabitMigration } from './habitMigration';
import { Habit } from '@/types/schema';

// Mock the preset habits data
vi.mock('@/data/presetHabits', () => ({
  PRESET_HABITS: [
    { id: 'preset_valid_1' },
    { id: 'preset_valid_2' }
  ]
}));

// Mock firebase config to prevent initialization
vi.mock('@/firebase.config', () => ({
  db: {}
}));

describe('needsHabitMigration', () => {
  // Helper to create a partial habit for testing
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
    weatherSensitive: false,
    ...overrides
  } as Habit);

  it('should return false if all habits have valid presetIds', () => {
    const habits = [
      createHabit({ presetId: 'preset_valid_1', isCustom: false }),
      createHabit({ presetId: 'preset_valid_2', isCustom: false })
    ];
    expect(needsHabitMigration(habits)).toBe(false);
  });

  it('should return false if orphaned habit is already custom', () => {
    const habits = [
      createHabit({ presetId: 'preset_removed_old', isCustom: true })
    ];
    expect(needsHabitMigration(habits)).toBe(false);
  });

  it('should return false if habit is custom and has no presetId', () => {
    const habits = [
      createHabit({ isCustom: true }) // presetId undefined
    ];
    expect(needsHabitMigration(habits)).toBe(false);
  });

  it('should return true if a habit has an invalid presetId and is not custom', () => {
    const habits = [
      createHabit({ presetId: 'preset_valid_1', isCustom: false }),
      createHabit({ presetId: 'preset_removed_one', isCustom: false }) // Orphan
    ];
    expect(needsHabitMigration(habits)).toBe(true);
  });

  it('should handle empty habits array', () => {
    expect(needsHabitMigration([])).toBe(false);
  });
});
