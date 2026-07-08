/**
 * Pure accumulation logic backing the habit-toggle points toast (see
 * `useHabitActions.toggleHabit`). Rapid toggles of the SAME habit should
 * update one toast in place with the cumulative net points instead of
 * stacking a new toast per tap. This module holds the pure math; the caller
 * owns the mutable state (a `useRef`-held Map, so it survives re-renders
 * without becoming a dependency) and supplies `now` so the logic stays
 * deterministic and testable (never calls `Date.now()` itself).
 */

/** One habit's running toast total. */
export interface ToastAccumulatorEntry {
  /** Cumulative point delta across all toggles inside the active window. */
  net: number;
  /** Number of toggles folded into `net` so far. */
  count: number;
  /** `now` at the most recent toggle — the anchor for the next window check. */
  lastAt: number;
}

/** Per-key accumulator state, e.g. keyed by habit id. */
export type ToastAccumulatorState = Map<string, ToastAccumulatorEntry>;

/**
 * Folds a new `delta` into `state[key]`, mutating `state` in place (it's
 * expected to be a `useRef`-held Map — mutating the caller's container is
 * the point, so re-renders don't reset it).
 *
 * If an entry for `key` exists and it was last touched within `windowMs` of
 * `now`, the delta accumulates onto the existing entry (`net += delta`,
 * `count += 1`). Otherwise a fresh entry starts (`net = delta`, `count = 1`).
 * `lastAt` is always advanced to `now`.
 *
 * @returns The updated `{ net, count }` for `key`.
 */
export const accumulate = (
  state: ToastAccumulatorState,
  key: string,
  delta: number,
  now: number,
  windowMs: number
): { net: number; count: number } => {
  const existing = state.get(key);
  const entry: ToastAccumulatorEntry =
    existing && now - existing.lastAt <= windowMs
      ? { net: existing.net + delta, count: existing.count + 1, lastAt: now }
      : { net: delta, count: 1, lastAt: now };

  state.set(key, entry);
  return { net: entry.net, count: entry.count };
};
