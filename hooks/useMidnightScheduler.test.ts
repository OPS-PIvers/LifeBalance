import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';

describe('useMidnightScheduler', () => {
  beforeEach(() => {
    // Pick a fixed local time well before midnight so midnight math is deterministic.
    vi.useFakeTimers({ now: new Date('2026-06-16T18:00:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never runs the callback when disabled', async () => {
    const callback = vi.fn(() => Promise.resolve());
    renderHook(() => useMidnightScheduler(callback, false));

    await act(async () => {
      // Advance well past any interval and past midnight.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('runs the callback immediately on enable (initialDelayMs=0)', async () => {
    const callback = vi.fn(() => Promise.resolve());

    await act(async () => {
      renderHook(() => useMidnightScheduler(callback, true, { initialDelayMs: 0 }));
      // Flush the synchronous immediate call's microtasks.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires the callback every intervalMs', async () => {
    const callback = vi.fn(() => Promise.resolve());
    const intervalMs = 60_000;

    await act(async () => {
      renderHook(() => useMidnightScheduler(callback, true, { intervalMs, initialDelayMs: 0 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // 1 immediate call so far.
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      // Three interval ticks (but stay before midnight at 18:00 + 3min).
      await vi.advanceTimersByTimeAsync(intervalMs * 3);
    });

    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('fires at local midnight and reschedules for the next midnight', async () => {
    const callback = vi.fn(() => Promise.resolve());
    // Use a very large interval so interval ticks don't interfere with the count.
    const intervalMs = 7 * 24 * 60 * 60 * 1000;

    await act(async () => {
      renderHook(() => useMidnightScheduler(callback, true, { intervalMs, initialDelayMs: 0 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(callback).toHaveBeenCalledTimes(1); // immediate

    // From 18:00 to next local midnight is 6 hours.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    });
    expect(callback).toHaveBeenCalledTimes(2); // first midnight

    // Advance a full day to hit the next rescheduled midnight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    });
    expect(callback).toHaveBeenCalledTimes(3); // second midnight
  });

  it('defers the first execution by initialDelayMs', async () => {
    const callback = vi.fn(() => Promise.resolve());
    const initialDelayMs = 5_000;

    await act(async () => {
      renderHook(() =>
        useMidnightScheduler(callback, true, { initialDelayMs, intervalMs: 60_000 })
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // Not yet started.
    expect(callback).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(initialDelayMs);
    });

    // Now the scheduler started and ran the immediate callback.
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('swallows callback errors (does not throw out of the timer)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const callback = vi.fn(() => Promise.reject(new Error('boom')));

    await act(async () => {
      renderHook(() => useMidnightScheduler(callback, true, { initialDelayMs: 0 }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain('[useMidnightScheduler]');
  });

  it('clears timers on unmount so no further callbacks fire', async () => {
    const callback = vi.fn(() => Promise.resolve());
    const intervalMs = 60_000;

    let unmount: () => void = () => {};
    await act(async () => {
      const result = renderHook(() =>
        useMidnightScheduler(callback, true, { intervalMs, initialDelayMs: 0 })
      );
      unmount = result.unmount;
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmount();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs * 5 + 24 * 60 * 60 * 1000);
    });

    // Still only the single immediate call.
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback held in the ref on the next tick', async () => {
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    const intervalMs = 60_000;

    const result = renderHook(
      ({ cb }: { cb: () => Promise<void> }) =>
        useMidnightScheduler(cb, true, { intervalMs, initialDelayMs: 0 }),
      { initialProps: { cb: first as () => Promise<void> } }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(first).toHaveBeenCalledTimes(1);

    // Swap in a new callback without changing enabled/intervalMs.
    await act(async () => {
      result.rerender({ cb: second as () => Promise<void> });
      await vi.advanceTimersByTimeAsync(0);
    });

    // Next interval tick should use the latest callback.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs);
    });

    expect(second).toHaveBeenCalledTimes(1);
    // first was not called again by the interval tick.
    expect(first).toHaveBeenCalledTimes(1);
  });
});
