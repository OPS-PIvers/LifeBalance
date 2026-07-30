import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { Habit } from '@/types/schema';
import {
  streakEndingOnForHabit,
  getMultiplier,
  calculatePointsForDateRange,
} from '@/utils/habitLogic';

// --- Firestore mock ----------------------------------------------------------
// Capture every batch.update so we can read back which point counters were
// incremented and by how much. Mirrors hooks/useHabitActions.test.tsx — the
// real habitLogic and dateHelpers are NOT mocked, so the multiplier selection
// under test runs for real and we assert on the resulting delta.

interface CapturedUpdate {
  ref: { __path: string };
  data: Record<string, unknown>;
}

const capturedUpdates: CapturedUpdate[] = [];
let commitCount = 0;

// increment() returns a tagged sentinel so we can read back the numeric delta.
const incrementMock = vi.fn((n: number) => ({ __increment: n }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path?: string, id?: string) => ({
    __path: id ? `${path}/${id}` : (path ?? '__autoId'),
  })),
  increment: (n: number) => incrementMock(n),
  deleteField: vi.fn(() => '__deleteField'),
  serverTimestamp: vi.fn(() => '__serverTimestamp'),
  writeBatch: vi.fn(() => ({
    update: (ref: { __path: string }, data: Record<string, unknown>) => {
      capturedUpdates.push({ ref, data });
    },
    commit: vi.fn(async () => {
      commitCount++;
    }),
  })),
}));

vi.mock('@/firebase.config', () => ({ db: {} }));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const mockToggleHabit = vi.fn();
const mockUpdateHabit = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

import PointsBreakdownModal from './PointsBreakdownModal';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';

const HOUSEHOLD_ID = 'house1';
const householdPath = `households/${HOUSEHOLD_ID}`;
const PAUL = 'paul-uid';
const JEN = 'jen-uid';

// Pin "today" to Sunday 2024-01-21 (local noon) so the current ISO week is the
// full Mon 2024-01-15 .. Sun 2024-01-21 and the weekly edit panel renders all
// seven day buttons deterministically regardless of the machine's real date.
const TODAY = '2024-01-21';
const MON = '2024-01-15';

const baseHabit = (overrides: Partial<Habit>): Habit =>
  ({
    id: 'h1',
    title: 'Pushups',
    category: 'Health',
    type: 'positive',
    period: 'daily',
    scoringType: 'incremental',
    basePoints: 10,
    targetCount: 1,
    count: 1,
    totalCount: 7,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2024-01-21T12:00:00',
    createdBy: 'user1',
    ...overrides,
  }) as Habit;

const householdUpdate = () =>
  capturedUpdates.find(u => u.ref.__path === householdPath);

// Open the weekly edit panel for the (single) habit and return the day button
// whose label matches `dayLabel` (e.g. 'Mon').
const openEditAndGetDayButton = (dayLabel: string): HTMLElement => {
  fireEvent.click(screen.getByLabelText(/^Edit /));
  const panel = screen.getByText('Toggle days to adjust history:').parentElement!;
  const dayCell = within(panel).getByText(dayLabel);
  // The clickable element is the <button> wrapping the label + dot.
  const button = dayCell.closest('button');
  if (!button) throw new Error(`No day button found for ${dayLabel}`);
  return button;
};

