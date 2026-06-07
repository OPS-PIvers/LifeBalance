import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface CountUpProps {
  /** Target value to ease toward. */
  value: number;
  /** Animation duration in milliseconds. */
  durationMs?: number;
  /** Optional className passed to the wrapping span. */
  className?: string;
  /** Optional prefix rendered before the number (e.g. "+" or "-"). */
  prefix?: string;
  /** Optional suffix rendered after the number (e.g. " pts"). */
  suffix?: string;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Self-contained count-up animation for points/score values.
 *
 * Eases from the previously rendered value to `value` over ~600ms using
 * requestAnimationFrame. State is only ever updated from inside the rAF
 * callback (never synchronously in the effect body), satisfying the
 * `react-hooks/set-state-in-effect` rule and keeping the dependency array
 * honest.
 *
 * When the user prefers reduced motion, the final value renders immediately
 * with no animation.
 */
const CountUp: React.FC<CountUpProps> = ({
  value,
  durationMs = 600,
  className,
  prefix = '',
  suffix = '',
}) => {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);

  // A ref mirror of the rendered value so the animation effect can read the
  // current display without depending on the `display` state (which would
  // restart the animation on every frame).
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  const setDisplayValue = (next: number): void => {
    displayRef.current = next;
    setDisplay(next);
  };

  useEffect(() => {
    // Reduced motion: skip the animation entirely. The final value is rendered
    // directly below, so there is no need to touch state here.
    if (reduceMotion) return;
    if (value === displayRef.current) return;

    const from = displayRef.current;
    const delta = value - from;
    const start = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(progress);
      setDisplayValue(Math.round(from + delta * eased));
      rafRef.current = progress < 1 ? requestAnimationFrame(tick) : null;
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs, reduceMotion]);

  // When reduced motion is requested, always show the exact target value.
  const shown = reduceMotion ? value : display;

  return (
    <span className={className}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
};

export default CountUp;
