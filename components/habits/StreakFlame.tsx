import React from 'react';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface StreakFlameProps {
  /** Current streak length in days. Drives the animation intensity. */
  streakDays: number;
  /** Icon size, forwarded to the lucide Flame icon. */
  size?: number;
  /** Extra classes applied to the Flame icon. */
  className?: string;
  /** Whether to fill the flame (defaults to true for active streaks >= 3). */
  fill?: boolean;
}

/**
 * Animated streak flame.
 *
 * - Streaks >= 3 (1.5x tier) get a subtle pulse.
 * - Streaks >= 7 (2x tier) get a stronger, faster pulse.
 * - Below 3, or when reduced motion is requested, the flame is static.
 *
 * The animation is a small scale/opacity loop driven by Framer Motion, so it
 * pauses cleanly and never blocks interaction.
 */
const StreakFlame: React.FC<StreakFlameProps> = ({
  streakDays,
  size = 10,
  className,
  fill,
}) => {
  const reduceMotion = useReducedMotion();
  const shouldFill = fill ?? streakDays >= 3;

  const tier = streakDays >= 7 ? 'hot' : streakDays >= 3 ? 'warm' : 'none';
  const animate =
    reduceMotion || tier === 'none'
      ? undefined
      : tier === 'hot'
        ? { scale: [1, 1.25, 1], rotate: [0, -4, 4, 0] }
        : { scale: [1, 1.12, 1] };

  const transition =
    tier === 'hot'
      ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const }
      : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' as const };

  return (
    <motion.span
      className="inline-flex"
      animate={animate}
      transition={animate ? transition : undefined}
      style={{ transformOrigin: 'center bottom' }}
      aria-hidden="true"
    >
      <Flame size={size} className={className} fill={shouldFill ? 'currentColor' : 'none'} />
    </motion.span>
  );
};

export default StreakFlame;
