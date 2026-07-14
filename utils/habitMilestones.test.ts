import { describe, it, expect } from 'vitest';
import { crossedMilestone, rewardMilestoneSatisfied, isRewardLocked, MILESTONES } from '@/utils/habitMilestones';

describe('crossedMilestone', () => {
  it('returns null when the streak did not cross any milestone', () => {
    expect(crossedMilestone(1, 2)).toBeNull();
    expect(crossedMilestone(3, 6)).toBeNull();
  });

  it('returns null when the streak went down or stayed flat', () => {
    expect(crossedMilestone(10, 5)).toBeNull();
    expect(crossedMilestone(7, 7)).toBeNull();
  });

  it('returns the milestone when exactly reached', () => {
    expect(crossedMilestone(6, 7)).toBe(7);
    expect(crossedMilestone(29, 30)).toBe(30);
    expect(crossedMilestone(99, 100)).toBe(100);
    expect(crossedMilestone(364, 365)).toBe(365);
  });

  it('returns the HIGHEST milestone crossed in one jump', () => {
    expect(crossedMilestone(0, 30)).toBe(30);
    expect(crossedMilestone(6, 400)).toBe(365);
  });

  it('does not re-fire for a streak that is already past the milestone', () => {
    expect(crossedMilestone(10, 11)).toBeNull();
  });

  it('exposes the milestone list sorted ascending', () => {
    expect(MILESTONES).toEqual([7, 30, 100, 365]);
  });
});

describe('rewardMilestoneSatisfied', () => {
  it('is always satisfied when there is no requirement', () => {
    expect(rewardMilestoneSatisfied({}, 'habit-1', 0)).toBe(true);
  });

  it('requires the streak threshold for an ANY-habit requirement', () => {
    const reward = { unlockRequirement: { streakDays: 30 } };
    expect(rewardMilestoneSatisfied(reward, 'habit-1', 29)).toBe(false);
    expect(rewardMilestoneSatisfied(reward, 'habit-2', 30)).toBe(true);
  });

  it('requires both the specific habit AND the streak threshold', () => {
    const reward = { unlockRequirement: { streakDays: 30, habitId: 'habit-1' } };
    expect(rewardMilestoneSatisfied(reward, 'habit-2', 100)).toBe(false);
    expect(rewardMilestoneSatisfied(reward, 'habit-1', 29)).toBe(false);
    expect(rewardMilestoneSatisfied(reward, 'habit-1', 30)).toBe(true);
  });
});

describe('isRewardLocked', () => {
  it('is never locked without a requirement', () => {
    expect(isRewardLocked({ id: 'r1' }, undefined)).toBe(false);
  });

  it('is locked when gated and not yet in unlockedRewardIds', () => {
    const reward = { id: 'r1', unlockRequirement: { streakDays: 30 } };
    expect(isRewardLocked(reward, undefined)).toBe(true);
    expect(isRewardLocked(reward, ['other'])).toBe(true);
  });

  it('is unlocked once its id is present', () => {
    const reward = { id: 'r1', unlockRequirement: { streakDays: 30 } };
    expect(isRewardLocked(reward, ['r1'])).toBe(false);
  });
});
