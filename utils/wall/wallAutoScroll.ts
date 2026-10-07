/**
 * The panel's auto-scroll "wheel": a list taller than its module glides up
 * slowly, runs on into a copy of itself, and comes to rest with its first
 * item back at the top, then waits and goes round again. Pure motion math;
 * `components/wall/calendar/modules/WallAutoScroll.tsx` drives it.
 */

/** Cruising speed, px per second: slow enough to read a row from across the room. */
export const AUTOSCROLL_SPEED = 24;
/** Time to ease up to cruising speed, and to ease back down to rest. */
export const AUTOSCROLL_RAMP_MS = 1800;
/** How long the list rests with its first item at the top before each lap. */
export const AUTOSCROLL_REST_MS = 4500;
/** After someone touches the list, how long it stays put before moving again. */
export const AUTOSCROLL_RESUME_MS = 8000;
/** Content must overflow by more than this many px before the wheel turns. */
export const AUTOSCROLL_MIN_OVERFLOW = 2;

export interface Glide {
  /** How far the glide has gone, 0 … distance. */
  offset: number;
  done: boolean;
}

/**
 * Where a glide of `distance` px stands `elapsedMs` after it started. Velocity
 * rises from 0 to `speed` along a half cosine over `ramp`, cruises, then falls
 * back to 0 the same way, arriving exactly at `distance`. A glide too short to
 * reach cruising speed shortens both ramps so it still starts and stops softly.
 */
export function glideOffset(
  distance: number,
  elapsedMs: number,
  speed = AUTOSCROLL_SPEED,
  rampMs = AUTOSCROLL_RAMP_MS
): Glide {
  if (distance <= 0) return { offset: 0, done: true };
  const v = speed / 1000;
  const r = Math.min(rampMs, distance / v);
  const total = distance / v + r;
  if (elapsedMs <= 0) return { offset: 0, done: false };
  if (elapsedMs >= total) return { offset: distance, done: true };
  // Distance covered x ms into a cosine ramp: the integral of v·(1 − cos(πt/r))/2.
  const ramp = (x: number) => v * (x / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * x) / r));
  if (elapsedMs < r) return { offset: ramp(elapsedMs), done: false };
  if (elapsedMs > total - r) return { offset: distance - ramp(total - elapsedMs), done: false };
  return { offset: ramp(r) + v * (elapsedMs - r), done: false };
}

/** Folds an offset into one lap, [0, lap): the copy below the seam is the list again. */
export function wrapOffset(offset: number, lap: number): number {
  if (lap <= 0) return 0;
  return ((offset % lap) + lap) % lap;
}

/** Whether a list of `contentHeight` overflows a `viewportHeight` module enough to turn. */
export function shouldAutoScroll(contentHeight: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && contentHeight - viewportHeight > AUTOSCROLL_MIN_OVERFLOW;
}
