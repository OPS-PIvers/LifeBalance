import { describe, it, expect } from 'vitest';
import { computePriceChangeNudge } from '@/utils/priceChangeNudge';

describe('computePriceChangeNudge', () => {
  it('returns null when there is no reference amount', () => {
    expect(computePriceChangeNudge(100, undefined)).toBeNull();
  });

  it('returns null when the amounts match exactly', () => {
    expect(computePriceChangeNudge(100, 100)).toBeNull();
  });

  it('returns null when the change is within the 10% noise threshold', () => {
    expect(computePriceChangeNudge(105, 100)).toBeNull();
    expect(computePriceChangeNudge(95, 100)).toBeNull();
  });

  it('nudges up when paid materially more than the reference', () => {
    const nudge = computePriceChangeNudge(118, 100);
    expect(nudge).not.toBeNull();
    expect(nudge?.delta).toBe(18);
    expect(nudge?.message).toBe('Up $18.00 from last time');
  });

  it('nudges down when paid materially less than the reference', () => {
    const nudge = computePriceChangeNudge(80, 100);
    expect(nudge).not.toBeNull();
    expect(nudge?.delta).toBe(-20);
    expect(nudge?.message).toBe('Down $20.00 from last time');
  });

  it('is not fooled by a tiny reference amount amplifying relative change', () => {
    // $0.50 reference, paid $0.60 -- absolute change is a dime, guarded by
    // MIN_REFERENCE_AMOUNT so it doesn't scream "up 20%".
    expect(computePriceChangeNudge(0.6, 0.5)).toBeNull();
  });

  it('ignores non-finite or non-positive paid amounts', () => {
    expect(computePriceChangeNudge(0, 100)).toBeNull();
    expect(computePriceChangeNudge(-5, 100)).toBeNull();
    expect(computePriceChangeNudge(NaN, 100)).toBeNull();
  });

  it('ignores a non-positive reference amount', () => {
    expect(computePriceChangeNudge(100, 0)).toBeNull();
    expect(computePriceChangeNudge(100, -10)).toBeNull();
  });

  it('respects the household-configured currency', () => {
    const nudgeEur = computePriceChangeNudge(118, 100, 'EUR');
    expect(nudgeEur?.message).toBe('Up €18.00 from last time');

    const nudgeGbp = computePriceChangeNudge(118, 100, 'GBP');
    expect(nudgeGbp?.message).toBe('Up £18.00 from last time');
  });
});
