import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import { format, startOfWeek, subDays } from 'date-fns';
import type { Habit, HouseholdMember, Household } from '@/types/schema';

// --- Firestore mock -------------------------------------------------------
// We capture every batch.update call so the test can assert which point
// counters (daily/weekly/total) were incremented and by how much.

interface CapturedUpdate {
  ref: { __path: string };
  data: Record<string, unknown>;
}

const capturedUpdates: CapturedUpdate[] = [];
const capturedSets: CapturedUpdate[] = [];
const capturedDeletes: { __path: string }[] = [];
let commitCount = 0;
/**
 * Set to make the NEXT batch.commit() reject — how the tests exercise the
 * error-toast paths (a real NOT_FOUND from a ghost member doc would reject the
 * whole all-or-nothing batch exactly like this). Cleared on consumption.
 */
let nextCommitError: Error | null = null;

// increment() returns a tagged sentinel so we can read back the numeric delta.
const incrementMock = vi.fn((n: number) => ({ __increment: n }));

vi.mock('firebase/firestore', () => {
  return {
    // doc(db, path, id?) -> a ref object carrying its path for assertions.
    doc: vi.fn((_db: unknown, path?: string, id?: string) => {
      const ref: Record<string, unknown> = {
        __path: id ? `${path}/${id}` : (path ?? '__autoId'),
        id: id ?? '__autoId',
      };
      // appendActivityLog (F-XCUT-01) chains .withConverter() on a fresh
      // auto-id ref; return the same ref so path/id assertions still hold.
      ref.withConverter = () => ref;
      return ref;
    }),
    collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
    increment: (n: number) => incrementMock(n),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    deleteField: () => ({ __deleteField: true }),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    writeBatch: vi.fn(() => ({
      set: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedSets.push({ ref, data });
      },
      update: (ref: { __path: string }, data: Record<string, unknown>) => {
        capturedUpdates.push({ ref, data });
      },
      delete: (ref: { __path: string }) => {
        capturedDeletes.push(ref);
      },
      commit: vi.fn(async () => {
        if (nextCommitError) {
          const error = nextCommitError;
          nextCommitError = null;
          throw error;
        }
        commitCount++;
      }),
    })),
    // Unused-by-these-tests APIs imported by the hook module.
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
});

vi.mock('@/firebase.config', () => ({ db: {} }));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { useHabitActions } from './useHabitActions';
import { streakForHabit } from '@/utils/habitLogic';
import {
  memberMostRecentUnitDateInPeriod,
  memberPeriodPointsDelta,
  householdPeriodPointsDelta,
  withAttributionDelta,
} from '@/utils/habitAttribution';
// The mocked updateDoc — updateHabit writes via updateDoc(ref, data), not a batch,
// so we read its captured call args to assert on the whitelisted update payload.
// getDocs backs the prior-submissions lookup for back-dated threshold submissions.
import { updateDoc, getDocs, getDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';

const updateDocMock = vi.mocked(updateDoc);
const getDocsMock = vi.mocked(getDocs);
// getDoc backs the stored-submission read in deleteHabitSubmission /
// updateHabitSubmission — the source of the snapshotted `attributedTo`.
const getDocMock = vi.mocked(getDoc);

// Minimal QuerySnapshot stand-in: one doc per prior submission count.
const submissionsSnap = (counts: number[]) =>
  ({ docs: counts.map(c => ({ data: () => ({ count: c }) })) }) as unknown as Awaited<
    ReturnType<typeof getDocs>
  >;

const HOUSEHOLD_ID = 'house1';
const householdPath = `households/${HOUSEHOLD_ID}`;

const currentUser = { uid: 'user1' } as HouseholdMember;
const householdSettings = { points: { daily: 0, weekly: 0, total: 0 } } as unknown as Household;

const baseHabit = (overrides: Partial<Habit>): Habit => ({
  id: 'h1',
  title: 'Read',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  scoringType: 'incremental',
  basePoints: 10,
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: new Date().toISOString(),
  ...overrides,
} as Habit);

const householdUpdate = () =>
  capturedUpdates.find(u => u.ref.__path === householdPath);

const habitUpdate = () =>
  capturedUpdates.find(u => u.ref.__path === `${householdPath}/habits/h1`);

describe('useHabitActions.addHabitSubmission', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  it('credits daily + weekly + total for a submission dated today', async () => {
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    // 1 completion * floor(10 * 1.0 multiplier) = 10
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    expect(hh!.data['points.daily']).toEqual({ __increment: 10 });
    expect(hh!.data['points.weekly']).toEqual({ __increment: 10 });
    expect(commitCount).toBe(1);
  });

  it('does NOT credit daily for a past-dated submission, but does credit total', async () => {
    // A submission three days ago: it is in the past, but still within this week
    // only if today is Thu–Sun. Use a date guaranteed to be a previous day but
    // assert daily is omitted regardless.
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    const pastDate = subDays(new Date(), 3);
    const pastTimestamp = pastDate.toISOString();

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, pastTimestamp);
    });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    // total is always credited (lifetime)
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    // daily must NOT be present for a non-today submission
    expect(hh!.data['points.daily']).toBeUndefined();

    // weekly is present iff the past date falls within the current week
    const today = format(new Date(), 'yyyy-MM-dd');
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const pastStr = format(pastDate, 'yyyy-MM-dd');
    if (pastStr >= weekStart && pastStr <= today) {
      expect(hh!.data['points.weekly']).toEqual({ __increment: 10 });
    } else {
      expect(hh!.data['points.weekly']).toBeUndefined();
    }

    // A back-dated submission must not bump today's live counter — only the
    // lifetime total absorbs the count.
    expect(habitUpdate()!.data['count']).toBe(0);
    expect(habitUpdate()!.data['totalCount']).toBe(1);
  });

  it('credits the same value across daily, weekly and total within ONE batch commit', async () => {
    // Guards the T1 invariant from the writer side: a single submission is the
    // sole points write (one commit, one household update), with no separate
    // recompute write piggy-backing on it.
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const householdUpdates = capturedUpdates.filter(u => u.ref.__path === householdPath);
    expect(householdUpdates).toHaveLength(1);
    expect(commitCount).toBe(1);
  });

  it('uses the PROSPECTIVE streak (including the new day) for the multiplier', async () => {
    // Habit completed the previous two days. Adding today makes a 3-day streak,
    // which yields the 1.5x daily multiplier. Pre-submission streak would be 2
    // (1.0x) — the bug. So the SUBMISSION records floor(10 * 1.5) = 15.
    //
    // Stage 1.5: the pool now receives the logging MEMBER's award instead. The
    // habit's two prior days are grandfathered (no attribution), so the logger's
    // own chain starts today at 1.0× → 10. The prospective-streak contract lives
    // on in `submission.streakDaysAtTime`/`multiplierApplied`, asserted here.
    const today = new Date();
    const y1 = format(subDays(today, 1), 'yyyy-MM-dd');
    const y2 = format(subDays(today, 2), 'yyyy-MM-dd');
    const habit = baseHabit({ completedDates: [y1, y2], count: 0 });

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const submission = capturedSets[0]!.data as { streakDaysAtTime: number; multiplierApplied: number; pointsEarned: number };
    expect(submission.streakDaysAtTime).toBe(3);
    expect(submission.multiplierApplied).toBe(1.5);
    expect(submission.pointsEarned).toBe(15);

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    expect(hh!.data['points.daily']).toEqual({ __increment: 10 });
  });

  it('credits the pool the LOGGER’s own award once their chain has built up', async () => {
    // Same two prior days, but this time they are attributed to the logger — so
    // their personal streak reaches 3 and the pool gets the 1.5× award (15),
    // matching what the submission itself records.
    const today = new Date();
    const y1 = format(subDays(today, 1), 'yyyy-MM-dd');
    const y2 = format(subDays(today, 2), 'yyyy-MM-dd');
    const habit = baseHabit({
      completedDates: [y1, y2],
      count: 0,
      completedBy: { [y1]: { [currentUser.uid]: 1 }, [y2]: { [currentUser.uid]: 1 } },
    });

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 15 });
  });
});

