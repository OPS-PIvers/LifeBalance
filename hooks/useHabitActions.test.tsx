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
  unattributedPeriodPoints,
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

    // A back-dated submission must not touch today's live counter at all — the
    // key is OMITTED rather than re-written from the client cache (which would
    // clobber a concurrent credit from another device). Only the lifetime total
    // absorbs the count.
    expect('count' in habitUpdate()!.data).toBe(false);
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
    // Current period → a server-side delta, never an absolute client value.
    expect(hu!.data['count']).toEqual({ __increment: 1 });
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
    expect(hu!.data['count']).toEqual({ __increment: 1 });
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
    expect('count' in hu!.data).toBe(false);
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
    expect('count' in hu!.data).toBe(false);
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
    expect('count' in habitUpdate()!.data).toBe(false);
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('reverses a single-date weekly threshold clear at the AWARD date, not the cleared date', async () => {
    // 🔒 Regression (PR #1167 / TODO.md §3 fix). `resetHabitDay` always hands a
    // SINGLE date to `attributionReversalForDates` — but a weekly threshold
    // habit's award can still sit on an EARLIER day of the same period than
    // the day being cleared, and the pre-fix implementation gated the whole
    // reversal by the CLEARED date regardless. Order-independence (the other
    // regression, covered in habitAttribution.test.ts) never applied here —
    // this is the single-date shape of the same wrong rule, and it is real:
    // clearing TODAY's completion of a habit whose award actually landed on
    // Monday used to debit today's `points.daily`, which today never earned.
    //
    // Fixed system clock so this is deterministic on any CI weekday: Wed
    // 2026-07-15, in the ISO week Mon 2026-07-13 – Sun 2026-07-19.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    getDocsMock.mockResolvedValue(daySubmissionsSnap([]));

    const habit = baseHabit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 2,
      count: 2,
      totalCount: 2,
      completedDates: ['2026-07-15'], // only the day the target was crossed
      completedBy: {
        '2026-07-13': { user1: 1 }, // Monday — the member's FIRST attributed day = the award
        '2026-07-15': { user1: 1 }, // Wednesday (today) — the day being cleared
      },
      lastUpdated: '2026-07-15T08:30:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings)
    );

    await act(async () => {
      await result.current.resetHabitDay('h1', '2026-07-15');
    });

    // The whole period's attribution is cleared, progress day included.
    const hu = habitUpdate();
    expect(hu!.data['completedBy.2026-07-13']).toEqual({ __deleteField: true });
    expect(hu!.data['completedBy.2026-07-15']).toEqual({ __deleteField: true });

    const memberUpd = capturedUpdates.find(
      u => u.ref.__path === `${householdPath}/members/user1`,
    );
    expect(memberUpd).toBeDefined();
    // Gated by the AWARD date (Monday: inside the current week, but NOT
    // today) — daily must stay untouched. The pre-fix implementation gated by
    // the CLEARED date (Wednesday = today) and would have debited daily too.
    expect(memberUpd!.data['points.daily']).toBeUndefined();
    expect(memberUpd!.data['points.weekly']).toEqual({ __increment: -10 });
    expect(memberUpd!.data['points.total']).toEqual({ __increment: -10 });

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.daily']).toBeUndefined();
    expect(hh!.data['points.weekly']).toEqual({ __increment: -10 });
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });
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

    // Jen IS debited too, even though she is not the un-credited member: taking
    // Paul's unit out drops the week below target, which zeroes HER period award
    // as a side effect. Leaving that to the corrective recompute was the F1 bug
    // — `points.total` is a lifetime counter `computeMemberPointsSync` never
    // rebuilds, so the drift would have been permanent.
    //
    // 🛡️ HER debit is gated by HER OWN day (Wednesday = the fixture's today),
    // not by the `targetDate` this call was made against (Paul's Monday). That
    // is where her award lives: `memberPointsForHabitOnDate` puts a threshold
    // period's award on the member's FIRST attributed day, which is Wednesday
    // for Jen and Monday for Paul. This assertion used to read `toBeUndefined()`
    // — the pre-fix code ran every side-effect member through the CALLER's date
    // gate, so her `points.daily` kept 10 points for an award the recompute no
    // longer attributes to today.
    const expectedJenDelta = memberPeriodPointsDelta(habit, after, 'jen-uid', targetDate!, today);
    expect(expectedJenDelta).toBe(-10);
    const jenWrite = memberWrites().find(u => u.ref.__path.endsWith('jen-uid'));
    expect(jenWrite).toBeDefined();
    expect(jenWrite!.data['points.total']).toEqual({ __increment: expectedJenDelta });
    expect(jenWrite!.data['points.weekly']).toEqual({ __increment: expectedJenDelta });
    expect(jenWrite!.data['points.daily']).toEqual({ __increment: expectedJenDelta });

    // --- Household pool debit matches the shared formula exactly, bucket for
    // bucket: total/weekly carry BOTH awards, and daily carries only Jen's —
    // the pool is gated by the very same per-date decomposition the member
    // writes are, so the two can never disagree.
    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: expectedPoolDelta });
    expect(hh!.data['points.weekly']).toEqual({ __increment: expectedPoolDelta });
    expect(hh!.data['points.daily']).toEqual({ __increment: expectedJenDelta });

    // 🏁 THE INVARIANT: pool = Σ member awards + unattributed (0 for a fully
    // attributed threshold week), so the two sides of this batch must agree —
    // in EVERY bucket, not just the lifetime total.
    expect(expectedPaulDelta + expectedJenDelta).toBe(expectedPoolDelta);
    const summedMembers = (bucket: string) =>
      memberWrites().reduce(
        (sum, u) => sum + ((u.data[bucket] as { __increment: number } | undefined)?.__increment ?? 0),
        0,
      );
    for (const bucket of ['points.total', 'points.weekly', 'points.daily']) {
      expect(summedMembers(bucket)).toBe(
        (hh!.data[bucket] as { __increment: number } | undefined)?.__increment ?? 0,
      );
    }

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

// ---------------------------------------------------------------------------
// Past-day attribution: `addHabitSubmission` with an explicit member set.
// ---------------------------------------------------------------------------

