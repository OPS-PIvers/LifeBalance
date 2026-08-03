import { describe, expect, it } from 'vitest';
import {
  assembleCeremony,
  assembleWeeklyRecap,
  assignedChorePointsOnDate,
  buildDailyPoints,
  memberAttributedPointsOnDate,
  memberChorePointsOnDate,
  memberDatesFor,
  memberPointsOnDate,
  memberSharedPointsOnDate,
  memberUnitsOnDate,
  shiftDay,
  unattributedPointsOnDate,
  weekDates,
  weekPointsTotal,
  type CeremonyMember,
  type DataAssemblyInput,
  type RecapCalendarItem,
  type RecapHabit,
  type RecapScoringHabit,
  type RecapTransaction,
} from '@/utils/recapAssembly';

/**
 * 🛡️ FIXTURES ARE ANCHORED TO THEIR OWN WEEK, never to an offset from "today" —
 * a weekday-dependent recap test has blocked a production deploy in this repo
 * before. Every date below is a literal inside Mon 2026-06-29 → Sun 2026-07-05
 * (or the prior week, Mon 2026-06-22 → Sun 2026-06-28).
 *
 * Cross-copy agreement with the server assembly is pinned separately, in
 * `functions/src/recap/parity.test.ts`. This file covers the client module's own
 * behaviour.
 */
const WEEK_START = '2026-06-29';
const WEEK_END = '2026-07-05';
const PRIOR_START = '2026-06-22';
const PRIOR_END = '2026-06-28';

const DAYS = weekDates(WEEK_START);
const [MON, TUE, WED, THU, FRI, SAT, SUN] = DAYS as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const PRIOR_DAYS = weekDates(PRIOR_START);
const [P_MON, P_TUE, , , , , P_SUN] = PRIOR_DAYS as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const JEN: CeremonyMember = { uid: 'u1', displayName: 'Jen' };
const PAUL: CeremonyMember = { uid: 'u2', displayName: 'Paul' };
const LEO: CeremonyMember = { uid: 'kid_leo', displayName: 'Leo', isManaged: true };

function habit(overrides: Partial<RecapScoringHabit> = {}): RecapScoringHabit {
  return {
    title: 'Morning walk',
    period: 'daily',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    completedDates: [],
    ...overrides,
  };
}

function recapHabit(overrides: Partial<RecapHabit> = {}): RecapHabit {
  return { ...habit(), streakDays: 0, ...overrides };
}

