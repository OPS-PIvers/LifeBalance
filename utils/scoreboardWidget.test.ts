import { describe, it, expect } from 'vitest';
import { selectAdultStandings, deriveScoreboardTrend } from '@/utils/scoreboardWidget';
import type { HouseholdMember, WeeklyRecap } from '@/types/schema';

function member(overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>): HouseholdMember {
  return {
    role: 'member',
    points: { daily: 0, weekly: 0, total: 0 },
    ...overrides,
  };
}

function recap(overrides: Partial<WeeklyRecap> & Pick<WeeklyRecap, 'isoWeek' | 'pointsByMember'>): WeeklyRecap {
  return {
    id: overrides.isoWeek,
    generatedAt: '2026-07-20T12:00:00.000Z',
    totalSpend: 0,
    priorWeekSpend: 0,
    topCategoryDeltas: [],
    habitCompletions: 0,
    streaksAtRisk: [],
    upcomingBills: [],
    narrative: '',
    narrativeSource: 'template',
    premium: true,
    ...overrides,
  };
}

describe('selectAdultStandings', () => {
  it('sorts adults by weekly points descending and flags the strict leader', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 45, weekly: 285, total: 900 } }),
      member({ uid: 'jen', displayName: 'Jen', points: { daily: 60, weekly: 325, total: 950 } }),
    ];

    const standings = selectAdultStandings(members);

    expect(standings.map(s => s.memberId)).toEqual(['jen', 'paul']);
    expect(standings[0]).toMatchObject({ name: 'Jen', today: 60, weekly: 325, barPct: 100, isLeader: true });
    // 285 / 325 = 0.8769... -> 88
    expect(standings[1]).toMatchObject({ name: 'Paul', today: 45, weekly: 285, barPct: 88, isLeader: false });
  });

  it('excludes managed (kid) members', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 10, total: 10 } }),
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true, points: { daily: 999, weekly: 999, total: 999 } }),
    ];

    const standings = selectAdultStandings(members);

    expect(standings).toHaveLength(1);
    expect(standings[0]?.memberId).toBe('paul');
  });

  it('renders a quiet zero state — no crown, 0% bars — before any points exist', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul' }),
      member({ uid: 'jen', displayName: 'Jen' }),
    ];

    const standings = selectAdultStandings(members);

    expect(standings).toHaveLength(2);
    for (const s of standings) {
      expect(s.today).toBe(0);
      expect(s.weekly).toBe(0);
      expect(s.barPct).toBe(0);
      expect(s.isLeader).toBe(false);
    }
  });

  it('never crowns a tie', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 20, weekly: 200, total: 200 } }),
      member({ uid: 'jen', displayName: 'Jen', points: { daily: 20, weekly: 200, total: 200 } }),
    ];

    const standings = selectAdultStandings(members);

    expect(standings.every(s => !s.isLeader)).toBe(true);
  });

  it('never crowns a lone adult (no competition to win)', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 20, weekly: 200, total: 200 } }),
    ];

    const standings = selectAdultStandings(members);

    expect(standings).toEqual([
      // barPct is still 100 (full relative to itself); only the crown withholds.
      expect.objectContaining({ memberId: 'paul', barPct: 100, isLeader: false }),
    ]);
  });

  it('crowns the strict leader even in a net-negative week, with both bars clamped empty', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: -5, weekly: -10, total: 200 } }),
      member({ uid: 'jen', displayName: 'Jen', points: { daily: -20, weekly: -40, total: 200 } }),
    ];

    const standings = selectAdultStandings(members);

    // Paul lost the least (-10 > -40) — a real competition was won.
    expect(standings.map(s => s.memberId)).toEqual(['paul', 'jen']);
    expect(standings[0]).toMatchObject({ memberId: 'paul', isLeader: true, barPct: 0 });
    expect(standings[1]).toMatchObject({ memberId: 'jen', isLeader: false, barPct: 0 });
  });

  it('clamps a negative member weekly to a 0% bar against a positive leader (never a negative CSS width)', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'paul', displayName: 'Paul', points: { daily: 20, weekly: 100, total: 200 } }),
      member({ uid: 'jen', displayName: 'Jen', points: { daily: -5, weekly: -20, total: 200 } }),
    ];

    const standings = selectAdultStandings(members);
    const jen = standings.find(s => s.memberId === 'jen');

    expect(jen?.barPct).toBe(0);
  });

  it('returns [] when there are no adult members', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ];

    expect(selectAdultStandings(members)).toEqual([]);
  });

  it('breaks a weekly-points tie alphabetically by name for a stable order', () => {
    const members: HouseholdMember[] = [
      member({ uid: 'z', displayName: 'Zoe', points: { daily: 0, weekly: 50, total: 50 } }),
      member({ uid: 'a', displayName: 'Amy', points: { daily: 0, weekly: 50, total: 50 } }),
    ];

    expect(selectAdultStandings(members).map(s => s.name)).toEqual(['Amy', 'Zoe']);
  });
});