describe('useHabitActions.addHabitSubmission (explicit attributeTo — past-day picker)', () => {
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);

  /** A date far enough back to sit outside the current Monday week, always. */
  const pastDate = () => format(subDays(new Date(), 10), 'yyyy-MM-dd');
  const pastStamp = () => `${pastDate()}T12:00:00`;

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
    getDocsMock.mockReset();
    getDocsMock.mockResolvedValue(submissionsSnap([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('credits the NAMED member, never the signed-in one (the mis-attribution bug)', async () => {
    // Back-filling a day your partner did used to credit YOU, silently and with
    // no way to say otherwise. The 6th argument is what makes it correctable.
    const D = pastDate();
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, pastStamp(), undefined, undefined, ['jen-uid']);
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!.data['attributedTo']).toBe('jen-uid');
    // The operator stays on the doc — that is the audit trail.
    expect(capturedSets[0]!.data['createdBy']).toBe('user1');

    const hu = habitUpdate()!;
    expect(hu.data[`completedBy.${D}.jen-uid`]).toEqual({ __increment: 1 });
    expect(hu.data[`completedBy.${D}.user1`]).toBeUndefined();

    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdate('user1')).toBeUndefined();
  });

  it('writes ONE submission doc per member for a two-person back-dated log, in one batch', async () => {
    const D = pastDate();
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, pastStamp(), undefined, undefined, ['user1', 'jen-uid'],
      );
    });

    expect(capturedSets).toHaveLength(2);
    expect(capturedSets.map(s => s.data['attributedTo'])).toEqual(['user1', 'jen-uid']);
    // One doc = one member = one unit bundle (never one doc of count 2).
    expect(capturedSets.every(s => s.data['count'] === 1)).toBe(true);

    const hu = habitUpdate()!;
    expect(hu.data[`completedBy.${D}.user1`]).toEqual({ __increment: 1 });
    expect(hu.data[`completedBy.${D}.jen-uid`]).toEqual({ __increment: 1 });
    expect(hu.data['totalCount']).toBe(2);
    // A1: a genuinely past-dated log writes NO `count` key at all.
    expect('count' in hu.data).toBe(false);

    expect(commitCount).toBe(1);
  });

  it("stores each doc's own member award, summing to the pool increment", async () => {
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, pastStamp(), undefined, undefined, ['user1', 'jen-uid'],
      );
    });

    expect(capturedSets[0]!.data['pointsEarned']).toBe(10);
    expect(capturedSets[1]!.data['pointsEarned']).toBe(10);
    const summed = capturedSets.reduce((n, s) => n + (s.data['pointsEarned'] as number), 0);
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: summed });
  });

  it('moves TOTAL only for a past-dated two-member log — pool and both member docs', async () => {
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, pastStamp(), undefined, undefined, ['user1', 'jen-uid'],
      );
    });

    for (const upd of [householdUpdate()!, memberUpdate('user1')!, memberUpdate('jen-uid')!]) {
      expect(upd.data['points.daily']).toBeUndefined();
      expect(upd.data['points.weekly']).toBeUndefined();
      expect(upd.data['points.total']).toBeDefined();
    }
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 20 });
    expect(memberUpdate('user1')!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: 10 });
  });

  it("moves daily+weekly+total for TODAY's two-member log, and increments the live counter", async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const habit = baseHabit({ completedDates: [], count: 0 });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, `${today}T12:00:00`, undefined, undefined, ['user1', 'jen-uid'],
      );
    });

    const hh = householdUpdate()!;
    expect(hh.data['points.total']).toEqual({ __increment: 20 });
    expect(hh.data['points.daily']).toEqual({ __increment: 20 });
    expect(hh.data['points.weekly']).toEqual({ __increment: 20 });
    // The race fix: a server-side delta, not an absolute client-cached value.
    expect(habitUpdate()!.data['count']).toEqual({ __increment: 2 });
  });

  it('gives a second member a FULL award on a threshold day another member already completed', async () => {
    // The locked competition model: both members completing the same threshold
    // day each earn a full award, and the grandfathering remainder is 0 — so
    // nothing is double-counted.
    const D = pastDate();
    const habit = baseHabit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 0,
      totalCount: 1,
      completedDates: [D],
      completedBy: { [D]: { 'user1': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, pastStamp(), undefined, undefined, ['jen-uid']);
    });

    expect(capturedSets[0]!.data['pointsEarned']).toBe(10);
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: 10 });
    // user1 already holds their award; nothing about it moves.
    expect(memberUpdate('user1')).toBeUndefined();
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: 10 });
  });

  it('is bit-for-bit the old behaviour when attributeTo is omitted', async () => {
    const D = pastDate();
    const habit = baseHabit({ completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, pastStamp());
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!.data['attributedTo']).toBe('user1');
    // The HABIT-level figure, not the member award (identical here, but this is
    // the branch that must not change shape).
    expect(capturedSets[0]!.data['pointsEarned']).toBe(10);
    const hu = habitUpdate()!;
    expect(Object.keys(hu.data).filter(k => k.startsWith('completedBy.'))).toEqual([
      `completedBy.${D}.user1`,
    ]);
  });

  it('feeds pausedUntil into the streak recompute (parity with creditHabitCompletion)', async () => {
    // Monday 2026-07-13 completed, then a planned break through Thursday
    // 2026-07-16. Logging Friday must BRIDGE the break (streak 2), not restart
    // it (streak 1) — which is what omitting pausedUntil produced.
    vi.useFakeTimers({ now: new Date('2026-07-17T09:00:00') });
    const habit = baseHabit({
      completedDates: ['2026-07-13'],
      pausedUntil: '2026-07-16',
      count: 0,
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, '2026-07-17T12:00:00');
    });

    expect(habitUpdate()!.data['streakDays']).toBe(2);
    expect(habitUpdate()!.data['streakDays']).toBe(
      streakForHabit({
        period: 'daily',
        completedDates: ['2026-07-17', '2026-07-13'],
        pausedUntil: '2026-07-16',
      })
    );
  });

  it('accepts a later-day credit in an already-complete weekly threshold period WITHOUT paying twice', async () => {
    // ACCEPTED AS DESIGNED. The day editor's `credited` state is DAY-scoped, so
    // a weekly habit whose week was already completed can take a credit on a
    // different day of that week. The week is the completion unit: the date does
    // NOT join `completedDates`, the household pool does not move at all, and
    // the credited member simply takes over the week's (previously
    // grandfathered) award.
    vi.useFakeTimers({ now: new Date('2026-07-24T09:00:00') }); // Fri, week of 07-20
    const habit = baseHabit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 3,
      count: 0,
      totalCount: 3,
      completedDates: ['2026-07-13'], // Mon of the PREVIOUS week — target met by toggling
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, '2026-07-15T12:00:00', undefined, undefined, ['jen-uid'],
      );
    });

    const hu = habitUpdate()!;
    expect(hu.data['completedBy.2026-07-15.jen-uid']).toEqual({ __increment: 1 });
    // Below target for the week, so the date never enters completedDates…
    expect('completedDates' in hu.data).toBe(false);
    // …and a past period never touches the live counter.
    expect('count' in hu.data).toBe(false);
    // NO DOUBLE AWARD: the week already paid the household; attributing it to
    // Jen moves it from the grandfathered remainder onto her, net zero.
    expect(householdUpdate()).toBeUndefined();
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: 10 });
    expect(memberUpdate('jen-uid')!.data['points.weekly']).toBeUndefined();
  });
});