describe('useHabitActions.addHabitSubmission (threshold completion gating)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
  });

  it('does NOT mark the date complete when a threshold submission is below target', async () => {
    // Target 3, logging 1: no points (already correct), and the date must NOT
    // enter completedDates — otherwise the corrective recompute later awards
    // full threshold points for a day the target was never met.
    const habit = baseHabit({ scoringType: 'threshold', targetCount: 3, count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    expect(householdUpdate()).toBeUndefined();
    const hu = habitUpdate();
    expect(hu).toBeDefined();
    // No delta written at all when the date isn't newly completed
    // (stale-cache clobber guard: never the locally-computed array).
    expect(hu!.data['completedDates']).toBeUndefined();
    expect(hu!.data['streakDays']).toBe(0);
    expect(hu!.data['count']).toBe(1);
  });

  it('marks the date complete and awards points when the submission reaches target', async () => {
    const habit = baseHabit({ scoringType: 'threshold', targetCount: 2, count: 1 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const today = format(new Date(), 'yyyy-MM-dd');
    const hu = habitUpdate();
    expect(hu).toBeDefined();
    // arrayUnion delta, not a locally-computed array (stale-cache clobber guard).
    expect(hu!.data['completedDates']).toEqual({ __arrayUnion: [today] });
    expect(hu!.data['count']).toBe(2);
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 10 });
  });
});

describe('useHabitActions.addHabitSubmission (back-dated submissions)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
    getDocsMock.mockResolvedValue(submissionsSnap([]));
  });

  const yesterday = () => format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const yesterdayTimestamp = () => `${yesterday()}T12:00:00`;

  it('does not bump the live period counter for a back-dated submission', async () => {
    // Daily threshold habit not yet done today: back-logging yesterday must not
    // make today's counter read 1 (which would mark today complete and rob the
    // genuine completion of its points).
    const habit = baseHabit({ scoringType: 'threshold', targetCount: 1, count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, yesterdayTimestamp());
    });

    const hu = habitUpdate();
    expect(hu).toBeDefined();
    expect(hu!.data['count']).toBe(0);
    expect(hu!.data['totalCount']).toBe(1);
    // arrayUnion delta, not a locally-computed array (stale-cache clobber guard).
    expect(hu!.data['completedDates']).toEqual({ __arrayUnion: [yesterday()] });
    expect(hu!.data['streakDays']).toBe(1);

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    expect(hh!.data['points.daily']).toBeUndefined();
  });

  it('awards a back-dated threshold completion even when the habit is already complete today', async () => {
    // habit.count (today's live counter) says nothing about yesterday: target
    // attainment must be evaluated against yesterday's own recorded counts.
    const today = format(new Date(), 'yyyy-MM-dd');
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [today],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, yesterdayTimestamp());
    });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });

    const hu = habitUpdate();
    expect(hu!.data['count']).toBe(1);
    // Only the newly-completed day is unioned; today was already present.
    expect(hu!.data['completedDates']).toEqual({ __arrayUnion: [yesterday()] });
    expect(hu!.data['streakDays']).toBe(2);
  });

  it('does not re-award a past day already completed via the toggle path', async () => {
    // Yesterday was completed by toggling (so it left no submission docs and its
    // counter has since reset). Back-logging a submission for it must not pay twice.
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 0,
      completedDates: [yesterday()],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, yesterdayTimestamp());
    });

    expect(householdUpdate()).toBeUndefined();
    // Already completed → unchanged → no completedDates field written at all.
    expect(habitUpdate()!.data['completedDates']).toBeUndefined();
  });

  it("sums the back-dated day's prior submissions to decide target attainment", async () => {
    // Yesterday already has submissions totalling 2 of a 3-target: logging 1
    // more for yesterday crosses the target and completes THAT day.
    getDocsMock.mockResolvedValue(submissionsSnap([2]));
    const habit = baseHabit({ scoringType: 'threshold', targetCount: 3, count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, yesterdayTimestamp());
    });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    // arrayUnion delta, not a locally-computed array (stale-cache clobber guard).
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [yesterday()] });
    expect(habitUpdate()!.data['count']).toBe(0);
  });
});

describe('useHabitActions.addHabitSubmission (Plan 080c: assigned chores credit the assignee)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  it("credits the assignee's member doc, not the shared household pool", async () => {
    const habit = baseHabit({ id: 'h1', completedDates: [], assignedTo: 'kid_leo' });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const memberUpd = capturedUpdates.find(
      u => u.ref.__path === `${householdPath}/members/kid_leo`,
    );
    expect(memberUpd).toBeDefined();
    expect(memberUpd!.data['points.total']).toEqual({ __increment: 10 });
    // The shared household pool must NOT receive the kid's chore points.
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
  });
});

describe('useHabitActions.addHabitSubmission (negative habits are DEBITED)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
    getDocsMock.mockResolvedValue(submissionsSnap([]));
  });

  it('debits points for a negative habit stored with POSITIVE basePoints', async () => {
    // HabitFormModal convention: basePoints 2, type 'negative'. The bug this
    // guards: reading basePoints raw AWARDED +2 for logging a bad habit.
    const habit = baseHabit({ type: 'negative', basePoints: 2, completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: -2 });
    expect(hh!.data['points.daily']).toEqual({ __increment: -2 });
    // The stored submission carries the signed value too, so a later
    // delete/clear reverses exactly what was credited.
    expect(capturedSets[0]!.data['pointsEarned']).toBe(-2);
  });

  it('debits points for a negative habit stored with NEGATIVE basePoints (wizard convention)', async () => {
    const habit = baseHabit({ type: 'negative', basePoints: -2, completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });

    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -2 });
    expect(capturedSets[0]!.data['pointsEarned']).toBe(-2);
  });
});

describe('useHabitActions.resetHabitDay', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
  });

  const yesterday = () => format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // QuerySnapshot stand-in for the day's submissions, with refs for batch.delete.
  const daySubmissionsSnap = (subs: { count: number; pointsEarned: number }[]) =>
    ({
      empty: subs.length === 0,
      docs: subs.map((s, i) => ({
        data: () => s,
        ref: { __path: `${householdPath}/habits/h1/submissions/s${i}` },
      })),
    }) as unknown as Awaited<ReturnType<typeof getDocs>>;

  it('deletes the day submissions and reverses EXACTLY their stored points', async () => {
    // A wrongly-credited negative-habit day (pre-repair, +2 was stored):
    // clearing it must subtract the +2 that was actually credited — reversal
    // always mirrors the stored value, never a recomputed one.
    getDocsMock.mockResolvedValue(daySubmissionsSnap([{ count: 1, pointsEarned: 2 }]));
    const habit = baseHabit({
      type: 'negative',
      basePoints: 2,
      completedDates: [yesterday()],
      totalCount: 1,
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', yesterday());
    });

    expect(capturedDeletes).toHaveLength(1);
    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: -2 });
    // Past date: no daily reversal.
    expect(hh!.data['points.daily']).toBeUndefined();

    const hu = habitUpdate();
    // arrayRemove delta, not a locally-computed array (stale-cache clobber guard).
    expect(hu!.data['completedDates']).toEqual({ __arrayRemove: [yesterday()] });
    expect(hu!.data['totalCount']).toBe(0);
    expect(hu!.data['streakDays']).toBe(0);
    expect(commitCount).toBe(1);
  });

  it('reverses a toggle-path day (no submissions) with the derived per-date points', async () => {
    getDocsMock.mockResolvedValue(daySubmissionsSnap([]));
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      completedDates: [yesterday()],
      totalCount: 1,
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', yesterday());
    });

    expect(capturedDeletes).toHaveLength(0);
    const hh = householdUpdate();
    expect(hh).toBeDefined();
    // Yesterday's threshold completion earned floor(10 * 1.0) = +10 → reverse it.
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });
    // arrayRemove delta, not a locally-computed array (stale-cache clobber guard).
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayRemove: [yesterday()] });
  });

  it('does nothing when the day has no submissions and no completion', async () => {
    getDocsMock.mockResolvedValue(daySubmissionsSnap([]));
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', yesterday());
    });

    expect(commitCount).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("reverses an assigned chore's points on the assignee's member doc", async () => {
    getDocsMock.mockResolvedValue(daySubmissionsSnap([{ count: 1, pointsEarned: 5 }]));
    const habit = baseHabit({
      assignedTo: 'kid_leo',
      completedDates: [yesterday()],
      totalCount: 1,
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', yesterday());
    });

    const memberUpd = capturedUpdates.find(
      u => u.ref.__path === `${householdPath}/members/kid_leo`,
    );
    expect(memberUpd).toBeDefined();
    expect(memberUpd!.data['points.total']).toEqual({ __increment: -5 });
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
  });
});

