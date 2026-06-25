import { describe, it, expect } from 'vitest';
import type { RewardItem } from '@/types/schema';
import {
  type RewardDraft,
  EMPTY_REWARD_DRAFT,
  buildRewardPayload,
  draftFromReward,
} from '@/utils/rewardDraft';

/** Build a draft on top of EMPTY_REWARD_DRAFT, overriding only the fields a case cares about. */
const makeDraft = (overrides: Partial<RewardDraft> = {}): RewardDraft => ({
  ...EMPTY_REWARD_DRAFT,
  title: 'Movie Night',
  cost: '50',
  ...overrides,
});

describe('buildRewardPayload', () => {
  it('returns null for an invalid draft (empty title)', () => {
    expect(buildRewardPayload(makeDraft({ title: '   ' }))).toBeNull();
  });

  it('returns null for a negative cost', () => {
    expect(buildRewardPayload(makeDraft({ cost: '-5' }))).toBeNull();
  });

  it('omits allowanceCents for a realWorld reward', () => {
    const payload = buildRewardPayload(makeDraft({ type: 'realWorld', allowanceDollars: '5' }));
    expect(payload).not.toBeNull();
    expect(payload).not.toHaveProperty('allowanceCents');
  });

  describe('dollars → integer cents (allowance type)', () => {
    const cents = (allowanceDollars: string): number | undefined =>
      buildRewardPayload(makeDraft({ type: 'allowance', allowanceDollars }))?.allowanceCents;

    it("'5' → 500", () => {
      expect(cents('5')).toBe(500);
    });

    it("'5.10' → 510", () => {
      expect(cents('5.10')).toBe(510);
    });

    it("'' → 0 (blank defaults to zero)", () => {
      expect(cents('')).toBe(0);
    });

    it("'0' → 0", () => {
      expect(cents('0')).toBe(0);
    });

    it("rounds fractional cents the same way as Math.round(dollars * 100)", () => {
      // 5.005 * 100 = 500.50000000000006 in IEEE-754, so Math.round yields 501.
      // The historical inline code used Math.round; we lock in that exact behavior
      // both against the literal result and against the same expression.
      expect(cents('5.005')).toBe(501);
      expect(cents('5.005')).toBe(Math.round(5.005 * 100));
    });

    it("invalid (non-numeric) → 0", () => {
      expect(cents('abc')).toBe(0);
    });
  });

  it('includes targetMemberId only when present', () => {
    expect(buildRewardPayload(makeDraft({ targetMemberId: 'kid_leo' }))).toMatchObject({
      targetMemberId: 'kid_leo',
    });
    expect(buildRewardPayload(makeDraft({ targetMemberId: '' }))).not.toHaveProperty(
      'targetMemberId',
    );
  });
});

describe('draftFromReward', () => {
  it('renders allowanceCents back as a fixed-2 dollar string', () => {
    const reward: RewardItem = {
      id: 'rw1',
      title: '$5 Allowance',
      cost: 100,
      icon: '💵',
      createdBy: 'u1',
      type: 'allowance',
      allowanceCents: 510,
      targetMemberId: 'kid_leo',
      active: false,
    };
    expect(draftFromReward(reward)).toEqual({
      title: '$5 Allowance',
      cost: '100',
      icon: '💵',
      type: 'allowance',
      allowanceDollars: '5.10',
      targetMemberId: 'kid_leo',
      active: false,
    });
  });

  it('defaults optional fields when absent (legacy reward)', () => {
    const reward: RewardItem = {
      id: 'rw-legacy',
      title: 'Movie Night',
      cost: 50,
      icon: '🎬',
      createdBy: 'u1',
    };
    expect(draftFromReward(reward)).toEqual({
      title: 'Movie Night',
      cost: '50',
      icon: '🎬',
      type: 'realWorld',
      allowanceDollars: '',
      targetMemberId: '',
      active: true,
    });
  });

  it('round-trips an allowance reward: {allowanceCents:510} → draft → payload{allowanceCents:510}', () => {
    const reward: RewardItem = {
      id: 'rw1',
      title: '$5.10 Allowance',
      cost: 100,
      icon: '💵',
      createdBy: 'u1',
      type: 'allowance',
      allowanceCents: 510,
    };
    const draft = draftFromReward(reward);
    expect(draft.allowanceDollars).toBe('5.10');

    const payload = buildRewardPayload(draft);
    expect(payload).toMatchObject({ type: 'allowance', allowanceCents: 510 });
  });
});
