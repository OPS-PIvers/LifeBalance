/**
 * Idle timer for the wall display (docs/plans/wall-display-kiosk.md §4.8).
 * Any touch, key or voice start calls `poke()`; `onIdle` fires once after
 * `timeoutMs` without a poke. Timer functions are injectable so tests (and
 * the lab page's fast-forward) don't depend on real time.
 */

export interface IdleTimerOptions {
  timeoutMs: number;
  onIdle: () => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface IdleTimer {
  /** Restart the countdown. */
  poke: () => void;
  /** Stop without firing. */
  stop: () => void;
  /** True between a poke and either the idle callback or stop(). */
  isRunning: () => boolean;
}

export function createIdleTimer({
  timeoutMs,
  onIdle,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
}: IdleTimerOptions): IdleTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  return {
    poke: () => {
      stop();
      handle = setTimer(() => {
        handle = null;
        onIdle();
      }, timeoutMs);
    },
    stop,
    isRunning: () => handle !== null,
  };
}
