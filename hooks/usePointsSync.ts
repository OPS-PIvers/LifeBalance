import { useCallback, useEffect, useRef } from 'react';
import { format, startOfWeek } from 'date-fns';
import { Habit } from '@/types/schema';
import {
  computeHouseholdPointsSync,
  type HouseholdPoints,
  type PointsSyncResult,
  type SubmissionTotalsByHabitDate,
} from '@/utils/habitLogic';
import { fetchSubmissionTotals, type GetHabitSubmissions } from '@/utils/habitSubmissionTotals';
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
  /**
   * Reads one habit's stored submissions. Supplied by the household context; the
   * default reads nothing, which degrades to the derived attribution (the
   * pre-submissions behaviour) rather than failing.
   */
  getHabitSubmissions?: GetHabitSubmissions;
  /** Injectable recompute (defaults to the real one) — kept for testability. */
  computePoints?: (
    habits: Habit[],
    currentPoints: HouseholdPoints,
    now: Date,
    submissionTotals?: SubmissionTotalsByHabitDate,
  ) => PointsSyncResult;
  /** Injectable clock (defaults to `new Date`) — kept for testability. */
  now?: () => Date;
}

const defaultNow = (): Date => new Date();
const noSubmissions: GetHabitSubmissions = async () => [];

/**
 * Fingerprint of everything that can change the submissions in `scope`: the
 * household and scored window, plus each tracked habit's identity and last
 * write. Every submission mutation (add/update/delete, and the transaction-fire
 * batch) stamps the habit doc's `lastUpdated`, which arrives on the live
 * listener — so an unchanged fingerprint means the previously fetched totals are
 * still current.
 */
const submissionCacheKey = (habits: Habit[], scope: string): string =>
  habits
    .filter(h => h.hasSubmissionTracking)
    .map(h => `${h.id}@${h.lastUpdated}`)
    .sort()
    .join(',') + `|${scope}`;

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
 * The recompute is submission-aware: before scoring it loads the week's stored
 * submissions for habits flagged `hasSubmissionTracking`, so a back-dated or
 * multi-unit log is credited at what it actually earned instead of the derived
 * one-completion-per-day approximation (which would silently claw those points
 * back on the next login). The read is bounded three ways — tracked habits only,
 * the scored week only, and cached against a habit-write fingerprint so an idle
 * 5-minute tick issues no queries at all.
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
  getHabitSubmissions = noSubmissions,
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

  // Last fetched submission totals + the fingerprint they were fetched for, so
  // the 5-minute scheduler tick re-reads Firestore only when a tracked habit has
  // actually been written (or the scored window rolled over). Without this the
  // recompute would issue one query per tracked habit every 5 minutes forever.
  const submissionCacheRef = useRef<{ key: string; totals: SubmissionTotalsByHabitDate } | null>(null);

  const sync = useCallback(async () => {
    if (!householdId) return;
    const currentHabits = habitsRef.current;
    const currentPoints = pointsRef.current;
    if (!currentPoints || currentHabits.length === 0) return;

    const when = now();
    const today = format(when, 'yyyy-MM-dd');
    // One window covers both halves of the recompute: the daily total scores
    // `today`, the weekly one `weekStart..today` — at most seven days, and only
    // for habits that have ever used the submissions path.
    const weekStart = format(startOfWeek(when, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    const cacheKey = submissionCacheKey(currentHabits, `${householdId}|${weekStart}..${today}`);
    let submissionTotals = submissionCacheRef.current?.key === cacheKey
      ? submissionCacheRef.current.totals
      : undefined;
    if (!submissionTotals) {
      submissionTotals = await fetchSubmissionTotals(currentHabits, weekStart, today, getHabitSubmissions);
      submissionCacheRef.current = { key: cacheKey, totals: submissionTotals };
    }

    const { points: corrected, needsUpdate } = computePoints(
      currentHabits,
      currentPoints,
      when,
      submissionTotals,
    );
    if (!needsUpdate) return; // keeps periodic ticks write-free when nothing drifted

    await writePoints({ ...corrected, today });
  }, [householdId, writePoints, getHabitSubmissions, computePoints, now]);

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
