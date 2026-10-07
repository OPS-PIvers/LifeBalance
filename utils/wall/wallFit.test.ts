import { describe, expect, it } from 'vitest';
import { fitScale } from './wallFit';

describe('fitScale', () => {
  it('takes the largest size when everything fits', () => {
    expect(fitScale(0.8, 1.6, () => true)).toBe(1.6);
  });

  it('finds the largest size that still fits, to within a step', () => {
    const scale = fitScale(0.8, 1.6, s => s <= 1.234);
    expect(scale).toBeLessThanOrEqual(1.234);
    expect(scale).toBeGreaterThan(1.234 - 0.02);
  });

  it('stops at the smallest size on a day too busy to fit', () => {
    expect(fitScale(0.8, 1.6, () => false)).toBe(0.8);
  });

  it('lays out only a handful of times', () => {
    let calls = 0;
    fitScale(0.8, 1.6, s => {
      calls += 1;
      return s <= 1;
    });
    expect(calls).toBeLessThanOrEqual(7);
  });
});
