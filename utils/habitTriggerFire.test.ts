import { describe, it, expect } from 'vitest';
import { format, parseISO, startOfWeek } from 'date-fns';
import {
  computeBackdatedHabitFire,
  computeHabitTriggerFire,
  computeHabitTriggerReverse,
} from '@/utils/habitTriggerFire';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Habit } from '@/types/schema';

const today = getLocalDateString();
const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
const twoDaysAgo = getLocalDateString(new Date(Date.now() - 2 * 86400000));
const threeDaysAgo = getLocalDateString(new Date(Date.now() - 3 * 86400000));

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    title: 'Test habit',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeHabitTriggerFire', () => {
  it('fires a fresh threshold habit like one manual tap (points + completedDate)', () => {
    const delta = computeHabitTriggerFire(makeHabit(), 'up');
    expect(delta).not.toBeNull();
    expect(delta!.count).toBe(1);
    expect(delta!.totalCount).toBe(1);
    expect(delta!.addedDate).toBe(today);
    expect(delta!.removedDate).toBeUndefined();
    expect(delta!.pointsChange).toBe(10);
    expect(delta!.multiplier).toBe(1.0);
  });

  it('applies the streak multiplier on the prospective streak', () => {
    // Completed the previous two days; firing today makes a 3-day streak → 2.0x.
    const d1 = getLocalDateString(new Date(Date.now() - 86400000));
    const d2 = getLocalDateString(new Date(Date.now() - 2 * 86400000));
    const habit = makeHabit({ completedDates: [d1, d2], streakDays: 2 });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.multiplier).toBe(2.0);
    expect(delta!.pointsChange).toBe(20);
  });

  it('reverses a fired habit (down toggle) removing the date and points', () => {
    const habit = makeHabit({ count: 1, totalCount: 1, completedDates: [today], streakDays: 1 });
    const delta = computeHabitTriggerFire(habit, 'down');
    expect(delta).not.toBeNull();
    expect(delta!.count).toBe(0);
    expect(delta!.removedDate).toBe(today);
    expect(delta!.addedDate).toBeUndefined();
    expect(delta!.pointsChange).toBe(-10);
  });

  it('returns null when reversing a habit already at count 0', () => {
    expect(computeHabitTriggerFire(makeHabit(), 'down')).toBeNull();
  });

  it('debits points for a negative incremental habit fire', () => {
    const habit = makeHabit({ type: 'negative', scoringType: 'incremental', basePoints: 10 });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.pointsChange).toBe(-10);
  });

  it('exposes increment() deltas measured against the real stored counter', () => {
    // Fresh fire: count 0→1, totalCount 0→1, not a reset.
    const fresh = computeHabitTriggerFire(makeHabit(), 'up');
    expect(fresh!.countDelta).toBe(1);
    expect(fresh!.totalCountDelta).toBe(1);
    expect(fresh!.resetCount).toBe(false);

    // A non-stale habit already at count 2 in-period: delta stays +1 relative to
    // the stored counter (so an increment() write lands on 3, not an absolute 1).
    const midPeriod = computeHabitTriggerFire(
      makeHabit({ count: 2, totalCount: 2, completedDates: [today], streakDays: 1 }),
      'up',
    );
    expect(midPeriod!.countDelta).toBe(1);
    expect(midPeriod!.resetCount).toBe(false);
  });

  it('lazy-resets a stale habit before an up fire (counter starts at 0)', () => {
    // lastUpdated far in the past → stale; the counter should be treated as 0,
    // so firing yields count 1 (not count+1 on top of a stale counter).
    const habit = makeHabit({
      count: 5,
      totalCount: 5,
      lastUpdated: '2020-01-01T00:00:00.000Z',
    });
    const delta = computeHabitTriggerFire(habit, 'up');
    expect(delta!.count).toBe(1);
    // The reset must be flagged so the caller writes `count` ABSOLUTELY (0+delta)
    // rather than increment()-ing the prior-period stored value of 5.
    expect(delta!.resetCount).toBe(true);
    // totalCount is a lifetime counter (never reset) → plain +1 increment.
    expect(delta!.totalCountDelta).toBe(1);
  });

  it('does not fire (up) an archived habit', () => {
    const habit = makeHabit({ archivedAt: new Date().toISOString() });
    expect(computeHabitTriggerFire(habit, 'up')).toBeNull();
  });

  it('still allows reversing (down) an archived habit', () => {
    const habit = makeHabit({
      archivedAt: new Date().toISOString(),
      count: 1,
      totalCount: 1,
      completedDates: [today],
      streakDays: 1,
    });
    const delta = computeHabitTriggerFire(habit, 'down');
    expect(delta).not.toBeNull();
    expect(delta!.removedDate).toBe(today);
  });
});