function baseInput(overrides: Partial<DataAssemblyInput> = {}): DataAssemblyInput {
  return {
    transactions: [],
    habits: [],
    members: [],
    calendarItems: [],
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

describe('shiftDay / weekDates', () => {
  it('returns the week’s 7 days, Monday first', () => {
    expect(DAYS).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-06-30', 1)).toBe('2026-07-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2026-07-05', -7)).toBe('2026-06-28');
    expect(shiftDay(WEEK_START, 0)).toBe(WEEK_START);
  });
});

// ---------------------------------------------------------------------------
// Attribution readers
// ---------------------------------------------------------------------------

describe('memberUnitsOnDate', () => {
  it('reads the attributed count', () => {
    const h = habit({ completedBy: { [MON]: { u1: 3 } } });
    expect(memberUnitsOnDate(h, 'u1', MON)).toBe(3);
    expect(memberUnitsOnDate(h, 'u2', MON)).toBe(0);
    expect(memberUnitsOnDate(h, 'u1', TUE)).toBe(0);
  });

  it('clamps zero/negative residue to absent', () => {
    const h = habit({ completedBy: { [MON]: { u1: 0, u2: -2 } } });
    expect(memberUnitsOnDate(h, 'u1', MON)).toBe(0);
    expect(memberUnitsOnDate(h, 'u2', MON)).toBe(0);
  });

  it('returns 0 for a habit with no completedBy at all', () => {
    expect(memberUnitsOnDate(habit({ completedDates: [MON] }), 'u1', MON)).toBe(0);
  });
});

describe('memberDatesFor', () => {
  it('reads a shared habit’s dates out of completedBy, sorted', () => {
    const h = habit({
      completedDates: [WED, MON],
      completedBy: { [WED]: { u1: 1 }, [MON]: { u1: 2, u2: 1 } },
    });
    expect(memberDatesFor(h, 'u1')).toEqual([MON, WED]);
    expect(memberDatesFor(h, 'u2')).toEqual([MON]);
    expect(memberDatesFor(h, 'u3')).toEqual([]);
  });

  it('gives an assigned chore’s own dates to the assignee, and nothing to anyone else', () => {
    const h = habit({ assignedTo: LEO.uid, completedDates: [MON, TUE] });
    expect(memberDatesFor(h, LEO.uid)).toEqual([MON, TUE]);
    expect(memberDatesFor(h, 'u1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-member scoring
// ---------------------------------------------------------------------------

describe('memberAttributedPointsOnDate', () => {
  it('pays an incremental habit per attributed unit', () => {
    const h = habit({
      scoringType: 'incremental',
      basePoints: 5,
      completedDates: [MON],
      completedBy: { [MON]: { u1: 3 } },
    });
    // Streak of 1 → 1.0x, so 3 units × 5.
    expect(memberAttributedPointsOnDate(h, 'u1', MON, WEEK_END)).toBe(15);
  });

  it('applies the member’s OWN historical streak multiplier', () => {
    const h = habit({
      scoringType: 'incremental',
      basePoints: 10,
      completedDates: [MON, TUE, WED],
      completedBy: { [MON]: { u1: 1 }, [TUE]: { u1: 1 }, [WED]: { u1: 1 } },
    });
    expect(memberAttributedPointsOnDate(h, 'u1', MON, WEEK_END)).toBe(10); // streak 1 → 1.0x
    expect(memberAttributedPointsOnDate(h, 'u1', TUE, WEEK_END)).toBe(10); // streak 2 → 1.0x
    expect(memberAttributedPointsOnDate(h, 'u1', WED, WEEK_END)).toBe(15); // streak 3 → 1.5x
  });

  it('never multiplies a NEGATIVE habit, and signs it negative', () => {
    const h = habit({
      type: 'negative',
      scoringType: 'incremental',
      basePoints: 10,
      completedDates: [MON, TUE, WED, THU],
      completedBy: Object.fromEntries([MON, TUE, WED, THU].map(d => [d, { u1: 2 }])),
    });
    // A 4-day streak would be 1.5x for a positive habit; negatives stay at 1.0x.
    expect(memberAttributedPointsOnDate(h, 'u1', THU, WEEK_END)).toBe(-20);
  });

  it('awards a threshold period ONCE, on the member’s first attributed day', () => {
    const h = habit({
      completedDates: [MON, TUE],
      completedBy: { [MON]: { u1: 1 }, [TUE]: { u1: 1 } },
      period: 'weekly',
      basePoints: 20,
    });
    expect(memberAttributedPointsOnDate(h, 'u1', MON, WEEK_END)).toBe(20);
    expect(memberAttributedPointsOnDate(h, 'u1', TUE, WEEK_END)).toBe(0);
  });

  it('pays BOTH members a full threshold award (the competition model)', () => {
    const h = habit({ completedDates: [MON], completedBy: { [MON]: { u1: 1, u2: 1 } } });
    expect(memberAttributedPointsOnDate(h, 'u1', MON, WEEK_END)).toBe(10);
    expect(memberAttributedPointsOnDate(h, 'u2', MON, WEEK_END)).toBe(10);
  });

  it('pays nothing when the period never completed', () => {
    // Attribution exists but the day never entered completedDates (target unmet).
    const h = habit({ completedDates: [], completedBy: { [MON]: { u1: 1 } } });
    expect(memberAttributedPointsOnDate(h, 'u1', MON, WEEK_END)).toBe(0);
  });

  it('pays nothing on a date the member holds no units for', () => {
    const h = habit({ completedDates: [MON], completedBy: { [MON]: { u1: 1 } } });
    expect(memberAttributedPointsOnDate(h, 'u2', MON, WEEK_END)).toBe(0);
  });
});

describe('unattributedPointsOnDate — the grandfathering term', () => {
  it('scores a habit with an EMPTY completedBy exactly as the legacy scorer did', () => {
    const h = habit({ completedDates: [MON, TUE, WED] });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(10); // streak 1
    expect(unattributedPointsOnDate(h, WED, WEEK_END)).toBe(15); // streak 3 → 1.5x
  });

  it('treats a present-but-empty completedBy map identically', () => {
    const bare = habit({ completedDates: [MON, TUE, WED] });
    const empty = habit({ completedDates: [MON, TUE, WED], completedBy: {} });
    for (const date of DAYS) {
      expect(unattributedPointsOnDate(empty, date, WEEK_END)).toBe(
        unattributedPointsOnDate(bare, date, WEEK_END),
      );
    }
  });

  it('drops to zero for a THRESHOLD period once anyone is attributed', () => {
    const h = habit({ completedDates: [MON], completedBy: { [MON]: { u1: 1 } } });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(0);
  });

  it('keeps the units nobody holds on an INCREMENTAL day', () => {
    // Legacy counts 1 unit per completed day; nobody is attributed on TUE.
    const h = habit({
      scoringType: 'incremental',
      basePoints: 7,
      completedDates: [MON, TUE],
      completedBy: { [MON]: { u1: 1 } },
    });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(0); // 1 legacy unit, 1 held
    expect(unattributedPointsOnDate(h, TUE, WEEK_END)).toBe(7); // still grandfathered
  });

  it('never goes negative when more units are attributed than the legacy scorer counted', () => {
    const h = habit({
      scoringType: 'incremental',
      basePoints: 7,
      completedDates: [MON],
      completedBy: { [MON]: { u1: 4 } },
    });
    expect(unattributedPointsOnDate(h, MON, WEEK_END)).toBe(0);
  });

  it('returns 0 on a date that is not a completion', () => {
    expect(unattributedPointsOnDate(habit({ completedDates: [MON] }), TUE, WEEK_END)).toBe(0);
  });

  it('returns 0 when the per-unit rate is 0 (basePoints absent)', () => {
    expect(unattributedPointsOnDate({ title: 'Bare', completedDates: [MON] }, MON, WEEK_END)).toBe(0);
  });
});

describe('weekly-period habits', () => {
  it('parks a threshold week’s single award on the week’s FIRST completed day', () => {
    const h = habit({ period: 'weekly', basePoints: 20, completedDates: [WED, FRI] });
    expect(unattributedPointsOnDate(h, WED, WEEK_END)).toBe(20);
    expect(unattributedPointsOnDate(h, FRI, WEEK_END)).toBe(0);
  });

  it('parks an incremental week’s remainder on the week’s LATEST completed day', () => {
    const h = habit({
      period: 'weekly',
      scoringType: 'incremental',
      basePoints: 8,
      completedDates: [TUE, SAT],
    });
    expect(unattributedPointsOnDate(h, TUE, WEEK_END)).toBe(0);
    expect(unattributedPointsOnDate(h, SAT, WEEK_END)).toBe(8);
  });

  it('earns week-cadence multipliers (2 weeks → 1.5x, 4 → 2.0x)', () => {
    const twoWeeks = habit({ period: 'weekly', basePoints: 20, completedDates: [P_TUE, WED] });
    expect(unattributedPointsOnDate(twoWeeks, WED, WEEK_END)).toBe(30);

    const fourWeeks = habit({
      period: 'weekly',
      basePoints: 20,
      completedDates: ['2026-06-08', '2026-06-15', P_TUE, WED],
    });
    expect(unattributedPointsOnDate(fourWeeks, WED, WEEK_END)).toBe(40);
  });

  it('sums to the week’s total exactly once across the 7 days', () => {
    const h = habit({ period: 'weekly', basePoints: 20, completedDates: [WED, FRI, SUN] });
    const total = DAYS.reduce((sum, d) => sum + unattributedPointsOnDate(h, d, WEEK_END), 0);
    expect(total).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Chores vs household
// ---------------------------------------------------------------------------

describe('assigned chores stay personal', () => {
  const chore = habit({ assignedTo: LEO.uid, basePoints: 5, completedDates: [MON, TUE] });
  const shared = habit({
    title: 'Read',
    basePoints: 10,
    completedDates: [MON],
    completedBy: { [MON]: { u1: 1 } },
  });

  it('credits the assignee via memberChorePointsOnDate', () => {
    expect(assignedChorePointsOnDate(chore, MON, WEEK_END)).toBe(5);
    expect(memberChorePointsOnDate([chore, shared], LEO.uid, MON, WEEK_END)).toBe(5);
    expect(memberChorePointsOnDate([chore, shared], 'u1', MON, WEEK_END)).toBe(0);
  });

  it('is excluded from the SHARED (household-contributing) half', () => {
    expect(memberSharedPointsOnDate([chore, shared], LEO.uid, MON, WEEK_END)).toBe(0);
    expect(memberSharedPointsOnDate([chore, shared], 'u1', MON, WEEK_END)).toBe(10);
  });

  it('lands in the member’s OWN figure but never in the household day total', () => {
    expect(memberPointsOnDate([chore, shared], LEO.uid, MON, WEEK_END)).toBe(5);
    const [monday] = buildDailyPoints([chore, shared], [JEN, LEO], WEEK_START, WEEK_END);
    expect(monday?.total).toBe(10);
    expect(monday?.byMember).toEqual({ u1: 10 });
  });
});

// ---------------------------------------------------------------------------
// The 7-day series
// ---------------------------------------------------------------------------

describe('buildDailyPoints', () => {
  it('emits 7 Monday-first all-zero rows for an untouched week', () => {
    expect(buildDailyPoints([], [JEN, PAUL], WEEK_START, WEEK_END)).toEqual(
      DAYS.map(date => ({ date, byMember: {}, unattributed: 0, total: 0 })),
    );
  });

  it('keeps total = Σ byMember + unattributed on every day', () => {
    const habits: RecapScoringHabit[] = [
      habit({ completedDates: [MON, WED], completedBy: { [MON]: { u1: 1 } } }),
      habit({ title: 'Legacy', basePoints: 6, completedDates: [MON, TUE] }),
    ];
    for (const day of buildDailyPoints(habits, [JEN, PAUL], WEEK_START, WEEK_END)) {
      const memberSum = Object.values(day.byMember).reduce((a, b) => a + b, 0);
      expect(day.total).toBe(memberSum + day.unattributed);
    }
  });

  it('omits members who scored nothing that day', () => {
    const h = habit({ completedDates: [MON], completedBy: { [MON]: { u1: 1 } } });
    const [monday, tuesday] = buildDailyPoints([h], [JEN, PAUL], WEEK_START, WEEK_END);
    expect(monday?.byMember).toEqual({ u1: 10 });
    expect(tuesday?.byMember).toEqual({});
  });

  it('produces a NEGATIVE day total when negative habits outweigh positive ones', () => {
    const habits: RecapScoringHabit[] = [
      habit({
        title: 'Late night snack',
        type: 'negative',
        scoringType: 'incremental',
        basePoints: 10,
        completedDates: [TUE],
        completedBy: { [TUE]: { u1: 2 } },
      }),
      habit({
        title: 'Skipped workout',
        type: 'negative',
        basePoints: 15,
        completedDates: [TUE],
        completedBy: { [TUE]: { u2: 1 } },
      }),
      habit({
        title: 'Read',
        basePoints: 10,
        completedDates: [TUE],
        completedBy: { [TUE]: { u1: 1 } },
      }),
    ];
    const days = buildDailyPoints(habits, [JEN, PAUL], WEEK_START, WEEK_END);
    const tuesday = days.find(d => d.date === TUE);
    // Jen: -20 (2 snacks) + 10 (read) = -10; Paul: -15. Nothing unattributed.
    expect(tuesday?.byMember).toEqual({ u1: -10, u2: -15 });
    expect(tuesday?.unattributed).toBe(0);
    expect(tuesday?.total).toBe(-25);
    expect(weekPointsTotal(habits, [JEN, PAUL], WEEK_START, WEEK_END)).toBe(-25);
  });
});

// ---------------------------------------------------------------------------
// Ceremony
// ---------------------------------------------------------------------------

describe('assembleCeremony', () => {
  it('returns EMPTY memberFacts when no member holds a completion', () => {
    const habits = [habit({ completedDates: [MON, TUE, WED] })]; // grandfathered
    const result = assembleCeremony({ habits, members: [JEN, PAUL], weekStart: WEEK_START, weekEnd: WEEK_END });
    expect(result.memberFacts).toEqual([]);
    // The household series is still emitted in full.
    expect(result.dailyPoints).toHaveLength(7);
    expect(result.totalPoints).toBe(10 + 10 + 15);
    expect(result.dailyPoints.every(d => Object.keys(d.byMember).length === 0)).toBe(true);
  });

  it('reports a member whose week netted exactly zero (completions, not points, is the signal)', () => {
    const habits: RecapScoringHabit[] = [
      habit({ title: 'Read', basePoints: 10, completedDates: [MON], completedBy: { [MON]: { u1: 1 } } }),
      habit({
        title: 'Snack',
        type: 'negative',
        basePoints: 10,
        completedDates: [TUE],
        completedBy: { [TUE]: { u1: 1 } },
      }),
    ];
    const { memberFacts } = assembleCeremony({ habits, members: [JEN], weekStart: WEEK_START, weekEnd: WEEK_END });
    expect(memberFacts).toHaveLength(1);
    expect(memberFacts[0]?.points).toBe(0);
    expect(memberFacts[0]?.completions).toBe(2);
  });

  it('builds a member’s facts: points, completions, best day, top streak, perfect habits', () => {
    const habits: RecapScoringHabit[] = [
      habit({
        title: 'Vitamins',
        basePoints: 10,
        completedDates: DAYS,
        completedBy: Object.fromEntries(DAYS.map(d => [d, { u1: 1 }])),
      }),
      habit({
        title: 'Weekly review',
        period: 'weekly',
        basePoints: 20,
        completedDates: [WED],
        completedBy: { [WED]: { u1: 1 } },
      }),
    ];
    const { memberFacts } = assembleCeremony({ habits, members: [JEN], weekStart: WEEK_START, weekEnd: WEEK_END });
    const jen = memberFacts[0];
    expect(jen?.memberId).toBe('u1');
    expect(jen?.name).toBe('Jen');
    expect(jen?.completions).toBe(8);
    expect(jen?.perfectHabits).toEqual(['Vitamins']); // weekly habits never qualify
    expect(jen?.topStreak).toEqual({ habitTitle: 'Vitamins', days: 7, period: 'daily' });
    expect(jen?.bestDay?.date).toBe(WED); // the weekly award lands here
    expect(jen?.isManaged).toBeUndefined();
  });

  it('flags a managed kid and still gives them their own facts', () => {
    const chore = habit({ title: 'Dishes', assignedTo: LEO.uid, basePoints: 5, completedDates: [MON, TUE] });
    const { memberFacts } = assembleCeremony({
      habits: [chore],
      members: [JEN, LEO],
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
    });
    const leo = memberFacts.find(f => f.memberId === LEO.uid);
    expect(leo?.isManaged).toBe(true);
    expect(leo?.completions).toBe(2);
    expect(leo?.points).toBe(10);
    expect(memberFacts.find(f => f.memberId === 'u1')?.points).toBe(0);
  });

  it('anchors every streak walk on weekEnd, so regenerating later is stable', () => {
    const habits = [
      habit({
        completedDates: [MON, TUE, WED],
        completedBy: { [MON]: { u1: 1 }, [TUE]: { u1: 1 }, [WED]: { u1: 1 } },
      }),
    ];
    const args = { habits, members: [JEN], weekStart: WEEK_START, weekEnd: WEEK_END };
    expect(assembleCeremony(args)).toEqual(assembleCeremony(args));
    // A streak that died mid-week is not "live" at weekEnd.
    expect(assembleCeremony(args).memberFacts[0]?.topStreak).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full assembly
// ---------------------------------------------------------------------------

describe('assembleWeeklyRecap', () => {
  it('returns all-zero/empty output for a completely empty household', () => {
    expect(assembleWeeklyRecap(baseInput())).toEqual({
      totalSpend: 0,
      priorWeekSpend: 0,
      topCategoryDeltas: [],
      habitCompletions: 0,
      streaksAtRisk: [],
      pointsByMember: [],
      upcomingBills: [],
      memberFacts: [],
      dailyPoints: DAYS.map(date => ({ date, byMember: {}, unattributed: 0, total: 0 })),
      totalPoints: 0,
      priorWeekPoints: 0,
    });
  });

  it('sums verified non-income spend in cents, excluding pending and income', () => {
    const transactions: RecapTransaction[] = [
      { amount: 0.1, category: 'Coffee', date: MON, status: 'verified' },
      { amount: 0.2, category: 'Coffee', date: TUE, status: 'verified' },
      { amount: 2400, category: 'Income', date: FRI, status: 'verified' },
      { amount: 99, category: 'income', date: FRI, status: 'verified' },
      { amount: 500, category: 'Shopping', date: SAT, status: 'pending_review' },
      { amount: 61.11, category: 'Groceries', date: P_MON, status: 'verified' },
      { amount: 999, category: 'Travel', date: '2026-05-01', status: 'verified' },
    ];
    const result = assembleWeeklyRecap(baseInput({ transactions }));
    expect(result.totalSpend).toBe(0.3); // NOT 0.30000000000000004
    expect(result.priorWeekSpend).toBe(61.11);
  });

  it('groups categories case-insensitively and keeps the first-seen casing', () => {
    const transactions: RecapTransaction[] = [
      { amount: 42.37, category: 'Groceries', date: MON, status: 'verified' },
      { amount: 18.99, category: 'groceries', date: WED, status: 'verified' },
      { amount: 61.11, category: 'GROCERIES', date: P_MON, status: 'verified' },
    ];
    const [delta] = assembleWeeklyRecap(baseInput({ transactions })).topCategoryDeltas;
    expect(delta).toEqual({ category: 'Groceries', current: 61.36, prior: 61.11 });
  });

  it('keeps only the 3 largest deltas, and drops categories that did not move', () => {
    const transactions: RecapTransaction[] = [
      { amount: 100, category: 'A', date: MON, status: 'verified' },
      { amount: 50, category: 'B', date: MON, status: 'verified' },
      { amount: 25, category: 'C', date: MON, status: 'verified' },
      { amount: 10, category: 'D', date: MON, status: 'verified' },
      { amount: 5, category: 'Flat', date: MON, status: 'verified' },
      { amount: 5, category: 'Flat', date: P_MON, status: 'verified' },
    ];
    const deltas = assembleWeeklyRecap(baseInput({ transactions })).topCategoryDeltas;
    expect(deltas.map(d => d.category)).toEqual(['A', 'B', 'C']);
  });

  it('reports a category that only existed in the PRIOR week', () => {
    const transactions: RecapTransaction[] = [
      { amount: 80, category: 'Gas', date: P_TUE, status: 'verified' },
    ];
    expect(assembleWeeklyRecap(baseInput({ transactions })).topCategoryDeltas).toEqual([
      { category: 'Gas', current: 0, prior: 80 },
    ]);
  });

  it('counts habit completions inside the week and flags streaks at risk', () => {
    const habits: RecapHabit[] = [
      recapHabit({ title: 'Read', completedDates: [P_SUN, MON, TUE, SUN], streakDays: 4 }),
      recapHabit({ title: 'Run', completedDates: [MON, WED], streakDays: 5 }),
      recapHabit({ title: 'Floss', completedDates: [THU], streakDays: 2 }),
    ];
    const result = assembleWeeklyRecap(baseInput({ habits }));
    expect(result.habitCompletions).toBe(3 + 2 + 1);
    // 'Read' completed on weekEnd → not at risk; 'Floss' streak < 3 → not at risk.
    expect(result.streaksAtRisk).toEqual([{ habitTitle: 'Run', streakDays: 5 }]);
  });

  it('lists expense calendar items in the 7 days FOLLOWING the week', () => {
    const calendarItems: RecapCalendarItem[] = [
      { title: 'Old bill', amount: 40, date: SUN, type: 'expense' },
      { title: 'Rent', amount: 1800, date: '2026-07-06', type: 'expense' },
      { title: 'Netflix', amount: 15.49, date: '2026-07-12', type: 'expense' },
      { title: 'Car loan', amount: 320, date: '2026-07-13', type: 'expense' },
      { title: 'Paycheck', amount: 2400, date: '2026-07-10', type: 'income' },
    ];
    expect(assembleWeeklyRecap(baseInput({ calendarItems })).upcomingBills).toEqual([
      { title: 'Rent', amount: 1800, date: '2026-07-06' },
      { title: 'Netflix', amount: 15.49, date: '2026-07-12' },
    ]);
  });

  it('derives pointsByMember from the SAME source as memberFacts', () => {
    const habits: RecapHabit[] = [
      recapHabit({
        title: 'Read',
        basePoints: 10,
        completedDates: [MON, TUE],
        completedBy: { [MON]: { u1: 1 }, [TUE]: { u2: 1 } },
      }),
    ];
    const result = assembleWeeklyRecap(baseInput({ habits, members: [JEN, PAUL] }));
    expect(result.pointsByMember).toEqual(
      result.memberFacts.map(f => ({ memberId: f.memberId, name: f.name, points: f.points })),
    );
    expect(result.pointsByMember).toEqual([
      { memberId: 'u1', name: 'Jen', points: 10 },
      { memberId: 'u2', name: 'Paul', points: 10 },
    ]);
  });

  it('leaves pointsByMember EMPTY for a fully grandfathered week', () => {
    const habits: RecapHabit[] = [recapHabit({ completedDates: [MON, TUE] })];
    const result = assembleWeeklyRecap(baseInput({ habits, members: [JEN, PAUL] }));
    expect(result.pointsByMember).toEqual([]);
    expect(result.memberFacts).toEqual([]);
    expect(result.totalPoints).toBe(20);
  });

  it('computes priorWeekPoints over the week BEFORE the recap week', () => {
    const habits: RecapHabit[] = [
      recapHabit({
        basePoints: 10,
        completedDates: [P_MON, P_TUE, MON],
        completedBy: { [P_MON]: { u1: 1 }, [P_TUE]: { u1: 1 }, [MON]: { u1: 1 } },
      }),
    ];
    const result = assembleWeeklyRecap(baseInput({ habits, members: [JEN] }));
    expect(result.priorWeekPoints).toBe(20);
    expect(result.totalPoints).toBe(10);
    expect(weekPointsTotal(habits, [JEN], PRIOR_START, PRIOR_END)).toBe(20);
  });

  it('scores a habit carrying NO ceremony fields exactly as the money-only path did', () => {
    const habits: RecapHabit[] = [
      { title: 'Legacy habit', completedDates: [MON, TUE], streakDays: 4 },
    ];
    const result = assembleWeeklyRecap(baseInput({ habits, members: [JEN] }));
    expect(result.habitCompletions).toBe(2);
    expect(result.streaksAtRisk).toEqual([{ habitTitle: 'Legacy habit', streakDays: 4 }]);
    expect(result.totalPoints).toBe(0); // basePoints absent → 0 per unit
    expect(result.memberFacts).toEqual([]);
  });
});