describe('useHabitActions.deleteHabitSubmission (past-day undo)', () => {
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
  const submissionDoc = (data: Record<string, unknown>) =>
    ({ exists: () => true, data: () => data }) as unknown as Awaited<ReturnType<typeof getDoc>>;
  const dateQuerySnap = (size: number) =>
    ({ size, empty: size === 0, docs: [] }) as unknown as Awaited<ReturnType<typeof getDocs>>;

  const pastDate = () => format(subDays(new Date(), 10), 'yyyy-MM-dd');

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

  it('leaves the live counter ALONE when the deleted submission is past-dated', async () => {
    // The counter belongs to a period that reset days ago; shrinking it here
    // silently un-did a completion still on screen.
    const D = pastDate();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date: D, count: 1, pointsEarned: 10,
      createdBy: 'user1', attributedTo: 'user1',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({
      completedDates: [D],
      count: 3, // today's live progress, untouched by this delete
      totalCount: 4,
      completedBy: { [D]: { 'user1': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1'))
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect('count' in habitUpdate()!.data).toBe(false);
    expect(habitUpdate()!.data['totalCount']).toBe(3);
    expect(commitCount).toBe(1);
  });

  it('does NOT debit the pool twice when an attributed doc has already been un-credited', async () => {
    // The exact no-race sequence: credit Jen on a past day from the day editor
    // (doc + completedBy + pool), un-credit her from the Habits-page picker
    // (which zeroes completedBy and debits the pool but never touches the doc),
    // then delete the now-orphaned doc. Falling back to `legacyDelta` here
    // debited the pool a SECOND time — and computeHouseholdPointsSync only ever
    // RAISES the stored total, so that drift is permanent.
    const D = pastDate();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date: D, count: 1, pointsEarned: 10,
      createdBy: 'user1', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({
      // The un-credit already removed D from completedDates and zeroed Jen's node.
      completedDates: [],
      count: 0,
      totalCount: 1,
      completedBy: { [D]: { 'jen-uid': 0 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    // Stored attribution says there is nothing left to reverse → reverse NOTHING.
    expect(householdUpdate()).toBeUndefined();
    expect(memberUpdate('jen-uid')).toBeUndefined();
    expect(Object.keys(habitUpdate()!.data).some(k => k.startsWith('completedBy.'))).toBe(false);
    expect(commitCount).toBe(1);
  });

  it('reverses the WHOLE doc when a pre-feature multi-unit log holds the day', async () => {
    // ACCEPTED AS DESIGNED: "un-credit this person for this day" takes back the
    // doc that recorded the day, units and all — there is no per-unit split of a
    // single submission.
    const D = pastDate();
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date: D, count: 3, pointsEarned: 30,
      createdBy: 'jen-uid', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = baseHabit({
      completedDates: [D],
      count: 0,
      totalCount: 3,
      completedBy: { [D]: { 'jen-uid': 3 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect(habitUpdate()!.data[`completedBy.${D}.jen-uid`]).toEqual({ __increment: -3 });
    expect(habitUpdate()!.data['totalCount']).toBe(0);
    expect(memberUpdate('jen-uid')!.data['points.total']).toEqual({ __increment: -30 });
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -30 });
  });
});

// ---------------------------------------------------------------------------
// 🏁 THE MEMBER RULE: the member docs a path writes must cover the same
// PERIOD-WIDE scope its pool delta was computed over.
//
// On a THRESHOLD period spanning several days (a weekly habit) one member's own
// award flips from 0 to a full award as a SIDE EFFECT of a different member's
// later-day credit completing the period. Writing only the uids the CALL was
// handed moved the pool by more than the sum of the member writes — and nothing
// self-heals it: `computeMemberPointsSync` rebuilds only daily/weekly (`total`
// is a lifetime counter it never touches), and a closed week's `weekly` is
// never revisited either.
//
// Every test here asserts BOTH member docs move AND `Σ member deltas === the
// pool delta` — the invariant `household = Σ member awards + unattributed`,
// whose unattributed term is 0 for a fully-attributed threshold period.
// ---------------------------------------------------------------------------

describe('useHabitActions — period-wide member point writes (household = Σ members)', () => {
  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
  const memberWrites = () => capturedUpdates.filter(u => u.ref.__path.includes('/members/'));
  const totalOf = (u: CapturedUpdate | undefined) =>
    (u?.data['points.total'] as { __increment: number } | undefined)?.__increment;
  /** Σ of every member doc's `points.total` move in this batch. */
  const summedMemberTotals = () =>
    memberWrites().reduce((sum, u) => sum + (totalOf(u) ?? 0), 0);

  const submissionDoc = (data: Record<string, unknown>) =>
    ({ exists: () => true, data: () => data }) as unknown as Awaited<ReturnType<typeof getDoc>>;
  const dateQuerySnap = (size: number) =>
    ({ size, empty: size === 0, docs: [] }) as unknown as Awaited<ReturnType<typeof getDocs>>;

  // A fixture anchored to its OWN week, never to an offset from `new Date()`.
  // Friday 2026-07-24 sits in the week of Mon 2026-07-20, so the week of Mon
  // 2026-07-13 is fully CLOSED — which is the case no recompute revisits.
  const NOW = new Date('2026-07-24T09:00:00');
  const MON = '2026-07-13';
  const WED = '2026-07-15';

  /** Weekly threshold, target 2 — the shape where the side-effect award lives. */
  const weeklyPair = (overrides: Partial<Habit>) => baseHabit({
    period: 'weekly',
    scoringType: 'threshold',
    targetCount: 2,
    basePoints: 10,
    lastUpdated: '2026-07-24T08:00:00',
    ...overrides,
  });

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addHabitSubmission: a later-day credit that COMPLETES the week pays the earlier member too', async () => {
    // Step 1 (already applied to the fixture): user1 credited for Monday →
    // period 1/2, nobody scored. Step 2: Jen credited for Wednesday → the week
    // reaches 2/2 and BOTH members' awards land. Writing only Jen left user1
    // permanently 10 points short of the pool.
    vi.useFakeTimers({ now: NOW });
    const habit = weeklyPair({
      count: 0,
      totalCount: 1,
      completedDates: [],
      completedBy: { [MON]: { 'user1': 1 } },
    });
    // The Monday submission written by step 1 — production's prior-period read.
    getDocsMock.mockResolvedValue(submissionsSnap([1]));

    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, `${WED}T12:00:00`, undefined, undefined, ['jen-uid'],
      );
    });

    // The week completes, so Wednesday enters completedDates…
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [WED] });
    // …and BOTH member docs are written, not just the one this call named.
    expect(totalOf(memberUpdate('jen-uid'))).toBe(10);
    expect(totalOf(memberUpdate('user1'))).toBe(10);
    // A closed week: total only — which is exactly why nothing would have
    // corrected the missing write later.
    expect(memberUpdate('user1')!.data['points.weekly']).toBeUndefined();
    expect(memberUpdate('user1')!.data['points.daily']).toBeUndefined();

    expect(totalOf(householdUpdate())).toBe(20);
    expect(summedMemberTotals()).toBe(totalOf(householdUpdate()));
    expect(commitCount).toBe(1);
  });

  it('deleteHabitSubmission: un-completing the week reverses BOTH members', async () => {
    // The mirror. Deleting Jen's Wednesday doc drops the week below target,
    // which zeroes user1's Monday award too — bounding the reversal to the
    // deleted doc's single uid left user1 holding points the pool gave back.
    vi.useFakeTimers({ now: NOW });
    getDocMock.mockResolvedValue(submissionDoc({
      habitId: 'h1', date: WED, count: 1, pointsEarned: 10,
      createdBy: 'user1', attributedTo: 'jen-uid',
      streakDaysAtTime: 1, multiplierApplied: 1,
    }));
    getDocsMock.mockResolvedValue(dateQuerySnap(1));

    const habit = weeklyPair({
      count: 0,
      totalCount: 2,
      completedDates: [WED],
      completedBy: { [MON]: { 'user1': 1 }, [WED]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect(totalOf(memberUpdate('jen-uid'))).toBe(-10);
    expect(totalOf(memberUpdate('user1'))).toBe(-10);
    // Only Jen's attributed unit comes off the habit doc — user1 keeps his
    // Monday UNIT; it is only his period AWARD that goes away.
    expect(habitUpdate()!.data[`completedBy.${WED}.jen-uid`]).toEqual({ __increment: -1 });
    expect(habitUpdate()!.data[`completedBy.${MON}.user1`]).toBeUndefined();

    expect(totalOf(householdUpdate())).toBe(-20);
    expect(summedMemberTotals()).toBe(totalOf(householdUpdate()));
    expect(commitCount).toBe(1);
  });

  it('creditHabitCompletion: picking "Me" then separately "Jen" pays both, not just Jen', async () => {
    // The Habits-page shape of the same bug: two single-member picks on a
    // weekly threshold habit. The fixture is the state after the first pick.
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = weeklyPair({
      count: 1,
      totalCount: 1,
      completedDates: [],
      completedBy: { [WED]: { 'user1': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['jen-uid']);
    });

    expect(totalOf(memberUpdate('jen-uid'))).toBe(10);
    expect(totalOf(memberUpdate('user1'))).toBe(10);
    expect(totalOf(householdUpdate())).toBe(20);
    expect(summedMemberTotals()).toBe(totalOf(householdUpdate()));
    expect(commitCount).toBe(1);
  });

  it('uncreditHabitCompletion: dropping the week below target reverses both members', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-15T09:00:00') });
    const habit = weeklyPair({
      count: 2,
      totalCount: 2,
      completedDates: [WED],
      completedBy: { [WED]: { 'user1': 1, 'jen-uid': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.uncreditHabitCompletion('h1', 'jen-uid', WED);
    });

    expect(totalOf(memberUpdate('jen-uid'))).toBe(-10);
    expect(totalOf(memberUpdate('user1'))).toBe(-10);
    expect(totalOf(householdUpdate())).toBe(-20);
    expect(summedMemberTotals()).toBe(totalOf(householdUpdate()));
    expect(commitCount).toBe(1);
  });

  it('REGRESSION PIN: the ordinary single-member incremental day still writes exactly ONE member doc', async () => {
    // The period-wide scan must not manufacture writes. Jen already holds a
    // unit on this day, but an incremental award depends only on the member's
    // OWN units and streak — so her delta is 0 and her doc is left alone.
    vi.useFakeTimers({ now: NOW });
    getDocsMock.mockResolvedValue(submissionsSnap([]));
    const habit = baseHabit({
      scoringType: 'incremental',
      period: 'daily',
      basePoints: 10,
      count: 0,
      totalCount: 1,
      completedDates: [WED],
      completedBy: { [WED]: { 'jen-uid': 1 } },
      lastUpdated: '2026-07-24T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission(
        'h1', 1, `${WED}T12:00:00`, undefined, undefined, ['user1'],
      );
    });

    expect(memberWrites()).toHaveLength(1);
    expect(totalOf(memberUpdate('user1'))).toBe(10);
    expect(memberUpdate('jen-uid')).toBeUndefined();
    expect(totalOf(householdUpdate())).toBe(10);
    expect(summedMemberTotals()).toBe(totalOf(householdUpdate()));
  });
});

// 🛡️ The two findings the period-wide rule was written for, on the paths that
// still bypassed it.
//
// F1 — `toggleHabit` (the ordinary tap, by far the most-used gesture in the
// app) computed its member writes from the ACTING member alone while its pool
// delta already summed every member holding attribution anywhere in the period.
// A weekly `targetCount: 2` habit completed by a second member on a later day
// therefore paid the pool 20 and one member 10, permanently shorting the other
// member's lifetime `points.total` — which no recompute rebuilds.
//
// F2 — every side-effect member's delta was written through the CALLER's date
// gate. A member whose award lives on an earlier day of the same live week had
// their `points.daily` moved for a day they never acted on, contradicting
// `memberPointsForHabitOnDate` (which puts a threshold period's award on the
// member's FIRST attributed day).
describe('useHabitActions — the awarding date, not the triggering date (F1 + F2)', () => {
  // Monday 2026-07-13 and Wednesday 2026-07-15 sit in ONE Monday-anchored week,
  // and Wednesday is the fixture's "today" — the live week, which is exactly
  // where the daily/weekly gating is observable. Anchored to its own week, never
  // to an offset from `new Date()`.
  const MON = '2026-07-13';
  const WED = '2026-07-15';
  const NOW = new Date('2026-07-15T09:00:00');

  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
  const memberWrites = () => capturedUpdates.filter(u => u.ref.__path.includes('/members/'));
  const bucketOf = (u: CapturedUpdate | undefined, bucket: string) =>
    (u?.data[bucket] as { __increment: number } | undefined)?.__increment ?? 0;
  /** 🏁 household = Σ members + unattributed, in EVERY bucket. */
  const expectPoolEqualsMembers = () => {
    for (const bucket of ['points.total', 'points.weekly', 'points.daily']) {
      expect(memberWrites().reduce((sum, u) => sum + bucketOf(u, bucket), 0)).toBe(
        bucketOf(householdUpdate(), bucket),
      );
    }
  };

  /**
   * Weekly threshold, target 2 — the shape where one member's award flips from
   * 0 to a full one as a SIDE EFFECT of another member's later-day completion.
   * The fixture is the state after user1's Monday tap: one unit banked, the
   * period still 1/2, so nothing has been awarded yet. `lastUpdated` sits in the
   * same week as `NOW`, so the habit is NOT stale (no lazy reset).
   */
  const afterMondayTap = () => baseHabit({
    period: 'weekly',
    scoringType: 'threshold',
    targetCount: 2,
    basePoints: 10,
    count: 1,
    totalCount: 1,
    completedDates: [],
    completedBy: { [MON]: { 'user1': 1 } },
    lastUpdated: `${MON}T09:00:00`,
  });

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('F1: a plain toggle that COMPLETES a weekly threshold week pays the earlier member too', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = afterMondayTap();
    // Jen is the one tapping on Wednesday — the plain toggle attributes to the
    // signed-in member, so she is `currentUser` here, not user1.
    const jen = { uid: 'jen-uid' } as HouseholdMember;
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, jen, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // The tap crosses the target, so Wednesday enters completedDates and only
    // Jen's own unit is attributed…
    const hu = habitUpdate()!;
    expect(hu.data['completedDates']).toEqual({ __arrayUnion: [WED] });
    expect(hu.data[`completedBy.${WED}.jen-uid`]).toEqual({ __increment: 1 });
    expect(hu.data[`completedBy.${MON}.user1`]).toBeUndefined();

    // …but BOTH awards materialize, so BOTH member docs must be written. The
    // pre-fix toggle wrote only Jen's, and user1's +10 was lost forever.
    expect(bucketOf(memberUpdate('user1'), 'points.total')).toBe(10);
    expect(bucketOf(memberUpdate('jen-uid'), 'points.total')).toBe(10);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(20);
    expect(memberWrites()).toHaveLength(2);

    // F2 on the same tap: user1's award belongs to MONDAY, so it moves his
    // weekly and lifetime totals but NOT today's daily.
    expect(memberUpdate('user1')!.data['points.daily']).toBeUndefined();
    expect(bucketOf(memberUpdate('user1'), 'points.weekly')).toBe(10);
    expect(bucketOf(memberUpdate('jen-uid'), 'points.daily')).toBe(10);

    // Σ member deltas === the pool delta, in every bucket.
    expectPoolEqualsMembers();
    expect(bucketOf(householdUpdate(), 'points.daily')).toBe(10);
    expect(bucketOf(householdUpdate(), 'points.weekly')).toBe(20);
    expect(commitCount).toBe(1);
  });

  it('F2: a side-effect award inside the LIVE week is gated by its own day, pool and member alike', async () => {
    // The trigger date IS today (Wednesday); user1's award date is Monday, an
    // earlier day of the SAME live week — the one window where the caller's gate
    // and the awarding day disagree on `daily` while both still move `weekly`.
    vi.useFakeTimers({ now: NOW });
    const habit = afterMondayTap();
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['jen-uid']);
    });

    // user1 never acted today, so his daily must not move — `points.daily` is
    // rebuilt by `computeMemberPointsReset` from `memberPointsForHabitOnDate`,
    // which attributes his award to MONDAY (his first attributed day in the
    // period). The pre-fix code wrote it through the caller's Wednesday gate.
    const user1Write = memberUpdate('user1')!;
    expect(user1Write.data['points.daily']).toBeUndefined();
    expect(bucketOf(user1Write, 'points.weekly')).toBe(10);
    expect(bucketOf(user1Write, 'points.total')).toBe(10);

    // Jen DID act today, so all three of her buckets move.
    const jenWrite = memberUpdate('jen-uid')!;
    expect(bucketOf(jenWrite, 'points.daily')).toBe(10);
    expect(bucketOf(jenWrite, 'points.weekly')).toBe(10);
    expect(bucketOf(jenWrite, 'points.total')).toBe(10);

    // 🛡️ THE CONSISTENCY REQUIREMENT: the pool is gated by the SAME per-date
    // decomposition, so it carries both awards in weekly/total and only Jen's in
    // daily — matching what `calculateHouseholdPointsForDate` derives for today.
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(20);
    expect(bucketOf(householdUpdate(), 'points.weekly')).toBe(20);
    expect(bucketOf(householdUpdate(), 'points.daily')).toBe(10);
    expectPoolEqualsMembers();
    expect(commitCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Household credit mode (`Habit.creditMode === 'household'`)
//
// 🏁 THE MECHANISM UNDER TEST: a household completion writes NO `completedBy`
// entry, so it scores through the EXISTING unattributed path — one award at the
// habit's own flame, paid to the pool, credited to nobody. These tests pin the
// invariant `household = Σ members + unattributed` on both sides of it.
// ---------------------------------------------------------------------------
describe('useHabitActions — household credit mode', () => {
  // Wednesday, mid-week: daily/weekly/total all move, so a missing bucket is
  // visible. Anchored to its own week, never to an offset from `new Date()`.
  const NOW = new Date('2026-07-15T09:00:00');
  const TODAY = '2026-07-15';

  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdate = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
  const memberWrites = () => capturedUpdates.filter(u => u.ref.__path.includes('/members/'));
  const bucketOf = (u: CapturedUpdate | undefined, bucket: string) =>
    (u?.data[bucket] as { __increment: number } | undefined)?.__increment ?? 0;
  /** Every `completedBy.*` key this batch wrote to the habit doc. */
  const attributionKeys = () =>
    Object.keys(habitUpdate()?.data ?? {}).filter(k => k.startsWith('completedBy'));

  /** Daily incremental, 10 pts, crediting the HOUSEHOLD. Not stale at NOW. */
  const householdHabit = (overrides: Partial<Habit> = {}) => baseHabit({
    creditMode: 'household',
    basePoints: 10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 1,
    lastUpdated: '2026-07-15T08:00:00',
    ...overrides,
  });

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
    updateDocMock.mockClear();
    getDocsMock.mockReset();
    getDocMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('toggleHabit: a household completion writes NO completedBy and moves ONLY the pool', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({ count: 0, totalCount: 0, completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // Nobody is credited — that IS household credit.
    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);

    // One award at the habit's own flame, to the pool.
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(10);
    expect(bucketOf(householdUpdate(), 'points.daily')).toBe(10);
    expect(bucketOf(householdUpdate(), 'points.weekly')).toBe(10);
    expect(commitCount).toBe(1);
  });

  it('toggleHabit: the pool delta EQUALS the unattributed remainder for the period', async () => {
    // 🏁 The invariant, stated as an assert, on the case that can actually break
    // it: a period that ALREADY carries a member's per-completion override. The
    // household unit must pay the pool exactly the unattributed remainder's own
    // move — not the sum, and not a second copy of Jen's award.
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({
      count: 1,
      totalCount: 1,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // The state this batch actually writes: one more unit, same attribution.
    const after = { ...habit, count: 2, totalCount: 2, completedDates: [TODAY] };
    const expectedUnattributedDelta =
      unattributedPeriodPoints(after, TODAY, TODAY) -
      unattributedPeriodPoints(habit, TODAY, TODAY);

    expect(expectedUnattributedDelta).toBe(10);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(expectedUnattributedDelta);
    // household = Σ members + unattributed, and Σ members moved by nothing.
    expect(memberWrites()).toHaveLength(0);
    expect(attributionKeys()).toEqual([]);
  });

  it('toggleHabit down: takes back the unattributed unit, never a member’s override', async () => {
    // 🛡️ Without the household guard, `reversalMoves` falls back to whoever
    // HOLDS attribution on the date — so an ordinary down-tap would debit Jen
    // for a unit it never touched, and `points.total` never self-heals.
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({
      count: 2,
      totalCount: 2,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'down');
    });

    expect(memberWrites()).toHaveLength(0);
    expect(attributionKeys()).toEqual([]);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
    expect(commitCount).toBe(1);
  });

  it('creditHabitCompletion: a member override on a household habit pays the pool ONCE', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({ count: 0, totalCount: 0, completedDates: [] });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['jen-uid']);
    });

    // The explicit pick wins over the habit's default: Jen IS credited.
    expect(habitUpdate()!.data[`completedBy.${TODAY}.jen-uid`]).toEqual({ __increment: 1 });
    expect(bucketOf(memberUpdate('jen-uid'), 'points.total')).toBe(10);
    // …and the pool receives her award ONCE — the unattributed remainder is 0
    // because the single unit is now attributed.
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(10);
    for (const bucket of ['points.total', 'points.weekly', 'points.daily']) {
      expect(memberWrites().reduce((sum, u) => sum + bucketOf(u, bucket), 0)).toBe(
        bucketOf(householdUpdate(), bucket),
      );
    }
    expect(commitCount).toBe(1);
  });

  it('creditHouseholdCompletion: one unattributed unit, pool only', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 0,
      totalCount: 0,
      completedDates: [],
      lastUpdated: '2026-07-15T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      // A one-off team effort on a habit whose DEFAULT is member credit.
      await result.current.creditHouseholdCompletion('h1');
    });

    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [TODAY] });
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(10);
  });

  it('uncreditHouseholdCompletion: reverses the pool and debits nobody', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 1,
      totalCount: 1,
      completedDates: [TODAY],
      lastUpdated: '2026-07-15T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.uncreditHouseholdCompletion('h1');
    });

    expect(memberWrites()).toHaveLength(0);
    expect(attributionKeys()).toEqual([]);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
  });

  it('addHabitSubmission with an empty attributeTo logs ONE unattributed doc', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 0,
      totalCount: 0,
      completedDates: [],
      lastUpdated: '2026-07-15T08:00:00',
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.addHabitSubmission('h1', 1, `${TODAY}T12:00:00`, undefined, undefined, []);
    });

    expect(capturedSets).toHaveLength(1);
    const submissionDoc = capturedSets[0]!.data;
    expect(submissionDoc['attributedTo']).toBeUndefined();
    expect(submissionDoc['creditsHousehold']).toBe(true);
    // The doc records the POOL's own move, so a stored-figure reversal undoes
    // exactly what was credited.
    expect(submissionDoc['pointsEarned']).toBe(bucketOf(householdUpdate(), 'points.total'));
    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);
  });

  it('deleteHabitSubmission: a household doc debits nobody, even with an override on the date', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 2,
      totalCount: 2,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'jen-uid': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        createdBy: 'user1', creditsHousehold: true, createdAt: '2026-07-15T08:30:00',
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);
    getDocsMock.mockResolvedValue(
      { size: 2, empty: false, docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>,
    );

    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    // 🛡️ `createdBy` is the OPERATOR, not a credit — deleting must not debit
    // user1, and the holder fallback must not debit Jen either.
    expect(memberWrites()).toHaveLength(0);
    expect(attributionKeys()).toEqual([]);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
  });

  // -------------------------------------------------------------------------
  // 🛡️ THE OTHER MEMBER-LESS SHAPE: a doc carrying NEITHER `attributedTo` NOR
  // `creditsHousehold`. Three live writers produce it — `transactionMutations`'
  // keyword fire (`createdBy` = whoever VERIFIED the triggering transaction, a
  // REAL member uid), `noSpendFire` (`createdBy: 'system'`) and the backfill
  // script (`createdBy: 'migration_script'`) — plus all pre-attribution
  // history. None of them credited ANYBODY: they write no `completedBy`.
  //
  // `createdBy` is the OPERATOR (schema + the add path's own comment), never a
  // credit, so resolving `creditedUid = attributedTo ?? createdBy` and running
  // `reversalMoves` on it takes units off a member this doc never touched —
  // their own genuine completion, or (via `resolveReversalSources`' holder
  // fallback) some other member's entirely. Reachable today: the submission log
  // modal lists these docs unfiltered and its delete button hits this path.
  // -------------------------------------------------------------------------

  it('deleteHabitSubmission: an automation doc never debits its OPERATOR’s own attribution', async () => {
    // The keyword-fire shape: `createdBy` is a real member uid, and that member
    // separately holds a genuine completion on the same date. Reversing off
    // `createdBy` strips the completion they actually earned.
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 2,
      totalCount: 2,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'user1': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        // NEITHER attributedTo NOR creditsHousehold — plus the automation's own
        // audit field, which is what makes this doc's provenance unambiguous.
        createdBy: 'user1', sourceTransactionId: 'txn_9', createdAt: '2026-07-15T08:30:00',
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);
    getDocsMock.mockResolvedValue(
      { size: 2, empty: false, docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>,
    );

    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    // Pre-fix: `completedBy.<TODAY>.user1: -1` and `points.total: -10` on user1.
    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);
    // The pool still reverses the doc's stored figure — the only record of what
    // a doc that credited nobody was actually credited.
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
    expect(commitCount).toBe(1);
  });

  it('deleteHabitSubmission: an automation doc never debits an UNRELATED holder either', async () => {
    // Same doc, but `createdBy` holds nothing that day — so
    // `resolveReversalSources`' holder fallback reaches for Jen instead, a
    // member with no connection whatsoever to this doc.
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 2,
      totalCount: 2,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'jen-uid': 1 } },
      lastUpdated: '2026-07-15T08:00:00',
    });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        createdBy: 'user1', createdAt: '2026-07-15T08:30:00',
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);
    getDocsMock.mockResolvedValue(
      { size: 2, empty: false, docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>,
    );

    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    // Pre-fix: `completedBy.<TODAY>.jen-uid: -1` and `points.total: -10` on Jen.
    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
    expect(commitCount).toBe(1);
  });

  it('deleteHabitSubmission: a member-less doc on an UNATTRIBUTED date is unchanged (control)', async () => {
    // 🔒 The row that was already correct pre-fix, pinned so the fix is proven
    // to have generalised the right answer rather than invented a new one: no
    // attribution anywhere on the date → nothing member-level to take back, and
    // the pool reverses the stored `pointsEarned` through `legacyDelta`.
    vi.useFakeTimers({ now: NOW });
    const habit = baseHabit({
      basePoints: 10,
      scoringType: 'incremental',
      count: 2,
      totalCount: 2,
      completedDates: [TODAY],
      lastUpdated: '2026-07-15T08:00:00',
    });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        createdBy: 'system', createdAt: '2026-07-15T08:30:00',
      }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);
    getDocsMock.mockResolvedValue(
      { size: 2, empty: false, docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>,
    );

    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.deleteHabitSubmission('h1', 's1');
    });

    expect(attributionKeys()).toEqual([]);
    expect(memberWrites()).toHaveLength(0);
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-10);
    expect(commitCount).toBe(1);
  });

  it('an assignedTo chore ignores creditMode entirely', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({
      assignedTo: 'kid_leo',
      count: 0,
      totalCount: 0,
      completedDates: [],
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'kid_leo'),
      )
    );

    await act(async () => {
      await result.current.toggleHabit('h1', 'up');
    });

    // Attribution is still recorded for the ASSIGNEE…
    expect(habitUpdate()!.data[`completedBy.${TODAY}.kid_leo`]).toEqual({ __increment: 1 });
    // …the points land on the kid's own doc at the legacy habit-level figure…
    expect(bucketOf(memberUpdate('kid_leo'), 'points.total')).toBe(10);
    // …and the shared household pool receives nothing at all.
    expect(householdUpdate()).toBeUndefined();
  });

  it('updateHabit: changing creditMode writes the field and no points at all', async () => {
    vi.useFakeTimers({ now: NOW });
    const habit = householdHabit({
      creditMode: 'members',
      count: 1,
      totalCount: 1,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { 'jen-uid': 1 } },
    });
    const { result } = renderHook(() =>
      useHabitActions(
        HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
      )
    );

    await act(async () => {
      await result.current.updateHabit({ ...habit, creditMode: 'household' });
    });

    const payload = updateDocMock.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(payload['creditMode']).toBe('household');
    // No points move, and the existing attribution is not disturbed: flipping
    // the mode is forward-looking only, and days already credited keep credit.
    expect(capturedUpdates).toHaveLength(0);
    expect(commitCount).toBe(0);
    expect(Object.keys(payload).some(k => k.startsWith('points.'))).toBe(false);
    expect(Object.keys(payload).some(k => k.startsWith('completedBy'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🔒 Regression (adversarial review, PR #1165) — THE MIXED WEEK.
//
// Household credit makes a shape that used to be exotic routine: ONE period
// holding both an attributed day and an unattributed one. The incremental
// reversal branch scored each cleared date as an ABSOLUTE figure against a
// progressively-stripped habit, and `unattributedPointsForHabitOnDate` gates on
// `periodHasAttribution` — which is PERIOD-wide. So the unattributed day,
// processed AFTER the attributed one, was re-scored as fully grandfathered and
// debited the pool a remainder that had already been taken off.
//
// The whole sequence runs through the real hook here, because the ORDER that
// broke it is not something a caller chooses: `arrayUnion` APPENDS, so a
// back-dated Monday credit lands after Wednesday in `completedDates`.
// ---------------------------------------------------------------------------
describe('useHabitActions — a mixed household/member week resets to exactly zero', () => {
  const NOW = new Date('2026-07-16T09:00:00'); // Thursday
  const MON = '2026-07-13';
  const WED = '2026-07-15';

  const roster = (...uids: string[]) => uids.map(uid => ({ uid })) as HouseholdMember[];
  const memberUpdateOf = (uid: string) =>
    capturedUpdates.find(u => u.ref.__path === `${householdPath}/members/${uid}`);
  const bucketOf = (u: CapturedUpdate | undefined, bucket: string) =>
    (u?.data[bucket] as { __increment: number } | undefined)?.__increment ?? 0;
  /** Every increment written to one doc for one bucket, summed across batches. */
  const runningTotal = (path: string, bucket: string) =>
    capturedUpdates
      .filter(u => u.ref.__path === path)
      .reduce((sum, u) => sum + bucketOf(u, bucket), 0);

  /** Weekly incremental, 10 pts, crediting the HOUSEHOLD. Not stale at NOW. */
  const weeklyHouseholdHabit = (overrides: Partial<Habit>): Habit => baseHabit({
    creditMode: 'household',
    period: 'weekly',
    scoringType: 'incremental',
    basePoints: 10,
    targetCount: 1,
    lastUpdated: '2026-07-13T08:00:00',
    ...overrides,
  });

  beforeEach(() => {
    capturedUpdates.length = 0;
    capturedSets.length = 0;
    capturedDeletes.length = 0;
    commitCount = 0;
    nextCommitError = null;
    incrementMock.mockClear();
    updateDocMock.mockClear();
    getDocsMock.mockReset();
    getDocMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('credit Jen Wednesday, credit the household Monday, reset: pool and Jen both land at 0', async () => {
    vi.useFakeTimers({ now: NOW });

    const step1 = weeklyHouseholdHabit({ count: 0, totalCount: 0, completedDates: [] });
    const { result, rerender } = renderHook(
      ({ habits }: { habits: Habit[] }) =>
        useHabitActions(
          HOUSEHOLD_ID, currentUser, habits, householdSettings, [], roster('user1', 'jen-uid'),
        ),
      { initialProps: { habits: [step1] } },
    );

    // 1 — a member override on a household habit: pool +10, Jen +10.
    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['jen-uid'], WED);
    });
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(10);
    expect(bucketOf(memberUpdateOf('jen-uid'), 'points.total')).toBe(10);

    // The state that batch wrote.
    const step2 = weeklyHouseholdHabit({
      count: 1,
      totalCount: 1,
      completedDates: [WED],
      completedBy: { [WED]: { 'jen-uid': 1 } },
    });
    rerender({ habits: [step2] });
    capturedUpdates.length = 0;

    // 2 — a back-dated household credit for Monday: pool +10, nobody credited.
    await act(async () => {
      await result.current.creditHouseholdCompletion('h1', MON);
    });
    expect(bucketOf(householdUpdate(), 'points.total')).toBe(10);
    expect(capturedUpdates.filter(u => u.ref.__path.includes('/members/'))).toHaveLength(0);
    // 🛡️ The ordering that broke this: `arrayUnion` APPENDS, so Monday lands
    // after Wednesday in `completedDates`.
    expect(habitUpdate()!.data['completedDates']).toEqual({ __arrayUnion: [MON] });

    const step3 = weeklyHouseholdHabit({
      count: 2,
      totalCount: 2,
      completedDates: [WED, MON], // Wednesday first — arrayUnion's real order
      completedBy: { [WED]: { 'jen-uid': 1 } },
    });
    rerender({ habits: [step3] });
    capturedUpdates.length = 0;

    // 3 — the reset gives back exactly the 20 the pool holds and Jen's 10.
    await act(async () => {
      await result.current.resetHabit('h1');
    });

    expect(bucketOf(householdUpdate(), 'points.total')).toBe(-20);
    expect(bucketOf(householdUpdate(), 'points.weekly')).toBe(-20);
    // Neither cleared day is today, so today's bucket must not move at all.
    expect(bucketOf(householdUpdate(), 'points.daily')).toBe(0);
    expect(bucketOf(memberUpdateOf('jen-uid'), 'points.total')).toBe(-10);

    // Only Wednesday carried attribution, so only Wednesday is cleared.
    expect(habitUpdate()!.data[`completedBy.${WED}`]).toEqual({ __deleteField: true });
    expect(habitUpdate()!.data[`completedBy.${MON}`]).toBeUndefined();
  });

  it('nets both counters to zero across all three writes', async () => {
    vi.useFakeTimers({ now: NOW });

    const states: Habit[] = [
      weeklyHouseholdHabit({ count: 0, totalCount: 0, completedDates: [] }),
      weeklyHouseholdHabit({
        count: 1, totalCount: 1, completedDates: [WED],
        completedBy: { [WED]: { 'jen-uid': 1 } },
      }),
      weeklyHouseholdHabit({
        count: 2, totalCount: 2, completedDates: [WED, MON],
        completedBy: { [WED]: { 'jen-uid': 1 } },
      }),
    ];
    const { result, rerender } = renderHook(
      ({ habits }: { habits: Habit[] }) =>
        useHabitActions(
          HOUSEHOLD_ID, currentUser, habits, householdSettings, [], roster('user1', 'jen-uid'),
        ),
      { initialProps: { habits: [states[0]!] } },
    );

    await act(async () => {
      await result.current.creditHabitCompletion('h1', ['jen-uid'], WED);
    });
    rerender({ habits: [states[1]!] });
    await act(async () => {
      await result.current.creditHouseholdCompletion('h1', MON);
    });
    rerender({ habits: [states[2]!] });
    await act(async () => {
      await result.current.resetHabit('h1');
    });

    // 🏁 Nothing happened, so nothing is owed: the pool must be back where it
    // started. It used to end at -10 — a permanent phantom deficit, because
    // `points.total` is a lifetime counter the corrective sync never lowers.
    for (const bucket of ['points.total', 'points.weekly', 'points.daily']) {
      expect(runningTotal(householdPath, bucket)).toBe(0);
      expect(runningTotal(`${householdPath}/members/jen-uid`, bucket)).toBe(0);
    }
    expect(commitCount).toBe(3);
  });

  it('reverses identically when `completedDates` arrives Monday-first', async () => {
    // 🛡️ ORDER-INDEPENDENCE. The same period, the same points, the only
    // difference being the array order the dates sit in — which no caller
    // controls. Both must produce the same deltas.
    vi.useFakeTimers({ now: NOW });

    const deltasFor = async (completedDates: string[]) => {
      capturedUpdates.length = 0;
      const habit = weeklyHouseholdHabit({
        count: 2, totalCount: 2, completedDates,
        completedBy: { [WED]: { 'jen-uid': 1 } },
      });
      const { result } = renderHook(() =>
        useHabitActions(
          HOUSEHOLD_ID, currentUser, [habit], householdSettings, [], roster('user1', 'jen-uid'),
        )
      );
      await act(async () => {
        await result.current.resetHabit('h1');
      });
      return {
        pool: ['points.total', 'points.weekly', 'points.daily']
          .map(b => bucketOf(householdUpdate(), b)),
        jen: ['points.total', 'points.weekly', 'points.daily']
          .map(b => bucketOf(memberUpdateOf('jen-uid'), b)),
      };
    };

    const wedFirst = await deltasFor([WED, MON]);
    const monFirst = await deltasFor([MON, WED]);

    expect(wedFirst).toEqual(monFirst);
    expect(wedFirst.pool).toEqual([-20, -20, 0]);
    expect(wedFirst.jen).toEqual([-10, -10, 0]);
  });
});
