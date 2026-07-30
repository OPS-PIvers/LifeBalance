import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import type { Habit } from '@/types/schema';
import {
  attributedMemberIds,
  attributedUnitsOnDate,
  attributionReversalForDates,
  calculateMemberPointsForDate,
  calculateMemberPointsForDateRange,
  completedByDatePath,
  completedByPath,
  computeMemberPointsReset,
  computeMemberPointsSync,
  decomposeDayPoints,
  habitFeedsMemberAttribution,
  householdPeriodPoints,
  memberCompletionCount,
  memberCompletionDates,
  memberIdsOnDate,
  memberPeriodPoints,
  memberPeriodPointsDelta,
  memberPointsForHabitOnDate,
  prospectiveMultiplierForMember,
  streakEndingOnForMember,
  streakForMember,
  withAttributionDelta,
  withDatesUnattributed,
} from '@/utils/habitAttribution';
import { calculatePointsForDate } from '@/utils/habitLogic';

// --- Fixture calendar ------------------------------------------------------
// 🛡️ Every date below is an offset from the FIXTURE's OWN Monday, never from
// "today". A suite anchored on the real clock passes Mon–Tue and fails Wed–Thu
// once a UTC runner rolls the date, which has blocked a production deploy here
// before. `today` is injected into every helper, so these tests are identical
// on every weekday and in every timezone.
const MONDAY = format(startOfISOWeek(parseISO('2026-06-17')), 'yyyy-MM-dd'); // 2026-06-15
/** Day `n` of the fixture week (0 = Monday). Negative walks into the prior week. */
const d = (n: number): string => format(addDays(parseISO(MONDAY), n), 'yyyy-MM-dd');

const PAUL = 'paul-uid';
const JEN = 'jen-uid';

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Exercise',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  scoringType: 'incremental',
  basePoints: 10,
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: `${MONDAY}T12:00:00.000Z`,
  ...overrides,
});

describe('habitAttribution — field paths', () => {
  it('builds the per-member dot path', () => {
    expect(completedByPath(d(0), PAUL)).toBe(`completedBy.${d(0)}.${PAUL}`);
  });

  it('builds the whole-day dot path', () => {
    expect(completedByDatePath(d(0))).toBe(`completedBy.${d(0)}`);
  });
});

describe('habitAttribution — readers', () => {
  const h = habit({
    completedDates: [d(0), d(1)],
    completedBy: {
      [d(0)]: { [PAUL]: 2, [JEN]: 1 },
      [d(1)]: { [JEN]: 1 },
    },
  });

  it('reads one member’s count on a date, defaulting to 0', () => {
    expect(memberCompletionCount(h, PAUL, d(0))).toBe(2);
    expect(memberCompletionCount(h, PAUL, d(1))).toBe(0);
    expect(memberCompletionCount(h, 'nobody', d(0))).toBe(0);
    expect(memberCompletionCount(habit(), PAUL, d(0))).toBe(0);
  });

  it('sums attributed units across members on a date', () => {
    expect(attributedUnitsOnDate(h, d(0))).toBe(3);
    expect(attributedUnitsOnDate(h, d(9))).toBe(0);
  });

  it('lists the members credited on a date', () => {
    expect(memberIdsOnDate(h, d(0)).sort()).toEqual([JEN, PAUL].sort());
    expect(memberIdsOnDate(h, d(9))).toEqual([]);
  });

  it('lists every member ever credited on the habit', () => {
    expect(attributedMemberIds(h).sort()).toEqual([JEN, PAUL].sort());
    expect(attributedMemberIds(habit())).toEqual([]);
  });

  it('derives a member’s own completion-date set, newest first', () => {
    expect(memberCompletionDates(h, JEN)).toEqual([d(1), d(0)]);
    expect(memberCompletionDates(h, PAUL)).toEqual([d(0)]);
    expect(memberCompletionDates(h, 'nobody')).toEqual([]);
  });
});

