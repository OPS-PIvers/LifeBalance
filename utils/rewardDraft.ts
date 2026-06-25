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
  };
}

/**
 * Build the Firestore reward payload from a draft (dollars → integer cents).
 *
 * Returns `null` when the draft is invalid (empty title, or a non-finite/negative
 * cost) so the caller can abort the submit. Conversion semantics, preserved
 * exactly from the prior inline implementation:
 * - `cost` is `Number(draft.cost)`; rejected when not finite or negative.
 * - `icon` defaults to '🎁' when blank.
 * - `allowanceCents` is only included for `type === 'allowance'`, computed as
 *   `Math.round(dollars * 100)`, defaulting to `0` when blank/invalid/≤ 0.
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
    // Convert dollars to integer cents; default to 0 when blank/invalid.
    payload.allowanceCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
  }
  if (draft.targetMemberId) {
    payload.targetMemberId = draft.targetMemberId;
  }
  return payload;
}
