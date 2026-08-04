import { describe, it, expect } from 'vitest';
import { type Account } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { OVER_ALLOCATION_MIN_SHORTFALL } from '@/utils/budgetFit';
import { previewPlanFit, projectedAvailable, type PlanDraft } from '@/utils/bucketPlanPreview';

function spentMap(entries: Record<string, BucketSpent>): Map<string, BucketSpent> {
  return new Map(Object.entries(entries));
}

function account(over: Partial<Account> & { id: string; balance: number }): Account {
  return {
    name: over.id,
    type: 'checking',
    lastUpdated: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const drafts = (entries: Record<string, number>): PlanDraft[] =>
  Object.entries(entries).map(([id, limit]) => ({ id, limit }));

describe('previewPlanFit', () => {
  it('sums max(0, limit − spent) across drafts', () => {
    const fit = previewPlanFit(
      500,
      drafts({ groceries: 300, gas: 120 }),
      spentMap({
        groceries: { verified: 100, pending: 25 },
        gas: { verified: 0, pending: 0 },
      }),
    );

    // (300 − 125) + (120 − 0) = 295
    expect(fit.claimed).toBe(295);
    expect(fit.available).toBe(500);
    expect(fit.leftover).toBe(205);
    expect(fit.shortfall).toBe(0);
    expect(fit.fits).toBe(true);
  });

  it('fits when the shortfall is just under the shared threshold', () => {
    // claimed 109.99 vs 100 available => shortfall 9.99 < 10
    const fit = previewPlanFit(100, drafts({ b1: 109.99 }), spentMap({ b1: { verified: 0, pending: 0 } }));

    expect(fit.shortfall).toBeCloseTo(9.99, 2);
    expect(fit.fits).toBe(true);
  });

  it('does NOT fit at exactly the shared threshold (same floor as the header mark)', () => {
    const fit = previewPlanFit(100, drafts({ b1: 110 }), spentMap({ b1: { verified: 0, pending: 0 } }));

    expect(fit.shortfall).toBe(OVER_ALLOCATION_MIN_SHORTFALL);
    expect(fit.fits).toBe(false);
  });

  it('reports the real-world over-allocation case ($356.22 vs $423.76)', () => {
    const fit = previewPlanFit(
      356.22,
      drafts({ b1: 423.76 }),
      spentMap({ b1: { verified: 0, pending: 0 } }),
    );

    expect(fit.claimed).toBe(423.76);
    expect(fit.leftover).toBeCloseTo(-67.54, 2);
    expect(fit.shortfall).toBeCloseTo(67.54, 2);
    expect(fit.fits).toBe(false);
  });

  it('an overspent bucket claims 0, never a negative that masks another over-claim', () => {
    const fit = previewPlanFit(
      100,
      drafts({ over: 100, claims: 115 }),
      spentMap({
        // Overspent by $200 — must contribute 0 to `claimed`, not −200.
        over: { verified: 300, pending: 0 },
        claims: { verified: 0, pending: 0 },
      }),
    );

    expect(fit.claimed).toBe(115);
    expect(fit.shortfall).toBeCloseTo(15, 2);
    expect(fit.fits).toBe(false);
  });

  it('treats a bucket missing from the spent map as $0 spent', () => {
    const fit = previewPlanFit(500, drafts({ brandNew: 200 }), new Map());

    expect(fit.claimed).toBe(200);
    expect(fit.leftover).toBe(300);
  });

  it('claims nothing with no drafts at all (leftover is the whole pool)', () => {
    const fit = previewPlanFit(356.22, [], new Map());

    expect(fit.claimed).toBe(0);
    expect(fit.leftover).toBe(356.22);
    expect(fit.shortfall).toBe(0);
    expect(fit.fits).toBe(true);
  });

  it('does not fit when available cash is negative even with a tiny plan', () => {
    const fit = previewPlanFit(-50, drafts({ b1: 5 }), spentMap({ b1: { verified: 0, pending: 0 } }));

    expect(fit.claimed).toBe(5);
    expect(fit.shortfall).toBe(55);
    expect(fit.fits).toBe(false);
  });

  it('sums exactly in cents (no floating-point drift)', () => {
    const fit = previewPlanFit(
      1,
      drafts({ a: 0.1, b: 0.2 }),
      spentMap({ a: { verified: 0, pending: 0 }, b: { verified: 0, pending: 0 } }),
    );

    expect(fit.claimed).toBe(0.3);
    expect(fit.leftover).toBe(0.7);
  });
});

describe('projectedAvailable', () => {
  const checking = account({ id: 'chk', balance: 1000, type: 'checking' });
  const savings = account({ id: 'sav', balance: 5000, type: 'savings' });
  const credit = account({ id: 'cc', balance: 400, type: 'credit' });

  it('is unchanged when every draft still matches its stored balance', () => {
    expect(
      projectedAvailable(356.22, [checking, savings, credit], {
        chk: '1000',
        sav: '5000',
        cc: '400',
      }),
    ).toBe(356.22);
  });

  it('a CHECKING balance edit moves the projected available cash', () => {
    // +$500 typed into checking.
    expect(projectedAvailable(356.22, [checking], { chk: '1500' })).toBe(856.22);
    // A downward edit moves it the other way.
    expect(projectedAvailable(356.22, [checking], { chk: '750' })).toBe(106.22);
  });

  it('a SAVINGS balance edit does NOT move it (only checking feeds Safe-to-Spend)', () => {
    expect(projectedAvailable(356.22, [checking, savings], { chk: '1000', sav: '99999' })).toBe(
      356.22,
    );
  });

  it('a CREDIT balance edit does NOT move it', () => {
    expect(projectedAvailable(356.22, [checking, credit], { chk: '1000', cc: '99999' })).toBe(
      356.22,
    );
  });

  it('an ARCHIVED checking account is excluded even when its draft changed', () => {
    const archived = account({ id: 'old', balance: 100, type: 'checking', archived: true });
    expect(projectedAvailable(356.22, [checking, archived], { chk: '1000', old: '9000' })).toBe(
      356.22,
    );
  });

  it('an empty draft is a no-op (treated as unchanged, not as $0)', () => {
    expect(projectedAvailable(356.22, [checking], { chk: '' })).toBe(356.22);
    expect(projectedAvailable(356.22, [checking], { chk: '   ' })).toBe(356.22);
  });

  it('an unparseable draft is a no-op', () => {
    expect(projectedAvailable(356.22, [checking], { chk: 'abc' })).toBe(356.22);
  });

  it('a missing draft (account added after mount) is a no-op', () => {
    expect(projectedAvailable(356.22, [checking], {})).toBe(356.22);
  });

  it('accepts a negative drafted checking balance (overdrawn is real)', () => {
    expect(projectedAvailable(356.22, [checking], { chk: '-100' })).toBe(-743.78);
  });

  it('sums deltas across several checking accounts', () => {
    const second = account({ id: 'chk2', balance: 200, type: 'checking' });
    expect(
      projectedAvailable(100, [checking, second], { chk: '1000.10', chk2: '200.20' }),
    ).toBe(100.3);
  });
});