describe('deriveScoreboardTrend', () => {
  const adults: HouseholdMember[] = [
    member({ uid: 'a', displayName: 'A' }),
    member({ uid: 'b', displayName: 'B' }),
  ];

  it('omits gracefully with no recap history', () => {
    expect(deriveScoreboardTrend([], 610, adults)).toEqual({ trendPct: null, isBestWeek: false });
  });

  it('computes trend % vs the most recently completed week (recaps[0])', () => {
    const recaps: WeeklyRecap[] = [
      recap({ isoWeek: '2026-W30', pointsByMember: [{ memberId: 'a', name: 'A', points: 300 }, { memberId: 'b', name: 'B', points: 245 }] }), // total 545
    ];

    // 610 vs 545 -> +11.9...% -> 12
    expect(deriveScoreboardTrend(recaps, 610, adults)).toEqual({ trendPct: 12, isBestWeek: true });
  });

  it('omits the trend percent when the last completed week totalled 0', () => {
    const recaps: WeeklyRecap[] = [
      recap({ isoWeek: '2026-W30', pointsByMember: [{ memberId: 'a', name: 'A', points: 0 }] }),
    ];

    expect(deriveScoreboardTrend(recaps, 50, adults).trendPct).toBeNull();
  });

  it('flags isBestWeek only when the live total is at least the max of the recap window', () => {
    const recaps: WeeklyRecap[] = [
      recap({ isoWeek: '2026-W30', pointsByMember: [{ memberId: 'a', name: 'A', points: 400 }] }),
      recap({ isoWeek: '2026-W29', pointsByMember: [{ memberId: 'a', name: 'A', points: 700 }] }),
    ];

    expect(deriveScoreboardTrend(recaps, 610, adults).isBestWeek).toBe(false); // below the 700 max
    expect(deriveScoreboardTrend(recaps, 700, adults).isBestWeek).toBe(true); // ties the max
    expect(deriveScoreboardTrend(recaps, 701, adults).isBestWeek).toBe(true); // beats the max
  });

  it('never claims a best week at 0 points, even with no recap history to beat', () => {
    expect(deriveScoreboardTrend([], 0, adults).isBestWeek).toBe(false);
  });

  it('excludes a managed kid entry from the baseline (mock repro: 120 adult + 35 kid inflating to 155)', () => {
    const membersWithKid: HouseholdMember[] = [
      ...adults,
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ];
    const recaps: WeeklyRecap[] = [
      recap({
        isoWeek: '2026-W30',
        pointsByMember: [
          { memberId: 'a', name: 'A', points: 70 },
          { memberId: 'b', name: 'B', points: 50 },
          { memberId: 'kid_leo', name: 'Leo', points: 35 },
        ],
      }),
    ];

    // Unfiltered baseline would be 155 (120 adult + 35 kid), making live 150
    // read as a -3% decline. Adults-only baseline is 120, so live 150 is the
    // honest +25%.
    expect(deriveScoreboardTrend(recaps, 150, membersWithKid)).toEqual({ trendPct: 25, isBestWeek: true });
  });

  it('excludes a managed kid entry when computing the best-week max across the recap window', () => {
    const membersWithKid: HouseholdMember[] = [
      ...adults,
      member({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ];
    const recaps: WeeklyRecap[] = [
      recap({
        isoWeek: '2026-W30',
        pointsByMember: [
          { memberId: 'a', name: 'A', points: 60 },
          { memberId: 'b', name: 'B', points: 40 },
          { memberId: 'kid_leo', name: 'Leo', points: 500 }, // would dominate the max if not filtered
        ],
      }),
    ];

    // Adults-only max is 100; a live total of 100 should tie it as a best week.
    // If the kid's 500 leaked in, this would incorrectly read false.
    expect(deriveScoreboardTrend(recaps, 100, membersWithKid).isBestWeek).toBe(true);
  });
});
