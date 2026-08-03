import { describe, expect, it } from 'vitest';
import { assembleWeeklyRecap, type DataAssemblyInput } from '@/utils/recapAssembly';
import { deriveWeeklyRecap, transactionsCoverWeek } from '@/utils/recapCompose';
import { weekRangeForIsoWeek } from '@/utils/recapWeek';

/**
 * Anchored to the same Mon 2026-06-29 → Sun 2026-07-05 (2026-W27) week
 * `utils/recapAssembly.test.ts` and `utils/recapWeek.test.ts` use — see
 * either file's "fixtures are anchored to their own week" warning.
 */
const ISO_WEEK = '2026-W27';
const WEEK_START = '2026-06-29';
const WEEK_END = '2026-07-05';
const RANGE = weekRangeForIsoWeek(ISO_WEEK)!;

const baseInput = (): Omit<DataAssemblyInput, 'weekStart' | 'weekEnd'> => ({
  transactions: [
    { amount: 42, category: 'Groceries', date: '2026-06-30', status: 'verified' },
    { amount: 18, category: 'Groceries', date: '2026-06-23', status: 'verified' }, // prior week
    { amount: 999, category: 'Groceries', date: '2026-06-30', status: 'pending_review' }, // excluded
  ],
  habits: [
    {
      title: 'Morning walk',
      period: 'daily',
      type: 'positive',
      basePoints: 10,
      scoringType: 'threshold',
      targetCount: 1,
      completedDates: [WEEK_START, '2026-06-30'],
      streakDays: 2,
      completedBy: {
        [WEEK_START]: { u1: 1 },
        '2026-06-30': { u1: 1 },
      },
    },
  ],
  members: [{ uid: 'u1', displayName: 'Jen' }],
  calendarItems: [{ title: 'Internet', amount: 65, date: '2026-07-08', type: 'expense' }],
});

describe('deriveWeeklyRecap', () => {
  it('produces the same numeric fields as calling assembleWeeklyRecap directly', () => {
    const input = baseInput();
    const assembled = assembleWeeklyRecap({ ...input, weekStart: WEEK_START, weekEnd: WEEK_END });
    const derived = deriveWeeklyRecap(RANGE, input, true);

    // The derived object carries assembleWeeklyRecap's output verbatim, plus
    // the wrapper fields (id/isoWeek/generatedAt/narrative/...) it adds.
    expect(derived).toMatchObject(assembled);
    expect(derived.id).toBe(ISO_WEEK);
    expect(derived.isoWeek).toBe(ISO_WEEK);
  });

  it('leaves the narrative empty — the absence is the signal, not a premium=false workaround', () => {
    // Narrative honesty and plan truthfulness are INDEPENDENT: a derived
    // recap never has a narrative (nothing generated it), regardless of the
    // household's actual plan.
    const derived = deriveWeeklyRecap(RANGE, baseInput(), true);
    expect(derived.narrative).toBe('');
  });

  it('never reports premium:false purely because the recap lacks a narrative — premium is whatever the caller resolved', () => {
    // A prior version of this module hardcoded `premium: false` on every
    // derived recap to route into the drawer's paywall fallback instead of
    // blank space. That was WRONG: `premium` describes the household's PLAN,
    // and while billing is off every household IS premium — hardcoding
    // false told them they lacked something they already have. `premium` is
    // now an explicit, caller-supplied parameter with no default, so this
    // asserts both directions actually flow through untouched.
    const premiumDerived = deriveWeeklyRecap(RANGE, baseInput(), true);
    expect(premiumDerived.premium).toBe(true);
    expect(premiumDerived.narrative).toBe(''); // still no narrative — the two facts don't couple

    const freeDerived = deriveWeeklyRecap(RANGE, baseInput(), false);
    expect(freeDerived.premium).toBe(false);
    expect(freeDerived.narrative).toBe(''); // same empty narrative either way
  });

  it('still emits the household daily-points series even with no per-member data', () => {
    // Mirrors assembleWeeklyRecap's own "household series is real even when
    // memberFacts is empty" contract (see recapAssembly.ts's doc comment).
    // Positive control first: with the base fixture's attributed habit, this
    // field is NOT empty — so the `toEqual([])` below is a real consequence of
    // dropping the habits, not the function's answer for every input.
    expect(deriveWeeklyRecap(RANGE, baseInput(), true).memberFacts?.length).toBeGreaterThan(0);

    const input = { ...baseInput(), habits: [] };
    const derived = deriveWeeklyRecap(RANGE, input, true);
    expect(derived.memberFacts).toEqual([]);
    expect(derived.dailyPoints).toHaveLength(7);
  });
});

describe('transactionsCoverWeek — honest degradation for the 90-day transaction window', () => {
  it('is always covered when the context reports no windowing at all', () => {
    expect(transactionsCoverWeek(RANGE, null, true)).toBe(true);
  });

  it('is always covered once loadAllTransactions has finished (hasMoreTransactions=false)', () => {
    expect(transactionsCoverWeek(RANGE, '2026-08-01', false)).toBe(true);
  });

  it('is covered when the live window already reaches back to the PRIOR week', () => {
    // Prior week's Monday is 2026-06-22 — a window starting on/before it covers.
    expect(transactionsCoverWeek(RANGE, '2026-06-22', true)).toBe(true);
    expect(transactionsCoverWeek(RANGE, '2026-06-01', true)).toBe(true);
  });

  it('is NOT covered when the window starts after the prior week — the caller must load more before deriving', () => {
    expect(transactionsCoverWeek(RANGE, '2026-06-23', true)).toBe(false);
    expect(transactionsCoverWeek(RANGE, '2026-07-01', true)).toBe(false);
  });
});
