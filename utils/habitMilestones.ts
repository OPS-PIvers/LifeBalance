import { RewardItem } from '@/types/schema';

/**
 * F-HABITS-02 (streak milestone celebrations): the fixed set of streak-day
 * thresholds that trigger a distinct celebratory toast (and can gate a
 * `RewardItem.unlockRequirement`). Kept as a sorted array (ascending) so
 * `crossedMilestone` can find the HIGHEST milestone crossed by one streak
 * jump in a single pass.
 */
export const MILESTONES: readonly number[] = [7, 30, 100, 365];

/**
 * Returns the highest milestone in MILESTONES that the streak crossed going
 * from `prevStreak` to `nextStreak` (prevStreak < milestone <= nextStreak),
 * or `null` if no milestone was crossed. A streak can jump by more than 1 in
 * theory (e.g. a batch recompute); this returns the single highest milestone
 * so only one toast fires rather than one per crossed threshold.
 */
export const crossedMilestone = (prevStreak: number, nextStreak: number): number | null => {
  if (nextStreak <= prevStreak) return null;
  let highest: number | null = null;
  for (const milestone of MILESTONES) {
    if (prevStreak < milestone && nextStreak >= milestone) {
      highest = milestone;
    }
  }
  return highest;
};

/**
 * Whether `reward`'s milestone gate (if any) is satisfied by a habit
 * identified by `habitId` reaching `streakDays`. A reward with no
 * `unlockRequirement` is always considered satisfied (never gated). A
 * requirement with no `habitId` matches ANY habit; one with a `habitId`
 * matches only that specific habit.
 */
export const rewardMilestoneSatisfied = (
  reward: Pick<RewardItem, 'unlockRequirement'>,
  habitId: string,
  streakDays: number,
): boolean => {
  const requirement = reward.unlockRequirement;
  if (!requirement) return true;
  if (requirement.habitId && requirement.habitId !== habitId) return false;
  return streakDays >= requirement.streakDays;
};

/**
 * Whether `reward` should currently render as locked in the store: it has an
 * unlock requirement AND its id is not yet in the household's
 * `unlockedRewardIds`.
 */
export const isRewardLocked = (
  reward: Pick<RewardItem, 'id' | 'unlockRequirement'>,
  unlockedRewardIds: string[] | undefined,
): boolean => {
  if (!reward.unlockRequirement) return false;
  return !(unlockedRewardIds ?? []).includes(reward.id);
};
