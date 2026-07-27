import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeWidgetOrder } from './HomeWidgetOrder';
import { resolveDashboardOrder } from '@/utils/dashboardLayout';

/**
 * The DRAG path can't be exercised for real in this project's environments:
 * framer-motion's gesture recognizer needs pointer capture plus rAF, and rAF is
 * throttled in the headless preview (see the notes on verifying framer
 * animations). So the drag is covered here instead, by stubbing `Reorder` the
 * same way this repo's other framer tests stub `motion` and driving framer's
 * real call sequence: `onReorder(next)` while the pointer moves, then
 * `onDragEnd()` when it lifts.
 *
 * That sequence is the actual contract `HomeWidgetOrder` depends on, and these
 * tests fail loudly if someone "optimizes" the drag-end dependency list and
 * drops the persisted write.
 */
const harness: {
  onReorder?: (next: string[]) => void;
  onDragEnd?: () => void;
  itemCount: number;
} = { itemCount: 0 };

vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({
      children,
      onReorder,
      className,
      'aria-label': ariaLabel,
    }: {
      children: React.ReactNode;
      onReorder: (next: string[]) => void;
      className?: string;
      'aria-label'?: string;
    }) => {
      harness.onReorder = onReorder;
      return (
        <ul className={className} aria-label={ariaLabel}>
          {children}
        </ul>
      );
    },
    // Only the props a real DOM node accepts are forwarded — `value`,
    // `dragListener` and `dragControls` are framer's own and would warn.
    Item: ({
      children,
      onDragEnd,
      className,
    }: {
      children: React.ReactNode;
      onDragEnd: () => void;
      className?: string;
    }) => {
      harness.onDragEnd = onDragEnd;
      return <li className={className}>{children}</li>;
    },
  },
  useDragControls: () => ({ start: () => {} }),
}));

const member = { dashboardLayout: undefined, hiddenKeys: undefined, dashboardHidden: undefined };

describe('HomeWidgetOrder — the drag path (PC#4)', () => {
  beforeEach(() => {
    harness.onReorder = undefined;
    harness.onDragEnd = undefined;
  });

  it('persists the dragged order when the pointer lifts', () => {
    const onSave = vi.fn();
    render(<HomeWidgetOrder member={member} onSave={onSave} />);

    const original = resolveDashboardOrder(undefined);
    const dragged = [original[1]!, original[0]!, ...original.slice(2)];

    // Pointer moving: framer reports the new order as the row crosses.
    act(() => harness.onReorder!(dragged));
    expect(onSave).not.toHaveBeenCalled(); // nothing written mid-gesture

    // Pointer lifting.
    act(() => harness.onDragEnd!());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]?.dashboardLayout).toEqual(dragged);
  });

  it('writes nothing when a press ends without moving anything', () => {
    const onSave = vi.fn();
    render(<HomeWidgetOrder member={member} onSave={onSave} />);

    // A tap on the grip: framer fires no `onReorder`, only `onDragEnd`. This is
    // the guard's real job — `dragOrder` is never cleared after a drag, so from
    // the second press onward it holds the PREVIOUS order and writing it would
    // persist a stale layout.
    act(() => harness.onDragEnd!());

    expect(onSave).not.toHaveBeenCalled();
  });

  it('writes nothing on a second no-move press after a completed drag', () => {
    const onSave = vi.fn();
    render(<HomeWidgetOrder member={member} onSave={onSave} />);

    const original = resolveDashboardOrder(undefined);
    const dragged = [original[1]!, original[0]!, ...original.slice(2)];

    act(() => harness.onReorder!(dragged));
    act(() => harness.onDragEnd!());
    expect(onSave).toHaveBeenCalledTimes(1);

    // The stale-write case specifically: `dragOrder` still holds `dragged`.
    act(() => harness.onDragEnd!());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the grip keyboard-operable alongside the drag', async () => {
    const onSave = vi.fn();
    render(<HomeWidgetOrder member={member} onSave={onSave} />);

    const original = resolveDashboardOrder(undefined);
    const second = original[1]!;
    const grips = screen.getAllByRole('button', { name: /^Reorder / });
    expect(grips).toHaveLength(original.length);

    await userEvent.type(grips[1]!, '{arrowup}');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]?.dashboardLayout?.[0]).toBe(second);
  });
});
