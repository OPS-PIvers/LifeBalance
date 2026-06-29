import React from 'react';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getMultiplier } from '@/utils/habitLogic';
import { Habit } from '@/types/schema';

interface StreakFlameProps {
  /** Current streak length in the habit's cadence (days for daily, ISO weeks for weekly). */
  streakDays: number;
  /**
   * Habit period — drives the multiplier ladder so weekly streaks light up at
   * the right tier (2w=1.5x, 4w=2x) instead of the daily 3/7-day thresholds.
   * Defaults to 'daily' so existing daily callers are unchanged.
   */
  period?: Habit['period'];
  /** Icon size, forwarded to the lucide Flame icon. */
  size?: number;
  /** Extra classes applied to the Flame icon. */
  className?: string;
  /** Whether to fill the flame (defaults to true once the 1.5x bonus tier is earned). */
  fill?: boolean;
}

/**
 * Animated streak flame.
 *
 * Tiers are derived from the period-aware point multiplier (getMultiplier), so
 * they track the bonus the streak has actually earned:
 * - 1.5x tier (daily 3 days / weekly 2 weeks) gets a subtle pulse.
 * - 2x tier (daily 7 days / weekly 4 weeks) gets a stronger, faster pulse.
 * - Below the 1.5x tier, or when reduced motion is requested, the flame is static.
 *
 * The animation is a small scale/opacity loop driven by Framer Motion, so it
 * pauses cleanly and never blocks interaction.
 */
const StreakFlame: React.FC<StreakFlameProps> = ({
  streakDays,
  period = 'daily',
  size = 10,
  className,
  fill,
}) => {
  const reduceMotion = useReducedMotion();
  // Positive multiplier for this streak in the habit's cadence: 1.0 / 1.5 / 2.0.
  const multiplier = getMultiplier(streakDays, true, period);
  const shouldFill = fill ?? multiplier >= 1.5;

  const tier = multiplier >= 2.0 ? 'hot' : multiplier >= 1.5 ? 'warm' : 'none';
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
