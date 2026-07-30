/**
 * Pie geometry for the habit row's attribution counter (stage 2).
 *
 * The 56px toggle's disc fills like a pie chart in member colors, proportional
 * to each member's share of the period's completions: 2 Paul : 1 Jen = ⅔ + ⅓.
 *
 * Two deliberate properties, both of them approved-mock requirements:
 *
 *  - **Slices start at 12 o'clock and run clockwise**, so the first member in
 *    roster order always owns the top of the disc and the reading is stable as
 *    counts change.
 *  - **NO stroke and NO gap between slices.** Adjacent slices are generated
 *    from the SAME cumulative fraction, so their endpoints are bit-identical
 *    and the disc reads as one solid object. A separating stroke (the obvious
 *    "chart" instinct) was explicitly rejected — it turned the counter into a
 *    seamed pie chart instead of a filled toggle.
 *
 * A single-member disc is emitted as one full-circle path (two half arcs) so
 * every slice is the same shape type — the solo case then reads exactly like
 * the app's existing solid "done" toggle, which is the point.
 */

/** One member's share going into the disc. */
export interface PieSegment {
  /** Stable React key — the member uid. */
  key: string;
  /** Hex fill (see utils/memberColors.ts). */
  color: string;
  /** Attributed completions; zero/negative segments are dropped. */
  units: number;
}

/** A drawable slice: an SVG path plus the fill it takes. */
export interface PieSlice {
  key: string;
  color: string;
  /** `d` attribute of a `<path>`. */
  d: string;
}

export interface PieGeometry {
  /** Center x/y of the square viewBox. */
  center?: number;
  /** Disc radius. */
  radius?: number;
}

/** Round to 2dp so paths are stable strings (and testable). */
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Point on the circle at `fraction` of a full turn, measured from 12 o'clock. */
const pointAt = (fraction: number, center: number, radius: number): [number, number] => {
  const angle = fraction * Math.PI * 2;
  return [r2(center + radius * Math.sin(angle)), r2(center - radius * Math.cos(angle))];
};

/** The whole disc, drawn as two half arcs (a single arc cannot close 360°). */
const fullCirclePath = (center: number, radius: number): string => {
  const top = r2(center - radius);
  const bottom = r2(center + radius);
  const cx = r2(center);
  return `M${cx},${top} A${radius},${radius} 0 1 1 ${cx},${bottom} A${radius},${radius} 0 1 1 ${cx},${top} Z`;
};

/**
 * Turn member shares into drawable slices.
 *
 * Proportions are normalised over the ATTRIBUTED units only, so the disc is
 * always full: a day that mixes attributed completions with grandfathered
 * (pre-feature, attributed to nobody) ones shows the attributed split rather
 * than an unexplained empty wedge.
 */
export const pieSlicePaths = (
  segments: readonly PieSegment[],
  { center = 23, radius = 21 }: PieGeometry = {},
): PieSlice[] => {
  const present = segments.filter(s => s.units > 0);
  const total = present.reduce((sum, s) => sum + s.units, 0);
  if (total <= 0) return [];

  const [only] = present;
  if (present.length === 1 && only) {
    return [{ key: only.key, color: only.color, d: fullCirclePath(center, radius) }];
  }

  const slices: PieSlice[] = [];
  let startFraction = 0;
  for (const segment of present) {
    // The end fraction is derived cumulatively (not from a per-slice sweep), so
    // this slice's end IS the next slice's start — no seam, no rounding drift.
    const endFraction = startFraction + segment.units / total;
    const [x0, y0] = pointAt(startFraction, center, radius);
    const [x1, y1] = pointAt(endFraction, center, radius);
    const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
    slices.push({
      key: segment.key,
      color: segment.color,
      d: `M${r2(center)},${r2(center)} L${x0},${y0} A${radius},${radius} 0 ${largeArc} 1 ${x1},${y1} Z`,
    });
    startFraction = endFraction;
  }
  return slices;
};
