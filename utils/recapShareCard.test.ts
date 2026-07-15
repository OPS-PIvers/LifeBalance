import { describe, it, expect } from 'vitest';
import { buildRecapShareContent } from '@/utils/recapShareCard';
import type { WeeklyRecap } from '@/types/schema';

function makeRecap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    id: '2026-W28',
    isoWeek: '2026-W28',
    generatedAt: '2026-07-13T00:00:00.000Z',
    totalSpend: 420,
    priorWeekSpend: 500,
    topCategoryDeltas: [],
    habitCompletions: 12,
    streaksAtRisk: [],
    pointsByMember: [],
    upcomingBills: [],
    narrative: 'A great week.',
    narrativeSource: 'template',
    premium: true,
    ...overrides,
  };
}

describe('buildRecapShareContent', () => {
  it('formats total spend and a "less than last week" delta when spend dropped', () => {
    const content = buildRecapShareContent(makeRecap({ totalSpend: 420, priorWeekSpend: 500 }));
    expect(content.totalSpendLabel).toBe('$420');
    expect(content.spendDeltaLabel).toBe('$80 less than last week');
    expect(content.spendDeltaIsGood).toBe(true);
  });

  it('formats a "more than last week" delta when spend rose', () => {
    const content = buildRecapShareContent(makeRecap({ totalSpend: 600, priorWeekSpend: 500 }));
    expect(content.spendDeltaLabel).toBe('$100 more than last week');
    expect(content.spendDeltaIsGood).toBe(false);
  });

  it('omits the delta when there is no prior-week baseline', () => {
    const content = buildRecapShareContent(makeRecap({ totalSpend: 200, priorWeekSpend: 0 }));
    expect(content.spendDeltaLabel).toBeNull();
  });

  it('omits the delta when spend is unchanged', () => {
    const content = buildRecapShareContent(makeRecap({ totalSpend: 300, priorWeekSpend: 300 }));
    expect(content.spendDeltaLabel).toBeNull();
  });

  it('picks the highest-points member as topMember', () => {
    const content = buildRecapShareContent(
      makeRecap({
        pointsByMember: [
          { memberId: 'a', name: 'Alex', points: 40 },
          { memberId: 'b', name: 'Bailey', points: 65 },
        ],
      })
    );
    expect(content.topMember).toEqual({ name: 'Bailey', points: 65 });
  });

  it('returns null topMember when there are no members', () => {
    const content = buildRecapShareContent(makeRecap({ pointsByMember: [] }));
    expect(content.topMember).toBeNull();
  });

  it('picks the longest streak as topStreak', () => {
    const content = buildRecapShareContent(
      makeRecap({
        streaksAtRisk: [
          { habitTitle: 'Read', streakDays: 5 },
          { habitTitle: 'Gym', streakDays: 11 },
        ],
      })
    );
    expect(content.topStreak).toEqual({ habitTitle: 'Gym', streakDays: 11 });
  });

  it('returns null topStreak when there are none', () => {
    const content = buildRecapShareContent(makeRecap({ streaksAtRisk: [] }));
    expect(content.topStreak).toBeNull();
  });

  it('respects a custom currency', () => {
    const content = buildRecapShareContent(makeRecap({ totalSpend: 100 }), 'EUR');
    expect(content.totalSpendLabel).toBe('€100');
  });

  it('carries through the isoWeek and habitCompletions unchanged', () => {
    const content = buildRecapShareContent(makeRecap({ isoWeek: '2026-W12', habitCompletions: 7 }));
    expect(content.isoWeek).toBe('2026-W12');
    expect(content.habitCompletions).toBe(7);
  });
});
