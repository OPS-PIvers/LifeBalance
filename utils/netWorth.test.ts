import { describe, it, expect } from 'vitest';
import { computeNetWorth } from '@/utils/netWorth';

describe('computeNetWorth', () => {
  it('sums checking + savings as assets and credit as liabilities', () => {
    const result = computeNetWorth([
      { type: 'checking', balance: 1500.5 },
      { type: 'savings', balance: 2000 },
      { type: 'credit', balance: 300.25 },
    ]);
    expect(result.totalAssets).toBe(3500.5);
    expect(result.totalLiabilities).toBe(300.25);
    expect(result.netWorth).toBe(3200.25);
  });

  it('returns zeros for an empty account list', () => {
    expect(computeNetWorth([])).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
  });

  it('handles liabilities exceeding assets (negative net worth)', () => {
    const result = computeNetWorth([
      { type: 'checking', balance: 100 },
      { type: 'credit', balance: 500 },
    ]);
    expect(result.netWorth).toBe(-400);
  });

  it('avoids float drift on repeating-decimal cent sums', () => {
    const result = computeNetWorth([
      { type: 'checking', balance: 0.1 },
      { type: 'checking', balance: 0.2 },
    ]);
    expect(result.totalAssets).toBe(0.3);
  });
});
