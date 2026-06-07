import { useMediaQuery } from './useMediaQuery';

/**
 * Returns true when the user has requested reduced motion at the OS level
 * (prefers-reduced-motion: reduce).
 *
 * Use this to gate non-essential animations — Framer Motion transitions,
 * count-up effects, confetti, auto-scrolling, etc. Essential feedback
 * (a state changing) should remain, just without the flourish.
 *
 * Example:
 *   const reduceMotion = useReducedMotion();
 *   <motion.div animate={reduceMotion ? false : { y: 0 }} />
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
