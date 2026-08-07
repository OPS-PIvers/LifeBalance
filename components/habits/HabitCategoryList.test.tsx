import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import HabitCategoryList from './HabitCategoryList';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import type { Habit } from '@/types/schema';

/**
 * The DRAG path can't be exercised for real in this project's environments:
 * framer-motion's gesture recognizer needs pointer capture plus rAF, and rAF is
 * throttled in the headless preview. So the drag is covered here the same way
 * `HomeWidgetOrder.test.tsx` covers its own — by stubbing `Reorder` and driving
 * framer's real call sequence: `onReorder(next)` while the pointer moves, then
 * `onDragEnd()` when it lifts.
 */
const harness: {
  onReorder?: (next: Habit[]) => void;
  onDragEnd?: () => void;
} = {};

vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({
      children,
      onReorder,
      'aria-label': ariaLabel,
    }: {
      children: React.ReactNode;
      onReorder: (next: Habit[]) => void;
      'aria-label'?: string;
    }) => {
      harness.onReorder = onReorder;
      return <ul aria-label={ariaLabel}>{children}</ul>;
    },
    // Only the props a real DOM node accepts are forwarded — `value`,
    // `dragListener` and `dragControls` are framer's own and would warn.
    Item: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: () => void }) => {
      harness.onDragEnd = onDragEnd;
      return <li>{children}</li>;
    },
  },
  useDragControls: () => ({ start: () => {} }),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
}));

vi.mock('./HabitCard', () => ({
  default: ({ habit }: { habit: Habit }) => <div>{habit.title}</div>,
}));

const makeHabit = (id: string, order: number): Habit =>
  ({ id, title: `Habit ${id}`, category: 'Morning', order }) as Habit;

const habits = [makeHabit('a', 1), makeHabit('b', 2), makeHabit('c', 3)];

describe('HabitCategoryList — the drag path', () => {
  const reorderHabits = vi.fn<(u: { id: string; order: number }[]) => Promise<void>>();

  beforeEach(() => {
    vi.clearAllMocks();
    harness.onReorder = undefined;
    harness.onDragEnd = undefined;
    reorderHabits.mockResolvedValue(undefined);
    (useGamification as unknown as Mock).mockReturnValue({ reorderHabits });
  });

  it('persists the dragged order when the pointer lifts', () => {
    render(<HabitCategoryList category="Morning" habits={habits} />);

    const dragged = [habits[1]!, habits[0]!, habits[2]!];

    // Pointer moving: framer reports the new order as the row crosses.
    act(() => harness.onReorder!(dragged));
    expect(reorderHabits).not.toHaveBeenCalled(); // nothing written mid-gesture

    // Pointer lifting.
    act(() => harness.onDragEnd!());

    expect(reorderHabits).toHaveBeenCalledTimes(1);
    // The existing `order` slots (1, 2, 3) are reassigned to the new arrangement.
    expect(reorderHabits.mock.calls[0]?.[0]).toEqual([
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
      { id: 'c', order: 3 },
    ]);
  });

  it('writes nothing when a press ends without moving anything', () => {
    render(<HabitCategoryList category="Morning" habits={habits} />);

    // A tap on the grip: framer fires no `onReorder`, only `onDragEnd`. Without
    // the guard this reached `reorderHabits([])` — an empty batch, but still a
    // "Habits reordered" toast for a gesture that reordered nothing.
    act(() => harness.onDragEnd!());

    expect(reorderHabits).not.toHaveBeenCalled();
  });

  it('writes nothing on a second no-move press after a completed drag', () => {
    render(<HabitCategoryList category="Morning" habits={habits} />);

    act(() => harness.onReorder!([habits[1]!, habits[0]!, habits[2]!]));
    act(() => harness.onDragEnd!());
    expect(reorderHabits).toHaveBeenCalledTimes(1);

    // The stale-write case specifically: `dragItems` still holds the previous
    // drag's habits, so an unguarded save would re-commit them — against docs
    // that may no longer exist, which fails the whole batch.
    act(() => harness.onDragEnd!());
    expect(reorderHabits).toHaveBeenCalledTimes(1);
  });

  it('assigns distinct ascending orders when the whole category shares the 999 fallback', () => {
    // No creation path sets `order`, so a category no habit has ever been
    // individually drag-sorted in has every habit sitting at the same
    // fallback value — the exact collision that made the reassignment a
    // no-op and the drag snap back.
    const noOrderHabits: Habit[] = [
      { id: 'x', title: 'Habit x', category: 'Household' } as Habit,
      { id: 'y', title: 'Habit y', category: 'Household' } as Habit,
      { id: 'z', title: 'Habit z', category: 'Household' } as Habit,
    ];

    render(<HabitCategoryList category="Household" habits={noOrderHabits} />);

    const dragged = [noOrderHabits[2]!, noOrderHabits[0]!, noOrderHabits[1]!];
    act(() => harness.onReorder!(dragged));
    act(() => harness.onDragEnd!());

    expect(reorderHabits).toHaveBeenCalledTimes(1);
    const call = reorderHabits.mock.calls[0]?.[0];
    expect(call).toEqual([
      { id: 'z', order: 999 },
      { id: 'x', order: 1000 },
      { id: 'y', order: 1001 },
    ]);

    // Distinct — never the same value repeated, which is what made the
    // original reassignment a no-op.
    const orders = call?.map(u => u.order) ?? [];
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("reuses each habit's own pre-existing distinct order slot", () => {
    const distinctHabits = [makeHabit('p', 5), makeHabit('q', 8), makeHabit('r', 12)];

    render(<HabitCategoryList category="Morning" habits={distinctHabits} />);

    const dragged = [distinctHabits[2]!, distinctHabits[0]!, distinctHabits[1]!];
    act(() => harness.onReorder!(dragged));
    act(() => harness.onDragEnd!());

    expect(reorderHabits).toHaveBeenCalledTimes(1);
    expect(reorderHabits.mock.calls[0]?.[0]).toEqual([
      { id: 'r', order: 5 },
      { id: 'p', order: 8 },
      { id: 'q', order: 12 },
    ]);
  });
});