describe('useHabitActions.resetHabit (period-scoped date removal)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  const todayStr = () => format(new Date(), 'yyyy-MM-dd');
  const weekStart = () => startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekStartStr = () => format(weekStart(), 'yyyy-MM-dd');
  // Sunday of the PREVIOUS ISO week — must survive a current-week reset.
  const lastWeekStr = () => format(subDays(weekStart(), 1), 'yyyy-MM-dd');
  // All distinct current-ISO-week completion days used in the fixtures
  // (weekStart + today collapse to one entry on Mondays).
  const currentWeekDates = () => [...new Set([weekStartStr(), todayStr()])];

  it('weekly mid-week reset removes ALL current-week dates but keeps prior weeks', async () => {
    const habit = baseHabit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [lastWeekStr(), ...currentWeekDates()],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    const hu = habitUpdate();
    expect(hu).toBeDefined();
    // arrayRemove delta covering the WHOLE current ISO week — leaving earlier-
    // in-week dates behind would let calculatePointsForDateRange re-credit the
    // points this reset reverses. Last week's date is NOT removed.
    expect(hu!.data['completedDates']).toEqual({ __arrayRemove: currentWeekDates() });
    expect(hu!.data['count']).toBe(0);
    // Streak recomputed from the remainder (only last week's completion).
    expect(hu!.data['streakDays']).toBe(
      streakForHabit({ period: 'weekly', completedDates: [lastWeekStr()] })
    );

    // Points reversal matches what the week credited: the completing toggle was
    // awarded at the 2-consecutive-week streak (1.5x) → floor(10 * 1.5) = 15.
    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: -15 });
    expect(hh!.data['points.daily']).toEqual({ __increment: -15 });
    expect(hh!.data['points.weekly']).toEqual({ __increment: -15 });
    expect(commitCount).toBe(1);
  });

  it('weekly reset with only current-week completions reverses the 1.0x award', async () => {
    const habit = baseHabit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: currentWeekDates(),
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(habitUpdate()!.data['completedDates']).toEqual({
      __arrayRemove: currentWeekDates(),
    });
    expect(habitUpdate()!.data['streakDays']).toBe(0);
    // 1-week streak → 1.0x → floor(10 * 1.0) = 10 reversed.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('daily reset still removes only today', async () => {
    const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [yesterdayStr, todayStr()],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    const hu = habitUpdate();
    expect(hu!.data['completedDates']).toEqual({ __arrayRemove: [todayStr()] });
    // 2-day streak reversed to yesterday-only.
    expect(hu!.data['streakDays']).toBe(
      streakForHabit({ period: 'daily', completedDates: [yesterdayStr] })
    );
    // Today's completing toggle was awarded at the 2-day streak (1.0x) → -10.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('omits completedDates entirely when there is nothing to remove', async () => {
    // Threshold habit with partial progress: count > 0 but the target was never
    // reached, so today never entered completedDates and no points were awarded.
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 3,
      count: 1,
      completedDates: [],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    const hu = habitUpdate();
    expect(hu).toBeDefined();
    expect(hu!.data['count']).toBe(0);
    // arrayRemove needs >= 1 value; the field must be absent, not an empty delta.
    expect('completedDates' in hu!.data).toBe(false);
    // No points were credited, so none are reversed.
    expect(householdUpdate()).toBeUndefined();
  });
});

describe('useHabitActions.toggleHabit (T1: single points write path)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  it('writes the points delta exactly once, in a single batch commit', async () => {
    // A toggle must atomically write its own correct delta and nothing else — the
    // drift-correcting recompute is decoupled from the points write (T1), so a
    // toggle never triggers a second recompute write.
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    const householdUpdates = capturedUpdates.filter(u => u.ref.__path === householdPath);
    expect(householdUpdates).toHaveLength(1);
    expect(householdUpdates[0]!.data['points.total']).toEqual({ __increment: 10 });
    expect(householdUpdates[0]!.data['points.daily']).toEqual({ __increment: 10 });
    expect(householdUpdates[0]!.data['points.weekly']).toEqual({ __increment: 10 });
    expect(commitCount).toBe(1);
  });

  it('writes completedDates as an arrayUnion delta on an up-toggle', async () => {
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    const today = format(new Date(), 'yyyy-MM-dd');
    // arrayUnion delta, not a locally-computed array (stale-cache clobber guard).
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [today] });
  });

  it('writes completedDates as an arrayRemove delta on a down-toggle that un-completes today', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const habit = baseHabit({ completedDates: [today], count: 1, totalCount: 1 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    // arrayRemove delta, not a locally-computed array (stale-cache clobber guard).
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayRemove: [today] });
  });

  it('omits completedDates entirely when a toggle does not change it', async () => {
    // Threshold habit with target 3: the first up-toggle (count 0→1) does not
    // complete the day, so no completedDates delta may be written.
    const habit = baseHabit({ scoringType: 'threshold', targetCount: 3, completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    expect(habitUpdate()).toBeDefined();
    expect(habitUpdate()!.data['completedDates']).toBeUndefined();
  });
});