describe('computeHabitTriggerReverse', () => {
  it('same-period restore is identical to the manual same-day down toggle', () => {
    const habit = makeHabit({ count: 1, totalCount: 1, completedDates: [today], streakDays: 1 });
    const reverse = computeHabitTriggerReverse(habit, today, today);
    const downToggle = computeHabitTriggerFire(habit, 'down');
    expect(reverse).toEqual(downToggle);
    expect(reverse!.removedDate).toBe(today);
    expect(reverse!.pointsChange).toBe(-10);
    expect(reverse!.count).toBe(0);
  });

  it('prior-day restore removes THAT date and debits its points, leaving the live counter untouched', () => {
    // Completed yesterday; today the counter was reset to 0. Restoring the
    // yesterday to-do must strip yesterday (not today) and debit yesterday's
    // points, without corrupting today's count.
    const habit = makeHabit({
      count: 0,
      totalCount: 1,
      completedDates: [yesterday],
      streakDays: 0,
    });
    const delta = computeHabitTriggerReverse(habit, yesterday, today);
    expect(delta).not.toBeNull();
    expect(delta!.removedDate).toBe(yesterday);
    expect(delta!.addedDate).toBeUndefined();
    expect(delta!.count).toBe(0); // untouched — belongs to the current period
    expect(delta!.countDelta).toBe(0); // live counter must not move
    expect(delta!.totalCount).toBe(0); // one lifetime completion disavowed
    expect(delta!.totalCountDelta).toBe(-1); // -1 lifetime completion
    expect(delta!.resetCount).toBe(false);
    expect(delta!.pointsChange).toBe(-10); // multiplier 1.0 on a lone completion
  });

  it('floors the lifetime-counter delta so a 0 total is never driven negative', () => {
    const habit = makeHabit({ count: 0, totalCount: 0, completedDates: [yesterday] });
    const delta = computeHabitTriggerReverse(habit, yesterday, today);
    expect(delta!.totalCount).toBe(0);
    expect(delta!.totalCountDelta).toBe(0);
  });

  it('debits the HISTORICAL streak multiplier on a prior-day restore', () => {
    // A 3-day streak ended yesterday (threeDaysAgo, twoDaysAgo, yesterday) → the
    // fire on yesterday earned 10 × 2.0 = 20; the reversal must debit exactly 20.
    const habit = makeHabit({
      count: 0,
      totalCount: 3,
      completedDates: [threeDaysAgo, twoDaysAgo, yesterday],
      streakDays: 0,
    });
    const delta = computeHabitTriggerReverse(habit, yesterday, today);
    expect(delta!.pointsChange).toBe(-20);
    expect(delta!.removedDate).toBe(yesterday);
    expect(delta!.count).toBe(0);
  });

  it('returns null when the completion date is no longer present (already restored)', () => {
    const habit = makeHabit({ count: 0, totalCount: 0, completedDates: [] });
    expect(computeHabitTriggerReverse(habit, yesterday, today)).toBeNull();
  });
});

