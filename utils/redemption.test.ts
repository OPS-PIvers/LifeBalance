import { describe, it, expect } from 'vitest';
import { redemptionMemberDelta } from '@/utils/redemption';
import type { RewardRedemption } from '@/types/schema';

/**
 * redemptionMemberDelta is the single source of truth for what approving a
 * redemption applies to the kid's member doc. These lock the three cases the
 * approval path (live + mock) depends on.
 */
describe('redemptionMemberDelta', () => {
  const base: Pick<RewardRedemption, 'cost' | 'type' | 'allowanceCents'> = {
    cost: 50,
    type: 'realWorld',
  };

  it('realWorld reward → deducts the point cost, credits no allowance', () => {
    expect(redemptionMemberDelta({ ...base, type: 'realWorld', cost: 50 })).toEqual({
      pointsDelta: -50,
      allowanceDelta: 0,
    });
  });

  it('allowance reward → deducts the point cost AND credits allowanceCents', () => {
    expect(
      redemptionMemberDelta({ type: 'allowance', cost: 100, allowanceCents: 500 }),
    ).toEqual({ pointsDelta: -100, allowanceDelta: 500 });
  });

  it('allowance reward with missing allowanceCents → deducts cost, credits 0 (no NaN)', () => {
    expect(redemptionMemberDelta({ type: 'allowance', cost: 100 })).toEqual({
      pointsDelta: -100,
      allowanceDelta: 0,
    });
  });

  it('always deducts the point cost (never credits points)', () => {
    // A free (cost 0) allowance reward still credits the allowance but deducts no
    // points; normalize -0 → 0 so the JS signed-zero quirk doesn't fail the check.
    const free = redemptionMemberDelta({ type: 'allowance', cost: 0, allowanceCents: 500 });
    expect(free.pointsDelta + 0).toBe(0);
    expect(free.allowanceDelta).toBe(500);
    expect(redemptionMemberDelta({ type: 'realWorld', cost: 25 }).pointsDelta).toBe(-25);
  });
});
