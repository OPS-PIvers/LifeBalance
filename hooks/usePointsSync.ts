import { useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Habit } from '@/types/schema';
import {
  computeHouseholdPointsSync,
  type HouseholdPoints,
  type PointsSyncResult,
} from '@/utils/habitLogic';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';

/** Payload handed to `writePoints` when the corrective sync needs to persist. */
export interface PointsSyncUpdate extends HouseholdPoints {
  /** Today's date (YYYY-MM-DD) for stamping the reset markers. */
  today: string;
}

interface UsePointsSyncParams {
  householdId: string | null | undefined;
  points: HouseholdPoints | undefined;
  habits: Habit[];
  /** Persists the corrected points + reset markers. Only called when needed. */
  writePoints: (update: PointsSyncUpdate) => void | Promise<void>;
  /** Injectable recompute (defaults to the real one) — kept for testability. */
  computePoints?: (
    habits: Habit[],
    currentPoints: HouseholdPoints,
    now: Date,
  ) => PointsSyncResult;
  /** Injectable clock (defaults to `new Date`) — kept for testability. */
  now?: () => Date;
}

const defaultNow = (): Date => new Date();

/**
 * Owns the corrective household-points sync: it reconciles the per-toggle deltas
 * (written atomically by `useHabitActions`, the source of truth between recalcs)
 * with the canonical recomputation of daily/weekly/total points.
 *
 * The recompute itself is the pure, unit-tested `computeHouseholdPointsSync`.
 * This hook controls *when* it runs:
 *
 *   (a) **Once per household load** (login / household switch) — a `ref` keyed on
 *       `householdId` ensures it runs a single time once habits + points are
 *       available, and again only when the household changes.
 *   (b) **On the midnight/periodic scheduler** — so drift accumulated during a
 *       long-lived session is corrected without a page reload. The internal
 *       `needsUpdate` short-circuit keeps periodic ticks write-free when nothing
 *       has drifted.
 *
 * Crucially, the latest `habits`/`points` are read through refs at sync time, so
 * the points write this hook produces does NOT re-trigger it: a habit toggle
 * writes a correct delta and must never cause an O(habits × dates) recompute.
 *
 * (Implements the structure shipped for todo #11; this extraction makes the
 * recompute unit-testable and the "no recompute on toggle" guarantee provable —
 * see hooks/usePointsSync.test.tsx.)
 */
export const usePointsSync = ({
  householdId,
  points,
  habits,
  writePoints,
  computePoints = computeHouseholdPointsSync,
  now = defaultNow,
}: UsePointsSyncParams): void => {
  // Latest values, read at sync time. Using refs (rather than closing over the
  // props) is what lets the periodic scheduler and the once-per-load effect see
  // fresh data while keeping `sync`'s identity stable enough that the sync's own
  // points write doesn't re-trigger a recompute. Updated in an effect (not during
  // render) and declared before the consumers below so they read fresh values.
  const habitsRef = useRef(habits);
  const pointsRef = useRef(points);
  useEffect(() => {
    habitsRef.current = habits;
    pointsRef.current = points;
  }, [habits, points]);

  const sync = useCallback(async () => {
    if (!householdId) return;
    const currentHabits = habitsRef.current;
    const currentPoints = pointsRef.current;
    if (!currentPoints || currentHabits.length === 0) return;

    const when = now();
    const { points: corrected, needsUpdate } = computePoints(
      currentHabits,
      currentPoints,
      when,
    );
    if (!needsUpdate) return; // keeps periodic ticks write-free when nothing drifted

    await writePoints({ ...corrected, today: format(when, 'yyyy-MM-dd') });
  }, [householdId, writePoints, computePoints, now]);

  // (a) Run once per household load. The guard ref keyed on householdId means a
  //     new household / re-login re-triggers the sync without resetting state.
  const syncedHouseholdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!householdId || !points || habits.length === 0) return;
    if (syncedHouseholdRef.current === householdId) return;
    syncedHouseholdRef.current = householdId;
    void sync();
  }, [householdId, points, habits.length, sync]);

  // (b) Periodic/midnight re-sync. A small initial delay staggers it after
  //     checkPointsReset (which stamps reset markers on day/week rollover).
  useMidnightScheduler(sync, !!householdId, { initialDelayMs: 200 });
};
