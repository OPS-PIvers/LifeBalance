import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import type { Habit, Household, HouseholdMember, RewardRedemptionRecord } from '@/types/schema';
import {
  computePointsDriftReport,
  planPointsDriftApply,
  proposedDeltaFor,
  type DriftRow,
  type PointsDriftReport,
} from '@/utils/pointsDriftRepair';
import { REDEMPTION_HISTORY_LIMIT } from '@/utils/redemption';

// 🛡️ Every date below is an offset from the FIXTURE's OWN Monday, never from
// "today" — see habitAttribution.test.ts's own warning. A suite anchored on
// the real clock passes some weekdays and fails others once a UTC runner
// rolls the date. `today` is always injected explicitly below.
const MONDAY = format(startOfISOWeek(parseISO('2026-06-17')), 'yyyy-MM-dd');
const d = (n: number): string => format(addDays(parseISO(MONDAY), n), 'yyyy-MM-dd');
const TODAY = d(0);

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

const household = (overrides: Partial<Household> = {}): Household =>
  ({
    id: 'house1',
    name: 'The Test House',
    inviteCode: 'ABC123',
    members: [],
    accounts: [],
    rewardsInventory: [],
    coreTemplates: { expenses: [], buckets: [] },
    freezeBank: { current: 0, accrued: 0, lastMonth: '' },
    ...overrides,
  }) as Household;

const member = (uid: string, overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
  uid,
  displayName: uid,
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const redemption = (cost: number, id = 'r1'): RewardRedemptionRecord => ({
  id,
  rewardId: 'reward1',
  rewardTitle: 'Movie night',
  icon: '🎬',
  cost,
  redeemedByUid: PAUL,
  redeemedAt: `${MONDAY}T12:00:00.000Z`,
});

const rowFor = (report: PointsDriftReport, id: string): DriftRow => {
  const row = report.rows.find(r => r.id === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

describe('computePointsDriftReport — the hard constraint (pre-attribution history)', () => {
  it('marks every member cannot_determine and proposes no writes for a household with only pre-attribution history', () => {
    // A single legacy completion with NO completedBy at all — exactly the
    // shape of every habit recorded before per-member attribution shipped.
    const h = habit({ completedDates: [TODAY], count: 1, scoringType: 'threshold' });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } }); // matches the legacy recompute exactly
    const members = [
      member(PAUL, { points: { daily: 0, weekly: 0, total: 37 } }), // legitimate pre-existing history
      member(JEN, { points: { daily: 0, weekly: 0, total: 12 } }),
    ];

    const report = computePointsDriftReport(hh, members, [h], TODAY);

    expect(report.attributionStartDate).toBeNull();
    expect(rowFor(report, PAUL).verdict.kind).toBe('cannot_determine');
    expect(rowFor(report, JEN).verdict.kind).toBe('cannot_determine');
    // The household itself IS determinable (legacy fallback covers it) and
    // happens to match here, so it reports looks_correct — but the point of
    // this test is that NOTHING gets proposed for writing.
    expect(planPointsDriftApply([report])).toEqual([]);
  });
});

describe('computePointsDriftReport — determinable drift', () => {
  it('proposes the exact delta for a member under-credited in the attributed era', () => {
    // Both PAUL and JEN complete a shared habit the same day — the household
    // pool correctly banks both awards, but JEN's own points.total was never
    // written (bug 1: cross-member award drop).
    const h = habit({
      completedDates: [TODAY],
      count: 1,
      completedBy: { [TODAY]: { [PAUL]: 1, [JEN]: 1 } },
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 20 } }); // pool got BOTH awards (10 + 10)
    const members = [
      member(PAUL, { points: { daily: 0, weekly: 0, total: 10 } }), // correctly credited
      member(JEN, { points: { daily: 0, weekly: 0, total: 0 } }), // award never written
    ];

    const report = computePointsDriftReport(hh, members, [h], TODAY);

    expect(rowFor(report, 'house1').verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, PAUL).verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, JEN).verdict).toEqual({ kind: 'under_credited', amount: 10 });

    const writes = planPointsDriftApply([report]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      scope: 'member',
      memberUid: JEN,
      previousTotal: 0,
      newTotal: 10,
      delta: 10,
    });
  });

  it('proposes the exact delta for a household over-debited by a known amount', () => {
    const h = habit({
      completedDates: [TODAY],
      count: 1,
      completedBy: { [TODAY]: { [PAUL]: 1 } },
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 3 } }); // should be 10; pool over-debited by 7
    const members = [member(PAUL, { points: { daily: 0, weekly: 0, total: 10 } })];

    const report = computePointsDriftReport(hh, members, [h], TODAY);

    expect(rowFor(report, PAUL).verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, 'house1').verdict).toEqual({ kind: 'over_debited', amount: 7 });

    const writes = planPointsDriftApply([report]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      scope: 'household',
      memberUid: undefined,
      previousTotal: 3,
      newTotal: 10,
      delta: 7,
    });
  });

  it('proposes no writes for a household that is already correct', () => {
    const h = habit({
      completedDates: [TODAY],
      count: 1,
      completedBy: { [TODAY]: { [PAUL]: 1 } },
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    const members = [member(PAUL, { points: { daily: 0, weekly: 0, total: 10 } })];

    const report = computePointsDriftReport(hh, members, [h], TODAY);

    expect(rowFor(report, 'house1').verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, PAUL).verdict).toEqual({ kind: 'looks_correct' });
    expect(planPointsDriftApply([report])).toEqual([]);
  });

  it('accounts for a KNOWN (not-truncated) redemption history exactly, rather than flagging phantom drift', () => {
    const h = habit({
      completedDates: [TODAY],
      count: 1,
      completedBy: { [TODAY]: { [PAUL]: 1 } },
    });
    // Recompute says 10; 4 points were legitimately spent on a redemption, so
    // the stored total of 6 is CORRECT, not drift.
    const hh = household({
      points: { daily: 0, weekly: 0, total: 6 },
      redemptionHistory: [redemption(4)],
    });
    const members = [member(PAUL, { points: { daily: 0, weekly: 0, total: 10 } })];

    const report = computePointsDriftReport(hh, members, [h], TODAY);

    expect(rowFor(report, 'house1').verdict).toEqual({ kind: 'looks_correct' });
  });
});

