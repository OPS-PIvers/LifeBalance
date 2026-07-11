import { describe, it, expect } from 'vitest';
import { mergeById, collectMissingMealIds } from '@/contexts/household/selectors';

describe('mergeById', () => {
  it('returns primary when secondary is empty', () => {
    const primary = [{ id: 'a' }];
    expect(mergeById(primary, [])).toBe(primary);
  });

  it('returns secondary when primary is empty', () => {
    const secondary = [{ id: 'a' }];
    expect(mergeById([], secondary)).toBe(secondary);
  });

  it('keeps primary entries when an id appears in both', () => {
    const primary = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const secondary = [{ id: 'b', v: 99 }, { id: 'c', v: 3 }];
    expect(mergeById(primary, secondary)).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 3 },
    ]);
  });
});

describe('collectMissingMealIds', () => {
  const meals = [{ id: 'm1' }, { id: 'm2' }];

  it('returns ids referenced by the plan but absent from meals', () => {
    const plan = [{ mealId: 'm1' }, { mealId: 'm3' }, { mealId: 'm4' }];
    expect(collectMissingMealIds(plan, meals, new Set()).sort()).toEqual(['m3', 'm4']);
  });

  it('skips entries without a mealId (one-off meals)', () => {
    const plan = [{ mealId: undefined }, { mealId: 'm3' }];
    expect(collectMissingMealIds(plan, meals, new Set())).toEqual(['m3']);
  });

  it('skips already-requested ids', () => {
    const plan = [{ mealId: 'm3' }, { mealId: 'm4' }];
    expect(collectMissingMealIds(plan, meals, new Set(['m3']))).toEqual(['m4']);
  });

  it('collapses duplicate references to one id', () => {
    const plan = [{ mealId: 'm3' }, { mealId: 'm3' }];
    expect(collectMissingMealIds(plan, meals, new Set())).toEqual(['m3']);
  });

  it('returns empty when every reference resolves', () => {
    const plan = [{ mealId: 'm1' }, { mealId: 'm2' }];
    expect(collectMissingMealIds(plan, meals, new Set())).toEqual([]);
  });
});
