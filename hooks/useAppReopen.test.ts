import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppReopen, APP_REOPEN_MIN_HIDDEN_MS } from '@/hooks/useAppReopen';

/** Stubs document.visibilityState and dispatches the matching event. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useAppReopen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-16T18:00:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore the real visibilityState getter so other tests see jsdom's default.
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it('fires after the app was hidden for at least minHiddenMs', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility('visible'));

    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a short task-switch', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(999));
    act(() => setVisibility('visible'));

    expect(onReopen).not.toHaveBeenCalled();
  });

  it('does not fire on a visible event with no prior hidden', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('visible'));

    expect(onReopen).not.toHaveBeenCalled();
  });

  it('keeps the FIRST hidden timestamp across repeated hidden events', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(800));
    act(() => setVisibility('hidden')); // duplicate event must not reset the clock
    act(() => vi.advanceTimersByTime(200));
    act(() => setVisibility('visible'));

    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('fires once per hidden→visible cycle, not on every visible event', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility('visible'));
    act(() => setVisibility('visible')); // duplicate visible — no re-fire

    expect(onReopen).toHaveBeenCalledTimes(1);

    // A fresh full cycle fires again.
    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility('visible'));

    expect(onReopen).toHaveBeenCalledTimes(2);
  });

  it('uses the latest callback without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAppReopen(cb, 1000), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility('visible'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unmount', () => {
    const onReopen = vi.fn();
    const { unmount } = renderHook(() => useAppReopen(onReopen, 1000));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(1000));
    unmount();
    act(() => setVisibility('visible'));

    expect(onReopen).not.toHaveBeenCalled();
  });

  it('defaults to the exported APP_REOPEN_MIN_HIDDEN_MS threshold', () => {
    const onReopen = vi.fn();
    renderHook(() => useAppReopen(onReopen));

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(APP_REOPEN_MIN_HIDDEN_MS - 1));
    act(() => setVisibility('visible'));
    expect(onReopen).not.toHaveBeenCalled();

    act(() => setVisibility('hidden'));
    act(() => vi.advanceTimersByTime(APP_REOPEN_MIN_HIDDEN_MS));
    act(() => setVisibility('visible'));
    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