describe('computePointsDriftReport — Habit.creditMode: "household" (Plan 1165)', () => {
  // A household-credit completion writes NO completedBy entry at all — it pays
  // the pool via the same unattributed path a pre-attribution legacy
  // completion uses, and credits no member (see isHouseholdCreditHabit /
  // unattributedPointsForHabitOnDate in utils/habitAttribution.ts). This must
  // fold into the household recompute correctly and must NOT be mistaken for
  // per-member attribution or corrupt attributionStartDate.
  it('folds a household-credit habit into the household total without crediting any member', () => {
    const creditHabit = habit({
      id: 'dinner',
      creditMode: 'household',
      basePoints: 15,
      completedDates: [TODAY],
      count: 1,
      // No completedBy — a household-credit completion never writes one.
    });
    const sharedHabit = habit({
      id: 'run',
      completedDates: [TODAY],
      count: 1,
      completedBy: { [TODAY]: { [PAUL]: 1 } },
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 25 } }); // 15 (household) + 10 (PAUL's run)
    const members = [
      member(PAUL, { points: { daily: 0, weekly: 0, total: 10 } }),
      member(JEN, { points: { daily: 0, weekly: 0, total: 0 } }), // JEN touched nothing
    ];

    const report = computePointsDriftReport(hh, members, [creditHabit, sharedHabit], TODAY);

    // attributionStartDate is driven by the SHARED habit's completedBy — the
    // household-credit habit contributes no completedBy entry and must not
    // suppress it.
    expect(report.attributionStartDate).toBe(TODAY);
    expect(rowFor(report, 'house1').verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, PAUL).verdict).toEqual({ kind: 'looks_correct' });
    expect(rowFor(report, JEN).verdict).toEqual({ kind: 'looks_correct' });
    expect(planPointsDriftApply([report])).toEqual([]);
  });

  it('a household with ONLY household-credit habits has no attribution data — every member row is cannot_determine', () => {
    const creditHabit = habit({
      id: 'dinner',
      creditMode: 'household',
      completedDates: [TODAY],
      count: 1,
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } }); // matches the legacy recompute
    const members = [member(PAUL, { points: { daily: 0, weekly: 0, total: 50 } })]; // legitimate pre-existing history

    const report = computePointsDriftReport(hh, members, [creditHabit], TODAY);

    expect(report.attributionStartDate).toBeNull();
    expect(rowFor(report, PAUL).verdict.kind).toBe('cannot_determine');
    expect(planPointsDriftApply([report])).toEqual([]);
  });
});