// Per-member habit points (stage 1): the dual write. A toggle must, in ONE
// batch, (a) bump `completedBy.<date>.<uid>` by a dot-path increment,
// (b) credit the household pool exactly what it always did, and (c) credit the
// acting member's own doc at THEIR streak multiplier.
describe('useHabitActions.toggleHabit (per-member attribution dual-write)', () => {
  const memberPath = `${householdPath}/members/${currentUser.uid}`;
  const memberUpdate = () => capturedUpdates.find(u => u.ref.__path === memberPath);
  const today = () => format(new Date(), 'yyyy-MM-dd');

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  it('increments attribution by dot path and credits the member, in ONE commit', async () => {
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // (a) Dot-path increment — NEVER a whole `completedBy` map write.
    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`])
      .toEqual({ __increment: 1 });
    expect(habitUpdate()!.data['completedBy']).toBeUndefined();

    // (b) The household pool is credited exactly what it was before this
    //     feature: the habit-level delta. This is the invisibility guarantee.
    expect(householdUpdate()!.data['points.daily']).toEqual({ __increment: 10 });

    // (c) The acting member's own score moves too, at their own multiplier
    //     (a first completion → 1.0× → 10).
    expect(memberUpdate()).toBeDefined();
    expect(memberUpdate()!.data['points.daily']).toEqual({ __increment: 10 });
    expect(memberUpdate()!.data['points.weekly']).toEqual({ __increment: 10 });
    expect(memberUpdate()!.data['points.total']).toEqual({ __increment: 10 });

    // Still exactly ONE batch (project atomicity rule).
    expect(commitCount).toBe(1);
  });

  it('DECREMENTS (never deletes) the member’s day key when a down-toggle empties it', async () => {
    // 🛡️ Clobber guard: choosing deleteField() at zero would have to read the
    // client-cached prior count, and a stale offline cache would then delete a
    // node another device had just incremented. The write is an unconditional
    // increment(-1) in every case; the harmless 0 residue reads as absent.
    const habit = baseHabit({
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { [currentUser.uid]: 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`])
      .toEqual({ __increment: -1 });
    expect(memberUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('treats a ZERO residue count as absent (no negative attribution)', async () => {
    // A previous down-toggle left `{uid: 0}` behind. Down-toggling again must
    // read that as "nothing attributed" and write no further decrement, exactly
    // as it does for a grandfathered completion with no entry at all.
    const habit = baseHabit({
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { [currentUser.uid]: 0 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`]).toBeUndefined();
    expect(memberUpdate()).toBeUndefined();
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('decrements rather than deletes when the member has units left', async () => {
    const habit = baseHabit({
      completedDates: [today()],
      count: 2,
      totalCount: 2,
      completedBy: { [today()]: { [currentUser.uid]: 2 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`])
      .toEqual({ __increment: -1 });
  });

  it('never writes negative attribution for a GRANDFATHERED completion', async () => {
    // A completion recorded before this feature has no `completedBy` entry.
    // Down-toggling it must leave attribution untouched (and debit nobody)
    // while the household pool is reversed exactly as it always was.
    const habit = baseHabit({ completedDates: [today()], count: 1, totalCount: 1 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`]).toBeUndefined();
    expect(memberUpdate()).toBeUndefined();
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('credits the member — AND THE POOL — at THEIR streak multiplier, not the habit’s', async () => {
    // 🏁 Stage 1.5, the visible consequence. The habit has a 6-day streak (2.0×
    // on the 7th day) but the acting member has never been credited, so their
    // own first completion earns 1.0× — and the pool now receives that SAME 10,
    // not the habit-level 20 it used to. Long-streak habits temporarily pay 1×
    // until each person's own chain rebuilds; that is the locked model.
    const dates = Array.from({ length: 6 }, (_, i) => format(subDays(new Date(), i + 1), 'yyyy-MM-dd'));
    const habit = baseHabit({ completedDates: dates, count: 0, totalCount: 6 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    expect(householdUpdate()!.data['points.daily']).toEqual({ __increment: 10 });
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdate()!.data['points.daily']).toEqual({ __increment: 10 });
  });

  it('pays the pool a SECOND full award when the other member completes too', async () => {
    // 🔒 Locked: both members earn a full award on the same threshold day, and
    // the pool receives the sum — where the habit-level scorer saw the day as
    // already complete and would have credited nothing at all.
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdate()!.data['points.total']).toEqual({ __increment: 10 });
  });

  it('attributes an assigned chore to the ASSIGNEE, and still does not double-credit them', async () => {
    // A managed kid has no auth session of their own — a parent taps the chore
    // for them — so `completedBy` must record the ASSIGNEE, not the signed-in
    // adult ("who the completion belongs to", not "who held the phone").
    // Scoring is unchanged: an assigned chore already routes its points to the
    // assignee's member doc (Plan 080c) and is excluded from the attribution
    // scorer, so there is still exactly ONE member write.
    const habit = baseHabit({ completedDates: [], count: 0, assignedTo: 'kid_leo' });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    const memberWrites = capturedUpdates.filter(u => u.ref.__path.includes('/members/'));
    expect(memberWrites).toHaveLength(1);
    expect(memberWrites[0]!.ref.__path).toBe(`${householdPath}/members/kid_leo`);
    expect(memberWrites[0]!.data['points.total']).toEqual({ __increment: 10 });
    // Attribution lands on the kid (stage 2's pie counter reads it)...
    expect(habitUpdate()!.data[`completedBy.${today()}.kid_leo`]).toEqual({ __increment: 1 });
    // ...and never on the acting adult.
    expect(habitUpdate()!.data[`completedBy.${today()}.${currentUser.uid}`]).toBeUndefined();
  });
});

describe('useHabitActions.creditHabitCompletion / uncreditHabitCompletion', () => {
  const today = () => format(new Date(), 'yyyy-MM-dd');
  const memberWrites = () => capturedUpdates.filter(u => u.ref.__path.includes('/members/'));

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  it('credits EVERY selected member a full completion in one batch', async () => {
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['paul-uid', 'jen-uid']);
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.paul-uid`]).toEqual({ __increment: 1 });
    expect(habitUpdate()!.data[`completedBy.${today()}.jen-uid`]).toEqual({ __increment: 1 });
    // Two members => two units on the counters (the pie counter reads "2").
    expect(habitUpdate()!.data['totalCount']).toEqual({ __increment: 2 });
    expect(habitUpdate()!.data['count']).toEqual({ __increment: 2 });

    const paths = memberWrites().map(u => u.ref.__path).sort();
    expect(paths).toEqual([
      `${householdPath}/members/jen-uid`,
      `${householdPath}/members/paul-uid`,
    ]);
    for (const write of memberWrites()) {
      expect(write.data['points.total']).toEqual({ __increment: 10 });
    }
    expect(commitCount).toBe(1);
  });

  it('un-credits one member: decrements, reverses their points, keeps the day', async () => {
    const habit = baseHabit({
      completedDates: [today()],
      count: 2,
      totalCount: 2,
      completedBy: { [today()]: { 'paul-uid': 1, 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'jen-uid');
    });

    // Unconditional decrement, never a cache-decided delete (clobber guard).
    expect(habitUpdate()!.data[`completedBy.${today()}.jen-uid`]).toEqual({ __increment: -1 });
    // Paul is still credited, so the day stays completed.
    expect(habitUpdate()!.data['completedDates']).toBeUndefined();

    const jen = memberWrites().find(u => u.ref.__path.endsWith('jen-uid'));
    expect(jen!.data['points.total']).toEqual({ __increment: -10 });
    expect(memberWrites().some(u => u.ref.__path.endsWith('paul-uid'))).toBe(false);
  });

  it('drops the date once the last attributed unit is un-credited', async () => {
    const habit = baseHabit({
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'jen-uid');
    });

    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayRemove: [today()] });
  });

  it('is a NO-OP on an unattributed (pre-feature) completion', async () => {
    const habit = baseHabit({ completedDates: [today()], count: 1, totalCount: 1 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'jen-uid');
    });

    expect(capturedUpdates).toHaveLength(0);
    expect(commitCount).toBe(0);
  });
});