describe('habitAttribution — local attribution edits', () => {
  it('increments without mutating the input', () => {
    const before = habit({ completedBy: { [d(0)]: { [PAUL]: 1 } } });
    const after = withAttributionDelta(before, d(0), PAUL, 1);
    expect(memberCompletionCount(after, PAUL, d(0))).toBe(2);
    expect(memberCompletionCount(before, PAUL, d(0))).toBe(1);
  });

  it('drops the member key at zero and the day key when it empties', () => {
    const before = habit({ completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } } });
    const noPaul = withAttributionDelta(before, d(0), PAUL, -1);
    expect(noPaul.completedBy?.[d(0)]).toEqual({ [JEN]: 1 });
    const empty = withAttributionDelta(noPaul, d(0), JEN, -1);
    expect(empty.completedBy?.[d(0)]).toBeUndefined();
  });

  it('never goes negative', () => {
    const after = withAttributionDelta(habit(), d(0), PAUL, -1);
    expect(memberCompletionCount(after, PAUL, d(0))).toBe(0);
  });

  it('clears whole dates', () => {
    const before = habit({
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(1)]: { [JEN]: 1 } },
    });
    const after = withDatesUnattributed(before, [d(0)]);
    expect(after.completedBy).toEqual({ [d(1)]: { [JEN]: 1 } });
    expect(withDatesUnattributed(before, [])).toBe(before);
  });
});

describe('habitAttribution — per-member streaks', () => {
  it('counts only the member’s OWN completions', () => {
    // Paul completed Mon/Tue/Wed; Jen only Wed. The habit-level streak is 3 for
    // both, but Jen's own streak is 1 — which is the whole point of the feature.
    const h = habit({
      completedDates: [d(0), d(1), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1, [JEN]: 1 },
      },
    });
    expect(streakForMember(h, PAUL, d(2))).toBe(3);
    expect(streakForMember(h, JEN, d(2))).toBe(1);
  });

  it('measures a weekly habit in ISO weeks', () => {
    const h = habit({
      period: 'weekly',
      completedDates: [d(-14), d(-7), d(0)],
      completedBy: {
        [d(-14)]: { [PAUL]: 1 },
        [d(-7)]: { [PAUL]: 1 },
        [d(0)]: { [PAUL]: 1, [JEN]: 1 },
      },
    });
    expect(streakForMember(h, PAUL, d(0))).toBe(3);
    expect(streakForMember(h, JEN, d(0))).toBe(1);
  });

  it('bridges EVERY member’s chain across a habit-level frozen date', () => {
    // Paul: Mon, (Tue frozen), Wed. The freeze is stored on the HABIT, and per
    // the locked decision it bridges every member's chain until per-member
    // freeze banks land — so Paul's streak is 2 (frozen days never count as a
    // completion, they only preserve continuity).
    const h = habit({
      completedDates: [d(0), d(2)],
      frozenDates: [d(1)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    expect(streakForMember(h, PAUL, d(2))).toBe(2);

    // Without the freeze the same gap breaks the chain back to 1.
    const unfrozen = habit({ ...h, frozenDates: [] });
    expect(streakForMember(unfrozen, PAUL, d(2))).toBe(1);
  });

  it('reconstructs the streak that ended on a past date', () => {
    const h = habit({
      completedDates: [d(0), d(1), d(2), d(3)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1 },
        [d(3)]: { [PAUL]: 1 },
      },
    });
    expect(streakEndingOnForMember(h, PAUL, d(1), d(3))).toBe(2);
    expect(streakEndingOnForMember(h, PAUL, d(3), d(3))).toBe(4);
    // A date the member never completed earns no streak of its own.
    expect(streakEndingOnForMember(h, JEN, d(3), d(3))).toBe(0);
  });

  it('uses the member’s PROSPECTIVE streak for the next completion', () => {
    // Paul already has Mon+Tue; completing Wed makes it 3 → the 1.5× tier.
    const h = habit({
      completedDates: [d(0), d(1)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(1)]: { [PAUL]: 1 } },
    });
    expect(prospectiveMultiplierForMember(h, PAUL, d(2), d(2))).toBe(1.5);
    // Jen starts from nothing, so her first completion is still 1.0×.
    expect(prospectiveMultiplierForMember(h, JEN, d(2), d(2))).toBe(1.0);
  });
});