describe('computePointsDriftReport — confounds are cannot_determine, never guessed', () => {
  const attributedHabit = habit({
    completedDates: [TODAY],
    count: 1,
    completedBy: { [TODAY]: { [PAUL]: 1 } },
  });

  it('flags the household when redemptionHistory is at the cap (possible truncation)', () => {
    const maxedHistory = Array.from({ length: REDEMPTION_HISTORY_LIMIT }, (_, i) =>
      redemption(1, `r${i}`)
    );
    const hh = household({
      points: { daily: 0, weekly: 0, total: 6 },
      redemptionHistory: maxedHistory,
    });
    const members = [member(PAUL)];

    const report = computePointsDriftReport(hh, members, [attributedHabit], TODAY);
    const row = rowFor(report, 'house1');
    expect(row.verdict.kind).toBe('cannot_determine');
    expect(row.recomputedTotal).toBeNull();
  });

  it('flags the household when any habit is submission-tracked', () => {
    const tracked = habit({ ...attributedHabit, hasSubmissionTracking: true });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    const members = [member(PAUL)];

    const report = computePointsDriftReport(hh, members, [tracked], TODAY);
    expect(rowFor(report, 'house1').verdict.kind).toBe('cannot_determine');
  });

  it('flags a managed-kid member regardless of everything else lining up', () => {
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    const kid = member(JEN, { isManaged: true, points: { daily: 0, weekly: 0, total: 999 } });

    const report = computePointsDriftReport(hh, [kid], [attributedHabit], TODAY);
    const row = rowFor(report, JEN);
    expect(row.verdict.kind).toBe('cannot_determine');
    expect(row.recomputedTotal).toBeNull();
  });

  it('flags a member who holds an assigned habit (chore points are unmodeled)', () => {
    const chore = habit({
      id: 'chore1',
      assignedTo: PAUL,
      completedDates: [TODAY],
      count: 1,
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    const members = [member(PAUL)];

    const report = computePointsDriftReport(hh, members, [attributedHabit, chore], TODAY);
    expect(rowFor(report, PAUL).verdict.kind).toBe('cannot_determine');
  });

  it('flags every member when a SHARED habit is submission-tracked, even one they never touched', () => {
    const trackedShared = habit({
      id: 'h2',
      hasSubmissionTracking: true,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { [JEN]: 1 } },
    });
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    const members = [member(PAUL), member(JEN)];

    const report = computePointsDriftReport(hh, members, [attributedHabit, trackedShared], TODAY);
    expect(rowFor(report, PAUL).verdict.kind).toBe('cannot_determine');
    expect(rowFor(report, JEN).verdict.kind).toBe('cannot_determine');
  });

  it('never proposes a downward correction — a stored total ABOVE the recompute is cannot_determine, not a fix', () => {
    const hh = household({ points: { daily: 0, weekly: 0, total: 10 } });
    // PAUL is stored with MORE than the habit recompute justifies.
    const members = [member(PAUL, { points: { daily: 0, weekly: 0, total: 25 } })];

    const report = computePointsDriftReport(hh, members, [attributedHabit], TODAY);
    const row = rowFor(report, PAUL);
    expect(row.verdict.kind).toBe('cannot_determine');
    expect(row.recomputedTotal).toBe(10); // still surfaced for transparency
    expect(planPointsDriftApply([report])).toEqual([]);
  });
});

describe('computePointsDriftReport — attributionStartDate', () => {
  it('is the earliest attributed date across every habit', () => {
    const early = habit({ id: 'a', completedBy: { [d(-5)]: { [PAUL]: 1 } } });
    const late = habit({ id: 'b', completedBy: { [d(-2)]: { [PAUL]: 1 } } });
    const hh = household();
    const report = computePointsDriftReport(hh, [member(PAUL)], [early, late], TODAY);
    expect(report.attributionStartDate).toBe(d(-5));
  });

  it('ignores a zero/negative residue entry (see completedBy write discipline)', () => {
    const residueOnly = habit({ completedBy: { [d(-5)]: { [PAUL]: 0 } } });
    const hh = household();
    const report = computePointsDriftReport(hh, [member(PAUL)], [residueOnly], TODAY);
    expect(report.attributionStartDate).toBeNull();
  });
});

describe('proposedDeltaFor', () => {
  it('reads the amount off a determinable verdict, and 0 off anything else', () => {
    expect(proposedDeltaFor({ kind: 'over_debited', amount: 7 })).toBe(7);
    expect(proposedDeltaFor({ kind: 'under_credited', amount: 3 })).toBe(3);
    expect(proposedDeltaFor({ kind: 'looks_correct' })).toBe(0);
    expect(proposedDeltaFor({ kind: 'cannot_determine', reason: 'x' })).toBe(0);
  });
});

describe('planPointsDriftApply — the negative-value guard', () => {
  it('floors newTotal at zero even when the stored value was already negative', () => {
    const report: PointsDriftReport = {
      householdId: 'house1',
      householdName: 'The Test House',
      attributionStartDate: TODAY,
      rows: [
        {
          scope: 'member',
          id: PAUL,
          label: 'Paul',
          storedTotal: -100,
          recomputedTotal: -90,
          verdict: { kind: 'under_credited', amount: 10 },
        },
      ],
    };

    const writes = planPointsDriftApply([report]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.newTotal).toBe(0); // NOT -90
    expect(writes[0]!.newTotal).toBeGreaterThanOrEqual(0);
  });

  it('skips a row whose clamp would be a no-op', () => {
    const report: PointsDriftReport = {
      householdId: 'house1',
      householdName: 'The Test House',
      attributionStartDate: TODAY,
      rows: [
        {
          scope: 'household',
          id: 'house1',
          label: 'Household',
          storedTotal: 0,
          recomputedTotal: 0,
          verdict: { kind: 'looks_correct' },
        },
      ],
    };
    expect(planPointsDriftApply([report])).toEqual([]);
  });
});