// 🛡️ The un-credit TARGET DATE is resolved by the CALLER (HabitCard, via
// `memberMostRecentUnitDateInPeriod`) and handed to `uncreditHabitCompletion`
// as an explicit argument — the two are only correct together. For a weekly
// threshold habit with multiple contributors, the day the household record
// shows as "complete" (whoever's unit CROSSED the target) and a given
// member's own most-recent unit can be different days entirely. This test
// pins that the picker's date-selection and the mutation's internals agree:
// the right day gets debited, and the pool/member figures stay internally
// consistent with the shared attribution formulas (`habitAttribution.ts`)
// that the corrective recompute also uses.
describe('useHabitActions.uncreditHabitCompletion (weekly threshold, multiple contributors, mid-week unit)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("un-credits Paul's Monday unit (not Jen's Wednesday one that crossed the target) — member debit, household debit, and completedDates stay consistent", async () => {
    // Wednesday 2026-07-15, same ISO week (Mon 2026-07-13 – Sun 2026-07-19)
    // already used elsewhere in this file — a fixture anchored to its own
    // week, never to an offset from `new Date()`.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const today = '2026-07-15';

    // Paul completed his only unit Monday; Jen's Wednesday unit crossed the
    // shared targetCount:2 threshold, so ONLY Wednesday ever entered
    // completedDates (creditHabitCompletion always stamps the CREDITING
    // day, not every contributor's day).
    const habit = baseHabit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 2,
      count: 2,
      totalCount: 2,
      completedDates: ['2026-07-15'],
      completedBy: { '2026-07-13': { 'paul-uid': 1 }, '2026-07-15': { 'jen-uid': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });

    // The picker's own target-date resolution (HabitCard.handleUncreditMember
    // calls exactly this before invoking uncreditHabitCompletion) must land on
    // PAUL'S day, not the day the record shows as complete.
    const targetDate = memberMostRecentUnitDateInPeriod(habit, 'paul-uid', today);
    expect(targetDate).toBe('2026-07-13');

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], [
        { uid: 'paul-uid' },
        { uid: 'jen-uid' },
      ] as HouseholdMember[])
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'paul-uid', targetDate!);
    });

    // --- Habit doc: Paul's Monday unit is stripped; Jen's Wednesday one is untouched.
    const hu = habitUpdate();
    expect(hu).toBeDefined();
    expect(hu!.data['completedBy.2026-07-13.paul-uid']).toEqual({ __increment: -1 });
    expect(hu!.data['completedBy.2026-07-15.jen-uid']).toBeUndefined();
    expect(hu!.data['count']).toEqual({ __increment: -1 });
    expect(hu!.data['totalCount']).toEqual({ __increment: -1 });
    // `targetDate` ('2026-07-13') isn't in `completedDates` (only '2026-07-15'
    // is), so there is nothing for this un-credit to remove — no arrayRemove.
    expect('completedDates' in hu!.data).toBe(false);
    expect(hu!.data['streakDays']).toBe(
      streakForHabit({ period: 'weekly', completedDates: habit.completedDates })
    );

    // --- Member debit: EXACTLY what Paul's own period award was, recomputed
    // from the shared attribution formula (`memberPeriodPointsDelta`) —
    // building the same before/after pair `uncreditHabitCompletion` builds
    // internally, so this pins the WIRING (right date, right batch shape),
    // not a re-derivation of the scoring math (already covered by
    // `habitAttribution.test.ts`).
    const stripped = withAttributionDelta(habit, targetDate!, 'paul-uid', -1);
    const after = {
      ...stripped,
      count: Math.max(0, habit.count - 1),
      totalCount: Math.max(0, habit.totalCount - 1),
      completedDates: habit.completedDates,
    };
    const expectedPaulDelta = memberPeriodPointsDelta(habit, after, 'paul-uid', targetDate!, today);
    const expectedPoolDelta = householdPeriodPointsDelta(habit, after, targetDate!, today);

    const memberWrites = () => capturedUpdates.filter(u => u.ref.__path.includes('/members/'));
    const paulWrite = memberWrites().find(u => u.ref.__path.endsWith('paul-uid'));
    expect(paulWrite).toBeDefined();
    expect(paulWrite!.data['points.total']).toEqual({ __increment: expectedPaulDelta });
    // Monday predates the fixture's "today" (Wednesday) but is inside the
    // same Monday-anchored week, so weekly is debited and daily is not.
    expect(paulWrite!.data['points.daily']).toBeUndefined();
    expect(paulWrite!.data['points.weekly']).toEqual({ __increment: expectedPaulDelta });

    // Jen's own member doc is untouched by THIS un-credit — only the targeted
    // member (Paul) gets a write. Any drift in Jen's stored figure (the
    // shared threshold no longer being met household-wide zeroes her period
    // award too, in `expectedPoolDelta`) is left to the corrective recompute,
    // exactly like every other reversal path in this file.
    expect(memberWrites().some(u => u.ref.__path.endsWith('jen-uid'))).toBe(false);

    // --- Household pool debit matches the shared formula exactly.
    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: expectedPoolDelta });
    expect(hh!.data['points.weekly']).toEqual({ __increment: expectedPoolDelta });
    expect(hh!.data['points.daily']).toBeUndefined();

    expect(commitCount).toBe(1);
  });
});