describe('habitAttribution — per-member scoring', () => {
  it('scores incremental units at the member’s own multiplier', () => {
    const h = habit({
      count: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 2, [JEN]: 1 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(20); // 2 × 10
    expect(memberPointsForHabitOnDate(h, JEN, d(0), d(0))).toBe(10);
  });

  it('applies the member’s streak tier to every unit of a multi-count day', () => {
    // Paul's own streak reaches 3 on Wed → 1.5× → floor(10 × 1.5) = 15 per unit.
    const h = habit({
      count: 2,
      completedDates: [d(0), d(1), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 2 },
      },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(2), d(2))).toBe(30);
  });

  it('debits a NEGATIVE habit’s attributed units', () => {
    const h = habit({
      type: 'negative',
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(-10);
  });

  it('gives EACH member a full threshold award on the same day', () => {
    // The locked product decision: both members earn full points for the same
    // threshold habit on the same date (the household formula still scores one
    // award — the difference is the decomposition remainder, see below).
    const h = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(10);
    expect(memberPointsForHabitOnDate(h, JEN, d(0), d(0))).toBe(10);
  });

  it('awards a threshold habit ONCE per period, on the member’s first day', () => {
    const h = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 1,
      count: 2,
      completedDates: [d(0), d(2)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(2))).toBe(10);
    expect(memberPointsForHabitOnDate(h, PAUL, d(2), d(2))).toBe(0);
    expect(memberPeriodPoints(h, PAUL, d(2), d(2))).toBe(10);
  });

  it('withholds a CURRENT-period threshold award until the target is met', () => {
    const h = habit({
      scoringType: 'threshold',
      targetCount: 3,
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(0);
    expect(memberPointsForHabitOnDate({ ...h, count: 3 }, PAUL, d(0), d(0))).toBe(10);
  });

  it('scores 0 for a member with no attribution at all', () => {
    const h = habit({ count: 1, completedDates: [d(0)] });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(0);
  });

  it('keeps ASSIGNED chores out of the attribution layer (no double-count)', () => {
    const chore = habit({
      assignedTo: JEN,
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [JEN]: 1 } },
    });
    expect(habitFeedsMemberAttribution(chore)).toBe(false);
    // Scored directly it still reports units (stage 2's pie counter wants them)…
    expect(memberPointsForHabitOnDate(chore, JEN, d(0), d(0))).toBe(10);
    // …but the points aggregator skips it, because `habitPointsTargets` already
    // routes an assigned chore's points to that member's own doc.
    expect(calculateMemberPointsForDate([chore], JEN, d(0), d(0))).toBe(0);
  });

  it('sums a member’s points across a date range', () => {
    const h = habit({
      count: 1,
      completedDates: [d(0), d(1), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1, [JEN]: 2 },
        [d(2)]: { [PAUL]: 1 },
      },
    });
    // Paul: Mon 10 (streak 1) + Tue 10 (streak 2) + Wed 15 (streak 3 → 1.5×).
    expect(calculateMemberPointsForDateRange([h], PAUL, d(0), d(2), d(2))).toBe(35);
    expect(calculateMemberPointsForDateRange([h], JEN, d(0), d(2), d(2))).toBe(20);
    // Range bounds are respected.
    expect(calculateMemberPointsForDateRange([h], PAUL, d(1), d(1), d(2))).toBe(10);
  });
});

// The stage-1 invisibility guarantee. `household` is produced by the UNCHANGED
// household scorer, so no attribution data can move it; members' shares are
// carved out of it and whatever is left is the grandfathered remainder.
describe('habitAttribution — household decomposition (grandfathering)', () => {
  it('attributes a pre-feature habit entirely to the remainder', () => {
    const legacy = habit({ count: 1, completedDates: [d(0)] }); // no completedBy
    const decomposition = decomposeDayPoints([legacy], [PAUL, JEN], d(0), undefined, d(0));

    expect(decomposition.household).toBe(calculatePointsForDate([legacy], d(0)));
    expect(decomposition.byMember).toEqual({ [PAUL]: 0, [JEN]: 0 });
    expect(decomposition.unattributed).toBe(decomposition.household);
  });

  it('leaves the household figure BYTE-IDENTICAL when attribution is added', () => {
    // Same habit, twice: once as it exists today, once with a full attribution
    // map bolted on. Every household-visible number must be unchanged — this is
    // the whole promise of stage 1.
    const base: Partial<Habit> = { count: 3, completedDates: [d(0), d(1)] };
    const legacy = habit(base);
    const attributed = habit({
      ...base,
      completedBy: {
        [d(0)]: { [PAUL]: 2, [JEN]: 1 },
        [d(1)]: { [PAUL]: 1 },
      },
    });

    for (const date of [d(0), d(1)]) {
      expect(calculatePointsForDate([attributed], date)).toBe(
        calculatePointsForDate([legacy], date),
      );
      expect(decomposeDayPoints([attributed], [PAUL, JEN], date, undefined, d(1)).household).toBe(
        decomposeDayPoints([legacy], [PAUL, JEN], date, undefined, d(1)).household,
      );
    }
  });

  it('holds the Σ-members + remainder identity exactly', () => {
    const h = habit({
      count: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 2, [JEN]: 1 } },
    });
    const { household, byMember, unattributed } = decomposeDayPoints(
      [h],
      [PAUL, JEN],
      d(0),
      undefined,
      d(0),
    );
    expect(byMember[PAUL]! + byMember[JEN]! + unattributed).toBe(household);
  });

  it('leaves NO remainder once the day is fully attributed at a matching streak', () => {
    // One member, one award, and their own streak equals the habit's — so the
    // member's share IS the household figure. This is the steady state the
    // remainder decays to as attribution accumulates.
    const h = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    const { household, byMember, unattributed } = decomposeDayPoints(
      [h],
      [PAUL, JEN],
      d(0),
      undefined,
      d(0),
    );
    expect(household).toBe(10);
    expect(byMember[PAUL]).toBe(10);
    expect(unattributed).toBe(0);
  });

  it('leaves a POSITIVE remainder while a member’s streak is still catching up', () => {
    // The transition case: the HABIT has a 3-day streak (1.5× → 15), but Paul's
    // own chain starts today, so he earns the 1.0× tier (10). The 5-point gap is
    // grandfathered history — it still counts for the household and belongs to
    // nobody, which is exactly what "member scores start at 0" means.
    const h = habit({
      count: 1,
      completedDates: [d(0), d(1), d(2)],
      completedBy: { [d(2)]: { [PAUL]: 1 } },
    });
    const { household, byMember, unattributed } = decomposeDayPoints(
      [h],
      [PAUL, JEN],
      d(2),
      undefined,
      d(2),
    );
    expect(household).toBe(15);
    expect(byMember[PAUL]).toBe(10);
    expect(byMember[JEN]).toBe(0);
    expect(unattributed).toBe(5);
  });
});

