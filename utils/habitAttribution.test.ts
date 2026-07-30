import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import type { Habit } from '@/types/schema';
import {
  attributedMemberIds,
  attributedUnitsOnDate,
  attributionFingerprint,
  attributionReversalForDates,
  calculateHouseholdPointsForDate,
  calculateHouseholdPointsForDateRange,
  calculateMemberPointsForDate,
  calculateMemberPointsForDateRange,
  completedByDatePath,
  completedByPath,
  computeHouseholdPointsSync,
  computeMemberPointsReset,
  computeMemberPointsSync,
  decomposeDayPoints,
  habitFeedsMemberAttribution,
  householdPeriodPoints,
  householdPeriodPointsDelta,
  householdPointsForHabitOnDate,
  legacyPeriodPoints,
  memberCompletionCount,
  memberCompletionDates,
  memberFrozenDates,
  memberIdsOnDate,
  memberMostRecentUnitDateInPeriod,
  memberPeriodPoints,
  memberPeriodPointsDelta,
  memberPointsForHabitOnDate,
  memberUnitsForPeriod,
  prospectiveMultiplierForMember,
  resolveReversalSources,
  streakEndingOnForMember,
  streakForMember,
  unattributedPeriodPoints,
  unattributedPointsForHabitOnDate,
  wholePeriodClearDates,
  withAttributionDelta,
  withDatesUnattributed,
} from '@/utils/habitAttribution';
import {
  calculatePointsForDate,
  calculateResetPoints,
  calculateStreak,
  pointsForHabitOnDate,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';

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

  it('sums a DAILY habit’s period units from that day alone', () => {
    expect(memberUnitsForPeriod(h, d(0))).toEqual({ [PAUL]: 2, [JEN]: 1 });
    expect(memberUnitsForPeriod(h, d(1))).toEqual({ [JEN]: 1 });
    expect(memberUnitsForPeriod(h, d(2))).toEqual({});
  });

  it('sums a WEEKLY habit’s period units across the whole ISO week', () => {
    // The live counter of a weekly habit accumulates all week, so the row's pie
    // must split the same span — splitting only today would show a 3-count disc
    // filled by one person's single completion.
    const weekly = habit({
      period: 'weekly',
      completedDates: [d(0), d(1)],
      completedBy: {
        [d(0)]: { [PAUL]: 2, [JEN]: 1 },
        [d(1)]: { [JEN]: 1 },
        // Previous week — must NOT bleed into this week's disc.
        [d(-3)]: { [PAUL]: 5 },
      },
    });
    expect(memberUnitsForPeriod(weekly, d(4))).toEqual({ [PAUL]: 2, [JEN]: 2 });
    expect(memberUnitsForPeriod(weekly, d(-3))).toEqual({ [PAUL]: 5 });
  });

  describe('memberMostRecentUnitDateInPeriod (F2: the picker’s un-credit target)', () => {
    it('finds the LATEST day within the period holding a unit, even when it is not "today"', () => {
      const weekly = habit({
        period: 'weekly',
        completedDates: [d(0), d(2)],
        completedBy: {
          [d(0)]: { [PAUL]: 1 }, // Monday
          [d(2)]: { [PAUL]: 1 }, // Wednesday
          // Previous week — out of scope regardless of recency.
          [d(-3)]: { [PAUL]: 9 },
        },
      });
      // Viewed on Friday (d(4)): the most recent unit in THIS week is Wednesday.
      expect(memberMostRecentUnitDateInPeriod(weekly, PAUL, d(4))).toBe(d(2));
    });

    it('degrades to exactly the daily case: the period IS the day', () => {
      expect(memberMostRecentUnitDateInPeriod(h, PAUL, d(0))).toBe(d(0));
      expect(memberMostRecentUnitDateInPeriod(h, PAUL, d(1))).toBe(null); // Paul holds nothing on d(1)
    });

    it('returns null when the member holds nothing in the period', () => {
      const weekly = habit({ period: 'weekly', completedDates: [d(0)], completedBy: { [d(0)]: { [JEN]: 1 } } });
      expect(memberMostRecentUnitDateInPeriod(weekly, PAUL, d(4))).toBe(null);
    });

    it('never looks past "today" into the rest of the ISO week', () => {
      const weekly = habit({
        period: 'weekly',
        completedDates: [d(0)],
        completedBy: {
          [d(0)]: { [PAUL]: 1 }, // Monday
          [d(5)]: { [PAUL]: 1 }, // Saturday — a stray future-dated fixture
        },
      });
      // Viewed Wednesday (d(2)): Saturday hasn't "happened" yet from today's
      // vantage point, so it must not be picked as the reversal target.
      expect(memberMostRecentUnitDateInPeriod(weekly, PAUL, d(2))).toBe(d(0));
    });
  });

  // The weekly branch derives the week's seven day-keys itself, so it has to
  // produce the exact strings `getLocalDateString()` writes. `parseISO` on a
  // date-only string is LOCAL midnight (unlike `new Date(string)`, which is
  // UTC), so this holds in every timezone — pinned here because an off-by-one
  // would silently blank the row's pie for weekly habits west of UTC.
  it('addresses the week with the same keys getLocalDateString writes', () => {
    const realToday = getLocalDateString();
    const weekly = habit({
      period: 'weekly',
      completedDates: [realToday],
      completedBy: { [realToday]: { [PAUL]: 1 } },
    });
    expect(memberUnitsForPeriod(weekly, realToday)).toEqual({ [PAUL]: 1 });
  });

  it('fingerprints only the current period, and is key-order independent', () => {
    const reordered = habit({
      completedDates: [d(0), d(1)],
      completedBy: {
        [d(1)]: { [JEN]: 1 },
        [d(0)]: { [JEN]: 1, [PAUL]: 2 },
      },
    });
    expect(attributionFingerprint(reordered, d(0))).toBe(attributionFingerprint(h, d(0)));
    // A change on a DIFFERENT day never moves the fingerprint of this one.
    const otherDay = habit({ ...h, completedBy: { ...h.completedBy, [d(1)]: { [JEN]: 9 } } });
    expect(attributionFingerprint(otherDay, d(0))).toBe(attributionFingerprint(h, d(0)));
    // A change on THIS day always does.
    const sameDay = habit({ ...h, completedBy: { ...h.completedBy, [d(0)]: { [PAUL]: 3 } } });
    expect(attributionFingerprint(sameDay, d(0))).not.toBe(attributionFingerprint(h, d(0)));
    expect(attributionFingerprint(habit(), d(0))).toBe('');
  });

  it('derives a member’s own completion-date set, newest first', () => {
    expect(memberCompletionDates(h, JEN)).toEqual([d(1), d(0)]);
    expect(memberCompletionDates(h, PAUL)).toEqual([d(0)]);
    expect(memberCompletionDates(h, 'nobody')).toEqual([]);
  });

  // 🛡️ Decrements are written as unconditional dot-path increments (choosing
  // deleteField() at zero would have to trust a client-cached prior count, and
  // a stale offline cache would then wipe a concurrent increment). That leaves
  // 0 — or, after concurrent decrements, negative — residue nodes behind, so
  // EVERY reader must read `count <= 0` as ABSENT.
  it('treats zero and negative residue counts as absent', () => {
    const residue = habit({
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 0, [JEN]: -2, 'sam-uid': 1 } },
    });
    expect(memberCompletionCount(residue, PAUL, d(0))).toBe(0);
    expect(memberCompletionCount(residue, JEN, d(0))).toBe(0);
    expect(attributedUnitsOnDate(residue, d(0))).toBe(1);
    expect(memberIdsOnDate(residue, d(0))).toEqual(['sam-uid']);
    expect(attributedMemberIds(residue)).toEqual(['sam-uid']);
    expect(memberCompletionDates(residue, PAUL)).toEqual([]);
    expect(memberCompletionDates(residue, JEN)).toEqual([]);
  });

  it('scores a residue node as zero points, not as a completion', () => {
    const residue = habit({
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 0, [JEN]: -1 } },
    });
    expect(memberPointsForHabitOnDate(residue, PAUL, d(0), d(0))).toBe(0);
    expect(memberPointsForHabitOnDate(residue, JEN, d(0), d(0))).toBe(0);
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

  it('applies a delta from 0, never compounding a residue node', () => {
    // `{PAUL: -2}` means "absent", so a +1 must land on 1 — not on −1.
    const before = habit({ completedBy: { [d(0)]: { [PAUL]: -2 } } });
    expect(memberCompletionCount(withAttributionDelta(before, d(0), PAUL, 1), PAUL, d(0))).toBe(1);
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
    // Paul: Mon, (Tue frozen), Wed. The freeze is stored on the HABIT, which
    // stays the household-wide bridge in every shared freeze mode AND for all
    // legacy data — so Paul's streak is 2 (frozen days never count as a
    // completion, they only preserve continuity). The narrower per-member
    // bridge is `frozenDatesBy`, covered in its own block below.
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

// Stage 6 — `Habit.frozenDatesBy`: the NARROW bridge written only under
// `freezeMode: 'per_member'`. A date listed for one uid bridges that member's
// chain and nobody else's.
describe('habitAttribution — per-member frozen dates', () => {
  /** Paul and Jen both did Mon and Wed; nobody completed Tue. */
  const monWed = (extra: Partial<Habit> = {}): Habit =>
    habit({
      completedDates: [d(0), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1, [JEN]: 1 },
        [d(2)]: { [PAUL]: 1, [JEN]: 1 },
      },
      ...extra,
    });

  it('reads only the dates listed for that member', () => {
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL], [d(5)]: [JEN, PAUL] } });
    expect(memberFrozenDates(h, PAUL)).toEqual([d(1), d(5)]);
    expect(memberFrozenDates(h, JEN)).toEqual([d(5)]);
    expect(memberFrozenDates(h, 'nobody')).toEqual([]);
  });

  it('bridges ONLY the frozen member’s chain', () => {
    // Paul spent a token on Tuesday; Jen did not. Same completions, same habit,
    // different streaks — this is the whole point of the per-member mode.
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL] } });
    expect(streakForMember(h, PAUL, d(2))).toBe(2);
    expect(streakForMember(h, JEN, d(2))).toBe(1);
  });

  it('leaves the HABIT-level streak alone (a personal token buys no household bridge)', () => {
    // The habit-level walk reads `frozenDates`, which a per-member freeze never
    // writes — so the household chain still shows the Tuesday break.
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL] } });
    expect(h.frozenDates).toBeUndefined();
    expect(calculateStreak(h.completedDates, d(2), h.frozenDates ?? [])).toBe(1);
  });

  it('feeds the historical multiplier for that member only', () => {
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL] } });
    expect(streakEndingOnForMember(h, PAUL, d(2), d(2))).toBe(2);
    expect(streakEndingOnForMember(h, JEN, d(2), d(2))).toBe(1);
  });

  it('feeds the PROSPECTIVE multiplier for that member only', () => {
    // Paul: Mon, (Tue frozen), Wed → completing Thu makes 3 → 1.5×.
    // Jen: same completions, no freeze → Thu is only her 2nd in a row → 1.0×.
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL] } });
    expect(prospectiveMultiplierForMember(h, PAUL, d(3), d(3))).toBe(1.5);
    expect(prospectiveMultiplierForMember(h, JEN, d(3), d(3))).toBe(1.0);
  });

  it('composes with the household-wide bridge rather than replacing it', () => {
    // Mon completed, Tue frozen household-wide, Wed frozen for Paul only, Thu
    // completed. Paul's chain survives both gaps; Jen's survives only the first.
    const h = habit({
      completedDates: [d(0), d(3)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 }, [d(3)]: { [PAUL]: 1, [JEN]: 1 } },
      frozenDates: [d(1)],
      frozenDatesBy: { [d(2)]: [PAUL] },
    });
    expect(streakForMember(h, PAUL, d(3))).toBe(2);
    expect(streakForMember(h, JEN, d(3))).toBe(1);
  });

  it('is INERT when absent: every walk matches the pre-stage-6 result', () => {
    // The regression pin. Identical habits bar an absent vs. empty map — and
    // an empty map must score exactly as the absent one does.
    const base = monWed();
    const empty = monWed({ frozenDatesBy: {} });
    for (const member of [PAUL, JEN]) {
      expect(streakForMember(empty, member, d(2))).toBe(streakForMember(base, member, d(2)));
      expect(streakEndingOnForMember(empty, member, d(2), d(2)))
        .toBe(streakEndingOnForMember(base, member, d(2), d(2)));
      expect(prospectiveMultiplierForMember(empty, member, d(3), d(3)))
        .toBe(prospectiveMultiplierForMember(base, member, d(3), d(3)));
      expect(memberPointsForHabitOnDate(empty, member, d(2), d(2)))
        .toBe(memberPointsForHabitOnDate(base, member, d(2), d(2)));
    }
  });

  it('never earns points: a frozen day is not a completion', () => {
    const h = monWed({ frozenDatesBy: { [d(1)]: [PAUL] } });
    // Tuesday is bridged for Paul, but he has no attributed unit there, so it
    // scores zero — the freeze buys continuity, never points.
    expect(memberCompletionCount(h, PAUL, d(1))).toBe(0);
    expect(memberPointsForHabitOnDate(h, PAUL, d(1), d(2))).toBe(0);
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

// Stage 1.5: `household` is now PRODUCED as `Σ member awards + unattributed
// remainder`, and `legacy` records what the pre-flip habit-level scorer would
// have said. Grandfathered data keeps the legacy figure exactly; attributed data
// is scored per member.
describe('habitAttribution — household decomposition (grandfathering)', () => {
  it('attributes a pre-feature habit entirely to the remainder', () => {
    const legacy = habit({ count: 1, completedDates: [d(0)] }); // no completedBy
    const decomposition = decomposeDayPoints([legacy], [PAUL, JEN], d(0), undefined, d(0));

    expect(decomposition.household).toBe(calculatePointsForDate([legacy], d(0)));
    expect(decomposition.byMember).toEqual({ [PAUL]: 0, [JEN]: 0 });
    expect(decomposition.unattributed).toBe(decomposition.household);
    expect(decomposition.legacy).toBe(decomposition.household);
  });

  it('leaves the LEGACY figure untouched while the household figure flips', () => {
    // Same habit, twice: once as it exists today, once with a full attribution
    // map bolted on. Adding attribution never rewrites history — the pre-flip
    // scorer says exactly what it always did — but the household figure it feeds
    // is now the sum of the members' own awards.
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
    }

    // Monday: 3 attributed units, all at the members' own 1.0× tier → 30, where
    // the legacy scorer only ever counted ONE unit for a past day (10).
    const monday = decomposeDayPoints([attributed], [PAUL, JEN], d(0), undefined, d(1));
    expect(monday.legacy).toBe(10);
    expect(monday.byMember).toEqual({ [PAUL]: 20, [JEN]: 10 });
    expect(monday.unattributed).toBe(0);
    expect(monday.household).toBe(30);
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

  it('scores an attributed day at the MEMBER’s multiplier, not the habit’s', () => {
    // 🏁 The visible consequence of the flip, pinned. The HABIT has a 3-day
    // streak (1.5× → 15), but Paul's own chain starts today, so today's single
    // completion is worth his 1.0× tier (10) — to him AND to the household.
    // Monday's and Tuesday's grandfathered completions still count for the
    // household on THEIR OWN dates; they do not prop up Wednesday.
    const h = habit({
      count: 1,
      completedDates: [d(0), d(1), d(2)],
      completedBy: { [d(2)]: { [PAUL]: 1 } },
    });
    const wednesday = decomposeDayPoints([h], [PAUL, JEN], d(2), undefined, d(2));
    expect(wednesday.legacy).toBe(15);
    expect(wednesday.household).toBe(10);
    expect(wednesday.byMember).toEqual({ [PAUL]: 10, [JEN]: 0 });
    expect(wednesday.unattributed).toBe(0);

    // Monday is untouched: no attribution anywhere in its period, so the legacy
    // figure stands verbatim and belongs to nobody.
    const monday = decomposeDayPoints([h], [PAUL, JEN], d(0), undefined, d(2));
    expect(monday.household).toBe(monday.legacy);
    expect(monday.unattributed).toBe(monday.legacy);
  });

  it('keeps a TRANSITION day whole: grandfathered units + a fresh member award', () => {
    // Two pre-feature increments today plus one freshly attributed tap. The
    // household keeps the two legacy units AND gains Paul's award, so nothing
    // silently disappears on flip day.
    const h = habit({
      count: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    const day = decomposeDayPoints([h], [PAUL, JEN], d(0), undefined, d(0));
    // The legacy scorer counts all 3 of today's units at 10 each; 2 of them are
    // grandfathered and survive the flip untouched.
    expect(unattributedPointsForHabitOnDate(h, d(0), d(0))).toBe(20);
    expect(day.unattributed).toBe(20);
    expect(day.byMember[PAUL]).toBe(10);
    expect(day.household).toBe(30);
  });

  it('credits the household TWICE when both members complete a threshold habit', () => {
    // 🔒 Locked decision: a "Both of us" completion credits every selected member
    // a FULL award, and the pool receives the sum — where the legacy scorer only
    // ever counted the period's one award.
    const h = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const day = decomposeDayPoints([h], [PAUL, JEN], d(0), undefined, d(0));
    expect(day.legacy).toBe(10);
    expect(day.byMember).toEqual({ [PAUL]: 10, [JEN]: 10 });
    expect(day.unattributed).toBe(0);
    expect(day.household).toBe(20);
  });

  it('skips assigned chores in both halves (they pay the assignee, not the pool)', () => {
    const chore = habit({
      assignedTo: 'kid-uid',
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { 'kid-uid': 1 } },
    });
    const day = decomposeDayPoints([chore], [PAUL, JEN, 'kid-uid'], d(0), undefined, d(0));
    expect(day.household).toBe(0);
    expect(day.unattributed).toBe(0);
    expect(day.byMember).toEqual({ [PAUL]: 0, [JEN]: 0, 'kid-uid': 0 });
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
    const { perMember, clearPaths, household } = attributionReversalForDates(legacy, [d(0)], d(0));
    expect(clearPaths).toEqual([]);
    expect(perMember.size).toBe(0);
    // The pool still loses what that grandfathered day contributed — the LEGACY
    // figure, since nobody holds it.
    expect(household).toEqual({ daily: -10, weekly: -10, total: -10 });
  });

  it('debits the pool the Σ of the member reversals it produced', () => {
    // 🔒 Reversal symmetry: what the members give back is what the pool gives
    // back, to the point.
    const h = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const { perMember, household } = attributionReversalForDates(h, [d(0)], d(0));
    const memberTotal = [...perMember.values()].reduce((sum, b) => sum + b.total, 0);
    expect(memberTotal).toBe(-20); // each member's full award
    expect(household.total).toBe(memberTotal);
    expect(household.daily).toBe(memberTotal);
  });

  it('debits members AND remainder on a mixed transition day', () => {
    const h = habit({
      count: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    expect(unattributedPointsForHabitOnDate(h, d(0), d(0))).toBe(20);
    const { perMember, household } = attributionReversalForDates(h, [d(0)], d(0));
    expect(perMember.get(PAUL)!.total).toBe(-10);
    expect(household.total).toBe(-30); // Paul's award + the two legacy units
  });

  it('reverses a weekly threshold period whose award sits on an earlier progress day', () => {
    // 🔒 Regression (adversarial review, PR #1155). Weekly `targetCount: 3`:
    // Paul taps Mon (1/3), Wed (2/3), Fri (3/3 → the award lands). ONLY Friday
    // enters `completedDates`, but the award is attributed to Monday — his first
    // attributed day of the week — so scoring Friday's own per-date contribution
    // reversed NOTHING: the pool and Paul both kept a completion that no longer
    // existed, and Mon/Wed stayed attributed forever (inflating his streak).
    const h = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 3,
      count: 3,
      completedDates: [d(4)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1 },
        [d(4)]: { [PAUL]: 1 },
      },
    });
    // The award really does sit on Monday, not on the completion day.
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(4))).toBe(10);
    expect(memberPointsForHabitOnDate(h, PAUL, d(4), d(4))).toBe(0);

    const { perMember, household, clearedDates, clearPaths } =
      attributionReversalForDates(h, [d(4)], d(4), 0);

    // The whole period's attribution goes, progress days included.
    expect(clearedDates).toEqual([d(0), d(2), d(4)]);
    expect(clearPaths).toEqual([d(0), d(2), d(4)].map(completedByDatePath));
    expect(attributedMemberIds(withDatesUnattributed(h, clearedDates))).toEqual([]);

    expect(perMember.get(PAUL)).toEqual({ daily: -10, weekly: -10, total: -10 });
    // Gated by the COMPLETION day (Friday), which is where the credit landed.
    expect(household).toEqual({ daily: -10, weekly: -10, total: -10 });
  });

  it('reverses each member’s own weekly threshold award', () => {
    const h = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 2,
      count: 2,
      completedDates: [d(2)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const { perMember, household, clearedDates } =
      attributionReversalForDates(h, [d(2)], d(2), 0);

    expect(clearedDates).toEqual([d(0), d(2)]);
    expect(perMember.get(PAUL)!.total).toBe(-10);
    expect(perMember.get(JEN)!.total).toBe(-10);
    expect(household.total).toBe(-20);
  });

  it('reverses a daily threshold day at the member’s own award', () => {
    const h = habit({
      scoringType: 'threshold',
      targetCount: 2,
      count: 2,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    const { perMember, household, clearedDates } =
      attributionReversalForDates(h, [d(0)], d(0), 0);
    expect(clearedDates).toEqual([d(0)]); // the day IS the period
    expect(perMember.get(PAUL)!.total).toBe(-10);
    expect(household.total).toBe(-10);
  });

  it('sweeps a below-target threshold period’s orphans without moving points', () => {
    // 2/3 of a weekly target: Mon and Wed are attributed, nothing ever entered
    // `completedDates`, and nothing was ever awarded. Resetting must still take
    // the attribution — leaving it would inflate Paul's per-member streak — but
    // must not move a single point.
    const h = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 3,
      count: 2,
      completedDates: [],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    const { perMember, household, clearedDates } =
      attributionReversalForDates(h, [d(2)], d(2), 0);

    expect(clearedDates).toEqual([d(0), d(2)]);
    expect(perMember.size).toBe(0);
    expect(household).toEqual({ daily: 0, weekly: 0, total: 0 });
  });

  it('still debits a grandfathered threshold day at the legacy figure', () => {
    const h = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [d(0)],
    });
    const { perMember, household, clearPaths } =
      attributionReversalForDates(h, [d(0)], d(0), 0);
    expect(clearPaths).toEqual([]);
    expect(perMember.size).toBe(0);
    expect(household).toEqual({ daily: -10, weekly: -10, total: -10 });
  });

  it('keeps an incremental habit’s reversal strictly per-date', () => {
    // Incremental attribution is genuinely one award per action per date, so
    // clearing Wednesday must leave Monday's unit — and its points — alone.
    const h = habit({
      count: 2,
      completedDates: [d(0), d(2)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    const { perMember, household, clearedDates } =
      attributionReversalForDates(h, [d(2)], d(2), 0);

    expect(clearedDates).toEqual([d(2)]);
    expect(perMember.get(PAUL)!.total).toBe(-10);
    // Wednesday's own contribution: Paul's award plus the one live-counter unit
    // nobody holds — unchanged from before the threshold split.
    expect(household.total).toBe(-20);
  });

  it('never debits the pool twice for a duplicated date', () => {
    const h = habit({
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    const once = attributionReversalForDates(h, [d(0)], d(0));
    const twice = attributionReversalForDates(h, [d(0), d(0)], d(0));
    expect(twice.household).toEqual(once.household);
    expect(twice.clearPaths).toEqual(once.clearPaths);
  });
});

// 🔒 Regression (follow-up to the PR #1155 adversarial review). An INCREMENTAL
// habit with `targetCount > 1` credits points on EVERY tap but only enters
// `completedDates` at target, so a below-target period carries member points and
// attribution with NO completion date. `resetHabit` reversed only the completion
// dates, so the member kept their award while the pool was still debited by
// `calculateResetPoints` — a permanent divergence (`points.total` is never
// clamped downward by the corrective sync) plus attribution that kept inflating
// that member's own streak.
describe('habitAttribution — whole-period clears sweep incremental orphans', () => {
  /** The pool debit a reversal produces must equal Σ members + the remainder. */
  const assertSigmaInvariant = (
    before: Habit,
    reversal: ReturnType<typeof attributionReversalForDates>,
    datesRemoved: string[],
    date: string,
    countAfter = 0,
  ): void => {
    const removed = new Set(datesRemoved);
    const after: Habit = {
      ...withDatesUnattributed(before, reversal.clearedDates),
      completedDates: before.completedDates.filter(c => !removed.has(c)),
      count: countAfter,
    };
    const remainderDelta =
      unattributedPeriodPoints(after, date, date) - unattributedPeriodPoints(before, date, date);
    const memberTotal = [...reversal.perMember.values()].reduce((sum, b) => sum + b.total, 0);
    expect(reversal.household.total).toBe(memberTotal + remainderDelta);
  };

  it('reverses a below-target incremental period the pool was still debited for', () => {
    // The flagged fixture: `targetCount: 3`, Paul tapped twice today (2/3).
    // Both taps paid him 10, nothing entered `completedDates`.
    const h = habit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 2,
      totalCount: 2,
      completedDates: [],
      completedBy: { [d(0)]: { [PAUL]: 2 } },
    });
    expect(memberPointsForHabitOnDate(h, PAUL, d(0), d(0))).toBe(20);

    // What `resetHabit` used to pass (its completion dates) reversed NOTHING…
    const naive = attributionReversalForDates(h, [], d(0), 0);
    expect(naive.perMember.size).toBe(0);
    expect(naive.clearedDates).toEqual([]);

    // …while the pool was debited `calculateResetPoints`' two units regardless.
    expect(calculateResetPoints(h)).toBe(20);

    const dates = wholePeriodClearDates(h, [], d(0));
    expect(dates).toEqual([d(0)]);
    const reversal = attributionReversalForDates(h, dates, d(0), 0);

    expect(reversal.perMember.get(PAUL)).toEqual({ daily: -20, weekly: -20, total: -20 });
    expect(reversal.clearedDates).toEqual([d(0)]);
    expect(reversal.clearPaths).toEqual([completedByDatePath(d(0))]);
    expect(attributedMemberIds(withDatesUnattributed(h, reversal.clearedDates))).toEqual([]);
    // The pool debit is unchanged in magnitude from what `calculateResetPoints`
    // already took — the member side simply stopped being skipped.
    expect(reversal.household).toEqual({ daily: -20, weekly: -20, total: -20 });
    expect(reversal.household.total).toBe(-calculateResetPoints(h));
    assertSigmaInvariant(h, reversal, [], d(0));
  });

  it('splits a below-target incremental period across both members', () => {
    const h = habit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 2,
      totalCount: 2,
      completedDates: [],
      completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
    });

    const reversal = attributionReversalForDates(
      h, wholePeriodClearDates(h, [], d(0)), d(0), 0,
    );

    expect(reversal.perMember.get(PAUL)).toEqual({ daily: -10, weekly: -10, total: -10 });
    expect(reversal.perMember.get(JEN)).toEqual({ daily: -10, weekly: -10, total: -10 });
    expect(reversal.household.total).toBe(-20);
    expect(reversal.household.total).toBe(-calculateResetPoints(h));
    assertSigmaInvariant(h, reversal, [], d(0));
  });

  it('sweeps a weekly incremental period’s progress days alongside its completion', () => {
    // `targetCount: 3` weekly: Mon (1/3) and Wed (2/3) are attributed but never
    // completions, so only Friday was ever reversed — two thirds of the week's
    // credit stayed with both the member AND the pool.
    const h = habit({
      period: 'weekly',
      scoringType: 'incremental',
      targetCount: 3,
      count: 3,
      totalCount: 3,
      completedDates: [d(4)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1 },
        [d(4)]: { [PAUL]: 1 },
      },
    });

    const dates = wholePeriodClearDates(h, [d(4)], d(4));
    // Completion day FIRST — the ordering the helper's remainder maths needs.
    expect(dates).toEqual([d(4), d(0), d(2)]);

    const reversal = attributionReversalForDates(h, dates, d(4), 0);
    expect(reversal.clearedDates.slice().sort()).toEqual([d(0), d(2), d(4)]);
    // All three units come back, and `daily` only absorbs today's — the earlier
    // days' daily credit rolled over at midnight and is no longer there to take.
    expect(reversal.perMember.get(PAUL)).toEqual({ daily: -10, weekly: -30, total: -30 });
    expect(reversal.household).toEqual({ daily: -10, weekly: -30, total: -30 });
    expect(reversal.household.total).toBe(-calculateResetPoints(h));
    assertSigmaInvariant(h, reversal, [d(4)], d(4));
  });

  it('leaves an at-target incremental day exactly as it was (control)', () => {
    // 🔒 The completion date already covers every attributed day, so the sweep
    // adds nothing and the reversal is bit-for-bit the pre-fix one.
    const h = habit({
      scoringType: 'incremental',
      targetCount: 3,
      count: 3,
      totalCount: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 3 } },
    });

    expect(wholePeriodClearDates(h, [d(0)], d(0))).toEqual([d(0)]);
    const before = attributionReversalForDates(h, [d(0)], d(0), 0);
    const after = attributionReversalForDates(
      h, wholePeriodClearDates(h, [d(0)], d(0)), d(0), 0,
    );
    expect(after).toEqual(before);
    expect(after.household).toEqual({ daily: -30, weekly: -30, total: -30 });
    expect(after.perMember.get(PAUL)).toEqual({ daily: -30, weekly: -30, total: -30 });
  });

  it('leaves THRESHOLD date sets untouched, below target and above', () => {
    // 🛡️ `attributionReversalForDates` period-scopes threshold habits itself;
    // adding orphan dates here would double-visit the period.
    const belowTarget = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 3,
      count: 2,
      completedDates: [],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(2)]: { [PAUL]: 1 } },
    });
    expect(wholePeriodClearDates(belowTarget, [], d(2))).toEqual([d(2)]);

    const atTarget = habit({
      period: 'weekly',
      scoringType: 'threshold',
      targetCount: 3,
      count: 3,
      completedDates: [d(4)],
      completedBy: { [d(0)]: { [PAUL]: 1 }, [d(4)]: { [PAUL]: 1 } },
    });
    expect(wholePeriodClearDates(atTarget, [d(4)], d(4))).toEqual([d(4)]);
  });

  it('adds nothing for a grandfathered incremental period', () => {
    // No `completedBy` at all → no orphans → the caller keeps its own dates and
    // the legacy `calculateResetPoints` fallback still applies.
    const legacy = habit({ scoringType: 'incremental', targetCount: 3, count: 2 });
    expect(wholePeriodClearDates(legacy, [], d(0))).toEqual([]);
  });
});