// 🛡️ Attribution OUTLIVES membership: `removeMember()` deletes the member doc
// but leaves that uid inside `Habit.completedBy`. A batch.update() against a
// deleted doc rejects NOT_FOUND, and a Firestore batch is all-or-nothing — so
// queuing a points reversal for a departed member would permanently break
// resetHabit / resetHabitDay / the stale-down toggle for every habit+date they
// were credited on. Every per-member write is filtered against the live roster;
// the habit-doc clear is NOT (it is always a valid write), so the stale
// attribution self-heals on the next successful clear.
describe('useHabitActions — per-member writes skip members who no longer exist', () => {
  const today = () => format(new Date(), 'yyyy-MM-dd');
  const yesterday = () => format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberPaths = () =>
    capturedUpdates.filter(u => u.ref.__path.includes('/members/')).map(u => u.ref.__path);

  const daySubmissionsSnap = () =>
    ({ empty: true, docs: [] }) as unknown as Awaited<ReturnType<typeof getDocs>>;

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
  });

  it('resetHabit: reverses only the LIVE member, still clearing the ghost’s attribution', async () => {
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 2,
      totalCount: 2,
      completedDates: [today()],
      completedBy: { [today()]: { 'user1': 1, 'ghost-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    // The habit doc still drops the WHOLE day's attribution, ghost included.
    expect(habitUpdate()!.data[`completedBy.${today()}`]).toEqual({ __deleteField: true });
    expect(memberPaths()).toEqual([`${householdPath}/members/user1`]);
    expect(commitCount).toBe(1);
  });

  it('resetHabit: with a full roster, every credited member is still reversed', async () => {
    // The control case — the filter must not silently drop live members.
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 2,
      totalCount: 2,
      completedDates: [today()],
      completedBy: { [today()]: { 'user1': 1, 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(memberPaths().sort()).toEqual([
      `${householdPath}/members/jen-uid`,
      `${householdPath}/members/user1`,
    ]);
    for (const uid of ['user1', 'jen-uid']) {
      const m = capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`)!;
      expect(m.data['points.total']).toEqual({ __increment: -10 });
      expect(m.data['points.daily']).toEqual({ __increment: -10 });
    }
    // 🏁 Stage 1.5: the pool gives back the SUM of the two member awards (−20),
    // not the single habit-level threshold award (−10) `calculateResetPoints`
    // would have computed.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -20 });
    expect(householdUpdate()!.data['points.daily']).toEqual({ __increment: -20 });
  });

  it('resetHabit: an UNATTRIBUTED reset still debits the legacy figure exactly', async () => {
    // 🛡️ Grandfathering: with no `completedBy`, the pool reversal is untouched
    // by the flip — `calculateResetPoints`' figure, applied flat to all three
    // buckets exactly as before.
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 1,
      totalCount: 1,
      completedDates: [today()],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(memberPaths()).toEqual([]);
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
    expect(householdUpdate()!.data['points.weekly']).toEqual({ __increment: -10 });
    expect(householdUpdate()!.data['points.daily']).toEqual({ __increment: -10 });
  });

  it('resetHabitDay: skips the ghost’s reversal and still commits', async () => {
    getDocsMock.mockResolvedValue(daySubmissionsSnap());
    const habit = baseHabit({
      scoringType: 'threshold',
      totalCount: 2,
      completedDates: [yesterday()],
      completedBy: { [yesterday()]: { 'user1': 1, 'ghost-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', yesterday());
    });

    expect(habitUpdate()!.data[`completedBy.${yesterday()}`]).toEqual({ __deleteField: true });
    expect(memberPaths()).toEqual([`${householdPath}/members/user1`]);
    expect(commitCount).toBe(1);
  });

  it('uncreditHabitCompletion: strips the ghost’s attribution with no member write', async () => {
    const habit = baseHabit({
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { 'ghost-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'ghost-uid');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.ghost-uid`]).toEqual({ __increment: -1 });
    expect(memberPaths()).toEqual([]);
    expect(commitCount).toBe(1);
  });

  it('creditHabitCompletion: records attribution for a ghost but never writes their points', async () => {
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['user1', 'ghost-uid']);
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.ghost-uid`]).toEqual({ __increment: 1 });
    expect(memberPaths()).toEqual([`${householdPath}/members/user1`]);
    expect(commitCount).toBe(1);
  });
});

describe('useHabitActions.toggleHabit (Plan 080c: assigned chores credit the assignee)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
  });

  const KID = 'kid_leo';
  const memberPath = `${householdPath}/members/${KID}`;

  it("credits the assignee's member.points, not the shared household pool", async () => {
    const habit = baseHabit({ completedDates: [], count: 0, assignedTo: KID });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // The kid's own member doc receives the points delta.
    const memberUpdates = capturedUpdates.filter(u => u.ref.__path === memberPath);
    expect(memberUpdates).toHaveLength(1);
    expect(memberUpdates[0]!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdates[0]!.data['points.daily']).toEqual({ __increment: 10 });
    expect(memberUpdates[0]!.data['points.weekly']).toEqual({ __increment: 10 });

    // The shared household pool must NOT be touched for an assigned chore.
    const householdUpdates = capturedUpdates.filter(u => u.ref.__path === householdPath);
    expect(householdUpdates).toHaveLength(0);
    expect(commitCount).toBe(1);
  });
});

describe('useHabitActions.updateHabit (Plan 080c-3: assignedTo round-trips through the whitelist)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    updateDocMock.mockClear();
  });

  // Pull the data payload from the single updateDoc(ref, data) call updateHabit makes.
  const lastUpdatePayload = (): Record<string, unknown> => {
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const call = updateDocMock.mock.calls[0];
    if (!call) throw new Error('expected updateDoc to have been called');
    // updateDoc's typed overloads widen arg 1 to string | FieldPath; the real call
    // passes a plain data object, so cast through unknown to read it back.
    return call[1] as unknown as Record<string, unknown>;
  };

  it('includes assignedTo in the written update when the chore is assigned to a kid', async () => {
    const habit = baseHabit({ id: 'h1', assignedTo: 'kid_leo' });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect(payload.assignedTo).toBe('kid_leo');
  });

  it('drops assignedTo (dormancy) when the habit is unassigned', async () => {
    // assignedTo is undefined on every existing habit; the undefined-filter must
    // strip it so an unassigned habit writes no assignedTo field at all.
    const habit = baseHabit({ id: 'h1' });
    expect(habit.assignedTo).toBeUndefined();

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect('assignedTo' in payload).toBe(false);
  });

  // Regression (adversarial-review finding on PR #1073, converged with #1072):
  // an ordinary habit edit (e.g. bumping basePoints via the habit card's Edit
  // form) must NEVER wipe previously-saved location/keyword triggers.
  // HabitFormModal's baseHabitData doesn't mention `triggers` at all for such
  // an edit, so the `habit` object passed to updateHabit has no `triggers`
  // own property — that must leave the stored field untouched, not delete it.
  it('does not delete existing triggers when the payload omits the triggers key entirely', async () => {
    const habit = baseHabit({ id: 'h1' });
    expect('triggers' in habit).toBe(false);

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    // Not even a deleteField() — the field is absent, so Firestore leaves the
    // stored triggers exactly as they were.
    expect('triggers' in payload).toBe(false);
  });

  it('writes a populated triggers object through unchanged', async () => {
    const triggers = { keywords: ['whole foods'], locations: [] };
    const habit = baseHabit({ id: 'h1', triggers });

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect(payload.triggers).toEqual(triggers);
  });

  it('writes a non-empty triggers value through when the payload explicitly provides one', async () => {
    const triggers = { locations: [{ id: 'loc1', name: 'Target', lat: 1, lng: 2, radiusMeters: 150 }] };
    const habit = baseHabit({ id: 'h1', triggers });

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect(payload.triggers).toEqual(triggers);
  });

  it('clears automations via deleteField() ONLY for an explicit empty triggers object', async () => {
    const habit = baseHabit({ id: 'h1', triggers: { keywords: [], locations: [] } });

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect(payload.triggers).toEqual({ __deleteField: true });
  });

  // Regression (PR #1072 clear-path bug): HabitCreatorWizard.handleSaveCustom
  // — when EDITING — always spreads an OWN `triggers` property onto the habit
  // object, even when the computed value is `undefined` (the user removed
  // their LAST keyword/location). That is NOT the same payload shape as an
  // ordinary edit that never mentions `triggers` at all (tested above): here
  // the key is present with an `undefined` value, so `hasOwnProperty` must
  // still see it and route to deleteField() rather than being swallowed by
  // the `habit.triggers !== undefined` style check that caused the original
  // regression (the last keyword could never actually be cleared).
  it('clears automations via deleteField() when the key is present with an undefined value (wizard clear path)', async () => {
    const habit = baseHabit({ id: 'h1', triggers: undefined });
    expect(Object.prototype.hasOwnProperty.call(habit, 'triggers')).toBe(true);

    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.updateHabit(habit);
    });

    const payload = lastUpdatePayload();
    expect(payload.triggers).toEqual({ __deleteField: true });
  });
});

describe('useHabitActions.toggleHabit (stale deselect — date-aware reversal)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    updateDocMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mid-week: clears yesterday's completion, debits weekly+total, NEVER today's daily, in one batch", async () => {
    // Wednesday 2026-07-15; habit completed Tuesday and never auto-reset.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 1,
      totalCount: 5,
      completedDates: ['2026-07-14'],
      lastUpdated: '2026-07-14T20:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    const hu = habitUpdate();
    expect(hu).toBeDefined();
    expect(hu!.data['count']).toBe(0);
    expect(hu!.data['totalCount']).toBe(4);
    expect(hu!.data['completedDates']).toEqual({ __arrayRemove: ['2026-07-14'] });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    // The completion being reversed happened YESTERDAY: today's daily bucket
    // never held those points, so it must not be debited (no negative daily).
    expect(hh!.data['points.daily']).toBeUndefined();
    // Yesterday is inside the current Monday-anchored week, whose bucket DOES
    // hold the award — debit it so the corrective recompute agrees.
    expect(hh!.data['points.weekly']).toEqual({ __increment: -10 });
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });

    // Habit + points committed atomically in a single writeBatch.
    expect(commitCount).toBe(1);
  });

  it('Sunday-complete / Monday-deselect: only total is debited across the week boundary', async () => {
    // Monday 2026-07-13; habit completed Sunday 2026-07-12 (previous ISO week).
    vi.useFakeTimers({ now: new Date('2026-07-13T08:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 1,
      totalCount: 1,
      completedDates: ['2026-07-12'],
      lastUpdated: '2026-07-12T21:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    const hu = habitUpdate();
    expect(hu!.data['count']).toBe(0);
    expect(hu!.data['completedDates']).toEqual({ __arrayRemove: ['2026-07-12'] });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.daily']).toBeUndefined();
    expect(hh!.data['points.weekly']).toBeUndefined(); // Sunday = last week
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });
    expect(commitCount).toBe(1);
  });

  it('stale deselect with no recorded prior completion just zeroes the counter (no points write)', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 3,
      count: 2, // below target: never entered completedDates
      totalCount: 2,
      completedDates: [],
      lastUpdated: '2026-07-14T20:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    const hu = habitUpdate();
    expect(hu).toBeDefined();
    expect(hu!.data['count']).toBe(0);
    expect(hu!.data['completedDates']).toBeUndefined();
    expect(hu!.data['totalCount']).toBe(2); // nothing disavowed
    expect(householdUpdate()).toBeUndefined();
  });

  it("clears the removed dates' attribution and reverses each credited member, in one batch", async () => {
    // Wednesday 2026-07-15; Tuesday's completion was credited to two members
    // and never auto-reset. Undoing it must strip the whole day's attribution
    // (a deleteField on the `completedBy.<date>` node — absolute by design,
    // mirroring the completedDates arrayRemove in the same batch) and reverse
    // exactly what each member earned there.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 2,
      totalCount: 2,
      completedDates: ['2026-07-14'],
      completedBy: { '2026-07-14': { 'user1': 1, 'jen-uid': 1 } },
      lastUpdated: '2026-07-14T20:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], [
        { uid: 'user1' },
        { uid: 'jen-uid' },
      ] as HouseholdMember[])
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    const hu = habitUpdate()!;
    expect(hu.data['completedBy.2026-07-14']).toEqual({ __deleteField: true });
    expect(hu.data['completedDates']).toEqual({ __arrayRemove: ['2026-07-14'] });

    // Both credited members lose their own award, gated by the date it was
    // earned on: yesterday is in this week (weekly + total), never today's daily.
    for (const uid of ['user1', 'jen-uid']) {
      const m = capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
      expect(m, uid).toBeDefined();
      expect(m!.data['points.total']).toEqual({ __increment: -10 });
      expect(m!.data['points.weekly']).toEqual({ __increment: -10 });
      expect(m!.data['points.daily']).toBeUndefined();
    }
    expect(commitCount).toBe(1);
  });

  it('SKIPS the points write for a member who has since been removed, but still strips their attribution', async () => {
    // 🛡️ A removed member's uid outlives their member doc inside `completedBy`.
    // batch.update() on a deleted doc rejects NOT_FOUND, and a batch is
    // all-or-nothing — so queuing that write would permanently break this
    // habit's stale deselect. The habit-doc clear still runs, so the poisoned
    // attribution self-heals.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 2,
      totalCount: 2,
      completedDates: ['2026-07-14'],
      completedBy: { '2026-07-14': { 'user1': 1, 'ghost-uid': 1 } },
      lastUpdated: '2026-07-14T20:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], [
        { uid: 'user1' },
      ] as HouseholdMember[])
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    // The habit doc still clears the whole day, ghost included.
    expect(habitUpdate()!.data['completedBy.2026-07-14']).toEqual({ __deleteField: true });

    const memberPaths = capturedUpdates
      .filter(u => u.ref.__path.includes('/members/'))
      .map(u => u.ref.__path);
    expect(memberPaths).toEqual([`${householdPath}/members/user1`]);
    expect(commitCount).toBe(1);
  });

  it("an assigned chore's stale deselect debits the assignee's member doc, not the household", async () => {
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = baseHabit({
      scoringType: 'threshold',
      count: 1,
      totalCount: 1,
      completedDates: ['2026-07-14'],
      lastUpdated: '2026-07-14T20:00:00',
      assignedTo: 'kid_leo',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(householdUpdate()).toBeUndefined();
    const member = capturedUpdates.find(
      u => u.ref.__path === `${householdPath}/members/kid_leo`
    );
    expect(member).toBeDefined();
    expect(member!.data['points.total']).toEqual({ __increment: -10 });
    expect(member!.data['points.daily']).toBeUndefined();
  });
});

describe('useHabitActions.toggleHabit (points toast Undo action)', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    vi.mocked(toast).mockClear();
  });

  it('renders an Undo action in the points toast that fires the reverse toggle', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result, rerender } = renderHook(
      ({ habits }: { habits: Habit[] }) =>
        useHabitActions(HOUSEHOLD_ID, currentUser, habits, householdSettings),
      { initialProps: { habits: [habit] } }
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // The points toast is the last plain toast() call; its body carries Undo.
    const toastBody = vi.mocked(toast).mock.calls.at(-1)?.[0];
    expect(toastBody).toBeDefined();
    render(toastBody as React.ReactElement);
    const undo = screen.getByRole('button', { name: 'Undo' });

    // Simulate the Firestore listener echoing the committed toggle before the
    // user reaches for Undo (the real flow), then reverse it.
    rerender({
      habits: [{ ...habit, count: 1, totalCount: 1, completedDates: [today], streakDays: 1 }],
    });
    const commitsBefore = commitCount;
    await act(async () => {
      fireEvent.click(undo);
    });

    expect(commitCount).toBe(commitsBefore + 1);
    const lastHousehold = capturedUpdates.filter(u => u.ref.__path === householdPath).at(-1);
    expect(lastHousehold!.data['points.total']).toEqual({ __increment: -10 });
    // ... and the completion date is removed again (a true reversal).
    const lastHabit = capturedUpdates.filter(u => u.ref.__path === `${householdPath}/habits/h1`).at(-1);
    expect(lastHabit!.data['completedDates']).toEqual({ __arrayRemove: [today] });
  });
});

// 🛡️ ROUND-2 REVIEW — a chore assigned to a member who has since been REMOVED.
// `removeMember()` never clears `Habit.assignedTo`, and `habitPointsTargets`
// has always routed an assigned habit's points straight at that member's doc —
// so every ordinary tap of such a habit queued a `batch.update()` on a deleted
// doc. That rejects NOT_FOUND, and a Firestore batch is all-or-nothing, so the
// habit became permanently un-tappable (silently: the forward path had no
// try/catch). This predates the per-member feature; it is a live production
// hazard, fixed here by skipping the points write for a ghost pool target.
describe('useHabitActions.toggleHabit (ghost assignee cannot poison the batch)', () => {
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const today = () => format(new Date(), 'yyyy-MM-dd');
  const memberPaths = () =>
    capturedUpdates.filter(u => u.ref.__path.includes('/members/')).map(u => u.ref.__path);

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('writes NO points for a chore assigned to a removed member, and still commits', async () => {
    const habit = baseHabit({ completedDates: [], count: 0, assignedTo: 'ghost-uid' });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // No member write at all — the ghost's doc is gone and the shared pool must
    // NOT absorb a departed member's chore points either.
    expect(memberPaths()).toEqual([]);
    expect(capturedUpdates.find(u => u.ref.__path === householdPath)).toBeUndefined();
    // The habit itself still toggles, attribution residue included (harmless —
    // every reader treats an unknown uid's counts as ordinary stored data).
    expect(habitUpdate()).toBeDefined();
    expect(habitUpdate()!.data[`completedBy.${today()}.ghost-uid`]).toEqual({ __increment: 1 });
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [today()] });
    expect(commitCount).toBe(1);
  });

  it('still credits a LIVE assignee (the control case)', async () => {
    const habit = baseHabit({ completedDates: [], count: 0, assignedTo: 'kid_leo' });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'kid_leo'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    expect(memberPaths()).toEqual([`${householdPath}/members/kid_leo`]);
    const kid = capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/kid_leo`)!;
    expect(kid.data['points.total']).toEqual({ __increment: 10 });
    expect(commitCount).toBe(1);
  });

  it('surfaces an error toast (and no celebration) when the forward commit fails', async () => {
    // Before this round the forward path had a bare `await batch.commit()`: a
    // rejection surfaced as an unhandled promise while the points toast still
    // told the user "+10 pts" for a write that never landed.
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    nextCommitError = new Error('NOT_FOUND: no document to update');
    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(commitCount).toBe(0);
    // The points toast is a plain toast() call — it must not fire for a failed write.
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });
});

