// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLocalToday } from '@/hooks/useLocalToday';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * The midnight roll is the entire reason this hook exists — a plain
 * `getLocalDateString()` in render would already return the right string on a
 * fresh render. So the meaningful assertions are the ones that hold the clock
 * still and move it, not the mount-time value.
 *
 * All times are local (the hook's whole contract is the LOCAL day), so the
 * fixtures are built with the local-time `Date` constructor rather than an ISO
 * string, which would be parsed as UTC and shift the boundary under any
 * non-UTC TZ.
 */
describe('useLocalToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on the current local day', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 14, 30, 0));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe('2026-07-31');
    expect(result.current).toBe(getLocalDateString());
  });

  it('rolls forward when local midnight passes', () => {
    // 23:59:00 — one minute short of the boundary.
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 0));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe('2026-07-31');

    // 30s later: still yesterday. Guards against a timer that fires eagerly.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe('2026-07-31');

    // Past midnight (60s + the hook's 1s buffer).
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(result.current).toBe('2026-08-01');
  });

  it('keeps rolling on subsequent days (the timeout re-arms)', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(result.current).toBe('2026-08-01');

    // A one-shot timeout would leave this stuck on 08-01 forever.
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(result.current).toBe('2026-08-02');
  });

  it('clears its timeout on unmount', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 0));
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useLocalToday());

    unmount();
    expect(clearSpy).toHaveBeenCalled();

    // Nothing pending: an uncleared timeout would setState on an unmounted
    // component when the day flipped.
    expect(vi.getTimerCount()).toBe(0);
    clearSpy.mockRestore();
  });

  it('hands two consumers the same day across the boundary', () => {
    // The invariant the extraction exists to make structural: the footer badge
    // and the Action Queue must never anchor on different days.
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 30));
    const badge = renderHook(() => useLocalToday());
    const queue = renderHook(() => useLocalToday());
    expect(badge.result.current).toBe(queue.result.current);

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(badge.result.current).toBe('2026-08-01');
    expect(queue.result.current).toBe('2026-08-01');
  });
});