// Click a day toggle and flush the async toggleDate handler's microtask chain.
// We use act + microtask flush (not waitFor) because the suite runs under fake
// timers, and waitFor's internal polling would never advance.
const clickDayAndFlush = async (button: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(button);
    // batch.commit() resolves on the microtask queue; let it settle.
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('PointsBreakdownModal — toggleDate uses the date-anchored historical multiplier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-21T12:00:00'));
    capturedUpdates.length = 0;
    commitCount = 0;
    incrementMock.mockClear();
    mockToggleHabit.mockClear();
    mockUpdateHabit.mockClear();

    (useHouseholdCore as unknown as Mock).mockReturnValue({
      householdId: HOUSEHOLD_ID,
      members: [{ uid: PAUL }, { uid: JEN }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('REMOVE: debits a past day with that day\'s OWN multiplier (1.0x), not the current 2.0x streak', async () => {
    // 7-day unbroken run ending today -> CURRENT daily streak = 7 -> 2.0x.
    // The buggy code debited using the post-removal current streak (6 -> 1.5x => -15);
    // the date-anchored streak ending on Monday is 1 (no Jan-14) -> 1.0x => -10,
    // which is exactly the +10 that calculatePointsForDateRange originally credited
    // for that day, so points.total cannot drift.
    const completed = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19', '2024-01-20', '2024-01-21'];
    const habit = baseHabit({ completedDates: [...completed], streakDays: 7 });

    (useGamification as unknown as Mock).mockReturnValue({
      toggleHabit: mockToggleHabit,
      updateHabit: mockUpdateHabit,
    });

    render(<PointsBreakdownModal isOpen onClose={() => {}} view="weekly" habits={[habit]} />);

    // Sanity: current-streak multiplier is the 2.0x the buggy path would have used.
    const currentStreak = streakEndingOnForHabit({ period: 'daily', completedDates: completed }, TODAY);
    expect(getMultiplier(currentStreak, true, 'daily')).toBe(2.0);

    // Expected debit: reverse the ORIGINAL credit, computed against the set that
    // STILL INCLUDES Monday (the pre-removal set).
    const monStreak = streakEndingOnForHabit({ period: 'daily', completedDates: completed }, MON);
    const monMultiplier = getMultiplier(monStreak, true, 'daily');
    const expectedDebit = -Math.floor(10 * monMultiplier);
    expect(monMultiplier).toBe(1.0);
    expect(expectedDebit).toBe(-10);

    // No-drift proof: the original Jan-15 contribution per the canonical recompute.
    const before = calculatePointsForDateRange([habit], MON, MON);
    const after = calculatePointsForDateRange(
      [{ ...habit, completedDates: completed.filter(d => d !== MON) }],
      MON,
      MON,
    );
    expect(before - after).toBe(-expectedDebit); // removing Monday drops exactly 10

    await clickDayAndFlush(openEditAndGetDayButton('Mon'));

    expect(commitCount).toBe(1);

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });
    // Monday is within the current week (but not today) -> weekly adjusts, daily does not.
    expect(hh!.data['points.weekly']).toEqual({ __increment: -10 });
    expect(hh!.data['points.daily']).toBeUndefined();
    // It must NOT be the buggy -20 (current 2.0x) or -15 (post-removal 1.5x).
    expect(hh!.data['points.total']).not.toEqual({ __increment: -20 });
    expect(hh!.data['points.total']).not.toEqual({ __increment: -15 });
  });

  it('ADD/RESTORE: credits a restored past day with that day\'s OWN multiplier (1.0x), not the current 2.0x streak', async () => {
    // Before edit: Tue..Sun completed (6-day run, current streak 6 -> 1.5x).
    // Restoring Monday makes Mon..Sun contiguous -> the buggy current streak
    // becomes 7 (2.0x => +20). The date-anchored streak ending on Monday is 1
    // (no Jan-14) -> 1.0x => +10, matching what the recompute will assign.
    const completed = ['2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19', '2024-01-20', '2024-01-21'];
    const habit = baseHabit({ completedDates: [...completed], streakDays: 6 });

    (useGamification as unknown as Mock).mockReturnValue({
      toggleHabit: mockToggleHabit,
      updateHabit: mockUpdateHabit,
    });

    render(<PointsBreakdownModal isOpen onClose={() => {}} view="weekly" habits={[habit]} />);

    // After restoring Monday the full set is Mon..Sun; the buggy current-streak
    // multiplier would be 2.0x.
    const restored = [...completed, MON];
    const currentStreakAfter = streakEndingOnForHabit({ period: 'daily', completedDates: restored }, TODAY);
    expect(getMultiplier(currentStreakAfter, true, 'daily')).toBe(2.0);

    // Expected credit: date-anchored streak ending on Monday in the restored set.
    const monStreak = streakEndingOnForHabit({ period: 'daily', completedDates: restored }, MON);
    const monMultiplier = getMultiplier(monStreak, true, 'daily');
    const expectedCredit = Math.floor(10 * monMultiplier);
    expect(monMultiplier).toBe(1.0);
    expect(expectedCredit).toBe(10);

    // No-drift proof: the canonical recompute attributes exactly +10 to Monday.
    const restoredContribution =
      calculatePointsForDateRange([{ ...habit, completedDates: restored }], MON, MON) -
      calculatePointsForDateRange([habit], MON, MON);
    expect(restoredContribution).toBe(expectedCredit);

    await clickDayAndFlush(openEditAndGetDayButton('Mon'));

    expect(commitCount).toBe(1);

    const hh = householdUpdate();
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: 10 });
    expect(hh!.data['points.weekly']).toEqual({ __increment: 10 });
    expect(hh!.data['points.daily']).toBeUndefined();
    // It must NOT be the buggy +20 (current 2.0x).
    expect(hh!.data['points.total']).not.toEqual({ __increment: 20 });
  });

  it('REMOVE: an ATTRIBUTED day takes its attribution — and the member awards — with it', async () => {
    // 🏁 Stage 1.5: the household figure is built FROM member awards, so removing
    // a completion has to strip `completedBy` in the same batch and debit the
    // members who held it — otherwise a stranded award keeps paying the pool
    // forever on the next recompute.
    const completed = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19', '2024-01-20', '2024-01-21'];
    const habit = baseHabit({
      completedDates: [...completed],
      streakDays: 7,
      completedBy: { [MON]: { [PAUL]: 1, [JEN]: 1 } },
    });

    (useGamification as unknown as Mock).mockReturnValue({
      toggleHabit: mockToggleHabit,
      updateHabit: mockUpdateHabit,
    });

    render(<PointsBreakdownModal isOpen onClose={() => {}} view="weekly" habits={[habit]} />);
    await clickDayAndFlush(openEditAndGetDayButton('Mon'));

    expect(commitCount).toBe(1);

    // The habit doc clears exactly that date's attribution node (never the map).
    const habitUpdate = capturedUpdates.find(u => u.ref.__path === `${householdPath}/habits/h1`)!;
    expect(habitUpdate.data[`completedBy.${MON}`]).toBeDefined();

    // Both members earned a full 1.0x award on their own first day, so the pool
    // gives back BOTH — not the single habit-level unit the legacy path debited.
    for (const uid of [PAUL, JEN]) {
      const memberUpdate = capturedUpdates.find(
        u => u.ref.__path === `${householdPath}/members/${uid}`,
      );
      expect(memberUpdate!.data['points.total']).toEqual({ __increment: -10 });
    }
    expect(householdUpdate()!.data['points.total']).toEqual({ __increment: -20 });
    expect(householdUpdate()!.data['points.weekly']).toEqual({ __increment: -20 });
    expect(householdUpdate()!.data['points.daily']).toBeUndefined();
  });

  it('threshold habits never adjust points when a date is toggled (preserved behavior)', async () => {
    const completed = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19', '2024-01-20', '2024-01-21'];
    const habit = baseHabit({ scoringType: 'threshold', completedDates: [...completed], streakDays: 7 });

    (useGamification as unknown as Mock).mockReturnValue({
      toggleHabit: mockToggleHabit,
      updateHabit: mockUpdateHabit,
    });

    render(<PointsBreakdownModal isOpen onClose={() => {}} view="weekly" habits={[habit]} />);

    await clickDayAndFlush(openEditAndGetDayButton('Mon'));

    expect(commitCount).toBe(1);

    // The habit doc is updated (the date moves) but NO household points update is written.
    expect(householdUpdate()).toBeUndefined();
    const habitUpdate = capturedUpdates.find(u => u.ref.__path === `${householdPath}/habits/h1`);
    expect(habitUpdate).toBeDefined();
  });
});
