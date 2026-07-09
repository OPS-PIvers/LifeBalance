import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePointsSync, type PointsSyncUpdate } from './usePointsSync';
import { Habit } from '@/types/schema';
import type { HouseholdPoints, PointsSyncResult } from '@/utils/habitLogic';

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

const fixedNow = () => new Date(2025, 5, 9, 12, 0, 0); // Mon 2025-06-09

interface Props {
  householdId: string | null | undefined;
  points: HouseholdPoints | undefined;
  habits: Habit[];
  writePoints: (update: PointsSyncUpdate) => void | Promise<void>;
  computePoints: (
    habits: Habit[],
    currentPoints: HouseholdPoints,
    now: Date,
  ) => PointsSyncResult;
  now: () => Date;
}

describe('usePointsSync', () => {
  let writePoints: ReturnType<typeof vi.fn<(update: PointsSyncUpdate) => void>>;
  let computePoints: ReturnType<
    typeof vi.fn<(habits: Habit[], currentPoints: HouseholdPoints, now: Date) => PointsSyncResult>
  >;

  beforeEach(() => {
    writePoints = vi.fn<(update: PointsSyncUpdate) => void>();
    computePoints = vi.fn<
      (habits: Habit[], currentPoints: HouseholdPoints, now: Date) => PointsSyncResult
    >(() => ({
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

  it('runs the corrective sync once when a household first loads', () => {
    renderHook(() => usePointsSync(baseProps()));
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledWith({
      daily: 10,
      weekly: 10,
      total: 10,
      today: '2025-06-09',
    });
  });

  it('does not recompute or write again when a habit toggle changes points/habits', () => {
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: baseProps(),
    });
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

    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
  });

  it('does not write when stored points already match (no update needed)', () => {
    computePoints.mockReturnValue({
      points: { daily: 10, weekly: 10, total: 10 },
      needsUpdate: false,
    });
    renderHook(() => usePointsSync(baseProps()));
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).not.toHaveBeenCalled();
  });

  it('re-runs the corrective sync when the household changes', () => {
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: baseProps(),
    });
    expect(computePoints).toHaveBeenCalledTimes(1);

    rerender({ ...baseProps(), householdId: 'hh2' });
    expect(computePoints).toHaveBeenCalledTimes(2);
    expect(writePoints).toHaveBeenCalledTimes(2);
  });

  it('does not run until habits and points are loaded', () => {
    const unloaded: Props = { ...baseProps(), habits: [], points: undefined };
    const { rerender } = renderHook((props: Props) => usePointsSync(props), {
      initialProps: unloaded,
    });
    expect(computePoints).not.toHaveBeenCalled();

    // Points arrive but habits still empty → still waiting.
    const pointsOnly: Props = {
      ...baseProps(),
      habits: [],
      points: { daily: 0, weekly: 0, total: 0 },
    };
    rerender(pointsOnly);
    expect(computePoints).not.toHaveBeenCalled();

    // Habits load → runs exactly once.
    rerender(baseProps());
    expect(computePoints).toHaveBeenCalledTimes(1);
    expect(writePoints).toHaveBeenCalledTimes(1);
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
      // Once-per-load recompute fires immediately.
      expect(computePoints).toHaveBeenCalledTimes(1);

      // Advance past the scheduler's 200ms initial delay → its immediate run.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(computePoints.mock.calls.length).toBeGreaterThanOrEqual(2);
      // needsUpdate is false, so no writes despite the extra recompute.
      expect(writePoints).not.toHaveBeenCalled();
    });
  });
});