describe('habitAttribution — household period points (pool delta)', () => {
  it('matches the legacy scorer for the period when nothing is attributed', () => {
    const h = habit({ count: 1, completedDates: [d(0)] });
    expect(householdPeriodPoints(h, d(0), d(0))).toBe(calculatePointsForDate([h], d(0)));
    expect(legacyPeriodPoints(h, d(0), d(0))).toBe(calculatePointsForDate([h], d(0)));
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
    expect(legacyPeriodPoints(h, d(2), d(2))).toBe(10);
  });

  it('pays the pool BOTH awards when a second member completes the same day', () => {
    const before = habit({
      scoringType: 'threshold',
      targetCount: 1,
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 1 } },
    });
    const after: Habit = { ...withAttributionDelta(before, d(0), JEN, 1), count: 2 };

    // The legacy scorer sees no change at all — the period was already complete.
    expect(legacyPeriodPoints(after, d(0), d(0)) - legacyPeriodPoints(before, d(0), d(0))).toBe(0);
    // The competition model pays Jen's full award.
    expect(householdPeriodPointsDelta(before, after, d(0), d(0))).toBe(10);
    expect(memberPeriodPointsDelta(before, after, JEN, d(0), d(0))).toBe(10);
  });

  it('pays the pool the SUM of the member deltas on an attributed toggle', () => {
    // An incremental up-tap by Paul on a habit Jen already worked today: the
    // pool delta is exactly Paul's own award, and the remainder never moves.
    const before = habit({
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [JEN]: 1 } },
    });
    const after: Habit = { ...withAttributionDelta(before, d(0), PAUL, 1), count: 2 };
    expect(householdPeriodPointsDelta(before, after, d(0), d(0))).toBe(
      memberPeriodPointsDelta(before, after, PAUL, d(0), d(0)),
    );
    expect(unattributedPeriodPoints(after, d(0), d(0))).toBe(0);
  });

  it('reverses symmetrically: crediting then un-crediting nets to zero', () => {
    // 🔒 A reversal must undo exactly the award it granted, on every layer.
    const before = habit({
      count: 2,
      completedDates: [d(0), d(1), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1, [JEN]: 1 },
      },
    });
    const after: Habit = { ...withAttributionDelta(before, d(2), JEN, 1), count: 3 };
    const credited = householdPeriodPointsDelta(before, after, d(2), d(2));
    const reversed = householdPeriodPointsDelta(after, before, d(2), d(2));
    expect(credited).toBeGreaterThan(0);
    expect(credited + reversed).toBe(0);
  });
});

