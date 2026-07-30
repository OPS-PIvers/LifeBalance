import { describe, it, expect, vi } from 'vitest';
import { Habit, HabitSubmission } from '@/types/schema';
import {
  buildSubmissionTotals,
  fetchSubmissionTotals,
  submissionCacheKey,
  type GetHabitSubmissions,
} from './habitSubmissionTotals';

const habit = (id: string, overrides: Partial<Habit> = {}): Habit =>
  ({
    id,
    title: id,
    category: 'Home',
    type: 'positive',
    basePoints: 10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-06-03T12:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  }) as Habit;

const submission = (overrides: Partial<HabitSubmission>): HabitSubmission =>
  ({
    id: 's1',
    habitId: 'h1',
    habitTitle: 'h1',
    timestamp: '2026-06-01T12:00:00.000Z',
    date: '2026-06-01',
    count: 1,
    pointsEarned: 10,
    streakDaysAtTime: 1,
    multiplierApplied: 1,
    createdBy: 'u1',
    createdAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }) as HabitSubmission;

describe('buildSubmissionTotals', () => {
  it('sums several submissions on the same date', () => {
    const totals = buildSubmissionTotals([
      ['h1', [
        submission({ count: 2, pointsEarned: 20 }),
        submission({ id: 's2', count: 1, pointsEarned: 15 }),
      ]],
    ]);
    expect(totals.get('h1')?.get('2026-06-01')).toEqual({ count: 3, points: 35 });
  });

  it('keys separate dates and habits apart', () => {
    const totals = buildSubmissionTotals([
      ['h1', [submission({}), submission({ id: 's2', date: '2026-06-02', count: 4, pointsEarned: 40 })]],
      ['h2', [submission({ habitId: 'h2', count: 7, pointsEarned: 70 })]],
    ]);
    expect(totals.get('h1')?.get('2026-06-02')).toEqual({ count: 4, points: 40 });
    expect(totals.get('h2')?.get('2026-06-01')).toEqual({ count: 7, points: 70 });
  });

  it('omits habits with no submissions, so a lookup miss means "no record"', () => {
    const totals = buildSubmissionTotals([['h1', []]]);
    expect(totals.has('h1')).toBe(false);
  });

  it('keeps a negative habit\'s debits signed', () => {
    const totals = buildSubmissionTotals([
      ['h1', [submission({ count: 2, pointsEarned: -20 })]],
    ]);
    expect(totals.get('h1')?.get('2026-06-01')?.points).toBe(-20);
  });
});

describe('fetchSubmissionTotals', () => {
  it('reads nothing when no habit has ever used the submissions path', async () => {
    const get = vi.fn<GetHabitSubmissions>(async () => []);
    const totals = await fetchSubmissionTotals([habit('h1'), habit('h2')], '2026-06-01', '2026-06-03', get);

    expect(get).not.toHaveBeenCalled();
    expect(totals.size).toBe(0);
  });

  it('reads only the tracked habits, and only the requested window', async () => {
    const get = vi.fn<GetHabitSubmissions>(async () => [submission({})]);
    await fetchSubmissionTotals(
      [habit('h1', { hasSubmissionTracking: true }), habit('h2')],
      '2026-06-01',
      '2026-06-03',
      get,
    );

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('h1', '2026-06-01', '2026-06-03');
  });

  it('degrades to "no record" for a habit whose read came back empty', async () => {
    // getHabitSubmissions swallows its own errors and returns [] — the recompute
    // then falls back to the derived attribution instead of failing outright.
    const get = vi.fn<GetHabitSubmissions>(async habitId =>
      habitId === 'h1' ? [submission({ count: 2, pointsEarned: 20 })] : []
    );
    const totals = await fetchSubmissionTotals(
      [habit('h1', { hasSubmissionTracking: true }), habit('h2', { hasSubmissionTracking: true })],
      '2026-06-01',
      '2026-06-03',
      get,
    );

    expect(totals.get('h1')?.get('2026-06-01')).toEqual({ count: 2, points: 20 });
    expect(totals.has('h2')).toBe(false);
  });
});

// Moved here from hooks/usePointsSync.ts (it was module-private there) so
// ScoreboardWidget/PointsBreakdownDrawer can reuse the same cache-fingerprint
// logic instead of re-fetching submission totals on every habit toggle (a
// fresh `habits` array identity arrives on every Firestore snapshot). See the
// exported function's own doc comment for the soundness argument.
describe('submissionCacheKey', () => {
  it('is stable across a new array identity when no tracked habit changed', () => {
    const habitsA = [habit('h1', { hasSubmissionTracking: true })];
    const habitsB = [habit('h1', { hasSubmissionTracking: true })]; // fresh objects/array
    expect(submissionCacheKey(habitsA, 'scope')).toBe(submissionCacheKey(habitsB, 'scope'));
  });

  it('changes when a tracked habit\'s lastUpdated changes', () => {
    const before = [habit('h1', { hasSubmissionTracking: true, lastUpdated: '2026-06-01T00:00:00.000Z' })];
    const after = [habit('h1', { hasSubmissionTracking: true, lastUpdated: '2026-06-01T06:00:00.000Z' })];
    expect(submissionCacheKey(before, 'scope')).not.toBe(submissionCacheKey(after, 'scope'));
  });

  it('ignores habits that are not flagged hasSubmissionTracking', () => {
    const withUntracked = [
      habit('h1', { hasSubmissionTracking: true }),
      habit('h2', { hasSubmissionTracking: false, lastUpdated: '2026-01-01T00:00:00.000Z' }),
    ];
    const untrackedChanged = [
      habit('h1', { hasSubmissionTracking: true }),
      habit('h2', { hasSubmissionTracking: false, lastUpdated: '2099-01-01T00:00:00.000Z' }),
    ];
    expect(submissionCacheKey(withUntracked, 'scope')).toBe(submissionCacheKey(untrackedChanged, 'scope'));
  });

  it('differs by scope, so different windows/households never collide', () => {
    const habits = [habit('h1', { hasSubmissionTracking: true })];
    expect(submissionCacheKey(habits, 'scope-a')).not.toBe(submissionCacheKey(habits, 'scope-b'));
  });

  it('is order-independent across tracked habits (sorted before joining)', () => {
    const h1 = habit('h1', { hasSubmissionTracking: true });
    const h2 = habit('h2', { hasSubmissionTracking: true });
    expect(submissionCacheKey([h1, h2], 'scope')).toBe(submissionCacheKey([h2, h1], 'scope'));
  });
});
