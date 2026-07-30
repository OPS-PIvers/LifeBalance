import { describe, it, expect } from 'vitest';
import {
  selectAdultStandings,
  deriveScoreboardTrend,
  listScoreboardWeekOptions,
  weekHasMemberAttribution,
  buildWeekStandings,
} from '@/utils/scoreboardWidget';
import type { Habit, HouseholdMember, WeeklyRecap } from '@/types/schema';

function member(overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>): HouseholdMember {
  return {
    role: 'member',
    points: { daily: 0, weekly: 0, total: 0 },
    ...overrides,
  };
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h-1',
    title: 'Read',
    category: 'General',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as unknown as Habit;
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

  it('handles a recap with an EMPTY pointsByMember without crashing or inventing a trend', () => {
    // The server now writes `[]` for a week no member holds a completion in
    // (and every pre-feature recap predates the field's per-member meaning),
    // so this shape reaches the widget on real data.
    const recaps: WeeklyRecap[] = [recap({ isoWeek: '2026-W30', pointsByMember: [] })];
    expect(deriveScoreboardTrend(recaps, 610, adults).trendPct).toBeNull();
  });
});

describe('listScoreboardWeekOptions', () => {
  // Thursday inside the Jul 27 - Aug 2 week.
  const today = new Date(2026, 6, 30);

  it('always offers the current week first, even with zero completions', () => {
    const options = listScoreboardWeekOptions([], today, 4);
    expect(options).toEqual([
      { weekStart: '2026-07-27', weekEnd: '2026-08-02', label: 'Jul 27 – Aug 2', isCurrent: true },
    ]);
  });

  it('offers a past week only when a habit was actually completed inside it, skipping empty gaps', () => {
    const habits = [makeHabit({ completedDates: ['2026-07-22'] })]; // inside Jul 20-26
    const options = listScoreboardWeekOptions(habits, today, 4);

    // Jul 13-19, Jul 6-12, Jun 29-Jul 5 all have zero completions and are
    // skipped — offering them would resolve to a wall of zeroes.
    expect(options).toEqual([
      { weekStart: '2026-07-27', weekEnd: '2026-08-02', label: 'Jul 27 – Aug 2', isCurrent: true },
      { weekStart: '2026-07-20', weekEnd: '2026-07-26', label: 'Jul 20 – Jul 26', isCurrent: false },
    ]);
  });

  it('respects maxPastWeeks as an upper bound on how far back it looks', () => {
    const habits = [makeHabit({ completedDates: ['2026-06-15'] })]; // 6+ weeks back
    const options = listScoreboardWeekOptions(habits, today, 2);

    // The week holding the completion is further back than maxPastWeeks=2
    // reaches, so only the current week is offered.
    expect(options).toEqual([
      { weekStart: '2026-07-27', weekEnd: '2026-08-02', label: 'Jul 27 – Aug 2', isCurrent: true },
    ]);
  });
});

describe('weekHasMemberAttribution', () => {
  const start = '2026-07-20';
  const end = '2026-07-26';

  it('is true when a shared habit has a positive completedBy entry inside the range', () => {
    const habits = [makeHabit({ completedBy: { '2026-07-22': { paul: 1 } } })];
    expect(weekHasMemberAttribution(habits, start, end)).toBe(true);
  });

  it('is false for a grandfathered habit — completedDates with no completedBy at all', () => {
    const habits = [makeHabit({ completedDates: ['2026-07-22'], completedBy: undefined })];
    expect(weekHasMemberAttribution(habits, start, end)).toBe(false);
  });

  it('is false when the only completedBy entry falls outside the range', () => {
    const habits = [makeHabit({ completedBy: { '2026-07-01': { paul: 1 } } })];
    expect(weekHasMemberAttribution(habits, start, end)).toBe(false);
  });

  it('excludes assigned (chore) habits — their attribution routes to the assignee directly', () => {
    const habits = [makeHabit({ assignedTo: 'kid_leo', completedBy: { '2026-07-22': { kid_leo: 1 } } })];
    expect(weekHasMemberAttribution(habits, start, end)).toBe(false);
  });

  it('treats a zero/negative-count entry as absent, matching the completedBy write discipline', () => {
    const habits = [makeHabit({ completedBy: { '2026-07-22': { paul: 0 } } })];
    expect(weekHasMemberAttribution(habits, start, end)).toBe(false);
  });
});

describe('buildWeekStandings', () => {
  const adults = [
    { uid: 'paul', displayName: 'Paul' },
    { uid: 'jen', displayName: 'Jen' },
  ];

  it('sorts by points descending, computes bar percentages, and crowns the strict leader', () => {
    const pointsByMemberId = new Map([['paul', 30], ['jen', 90]]);

    const standings = buildWeekStandings(adults, pointsByMemberId);

    expect(standings.map(s => s.memberId)).toEqual(['jen', 'paul']);
    expect(standings[0]).toMatchObject({ points: 90, barPct: 100, isLeader: true });
    expect(standings[1]).toMatchObject({ points: 30, barPct: 33, isLeader: false });
  });

  it('defaults a member absent from the points map to 0, not a crash', () => {
    const pointsByMemberId = new Map([['paul', 50]]);

    const standings = buildWeekStandings(adults, pointsByMemberId);
    const jen = standings.find(s => s.memberId === 'jen');

    expect(jen).toMatchObject({ points: 0, barPct: 0, isLeader: false });
  });

  it('never crowns an all-zero field (both members absent from the map)', () => {
    const standings = buildWeekStandings(adults, new Map());
    expect(standings.every(s => !s.isLeader)).toBe(true);
  });
});