// 🛡️ ROUND-2 REVIEW — every reversal is bounded by STORED attribution.
//
// `attributionActor()` answers "who gets CREDITED going forward"; it reads the
// habit's CURRENT `assignedTo`, which can change after the fact. Using it to
// decide what to REVERSE debits a member who was never credited (they go
// negative) while the member who actually earned the points keeps them forever.
// The stored `Habit.completedBy` map is the only record of who was credited, so
// it — via `resolveReversalSources` — is the authority for every reversal.
describe('useHabitActions — reversals follow stored attribution, not current assignment', () => {
  const today = () => format(new Date(), 'yyyy-MM-dd');
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);

  /** getDoc stand-in for one stored submission doc. */
  const submissionDoc = (data: Record<string, unknown>) =>
    ({ exists: () => true, data: () => data }) as unknown as Awaited<ReturnType<typeof getDoc>>;
  /** getDocs stand-in for the "is this the last submission for the date" query. */
  const dateQuerySnap = (size: number) =>
    ({ size, empty: size === 0, docs: [] }) as unknown as Awaited<ReturnType<typeof getDocs>>;

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
    getDocsMock.mockReset();
    getDocMock.mockReset();
  });

  it('down-toggle takes the unit back from the member who HOLDS it, not the tapper', async () => {
    // Jen is the credited member on today's completion; user1 taps 'down'.
    // Keying the reversal off the tapper found no units for user1, so it wrote
    // nothing — leaving Jen's credit stranded permanently.
    const habit = baseHabit({
      completedDates: [today()],
      count: 1,
      totalCount: 1,
      completedBy: { [today()]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(habitUpdate()!.data[`completedBy.${today()}.jen-uid`]).toEqual({ __increment: -1 });
    expect(habitUpdate()!.data[`completedBy.${today()}.user1`]).toBeUndefined();
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: -10 });
    expect(memberUpdate('user1')).toBeUndefined();
    // The household pool reversal is unchanged by any of this.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('addHabitSubmission SNAPSHOTS the credited uid on the submission', async () => {
    const shared = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [shared], householdSettings, [], roster('user1'))
    );
    await act(async () => {
      await result.current.addHabitSubmission('h1', 1);
    });
    expect(capturedSets[0]!.data['attributedTo']).toBe('user1');

    capturedSets.length = 0;
    const chore = baseHabit({ completedDates: [], assignedTo: 'kid_leo' });
    const { result: choreResult } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [chore], householdSettings, [], roster('user1', 'kid_leo'),
      )
    );
    await act(async () => {
      await choreResult.current.addHabitSubmission('h1', 1);
    });
    // The completion belongs to the kid, not to the parent who tapped.
    expect(capturedSets[0]!.data['createdBy']).toBe('user1');
    expect(capturedSets[0]!.data['attributedTo']).toBe('kid_leo');
  });

  it('deleteHabitSubmission debits the ORIGINAL credited member after a reassignment', async () => {
    // Jen logged the submission while the habit was shared. It has since been
    // reassigned to kid_leo. Re-deriving the actor from `assignedTo` decremented
    // kid_leo — a member who never earned these units.
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 1, pointsEarned: 10,
      createdBy: 'jen-uid', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({
      completedDates: [date],
      count: 1,
      totalCount: 1,
      completedBy: { [date]: { 'jen-uid': 1 } },
      assignedTo: 'kid_leo',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [],
        roster('user1', 'jen-uid', 'kid_leo'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    // The stored holder's units come back...
    expect(habitUpdate()!.data[`completedBy.${date}.jen-uid`]).toEqual({ __increment: -1 });
    // ...and the new assignee's attribution is never touched.
    expect(habitUpdate()!.data[`completedBy.${date}.kid_leo`]).toBeUndefined();
    expect(commitCount).toBe(1);
  });

  it('deleteHabitSubmission debits the snapshotted member, never the current one', async () => {
    // Same shape, but the habit stays SHARED so the member-points half is live:
    // Jen holds the attribution and must be the one debited, even though the
    // submission was filed by user1.
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 1, pointsEarned: 10,
      createdBy: 'user1', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({
      completedDates: [date],
      count: 1,
      totalCount: 1,
      completedBy: { [date]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect(habitUpdate()!.data[`completedBy.${date}.jen-uid`]).toEqual({ __increment: -1 });
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: -10 });
    expect(memberUpdate('user1')).toBeUndefined();
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('deleting a LEGACY submission reverses the pool only — zero member writes', async () => {
    // Pre-stage-1 data: no `attributedTo` on the submission, no `completedBy` on
    // the habit. The credit predates member scoring, so there is nothing
    // member-level to reverse — debiting anyone would invent a loss, and writing
    // a decrement would push a member's count negative.
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 1, pointsEarned: 10,
      createdBy: 'user1', streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({ completedDates: [date], count: 1, totalCount: 1 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect(capturedUpdates.filter(u => u.ref.__path.includes('/members/'))).toEqual([]);
    expect(Object.keys(habitUpdate()!.data).some(k => k.startsWith('completedBy.'))).toBe(false);
    // The household reversal is untouched — exactly the pre-feature behaviour.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
    expect(commitCount).toBe(1);
  });

  it('updateHabitSubmission shrinks the ORIGINAL credited member, not the new assignee', async () => {
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 2, pointsEarned: 20,
      createdBy: 'user1', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));

    const habit = baseHabit({
      completedDates: [date],
      count: 2,
      totalCount: 2,
      completedBy: { [date]: { 'jen-uid': 2 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.updateHabitSubmission('h1', 's1', { count: 1 });
    });

    expect(habitUpdate()!.data[`completedBy.${date}.jen-uid`]).toEqual({ __increment: -1 });
    expect(habitUpdate()!.data[`completedBy.${date}.user1`]).toBeUndefined();
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: -10 });
    expect(memberUpdate('user1')).toBeUndefined();
  });

  it('editing a LEGACY submission down writes no attribution and debits no member', async () => {
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 2, pointsEarned: 20,
      createdBy: 'user1', streakDaysAtTime: 1, multiplierApplied: 1,
    }));

    const habit = baseHabit({ completedDates: [date], count: 2, totalCount: 2 });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.updateHabitSubmission('h1', 's1', { count: 1 });
    });

    expect(Object.keys(habitUpdate()!.data).some(k => k.startsWith('completedBy.'))).toBe(false);
    expect(capturedUpdates.filter(u => u.ref.__path.includes('/members/'))).toEqual([]);
    // The pool still loses the one unit's worth of points, as it always did.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -10 });
  });

  it('editing a submission UP still credits the snapshotted member forward', async () => {
    // Bounding applies to reversals only — an increase is a forward credit and
    // lands on the member the submission belongs to.
    const date = today();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date, count: 1, pointsEarned: 10,
      createdBy: 'user1', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));

    const habit = baseHabit({
      completedDates: [date],
      count: 1,
      totalCount: 1,
      completedBy: { [date]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.updateHabitSubmission('h1', 's1', { count: 2 });
    });

    expect(habitUpdate()!.data[`completedBy.${date}.jen-uid`]).toEqual({ __increment: 1 });
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: 10 });
  });
});

