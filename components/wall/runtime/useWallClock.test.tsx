import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWallClock } from './useWallRuntime';

vi.mock('@/firebase.config', () => ({ auth: {}, db: {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 16, 12, 0, 5));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWallClock', () => {
  it('keeps the same time while the minute hasn’t changed, so nothing re-renders', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useWallClock();
    });
    const first = result.current[0];
    const settled = renders;
    // The 15 s safety ticks inside 12:00.
    act(() => vi.advanceTimersByTime(45_000));
    expect(result.current[0]).toBe(first);
    expect(renders).toBe(settled);
  });

  it('moves on at the top of the next minute', () => {
    const { result } = renderHook(() => useWallClock());
    const first = result.current[0];
    act(() => vi.advanceTimersByTime(55_050));
    expect(result.current[0]).not.toBe(first);
    expect(result.current[0].getMinutes()).toBe(1);
  });

  it('re-renders about once a minute over an hour, not four times', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useWallClock();
    });
    const settled = renders;
    // A step at a time, so each tick renders on its own as it would on the wall.
    for (let s = 0; s < 60 * 4; s++) act(() => vi.advanceTimersByTime(15_000));
    expect(renders - settled).toBe(60);
  });

  it('always takes a time it is handed, even inside the same minute', () => {
    const { result } = renderHook(() => useWallClock());
    const later = new Date(2026, 9, 16, 12, 0, 40);
    act(() => result.current[1](later));
    expect(result.current[0]).toBe(later);
  });
});