describe('habitAttribution — household recompute (the written figure)', () => {
  it('sums to Σ members + remainder on every path', () => {
    const habits = [
      // Fully attributed threshold day, both members.
      habit({
        id: 'shared',
        scoringType: 'threshold',
        targetCount: 1,
        count: 2,
        completedDates: [d(0)],
        completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } },
      }),
      // Transition day: one legacy unit plus one attributed one.
      habit({ id: 'mixed', count: 2, completedDates: [d(0)], completedBy: { [d(0)]: { [JEN]: 1 } } }),
      // Untouched pre-feature habit.
      habit({ id: 'legacy', count: 1, completedDates: [d(0)] }),
    ];
    const { household, byMember, unattributed } = decomposeDayPoints(
      habits,
      [PAUL, JEN],
      d(0),
      undefined,
      d(0),
    );
    expect(household).toBe(byMember[PAUL]! + byMember[JEN]! + unattributed);
    expect(calculateHouseholdPointsForDate(habits, d(0), d(0))).toBe(household);
    // The same habits over a one-day range agree with the single-day scorer.
    expect(calculateHouseholdPointsForDateRange(habits, d(0), d(0), d(0))).toBe(household);
  });

  it('reproduces the legacy per-date figure for fully un-attributed history', () => {
    // 🛡️ Grandfathering: with no `completedBy` anywhere, the flipped scorer must
    // agree with the pre-flip one, date for date — and the range must be their
    // sum. (`calculatePointsForDateRange` reads the real clock for "today", so
    // it can't be compared directly against an injected fixture week without
    // making the suite weekday-dependent; `pointsForHabitOnDate` takes `today`.)
    const habits = [
      habit({ id: 'daily', count: 2, completedDates: [d(0), d(1), d(2)] }),
      habit({
        id: 'weekly',
        period: 'weekly',
        scoringType: 'threshold',
        targetCount: 1,
        count: 1,
        completedDates: [d(0), d(2)],
      }),
    ];
    let expected = 0;
    for (const h of habits) {
      for (const date of [d(0), d(1), d(2)]) {
        expect(householdPointsForHabitOnDate(h, date, d(2))).toBe(
          pointsForHabitOnDate(h, date, d(2)),
        );
        expected += pointsForHabitOnDate(h, date, d(2));
      }
    }
    expect(calculateHouseholdPointsForDateRange(habits, d(0), d(2), d(2))).toBe(expected);
  });

  it('computeHouseholdPointsSync recomputes daily/weekly/total and flags an update', () => {
    const now = parseISO(`${d(0)}T12:00:00`);
    const habits = [habit({ count: 1, completedDates: [d(0)] })];
    const result = computeHouseholdPointsSync(habits, { daily: 0, weekly: 0, total: 0 }, now);
    expect(result.needsUpdate).toBe(true);
    expect(result.points).toEqual({ daily: 10, weekly: 10, total: 10 });
  });

  it('computeHouseholdPointsSync reports no update when the stored points match', () => {
    const now = parseISO(`${d(0)}T12:00:00`);
    const habits = [habit({ count: 1, completedDates: [d(0)] })];
    const result = computeHouseholdPointsSync(habits, { daily: 10, weekly: 10, total: 10 }, now);
    expect(result.needsUpdate).toBe(false);
  });

  it('computeHouseholdPointsSync preserves a cumulative total that predates this week', () => {
    const now = parseISO(`${d(0)}T12:00:00`);
    const habits = [habit({ count: 1, completedDates: [d(0), d(-7)] })];
    const result = computeHouseholdPointsSync(habits, { daily: 10, weekly: 10, total: 200 }, now);
    expect(result.points.total).toBe(200);
    expect(result.points.daily).toBe(10);
    expect(result.points.weekly).toBe(10);
    expect(result.needsUpdate).toBe(false);
  });

  it('computeHouseholdPointsSync zeroes daily/weekly but keeps total with no completions', () => {
    const now = parseISO(`${d(0)}T12:00:00`);
    const result = computeHouseholdPointsSync([], { daily: 5, weekly: 5, total: 100 }, now);
    expect(result.needsUpdate).toBe(true);
    expect(result.points).toEqual({ daily: 0, weekly: 0, total: 100 });
  });

  it('computeHouseholdPointsSync sums the member awards, not the habit multiplier', () => {
    // Paul on a 7-day habit chain but his OWN chain is 3 days: the household
    // weekly figure follows HIS 1.5× tier, not the habit's 2.0×.
    const dates = [d(-4), d(-3), d(-2), d(0), d(1), d(2)];
    const h = habit({
      count: 1,
      completedDates: dates,
      completedBy: {
        [d(0)]: { [PAUL]: 1 },
        [d(1)]: { [PAUL]: 1 },
        [d(2)]: { [PAUL]: 1 },
      },
    });
    const now = parseISO(`${d(2)}T12:00:00`);
    const { points } = computeHouseholdPointsSync([h], { daily: 0, weekly: 0, total: 0 }, now);
    // Paul: Mon 10 (streak 1) + Tue 10 (streak 2) + Wed 15 (streak 3 → 1.5×).
    expect(points.weekly).toBe(35);
    expect(points.daily).toBe(15);
    expect(calculateMemberPointsForDateRange([h], PAUL, d(0), d(2), d(2))).toBe(35);
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

// ---------------------------------------------------------------------------
// resolveReversalSources — 🛡️ reversals are bounded by STORED attribution
// ---------------------------------------------------------------------------
// The rule this pins: a member-points debit or a `completedBy` decrement may
// only ever take back units the map ACTUALLY records for that uid+date. "Who is
// credited going forward" (a habit's CURRENT `assignedTo`, or the tapping uid)
// is a different question, and using it to decide what to REVERSE debits members
// who were never credited while stranding the credit of the member who was.
describe('resolveReversalSources', () => {
  const MIA = 'mia-uid';

  it('clamps to what the preferred member actually holds', () => {
    const h = habit({ completedBy: { [d(0)]: { [PAUL]: 2 } } });
    // Asking for 5 back can only take the 2 that are stored.
    expect(resolveReversalSources(h, PAUL, d(0), 5)).toEqual([{ memberId: PAUL, units: 2 }]);
    // Asking for fewer than stored takes only what was asked.
    expect(resolveReversalSources(h, PAUL, d(0), 1)).toEqual([{ memberId: PAUL, units: 1 }]);
  });

  it('does NOT spill a shortfall onto other members when the preferred uid holds some', () => {
    // Paul holds 1, Jen holds 3. Reversing 3 "Paul units" must take Paul's ONE
    // and stop — helping itself to Jen's would debit a member the caller never
    // named, for units she genuinely earned.
    const h = habit({ completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 3 } } });
    expect(resolveReversalSources(h, PAUL, d(0), 3)).toEqual([{ memberId: PAUL, units: 1 }]);
  });

  it('falls back to whoever DOES hold attribution when the preferred uid holds none', () => {
    // The reassignment case: the habit names Mia today, but Jen is the member
    // the completion was actually credited to, so the reversal comes out of Jen.
    const h = habit({ completedBy: { [d(0)]: { [JEN]: 1 } } });
    expect(resolveReversalSources(h, MIA, d(0), 1)).toEqual([{ memberId: JEN, units: 1 }]);
  });

  it('spends the fallback largest-count-first and stops at `units`', () => {
    const h = habit({ completedBy: { [d(0)]: { [JEN]: 1, [PAUL]: 3 } } });
    expect(resolveReversalSources(h, MIA, d(0), 4)).toEqual([
      { memberId: PAUL, units: 3 },
      { memberId: JEN, units: 1 },
    ]);
    // Bounded by the request, not by the stored total.
    expect(resolveReversalSources(h, MIA, d(0), 2)).toEqual([{ memberId: PAUL, units: 2 }]);
  });

  it('breaks equal-count ties deterministically by uid', () => {
    const h = habit({ completedBy: { [d(0)]: { [PAUL]: 1, [JEN]: 1 } } });
    // jen-uid sorts before paul-uid, so Jen is taken first — same answer every run.
    expect(resolveReversalSources(h, MIA, d(0), 1)).toEqual([{ memberId: JEN, units: 1 }]);
  });

  it('returns NOTHING for a fully grandfathered date (nobody holds attribution)', () => {
    // The transition-day rule: a completion recorded before member scoring
    // shipped has no member credit to take back, so deleting it must debit
    // nobody. The household/pool reversal is a separate, unchanged computation.
    const legacy = habit({ count: 1, completedDates: [d(0)] });
    expect(resolveReversalSources(legacy, PAUL, d(0), 1)).toEqual([]);
    expect(resolveReversalSources(legacy, JEN, d(0), 3)).toEqual([]);
  });

  it('treats a zero/negative residue node as absent on both the preferred and fallback paths', () => {
    // Decrements are unconditional increments, so a node can rest at 0 or dip
    // below it. `count <= 0` means ABSENT everywhere in this module.
    const residue = habit({ completedBy: { [d(0)]: { [PAUL]: 0, [JEN]: -1 } } });
    expect(resolveReversalSources(residue, PAUL, d(0), 1)).toEqual([]);
    expect(resolveReversalSources(residue, MIA, d(0), 1)).toEqual([]);
  });

  it('returns nothing for a non-positive request or an untouched date', () => {
    const h = habit({ completedBy: { [d(0)]: { [PAUL]: 2 } } });
    expect(resolveReversalSources(h, PAUL, d(0), 0)).toEqual([]);
    expect(resolveReversalSources(h, PAUL, d(0), -1)).toEqual([]);
    expect(resolveReversalSources(h, PAUL, d(1), 1)).toEqual([]);
  });
});

