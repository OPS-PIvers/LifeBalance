import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WallRailMode } from '@/types/schema';
import { CLOCK_HOLD_MS, RAIL_PEEK_MS, useWallRail } from './useWallRail';

const Harness: React.FC<{ mode: WallRailMode; onHold: () => void }> = ({ mode, onHold }) => {
  const rail = useWallRail(mode, onHold);
  return (
    <div
      data-testid="wall"
      data-state={`${rail.shown ? 'shown' : 'none'}|${rail.floating ? 'float' : 'fixed'}|${rail.open ? 'open' : 'closed'}`}
      onPointerDownCapture={rail.handlers.onPointerDown}
      onPointerMoveCapture={rail.handlers.onPointerMove}
      onPointerUpCapture={rail.handlers.onPointerUp}
    >
      <header className="mast">
        <span className="clock">7:42</span>
      </header>
      <button type="button">Milk</button>
    </div>
  );
};

const state = () => screen.getByTestId('wall').getAttribute('data-state');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useWallRail', () => {
  it('keeps today’s rail beside the screens by default', () => {
    render(<Harness mode="shown" onHold={() => undefined} />);
    fireEvent.pointerDown(screen.getByText('Milk'));
    expect(state()).toBe('shown|fixed|closed');
  });

  it('On tap: a touch slides the rail in, and it leaves after a quiet spell', () => {
    render(<Harness mode="tap" onHold={() => undefined} />);
    expect(state()).toBe('shown|float|closed');
    fireEvent.pointerDown(screen.getByText('Milk'));
    expect(state()).toBe('shown|float|open');
    act(() => vi.advanceTimersByTime(RAIL_PEEK_MS - 1000));
    // Another touch restarts the clock.
    fireEvent.pointerDown(screen.getByText('Milk'));
    act(() => vi.advanceTimersByTime(RAIL_PEEK_MS - 1000));
    expect(state()).toBe('shown|float|open');
    act(() => vi.advanceTimersByTime(1000));
    expect(state()).toBe('shown|float|closed');
  });

  it('Hidden: no rail, and touches never bring it back', () => {
    render(<Harness mode="hidden" onHold={() => undefined} />);
    fireEvent.pointerDown(screen.getByText('Milk'));
    expect(state()).toBe('none|fixed|closed');
  });

  it('holding the clock opens the display menu; a short tap or a drag does not', () => {
    const onHold = vi.fn();
    render(<Harness mode="hidden" onHold={onHold} />);
    const clock = screen.getByText('7:42');

    fireEvent.pointerDown(clock, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS - 100));
    fireEvent.pointerUp(clock);
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.pointerDown(clock, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(clock, { clientX: 10, clientY: 60 });
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText('Milk'));
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.pointerDown(clock, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
  });
});
