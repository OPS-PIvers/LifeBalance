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
    const derived = deriveWeeklyRecap(RANGE, input);

    // The derived object carries assembleWeeklyRecap's output verbatim, plus
    // the wrapper fields (id/isoWeek/generatedAt/narrative/...) it adds.
    expect(derived).toMatchObject(assembled);
    expect(derived.id).toBe(ISO_WEEK);
    expect(derived.isoWeek).toBe(ISO_WEEK);
  });

  it('is honest about having no narrative: premium is false, never true with an empty narrative', () => {
    // A `premium: true` + empty `narrative` would render a blank paragraph in
    // WeeklyRecapDrawer/RecapDeck (both protected/out of scope for this
    // change) — `premium: false` is the only lever available to route into
    // their existing graceful "nothing generated yet" fallback instead.
    const derived = deriveWeeklyRecap(RANGE, baseInput());
    expect(derived.narrative).toBe('');
    expect(derived.premium).toBe(false);
  });

  it('still emits the household daily-points series even with no per-member data', () => {
    // Mirrors assembleWeeklyRecap's own "household series is real even when
    // memberFacts is empty" contract (see recapAssembly.ts's doc comment).
    const input = { ...baseInput(), habits: [] };
    const derived = deriveWeeklyRecap(RANGE, input);
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