describe('habitAttribution — the two-member PAST day the day-editor picker writes', () => {
  // "Both of us" on a past incremental day writes TWO submission docs of one
  // unit each, so the day carries `{ count: 2, points: 20 }` in submission
  // totals AND two attributed units. Pinned as EQUALITIES so a future change to
  // either scorer trips this rather than drifting silently.
  const D = d(-4); // outside the fixture week, so no weekly bucket is involved
  const TODAY = d(2);

  const twoMemberDay = habit({
    count: 0,
    totalCount: 2,
    completedDates: [D],
    completedBy: { [D]: { [PAUL]: 1, [JEN]: 1 } },
  });
  const stored = new Map([[twoMemberDay.id, new Map([[D, { count: 2, points: 20 }]])]]);
  const storedForHabit = stored.get(twoMemberDay.id);

  it('agrees across all three scorers, with a zero grandfathering remainder', () => {
    // Each member earns a full award at their own 1.0x streak.
    expect(memberPointsForHabitOnDate(twoMemberDay, PAUL, D, TODAY)).toBe(10);
    expect(memberPointsForHabitOnDate(twoMemberDay, JEN, D, TODAY)).toBe(10);

    // The legacy per-day figure reconciles the two stored docs to +20…
    expect(pointsForHabitOnDate(twoMemberDay, D, TODAY, storedForHabit)).toBe(20);
    // …and the two member awards ABSORB the legacy unit rather than adding to
    // it (a past day counts as one legacy unit; 2 attributed units floor it).
    expect(unattributedPointsForHabitOnDate(twoMemberDay, D, TODAY, storedForHabit)).toBe(0);

    // household = Σ members + remainder = the calendar cell's own figure.
    expect(householdPointsForHabitOnDate(twoMemberDay, D, TODAY, storedForHabit)).toBe(20);
    expect(householdPointsForHabitOnDate(twoMemberDay, D, TODAY, storedForHabit)).toBe(
      pointsForHabitOnDate(twoMemberDay, D, TODAY, storedForHabit),
    );
  });

  it('is exactly the pool delta the write emitted — no login-time correction jump', () => {
    const before = habit({ count: 0, totalCount: 0, completedDates: [] });
    expect(householdPeriodPointsDelta(before, twoMemberDay, D, TODAY)).toBe(20);
  });
});
