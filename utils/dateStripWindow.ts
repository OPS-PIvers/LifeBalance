/**
 * Pure windowing logic for MealPlanTab's scrollable date strip.
 *
 * The strip covers a fixed ~5-month range (STRIP_WEEKS_BACK + STRIP_WEEKS_FORWARD
 * weeks around "today" — see MealPlanTab.tsx), but materializing every day of
 * that range as a DOM chip up front is wasteful. These helpers compute a
 * bounded *window* (a contiguous index range into the full day list) that
 * starts centered on the initially-selected day and only grows — never
 * shrinks — as navigation approaches its edges, so newly-reached days get
 * materialized without ever re-rendering the whole range.
 *
 * All indices are offsets into the full day list, where index 0 is the
 * earliest day in the strip's range (STRIP_WEEKS_BACK weeks before today).
 */

export interface StripWindow {
  /** Inclusive start index. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

/** Days materialized on first render, centered on the initially selected day. */
export const STRIP_WINDOW_SIZE = 28;
/** Extra days added past the target when the window has to grow. */
export const STRIP_WINDOW_PAD = 14;
/** How close (in days) a target must be to an edge before the window grows. */
export const STRIP_WINDOW_EDGE_THRESHOLD = 7;

const clampWindow = (start: number, end: number, totalDays: number): StripWindow => ({
  start: Math.max(0, Math.min(start, totalDays)),
  end: Math.max(0, Math.min(end, totalDays)),
});

/**
 * The initial window: STRIP_WINDOW_SIZE days centered on `centerIndex`,
 * clamped to `[0, totalDays)`.
 */
export function initialStripWindow(centerIndex: number, totalDays: number): StripWindow {
  const half = Math.floor(STRIP_WINDOW_SIZE / 2);
  let start = centerIndex - half;
  let end = start + STRIP_WINDOW_SIZE;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > totalDays) {
    start -= end - totalDays;
    end = totalDays;
  }
  return clampWindow(start, end, totalDays);
}

/**
 * Grows `window` (never shrinks it) so `targetIndex` sits at least
 * STRIP_WINDOW_EDGE_THRESHOLD days from both edges, padding by
 * STRIP_WINDOW_PAD when it needs to extend. Returns the SAME object
 * reference when no growth is needed, so `setStripWindow(w =>
 * extendStripWindowTo(w, ...))` bails out of a re-render cleanly.
 */
export function extendStripWindowTo(window: StripWindow, targetIndex: number, totalDays: number): StripWindow {
  let { start, end } = window;
  let changed = false;

  if (targetIndex - start < STRIP_WINDOW_EDGE_THRESHOLD) {
    const nextStart = Math.max(0, targetIndex - STRIP_WINDOW_PAD);
    if (nextStart < start) {
      start = nextStart;
      changed = true;
    }
  }
  if (end - 1 - targetIndex < STRIP_WINDOW_EDGE_THRESHOLD) {
    const nextEnd = Math.min(totalDays, targetIndex + STRIP_WINDOW_PAD + 1);
    if (nextEnd > end) {
      end = nextEnd;
      changed = true;
    }
  }

  return changed ? clampWindow(start, end, totalDays) : window;
}
