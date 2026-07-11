import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

// increment() returns a tagged sentinel so we can read back the numeric delta.
const incrementMock = vi.fn((n: number) => ({ __increment: n }));

vi.mock('firebase/firestore', () => {
  return {
    // doc(db, path, id?) -> a ref object carrying its path for assertions.
    doc: vi.fn((_db: unknown, path?: string, id?: string) => ({
      __path: id ? `${path}/${id}` : (path ?? '__autoId'),
    })),
    collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
    increment: (n: number) => incrementMock(n),
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
// The mocked updateDoc — updateHabit writes via updateDoc(ref, data), not a batch,
// so we read its captured call args to assert on the whitelisted update payload.
// getDocs backs the prior-submissions lookup for back-dated threshold submissions.
import { updateDoc, getDocs } from 'firebase/firestore';

const updateDocMock = vi.mocked(updateDoc);
const getDocsMock = vi.mocked(getDocs);

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
    // (1.0x) — the bug. So today's submission should earn floor(10 * 1.5) = 15.
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

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 15 });
    expect(hh!.data['points.daily']).toEqual({ __increment: 15 });
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
    expect(hu!.data['completedDates']).toEqual([]);
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
    expect(hu!.data['completedDates']).toEqual([today]);
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
    expect(hu!.data['completedDates']).toEqual([yesterday()]);
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
    expect(hu!.data['completedDates']).toEqual([today, yesterday()]);
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
    expect(habitUpdate()!.data['completedDates']).toEqual([yesterday()]);
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
    expect(habitUpdate()!.data['completedDates']).toEqual([yesterday()]);
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
    expect(hu!.data['completedDates']).toEqual([]);
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
    expect(habitUpdate()!.data['completedDates']).toEqual([]);
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
});
