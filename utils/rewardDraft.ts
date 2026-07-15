import type { RewardItem } from '@/types/schema';

/** The reward type discriminant, narrowed to the non-undefined union. */
export type RewardType = NonNullable<RewardItem['type']>;

/**
 * Draft shape for the reward create/edit form (Plan 080d).
 *
 * `allowanceCents` is tracked as a dollar *string* (`allowanceDollars`) because it
 * is bound to a text/number `<input>`; the conversion to integer cents happens at
 * submit time in {@link buildRewardPayload}.
 */
export interface RewardDraft {
  title: string;
  cost: string;
  icon: string;
  type: RewardType;
  allowanceDollars: string;
  targetMemberId: string;
  active: boolean;
  // F-HABITS-02 (streak milestone celebrations): milestoneStreakDays is a
  // MILESTONES value (utils/habitMilestones.ts) as a string, or '' for "no
  // milestone gate" (the reward is always available, subject only to cost).
  // milestoneHabitId is a habit id, or '' for "any habit" once
  // milestoneStreakDays is set.
  milestoneStreakDays: string;
  milestoneHabitId: string;
}

/** A fresh, empty draft for the "add reward" form. */
export const EMPTY_REWARD_DRAFT: RewardDraft = {
  title: '',
  cost: '',
  icon: '🎁',
  type: 'realWorld',
  allowanceDollars: '',
  targetMemberId: '',
  active: true,
  milestoneStreakDays: '',
  milestoneHabitId: '',
};

/**
 * Convert an existing reward into an editable draft (cents → dollar string).
 *
 * Mirrors the inline form-seeding that previously lived in RewardsModal: the
 * allowance amount is rendered back as a fixed-2 dollar string, and absent
 * optional fields fall back to their empty/default representations.
 */
export function draftFromReward(reward: RewardItem): RewardDraft {
  return {
    title: reward.title,
    cost: String(reward.cost),
    icon: reward.icon,
    type: reward.type ?? 'realWorld',
    allowanceDollars:
      reward.allowanceCents !== undefined ? (reward.allowanceCents / 100).toFixed(2) : '',
    targetMemberId: reward.targetMemberId ?? '',
    active: reward.active ?? true,
    milestoneStreakDays:
      reward.unlockRequirement !== undefined ? String(reward.unlockRequirement.streakDays) : '',
    milestoneHabitId: reward.unlockRequirement?.habitId ?? '',
  };
}

/**
 * Build the Firestore reward payload from a draft (dollars → integer cents).
 *
 * Returns `null` when the draft is invalid so the caller can abort the submit.
 * A draft is invalid when the title is empty, the `cost` is non-finite/negative,
 * or (for `allowance` rewards) the allowance amount is non-finite/negative.
 * Conversion semantics, preserved exactly from the prior inline implementation:
 * - `cost` is `Number(draft.cost)`; rejected when not finite or negative.
 * - `icon` defaults to '🎁' when blank.
 * - `allowanceCents` is only included for `type === 'allowance'`, computed as
 *   `Math.round(dollars * 100)`. A blank string parses to `0` (a $0 allowance is
 *   allowed); a genuinely invalid or negative amount aborts the submit (returns
 *   `null`), mirroring the `cost` validation rather than silently coercing to 0.
 * - `targetMemberId` is only included when truthy.
 */
export function buildRewardPayload(draft: RewardDraft): Omit<RewardItem, 'id' | 'createdBy'> | null {
  const title = draft.title.trim();
  const cost = Number(draft.cost);
  const icon = draft.icon.trim() || '🎁';
  if (!title || !Number.isFinite(cost) || cost < 0) return null;

  const payload: Omit<RewardItem, 'id' | 'createdBy'> = {
    title,
    cost,
    icon,
    type: draft.type,
    active: draft.active,
  };
  if (draft.type === 'allowance') {
    const dollars = Number(draft.allowanceDollars);
    // Abort on a genuinely invalid/negative amount (consistent with `cost`).
    // Blank → Number('') === 0, which is finite and ≥ 0, so a $0 allowance is allowed.
    if (!Number.isFinite(dollars) || dollars < 0) return null;
    payload.allowanceCents = Math.round(dollars * 100);
  }
  if (draft.targetMemberId) {
    payload.targetMemberId = draft.targetMemberId;
  }
  // F-HABITS-02: a blank milestoneStreakDays means "no gate" (field omitted
  // entirely). A non-blank value must parse to a positive integer or the
  // submit is aborted, mirroring the cost/allowance validation above.
  if (draft.milestoneStreakDays.trim()) {
    const streakDays = Number(draft.milestoneStreakDays);
    if (!Number.isFinite(streakDays) || streakDays <= 0) return null;
    payload.unlockRequirement = draft.milestoneHabitId
      ? { streakDays, habitId: draft.milestoneHabitId }
      : { streakDays };
  }
  return payload;
}
