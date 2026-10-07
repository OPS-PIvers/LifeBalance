/**
 * The largest scale in [min, max] at which `fits(scale)` holds, to the nearest
 * `step`. Fitting is monotonic (bigger type never fits where smaller didn't),
 * so a binary search needs only a handful of layouts. Nothing fits → `min`:
 * the box clips at its smallest type rather than shrinking without limit.
 */
export function fitScale(min: number, max: number, fits: (scale: number) => boolean, step = 0.02): number {
  if (fits(max)) return max;
  let lo = min;
  let hi = max;
  while (hi - lo > step) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
