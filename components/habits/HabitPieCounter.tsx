import React from 'react';
import { pieSlicePaths, type PieSegment } from '@/utils/habitPieSlices';

interface HabitPieCounterProps {
  /** Member shares, already ordered (first segment owns 12 o'clock). */
  segments: readonly PieSegment[];
  /** The habit's live period counter — the numeral drawn over the disc. */
  count: number;
}

/**
 * The attribution counter that fills the habit row's 56px toggle: a disc split
 * into member-colored slices, with the period counter over it.
 *
 * Solid fills, no separating stroke, slices from 12 o'clock (see
 * `utils/habitPieSlices.ts` — the geometry and the no-seam rule live there). A
 * solo completion is a full one-color disc, which deliberately reads like the
 * app's plain "done" toggle.
 *
 * Habits-page only: the badge-row flame rings and this counter are the two
 * pieces of per-member decoration that live on habit rows and nowhere else.
 */
const HabitPieCounter: React.FC<HabitPieCounterProps> = ({ segments, count }) => {
  const slices = pieSlicePaths(segments);
  return (
    <>
      <svg
        viewBox="0 0 46 46"
        className="w-[46px] h-[46px] block"
        aria-hidden="true"
        focusable="false"
      >
        {slices.map(slice => (
          <path key={slice.key} d={slice.d} fill={slice.color} />
        ))}
      </svg>
      {/* Absolutely centred over the disc so the numeral never shifts as the
          slice arrangement changes. The soft shadow keeps it legible on every
          member color (amber included) without an outline. */}
      <span
        className="absolute inset-0 flex items-center justify-center font-mono text-[19px] font-bold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.28)]"
        aria-hidden="true"
      >
        {count}
      </span>
    </>
  );
};

export default HabitPieCounter;
