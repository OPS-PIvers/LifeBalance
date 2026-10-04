import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleTimer } from './wallIdle';

describe('createIdleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the timeout with no activity', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 180_000, onIdle });
    timer.poke();
    vi.advanceTimersByTime(179_999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.isRunning()).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown on every poke', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 1000, onIdle });
    timer.poke();
    vi.advanceTimersByTime(900);
    timer.poke();
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels without firing', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ timeoutMs: 1000, onIdle });
    timer.poke();
    expect(timer.isRunning()).toBe(true);
    timer.stop();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.isRunning()).toBe(false);
  });
});
