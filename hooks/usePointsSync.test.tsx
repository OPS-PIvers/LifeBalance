import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePointsSync, type PointsSyncUpdate } from './usePointsSync';
import { Habit, HabitSubmission } from '@/types/schema';
import type { HouseholdPoints, PointsSyncResult, SubmissionTotalsByHabitDate } from '@/utils/habitLogic';
import type { GetHabitSubmissions } from '@/utils/habitSubmissionTotals';

// A minimal habit; the hook delegates the actual recompute to `computePoints`,
// so the habit contents only matter for the injected stub below.
const habit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h1',
    title: 'Test',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 1,
    count: 1,
    totalCount: 1,
    completedDates: ['2025-06-09'],
    streakDays: 1,
    lastUpdated: '2025-06-09T12:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  }) as Habit;

const submission = (overrides: Partial<HabitSubmission> = {}): HabitSubmission =>
  ({
    id: 's1',
    habitId: 'h1',
    habitTitle: 'Test',
    timestamp: '2025-06-09T12:00:00.000Z',
    date: '2025-06-09',
    count: 2,
    pointsEarned: 20,
    streakDaysAtTime: 1,
    multiplierApplied: 1,
    createdBy: 'u1',
    createdAt: '2025-06-09T12:00:00.000Z',
    ...overrides,
  }) as HabitSubmission;

const fixedNow = () => new Date(2025, 5, 9, 12, 0, 0); // Mon 2025-06-09

type ComputePoints = (
  habits: Habit[],
  currentPoints: HouseholdPoints,
  now: Date,
  submissionTotals?: SubmissionTotalsByHabitDate,
) => PointsSyncResult;

interface Props {
  householdId: string | null | undefined;
  points: HouseholdPoints | undefined;
  habits: Habit[];
  writePoints: (update: PointsSyncUpdate) => void | Promise<void>;
  getHabitSubmissions?: GetHabitSubmissions;
  computePoints: ComputePoints;
  now: () => Date;
}

/** The sync awaits the submission fetch, so assertions must flush microtasks. */
const flush = () => act(async () => { await Promise.resolve(); });

