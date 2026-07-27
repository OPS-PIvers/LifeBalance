// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preloadOnIdle } from './preloadOnIdle';

describe('preloadOnIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses requestIdleCallback when available', () => {
    const load = vi.fn(() => Promise.resolve());
    let idleCb: (() => void) | undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleRequestCallback) => {
        idleCb = cb as unknown as () => void;
        return 1;
      })
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());

    preloadOnIdle(load);
    expect(load).not.toHaveBeenCalled();

    idleCb?.();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancel function cancels a pending requestIdleCallback', () => {
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 42));
    const cancelIdle = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancelIdle);

    const cancel = preloadOnIdle(() => Promise.resolve());
    cancel();

    expect(cancelIdle).toHaveBeenCalledWith(42);
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.resolve());

    preloadOnIdle(load, 1000);
    expect(load).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancel function clears a pending timeout', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.resolve());

    const cancel = preloadOnIdle(load, 1000);
    cancel();
    vi.advanceTimersByTime(5000);

    expect(load).not.toHaveBeenCalled();
  });

  it('swallows load failures', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.reject(new Error('offline')));

    preloadOnIdle(load, 0);
    vi.advanceTimersByTime(0);
    // Flush the rejected promise; the catch inside preloadOnIdle must absorb
    // it without an unhandled rejection.
    await vi.runAllTimersAsync();

    expect(load).toHaveBeenCalledTimes(1);
  });
});