describe('habitAttribution — un-credit reversal math', () => {
  it('reverses exactly one unit at the member’s own multiplier', () => {
    const before = habit({
      count: 2,
      completedDates: [d(0), d(1), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 2 },
      },
    });
    const after = { ...withAttributionDelta(before, d(2), PAUL, -1), count: 1 };
    // Paul is on a 3-day streak → 15/unit, so removing one unit costs 15.
    expect(memberPeriodPointsDelta(before, after, PAUL, d(2), d(2))).toBe(-15);
  });

  it('reverses a HISTORICAL completion at the multiplier that applied THEN', () => {
    // Paul's streak reached 7 by Sunday (2.0×), but the Wednesday completion
    // being un-credited only ever earned the 3-day 1.5× tier. Reversing at
    // today's multiplier would claw back 20 instead of 15.
    const dates = [d(0), d(1), d(2), d(3), d(4), d(5), d(6)];
    const before = habit({
      count: 1,
      completedDates: dates,
      completedBy: Object.fromEntries(dates.map(date => [date, { [PAUL]: 1 }])),
    });
    expect(streakEndingOnForMember(before, PAUL, d(6), d(6))).toBe(7);
    expect(memberPointsForHabitOnDate(before, PAUL, d(6), d(6))).toBe(20);

    const after = withAttributionDelta(before, d(2), PAUL, -1);
    expect(memberPeriodPointsDelta(before, after, PAUL, d(2), d(6))).toBe(-15);
  });

  it('gates a reversal’s buckets by the date it was earned on', () => {
    // Clearing Monday and "today" (Wednesday) at once: total absorbs both,
    // weekly absorbs both (same ISO week), daily only Wednesday's.
    const h = habit({
      count: 1,
      completedDates: [d(0), d(2)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    const { perMember, clearPaths } = attributionReversalForDates(h, [d(0), d(2)], d(2));

    expect(clearPaths).toEqual([completedByDatePath(d(0)), completedByDatePath(d(2))]);
    // Monday earned 10 (streak 1). Wednesday — with Monday already stripped —
    // is scored against Paul's remaining chain, so the reversal always undoes
    // what is actually left rather than double-counting a broken streak.
    const paul = perMember.get(PAUL)!;
    expect(paul.total).toBeLessThan(0);
    expect(paul.weekly).toBe(paul.total);
    expect(paul.daily).toBeGreaterThan(paul.total); // Monday's share excluded
  });

  it('is a no-op for dates nobody is attributed for', () => {
    const legacy = habit({ count: 1, completedDates: [d(0)] });
    const { perMember, clearPaths } = attributionReversalForDates(legacy, [d(0)], d(0));
    expect(clearPaths).toEqual([]);
    expect(perMember.size).toBe(0);
  });
});

describe('habitAttribution — household period points (credit/un-credit pool delta)', () => {
  it('matches the unchanged household scorer for the period', () => {
    const h = habit({ count: 1, completedDates: [d(0)] });
    expect(householdPeriodPoints(h, d(0), d(0))).toBe(calculatePointsForDate([h], d(0)));
  });

  it('collapses a weekly habit’s week to a single award', () => {
    const h = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [d(0), d(2)],
    });
    expect(householdPeriodPoints(h, d(2), d(2))).toBe(10);
  });
});

