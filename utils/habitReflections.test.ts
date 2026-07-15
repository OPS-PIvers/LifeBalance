import { describe, it, expect } from 'vitest';
import { selectRecentReflections } from '@/utils/habitReflections';
import { HabitSubmission } from '@/types/schema';

const baseSubmission = (overrides: Partial<HabitSubmission>): HabitSubmission => ({
  id: 'sub-1',
  habitId: 'habit-1',
  habitTitle: 'Read',
  timestamp: '2026-07-10T20:00:00.000Z',
  date: '2026-07-10',
  count: 1,
  pointsEarned: 10,
  streakDaysAtTime: 3,
  multiplierApplied: 1.5,
  createdBy: 'user-1',
  createdAt: '2026-07-10T20:00:00.000Z',
  ...overrides,
});

describe('selectRecentReflections', () => {
  it('excludes submissions without a note or mood', () => {
    const submissions = [
      baseSubmission({ id: '1' }),
      baseSubmission({ id: '2', mood: 'great' }),
    ];
    const result = selectRecentReflections(submissions);
    expect(result).toEqual([{ habitTitle: 'Read', mood: 'great' }]);
  });

  it('sorts newest-first by createdAt', () => {
    const submissions = [
      baseSubmission({ id: '1', createdAt: '2026-07-01T00:00:00.000Z', mood: 'meh' }),
      baseSubmission({ id: '2', createdAt: '2026-07-10T00:00:00.000Z', mood: 'great' }),
      baseSubmission({ id: '3', createdAt: '2026-07-05T00:00:00.000Z', mood: 'good' }),
    ];
    const result = selectRecentReflections(submissions);
    expect(result.map(r => r.mood)).toEqual(['great', 'good', 'meh']);
  });

  it('bounds the result to the given limit', () => {
    const submissions = Array.from({ length: 10 }, (_, i) =>
      baseSubmission({ id: `${i}`, createdAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, mood: 'good' })
    );
    expect(selectRecentReflections(submissions, 5)).toHaveLength(5);
    // Default limit is 5.
    expect(selectRecentReflections(submissions)).toHaveLength(5);
  });

  it('truncates a long note for the AI prompt payload', () => {
    const longNote = 'a'.repeat(200);
    const result = selectRecentReflections([baseSubmission({ note: longNote })]);
    expect(result[0]?.note).toHaveLength(80);
  });

  it('includes both mood and a short note together', () => {
    const result = selectRecentReflections([baseSubmission({ mood: 'rough', note: 'Tough day' })]);
    expect(result).toEqual([{ habitTitle: 'Read', mood: 'rough', note: 'Tough day' }]);
  });

  it('returns an empty array when nothing has a note or mood', () => {
    expect(selectRecentReflections([baseSubmission({})])).toEqual([]);
  });
});