// 🔒 Regression (follow-up to the PR #1155 adversarial review). An INCREMENTAL
// habit with `targetCount > 1` pays points on every tap but only enters
// `completedDates` at target, so resetting a below-target period debited the
// pool (`calculateResetPoints`) while the per-member reversal — anchored on the
// completion dates, of which there are none — produced nothing. Member and pool
// diverged permanently, and the orphaned attribution kept inflating that
// member's own streak.
describe('useHabitActions.resetHabit (below-target incremental periods)', () => {
  const today = () => format(new Date(), 'yyyy-MM-dd');
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
  });

  it('debits the member their own units and clears the orphaned attribution', async () => {
    const date = today();
    const habit = baseHabit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 2,
      totalCount: 2,
      completedDates: [], // 2/3 — the target was never reached
      completedBy: { [date]: { 'user1': 2 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    const hu = habitUpdate()!;
    expect(hu.data['count']).toBe(0);
    // Nothing to arrayRemove — the period never produced a completion date.
    expect('completedDates' in hu.data).toBe(false);
    // …but the attribution the two taps recorded DOES go.
    expect(hu.data[`completedBy.${date}`]).toEqual({ __deleteField: true });

    // Both taps come back off user1, at their own 1.0x multiplier.
    expect(memberUpdate('user1')!.data['points.total']).toEqual({ __increment: -20 });
    expect(memberUpdate('user1')!.data['points.daily']).toEqual({ __increment: -20 });
    expect(memberUpdate('user1')!.data['points.weekly']).toEqual({ __increment: -20 });
    // The pool loses exactly what it lost before this fix — the member side
    // simply stopped being skipped, so Σ members reconciles with it.
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -20 });
    expect(commitCount).toBe(1);
  });

  it('splits the reversal across both credited members', async () => {
    const date = today();
    const habit = baseHabit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 2,
      totalCount: 2,
      completedDates: [],
      completedBy: { [date]: { 'user1': 1, 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    for (const uid of ['user1', 'jen-uid']) {
      expect(memberUpdate(uid)!.data['points.total']).toEqual({ __increment: -10 });
    }
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -20 });
  });

  it('leaves an AT-target incremental reset unchanged (control)', async () => {
    // The completion date already covers every attributed day, so the sweep adds
    // nothing: same clear, same member debit, same pool debit as before.
    const date = today();
    const habit = baseHabit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 3,
      totalCount: 3,
      completedDates: [date],
      completedBy: { [date]: { 'user1': 3 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayRemove: [date] });
    expect(habitUpdate()!.data[`completedBy.${date}`]).toEqual({ __deleteField: true });
    expect(memberUpdate('user1')!.data['points.total']).toEqual({ __increment: -30 });
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -30 });
  });

  it('keeps a grandfathered below-target reset on the legacy figure', async () => {
    // 🛡️ No `completedBy` → no orphans → no member write, and the pool still
    // takes `calculateResetPoints`' two units exactly as it always did.
    const habit = baseHabit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 2,
      totalCount: 2,
      completedDates: [],
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(capturedUpdates.filter(u => u.ref.__path.includes('/members/'))).toEqual([]);
    expect(Object.keys(habitUpdate()!.data).some(k => k.startsWith('completedBy.'))).toBe(false);
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -20 });
  });
});