describe('computeBackdatedHabitFire', () => {
  // The canonical scenario: a charge from four days ago, reviewed today.
  const fourDaysAgo = getLocalDateString(new Date(Date.now() - 4 * 86400000));

  it('credits the TRANSACTION date, not today — the bug this fixes', () => {
    const delta = computeBackdatedHabitFire(makeHabit(), fourDaysAgo, today);
    expect(delta).not.toBeNull();
    expect(delta!.addedDate).toBe(fourDaysAgo);
    expect(delta!.addedDate).not.toBe(today);
  });

  it('leaves the live counter untouched for a PAST-period fire', () => {
    // The stored counter describes today; crediting a past day must not move it.
    const habit = makeHabit({ count: 3, totalCount: 7 });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(delta.inCurrentPeriod).toBe(false);
    expect(delta.countDelta).toBe(0);
    expect(delta.resetCount).toBe(false);
    // Lifetime counter is period-independent.
    expect(delta.totalCountDelta).toBe(1);
  });

  it('increments the live counter for a SAME-DAY fire', () => {
    const delta = computeBackdatedHabitFire(makeHabit({ count: 2 }), today, today)!;
    expect(delta.inCurrentPeriod).toBe(true);
    expect(delta.countDelta).toBe(1);
  });

  it('lazy-resets a stale habit on a same-day fire (absolute count, not increment)', () => {
    const stale = makeHabit({ count: 5, lastUpdated: '2020-01-01T00:00:00.000Z' });
    const delta = computeBackdatedHabitFire(stale, today, today)!;
    expect(delta.resetCount).toBe(true);
    expect(delta.count).toBe(1);
  });

  it('gates the points buckets by date: past fire credits total only', () => {
    const delta = computeBackdatedHabitFire(makeHabit(), fourDaysAgo, today)!;
    expect(delta.pointsDelta.total).toBe(10);
    expect(delta.pointsDelta.daily).toBe(0);
  });

  it('credits all three buckets for a same-day fire', () => {
    const delta = computeBackdatedHabitFire(makeHabit(), today, today)!;
    expect(delta.pointsDelta).toEqual({ daily: 10, weekly: 10, total: 10 });
  });

  it('scores with the multiplier that applied ON the fire date, not the current one', () => {
    // Completed the two days before the fire date → firing it makes a 3-day
    // streak ending THEN, so 2.0x. Later completions must not change this.
    const d1 = getLocalDateString(new Date(Date.now() - 5 * 86400000));
    const d2 = getLocalDateString(new Date(Date.now() - 6 * 86400000));
    const habit = makeHabit({ completedDates: [d1, d2] });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(delta.multiplier).toBe(2.0);
    expect(delta.streakAtFireDate).toBe(3);
    expect(delta.pointsEarned).toBe(20);
  });

  it('debits points for a NEGATIVE habit', () => {
    const habit = makeHabit({ type: 'negative', scoringType: 'incremental' });
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today)!.pointsEarned).toBe(-10);
  });

  it('un-freezes a day the fire proves was completed, and reports it', () => {
    const habit = makeHabit({ frozenDates: [fourDaysAgo] });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(delta.unfrozenDate).toBe(fourDaysAgo);
    expect(delta.addedDate).toBe(fourDaysAgo);
  });

  it('reports no un-freeze when the fire date was never frozen', () => {
    expect(computeBackdatedHabitFire(makeHabit(), fourDaysAgo, today)!.unfrozenDate).toBeUndefined();
  });

  it('returns null for an ARCHIVED habit', () => {
    const habit = makeHabit({ archivedAt: '2026-01-01T00:00:00.000Z' });
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today)).toBeNull();
  });

  it('returns null beyond the back-date window and for future dates', () => {
    const ancient = getLocalDateString(new Date(Date.now() - 45 * 86400000));
    const future = getLocalDateString(new Date(Date.now() + 3 * 86400000));
    expect(computeBackdatedHabitFire(makeHabit(), ancient, today)).toBeNull();
    expect(computeBackdatedHabitFire(makeHabit(), future, today)).toBeNull();
  });

  it('does not mark a THRESHOLD date complete until its own period hits the target', () => {
    const habit = makeHabit({ targetCount: 3 });
    // Only one prior unit recorded for that past period → 2 of 3, not complete.
    const partial = computeBackdatedHabitFire(habit, fourDaysAgo, today, 1)!;
    expect(partial.addedDate).toBeUndefined();
    expect(partial.pointsEarned).toBe(0);
    // A third unit crosses the target and scores once.
    const crossing = computeBackdatedHabitFire(habit, fourDaysAgo, today, 2)!;
    expect(crossing.addedDate).toBe(fourDaysAgo);
    expect(crossing.pointsEarned).toBe(10);
  });

  it('scores an INCREMENTAL habit on every unit regardless of prior count', () => {
    const habit = makeHabit({ scoringType: 'incremental', targetCount: 1 });
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today, 5)!.pointsEarned).toBe(10);
  });

  it('does not re-score a period already credited', () => {
    // The date is already a completion (logged by hand, toggle path). A second
    // threshold fire adds the unit but must not pay for the period twice.
    const habit = makeHabit({ completedDates: [fourDaysAgo] });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(delta.addedDate).toBeUndefined();
    expect(delta.pointsEarned).toBe(0);
    expect(delta.totalCountDelta).toBe(1);
  });

  it('anchors a WEEKLY habit to its ISO week for the live-counter decision', () => {
    // Monday of this ISO week is in the CURRENT period for a weekly habit even
    // though it is not today, so the live counter does move.
    const habit = makeHabit({ period: 'weekly' });
    const monday = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const delta = computeBackdatedHabitFire(habit, monday, today)!;
    expect(delta.inCurrentPeriod).toBe(true);
    expect(delta.countDelta).toBe(1);
  });
});