describe('habitAttribution — per-member recompute', () => {
  const chore = (id: string, assignedTo: string): Habit =>
    habit({
      id,
      scoringType: 'threshold',
      count: 1,
      totalCount: 1,
      completedDates: [d(0)],
      assignedTo,
    });

  it('sums a member’s assigned chores AND their attributed share', () => {
    const shared = habit({
      id: 'shared',
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const result = computeMemberPointsReset(
      [{ uid: PAUL }, { uid: JEN }],
      [shared, chore('c1', JEN)],
      MONDAY,
      d(0),
    );

    expect(result.find(r => r.memberUid === PAUL)).toEqual({
      memberUid: PAUL,
      daily: 10,
      weekly: 10,
    });
    // Jen: 10 from the shared habit's attribution + 10 from her own chore.
    expect(result.find(r => r.memberUid === JEN)).toEqual({
      memberUid: JEN,
      daily: 20,
      weekly: 20,
    });
  });

  it('omits members with neither a chore nor any attribution (transition-day no-op)', () => {
    const legacy = habit({ count: 1, completedDates: [d(0)] });
    expect(computeMemberPointsReset([{ uid: PAUL }, { uid: JEN }], [legacy], MONDAY, d(0)))
      .toEqual([]);
  });

  it('still rolls a managed kid’s assigned chores over, unchanged', () => {
    const result = computeMemberPointsReset(
      [{ uid: 'parent1' }, { uid: 'kid_leo' }, { uid: 'kid_mia' }],
      [chore('c1', 'kid_leo'), chore('c2', 'kid_mia'), chore('c3', 'kid_leo')],
      MONDAY,
      d(0),
    );
    expect(result.find(r => r.memberUid === 'kid_leo')).toEqual({
      memberUid: 'kid_leo',
      daily: 20,
      weekly: 20,
    });
    expect(result.find(r => r.memberUid === 'kid_mia')).toEqual({
      memberUid: 'kid_mia',
      daily: 10,
      weekly: 10,
    });
    expect(result.map(r => r.memberUid)).not.toContain('parent1');
  });

  it('reports only the members whose stored figures drifted', () => {
    const shared = habit({
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const now = parseISO(`${d(0)}T12:00:00`);
    const updates = computeMemberPointsSync(
      [
        { uid: PAUL, points: { daily: 10, weekly: 10, total: 100 } }, // already correct
        { uid: JEN, points: { daily: 0, weekly: 0, total: 50 } }, // drifted
      ],
      [shared],
      now,
    );

    expect(updates).toEqual([
      { memberUid: JEN, daily: 10, weekly: 10, today: d(0) },
    ]);
  });

  it('writes nothing at all for a household with no attribution', () => {
    const legacy = habit({ count: 1, completedDates: [d(0)] });
    const updates = computeMemberPointsSync(
      [{ uid: PAUL, points: { daily: 999, weekly: 999, total: 999 } }],
      [legacy],
      parseISO(`${d(0)}T12:00:00`),
    );
    expect(updates).toEqual([]);
  });
});
