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
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { useHabitActions } from './useHabitActions';

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