// Stage 6 — `Household.freezeMode: 'per_member'`: each adult holds their own
// token bank (`freezeBanksByMember`) and their own frozen dates
// (`Habit.frozenDatesBy`, date → uid[]). The shared `frozenDates` is not in use.
describe('computeBackdatedHabitFire — per-member freeze mode', () => {
  const fourDaysAgo = getLocalDateString(new Date(Date.now() - 4 * 86400000));
  const ALICE = 'uid-alice';
  const BOB = 'uid-bob';
  const perMember = (memberId: string) => ({ memberId, freezeMode: 'per_member' as const });

  it('reports the un-freeze as unfrozenDateFor, naming the ACTING member', () => {
    const habit = makeHabit({ frozenDatesBy: { [fourDaysAgo]: [ALICE] } });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(ALICE))!;
    expect(delta.unfrozenDateFor).toEqual({ date: fourDaysAgo, memberId: ALICE });
    expect(delta.addedDate).toBe(fourDaysAgo);
    // NEVER the shared field: that would send the caller to `frozenDates` and
    // the shared bank, which this mode does not use.
    expect(delta.unfrozenDate).toBeUndefined();
  });

  it('does NOT un-freeze when a DIFFERENT member holds the frozen date', () => {
    const habit = makeHabit({ frozenDatesBy: { [fourDaysAgo]: [BOB] } });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(ALICE))!;
    expect(delta.unfrozenDateFor).toBeUndefined();
    expect(delta.unfrozenDate).toBeUndefined();
    // The completion still lands — only the freeze is someone else's business.
    expect(delta.addedDate).toBe(fourDaysAgo);
  });

  it('ignores the SHARED frozenDates in per-member mode', () => {
    // A legacy shared freeze left over from before the mode was flipped. The
    // shared bank is not in use, so nothing is un-frozen or refunded from it.
    const habit = makeHabit({ frozenDates: [fourDaysAgo] });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(ALICE))!;
    expect(delta.unfrozenDate).toBeUndefined();
    expect(delta.unfrozenDateFor).toBeUndefined();
  });

  it('scores the multiplier off the MEMBER’s own frozen bridge, not the habit-level one', () => {
    // Alice completed 6/5/4 days ago, MISSED 3 days ago (her own token froze
    // it), and completed 2 days ago and yesterday. Firing 3 days ago... no —
    // the interesting case is firing a date whose backward walk CROSSES her
    // personal freeze.
    //
    // Layout (oldest → newest), firing `fourDaysAgo`:
    //   6d ago: completed
    //   5d ago: MISSED, frozen for Alice only (frozenDatesBy)
    //   4d ago: the fire date
    // Habit-level: the 5-day gap is not bridged → streak ending on 4d ago = 1
    //   → multiplier 1.0 → 10 pts.
    // Alice-bridged: 6d ago + [bridge] + 4d ago → streak 2... still 1.0x, so
    // stretch it one further back to cross the 3-day threshold.
    const d5 = getLocalDateString(new Date(Date.now() - 5 * 86400000));
    const d6 = getLocalDateString(new Date(Date.now() - 6 * 86400000));
    const d7 = getLocalDateString(new Date(Date.now() - 7 * 86400000));
    const habit = makeHabit({
      completedDates: [d7, d6],
      frozenDatesBy: { [d5]: [ALICE] },
    });

    // Habit-level (today's blind behaviour): d5 breaks the chain, so the fire
    // sees a streak of 1 and pays 10.
    const blind = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(blind.streakAtFireDate).toBe(1);
    expect(blind.multiplier).toBe(1.0);
    expect(blind.pointsEarned).toBe(10);

    // Alice's own token bridges d5: d7 + d6 + (frozen d5) + the fire = 3 → 2.0x.
    const aware = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(ALICE))!;
    expect(aware.streakAtFireDate).toBe(3);
    expect(aware.multiplier).toBe(2.0);
    expect(aware.pointsEarned).toBe(20);

    // ...and NOT for Bob, who never spent a token on d5.
    const bob = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(BOB))!;
    expect(bob.streakAtFireDate).toBe(1);
    expect(bob.pointsEarned).toBe(10);
  });

  it('leaves streakDays HABIT-LEVEL — a personal token never inflates the flame', () => {
    // Same layout as above, fired onto TODAY so the current streak is live.
    const yesterdayD = getLocalDateString(new Date(Date.now() - 86400000));
    const habit = makeHabit({
      completedDates: [threeDaysAgo],
      frozenDatesBy: { [twoDaysAgo]: [ALICE], [yesterdayD]: [ALICE] },
    });
    const blind = computeBackdatedHabitFire(habit, today, today)!;
    const aware = computeBackdatedHabitFire(habit, today, today, 0, perMember(ALICE))!;
    // The multiplier IS member-aware...
    expect(aware.streakAtFireDate).toBeGreaterThan(blind.streakAtFireDate);
    // ...but the habit doc's flame is not (matching applyPerMember, which
    // deliberately never writes streakDays).
    expect(aware.streakDays).toBe(blind.streakDays);
  });

  it('a shared mode with a memberId is byte-identical to passing no options at all', () => {
    // The regression fence: `freezeMode` absent, 'shared' and 'freeze_both' must
    // every one of them produce the exact pre-stage-6 delta.
    const habit = makeHabit({
      frozenDates: [fourDaysAgo],
      frozenDatesBy: { [fourDaysAgo]: [ALICE] },
      completedDates: [threeDaysAgo],
    });
    const baseline = computeBackdatedHabitFire(habit, fourDaysAgo, today)!;
    expect(baseline.unfrozenDate).toBe(fourDaysAgo);
    expect(baseline.unfrozenDateFor).toBeUndefined();

    for (const freezeMode of ['shared', 'freeze_both'] as const) {
      expect(computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, { memberId: ALICE, freezeMode }))
        .toEqual(baseline);
    }
    // A memberId with no mode, and a mode with no memberId, both stay shared.
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, { memberId: ALICE })).toEqual(baseline);
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, { freezeMode: 'per_member' })).toEqual(baseline);
    expect(computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, {})).toEqual(baseline);
  });

  it('never sets unfrozenDateFor when the fire does not newly complete the date', () => {
    // Already completed → no new completion, so nothing to un-freeze (the same
    // gate the shared path uses).
    const habit = makeHabit({
      completedDates: [fourDaysAgo],
      frozenDatesBy: { [fourDaysAgo]: [ALICE] },
    });
    const delta = computeBackdatedHabitFire(habit, fourDaysAgo, today, 0, perMember(ALICE))!;
    expect(delta.addedDate).toBeUndefined();
    expect(delta.unfrozenDateFor).toBeUndefined();
  });
});