describe('usePointsSync', () => {
  let writePoints: ReturnType<typeof vi.fn<(update: PointsSyncUpdate) => void>>;
  let computePoints: ReturnType<typeof vi.fn<ComputePoints>>;

  beforeEach(() => {
    writePoints = vi.fn<(update: PointsSyncUpdate) => void>();
    computePoints = vi.fn<ComputePoints>(() => ({
      points: { daily: 10, weekly: 10, total: 10 },
      needsUpdate: true,
    }));
  });

  const baseProps = (): Props => ({
    householdId: 'hh1',
    points: { daily: 0, weekly: 0, total: 0 },
    habits: [habit()],
    writePoints,
    computePoints,
    now: fixedNow,
  });

  it('runs the corrective sync once when a household first loads', async () => {
    renderHook(() => usePointsSync(baseProps()));
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledWith({
      daily: 10,
      weekly: 10,
      total: 10,
      today: '2025-06-09',
    });
  });

  it('does not recompute or write again when a habit toggle changes points/habits', async () => {
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: baseProps(),
    });
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);

    // Simulate a habit toggle: its atomic batch already bumped points, and the
    // habit's count/completedDates changed — both new object identities that
    // re-fire the effect. The corrective sync must NOT recompute or write again.
    rerender({
      ...baseProps(),
      points: { daily: 10, weekly: 10, total: 10 },
      habits: [habit({ count: 2, totalCount: 2 })],
    });
    await flush();

    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
  });

  it('does not write when stored points already match (no update needed)', async () => {
    computePoints.mockReturnValue({
      points: { daily: 10, weekly: 10, total: 10 },
      needsUpdate: false,
    });
    renderHook(() => usePointsSync(baseProps()));
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).not.toHaveBeenCalled();
  });

  it('re-runs the corrective sync when the household changes', async () => {
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: baseProps(),
    });
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(1);

    rerender({ ...baseProps(), householdId: 'hh2' });
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(2);
    expect(writePoints).toHaveBeenCalledTimes(2);
  });

  it('does not run until habits and points are loaded', async () => {
    const unloaded: Props = { ...baseProps(), habits: [], points: undefined };
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: unloaded,
    });
    await flush();
    expect(computePoints).not.toHaveBeenCalled();

    // Points arrive but habits still empty → still waiting.
    const pointsOnly: Props = {
      ...baseProps(),
      habits: [],
      points: { daily: 0, weekly: 0, total: 0 },
    };
    rerender(pointsOnly);
    await flush();
    expect(computePoints).not.toHaveBeenCalled();

    // Habits load → runs exactly once.
    rerender(baseProps());
    await flush();
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
  });

  describe('stored submissions', () => {
    it('reads nothing when no habit has ever used the submissions path', async () => {
      const getHabitSubmissions = vi.fn<GetHabitSubmissions>(async () => []);
      renderHook(() => usePointsSync({ ...baseProps(), getHabitSubmissions }));
      await flush();

      expect(getHabitSubmissions).not.toHaveBeenCalled();
      // Still scored — just with an empty map, i.e. the derived attribution.
      expect(computePoints.mock.calls[0]?.[3]?.size).toBe(0);
    });

    it('feeds the week of stored submissions into the recompute', async () => {
      const getHabitSubmissions = vi.fn<GetHabitSubmissions>(async () => [submission()]);
      renderHook(() =>
        usePointsSync({
          ...baseProps(),
          habits: [habit({ hasSubmissionTracking: true })],
          getHabitSubmissions,
        })
      );
      await flush();

      // Bounded to the scored week (Mon 2025-06-09 → today), not full history.
      expect(getHabitSubmissions).toHaveBeenCalledWith('h1', '2025-06-09', '2025-06-09');
      expect(computePoints.mock.calls[0]?.[3]?.get('h1')?.get('2025-06-09')).toEqual({
        count: 2,
        points: 20,
      });
    });
  });

  describe('periodic re-sync', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-syncs on the midnight/periodic scheduler tick after a long session', async () => {
      // No drift, so ticks are write-free — this isolates the recompute count.
      computePoints.mockReturnValue({
        points: { daily: 0, weekly: 0, total: 0 },
        needsUpdate: false,
      });

      renderHook(() => usePointsSync(baseProps()));
      // Once-per-load recompute fires on the next microtask.
      await flush();
      expect(computePoints).toHaveBeenCalledTimes(1);

      // Advance past the scheduler's 200ms initial delay → its immediate run.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(computePoints.mock.calls.length).toBeGreaterThanOrEqual(2);
      // needsUpdate is false, so no writes despite the extra recompute.
      expect(writePoints).not.toHaveBeenCalled();
    });

    it('does not re-read submissions on an idle tick, but does after a habit write', async () => {
      computePoints.mockReturnValue({
        points: { daily: 0, weekly: 0, total: 0 },
        needsUpdate: false,
      });
      const getHabitSubmissions = vi.fn<GetHabitSubmissions>(async () => [submission()]);
      const tracked = (lastUpdated: string) =>
        [habit({ hasSubmissionTracking: true, lastUpdated })] as Habit[];

      const { rerender } = renderHook((props: Props) => usePointsSync(props), {
        initialProps: {
          ...baseProps(),
          habits: tracked('2025-06-09T12:00:00.000Z'),
          getHabitSubmissions,
        },
      });
      await flush();
      expect(getHabitSubmissions).toHaveBeenCalledTimes(1);

      // Several scheduler ticks with nothing written: the cached totals are
      // still current, so the recompute stays submission-aware for free.
      await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60 * 1000); });
      expect(computePoints.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(getHabitSubmissions).toHaveBeenCalledTimes(1);

      // A submission mutation stamps the habit doc's lastUpdated, which arrives
      // on the live listener → the next tick must refetch.
      rerender({
        ...baseProps(),
        habits: tracked('2025-06-09T18:00:00.000Z'),
        getHabitSubmissions,
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
      expect(getHabitSubmissions).toHaveBeenCalledTimes(2);
    });
  });
});
