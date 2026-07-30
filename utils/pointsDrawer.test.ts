import { describe, it, expect } from 'vitest';
import { getAdultStandings, computePointsTrend, MemberStanding } from '@/utils/pointsDrawer';
import { HouseholdMember, WeeklyRecap } from '@/types/schema';

const member = (overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>): HouseholdMember => ({
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const findRow = (rows: MemberStanding[], memberId: string): MemberStanding | undefined =>
  rows.find((row) => row.memberId === memberId);

describe('getAdultStandings', () => {
  it('sorts adults descending by the selected period and crowns the sole leader', () => {
    const members = [
      member({ uid: 'jen', displayName: 'Jen', points: { daily: 40, weekly: 325, total: 1000 } }),
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 20, weekly: 285, total: 900 } }),
    ];

    const week = getAdultStandings(members, 'week');
    expect(week.map((r) => r.memberId)).toEqual(['jen', 'paul']);
    expect(findRow(week, 'jen')?.isLeader).toBe(true);
    expect(findRow(week, 'paul')?.isLeader).toBe(false);
    expect(findRow(week, 'jen')?.points).toBe(325);

    const day = getAdultStandings(members, 'day');
    expect(day.map((r) => r.memberId)).toEqual(['jen', 'paul']);
    expect(findRow(day, 'jen')?.points).toBe(40);
  });

  it('excludes managed kids (adults-only standings)', () => {
    const members = [
      member({ uid: 'jen', displayName: 'Jen', points: { daily: 10, weekly: 10, total: 10 } }),
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true, points: { daily: 999, weekly: 999, total: 999 } }),
    ];

    const rows = getAdultStandings(members, 'week');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.memberId).toBe('jen');
  });

  it('never crowns a solo adult — nothing to lead over', () => {
    const members = [member({ uid: 'jen', displayName: 'Jen', points: { daily: 40, weekly: 40, total: 40 } })];
    const rows = getAdultStandings(members, 'week');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isLeader).toBe(false);
  });

  it('never crowns a tie', () => {
    const members = [
      member({ uid: 'jen', displayName: 'Jen', points: { daily: 10, weekly: 50, total: 0 } }),
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 50, total: 0 } }),
    ];
    const rows = getAdultStandings(members, 'week');
    expect(rows.every((r) => !r.isLeader)).toBe(true);
    // Ties break alphabetically for a stable order.
    expect(rows.map((r) => r.memberId)).toEqual(['jen', 'paul']);
  });

  it('never crowns an all-zero field', () => {
    const members = [
      member({ uid: 'jen', displayName: 'Jen' }),
      member({ uid: 'paul', displayName: 'Paul' }),
    ];
    const rows = getAdultStandings(members, 'week');
    expect(rows.every((r) => !r.isLeader)).toBe(true);
  });

  it('returns an empty array when there are no adults', () => {
    const members = [member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true })];
    expect(getAdultStandings(members, 'week')).toEqual([]);
  });
});

describe('computePointsTrend', () => {
  const recap = (pointsByMember: WeeklyRecap['pointsByMember']): WeeklyRecap => ({
    id: '2026-W30',
    isoWeek: '2026-W30',
    generatedAt: '2026-07-27T09:00:00.000Z',
    totalSpend: 0,
    priorWeekSpend: 0,
    topCategoryDeltas: [],
    habitCompletions: 0,
    streaksAtRisk: [],
    pointsByMember,
    upcomingBills: [],
    narrative: '',
    narrativeSource: 'template',
    premium: false,
  });

  const adults = [
    member({ uid: 'jen', displayName: 'Jen' }),
    member({ uid: 'paul', displayName: 'Paul' }),
  ];

  it('derives a positive percent vs. the newest recap', () => {
    const recaps = [
      recap([
        { memberId: 'jen', name: 'Jen', points: 300 },
        { memberId: 'paul', name: 'Paul', points: 245 },
      ]),
    ];
    // last week total = 545; this week 610 → +11.9% → rounds to 12.
    expect(computePointsTrend(610, recaps, adults)).toEqual({ percent: 12 });
  });

  it('derives a negative percent when this week is behind', () => {
    const recaps = [recap([{ memberId: 'jen', name: 'Jen', points: 400 }])];
    expect(computePointsTrend(300, recaps, adults)).toEqual({ percent: -25 });
  });

  it('uses only the NEWEST recap (recaps are newest-first)', () => {
    const recaps = [
      recap([{ memberId: 'jen', name: 'Jen', points: 100 }]), // newest
      recap([{ memberId: 'jen', name: 'Jen', points: 1000 }]), // older — ignored
    ];
    expect(computePointsTrend(150, recaps, adults)).toEqual({ percent: 50 });
  });

  it('omits the chip when there is no recap yet', () => {
    expect(computePointsTrend(610, [], adults)).toBeNull();
  });

  it('omits the chip when last week totalled zero (nothing to divide by)', () => {
    const recaps = [recap([{ memberId: 'jen', name: 'Jen', points: 0 }])];
    expect(computePointsTrend(50, recaps, adults)).toBeNull();
  });

  it('excludes a managed kid\'s recap points from the baseline (adults-only, matching the household weekly figure)', () => {
    const membersWithKid = [
      member({ uid: 'jen', displayName: 'Jen' }),
      member({ uid: 'paul', displayName: 'Paul' }),
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ];
    const recaps = [
      recap([
        { memberId: 'jen', name: 'Jen', points: 150 },
        { memberId: 'paul', name: 'Paul', points: 0 },
        { memberId: 'kid_leo', name: 'Leo', points: 35 },
      ]),
    ];
    // Adult-only baseline is 150 (Jen) + 0 (Paul) = 150. Household weekly (which
    // never includes the kid's chore points) flat at 150 → 0% trend, not the
    // -19% you'd get by including the kid's 35 in the 185 baseline.
    expect(computePointsTrend(150, recaps, membersWithKid)).toEqual({ percent: 0 });
  });

  it('drops the chip when the adult-only baseline is zero even if kids scored', () => {
    const membersWithKid = [
      member({ uid: 'jen', displayName: 'Jen' }),
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ];
    const recaps = [
      recap([
        { memberId: 'jen', name: 'Jen', points: 0 },
        { memberId: 'kid_leo', name: 'Leo', points: 35 },
      ]),
    ];
    expect(computePointsTrend(50, recaps, membersWithKid)).toBeNull();
  });
});
