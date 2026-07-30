import { describe, it, expect } from 'vitest';
import {
  selectAutoFreezeCandidates,
  selectMemberAutoFreezeCandidates,
  FREEZE_MAX_TOKENS,
} from './freezeBank';
import { Habit } from '@/types/schema';

// Plan 25 — pure candidate selection for the midnight/login auto-apply pass.
// Fixed calendar: "today" is 2026-07-09 (Thu); yesterday = 2026-07-08.

const TODAY = '2026-07-09';
const YESTERDAY = '2026-07-08';

const habit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h1',
    title: 'Test Habit',
    category: 'Health',
    count: 0,
    totalCount: 0,
    targetCount: 1,
    basePoints: 10,
    scoringType: 'threshold',
    type: 'positive',
    period: 'daily',
    // A 3-day streak ending the day before yesterday; yesterday missed.
    completedDates: ['2026-07-05', '2026-07-06', '2026-07-07'],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  } as Habit);

describe('FREEZE_MAX_TOKENS', () => {
  it('is the fixed v1 stock of 2', () => {
    expect(FREEZE_MAX_TOKENS).toBe(2);
  });
});

describe('selectAutoFreezeCandidates', () => {
  it('selects a positive daily habit whose 3-day streak would break', () => {
    const result = selectAutoFreezeCandidates([habit()], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.habit.id).toBe('h1');
    expect(result[0]!.protectedStreak).toBe(3);
  });

  it('skips habits below the 3-completed-day protection threshold', () => {
    const short = habit({ completedDates: ['2026-07-06', '2026-07-07'] });
    expect(selectAutoFreezeCandidates([short], TODAY)).toEqual([]);
  });

  it('skips a habit that completed yesterday (nothing to protect)', () => {
    const done = habit({
      completedDates: ['2026-07-05', '2026-07-06', '2026-07-07', YESTERDAY],
    });
    expect(selectAutoFreezeCandidates([done], TODAY)).toEqual([]);
  });

  it('is idempotent: a habit already frozen yesterday is not re-selected', () => {
    const frozen = habit({ frozenDates: [YESTERDAY] });
    expect(selectAutoFreezeCandidates([frozen], TODAY)).toEqual([]);
  });

  it('skips a paused habit (F-HABITS-01: a planned break never burns a token)', () => {
    const paused = habit({ pausedUntil: '2026-07-20' }); // pausedUntil >= TODAY
    expect(selectAutoFreezeCandidates([paused], TODAY)).toEqual([]);
    // A pause that has already elapsed no longer excludes it.
    const expired = habit({ pausedUntil: '2026-07-01' });
    expect(selectAutoFreezeCandidates([expired], TODAY)).toHaveLength(1);
  });

  it('skips negative and weekly habits', () => {
    const negative = habit({ id: 'neg', type: 'negative' });
    const weekly = habit({ id: 'wk', period: 'weekly' });
    expect(selectAutoFreezeCandidates([negative, weekly], TODAY)).toEqual([]);
  });

  it('skips a habit with no completion history (nothing to protect)', () => {
    expect(selectAutoFreezeCandidates([habit({ completedDates: [] })], TODAY)).toEqual([]);
  });

  it('supports consecutive-night freezes: night 2 bridges night 1\'s frozen day', () => {
    // Completed 07-04..07-06 (3 days); 07-07 was frozen last night; 07-08
    // missed again → the prospective streak bridges BOTH frozen days back to
    // the completed run.
    const h = habit({
      completedDates: ['2026-07-04', '2026-07-05', '2026-07-06'],
      frozenDates: ['2026-07-07'],
    });
    const result = selectAutoFreezeCandidates([h], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.protectedStreak).toBe(3);
  });

  it('does not use the stored streakDays field (robust to a prior midnight reset)', () => {
    // streakDays already collapsed to 0 by the habit reset — the prospective
    // streak is derived from completedDates, so the habit is still protected.
    const result = selectAutoFreezeCandidates([habit({ streakDays: 0 })], TODAY);
    expect(result).toHaveLength(1);
  });

  it('orders candidates deterministically: highest protected streak first, then id', () => {
    const five = habit({
      id: 'b-five',
      completedDates: ['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'],
    });
    const three = habit({ id: 'a-three' });
    const threeToo = habit({ id: 'z-three' });

    const result = selectAutoFreezeCandidates([threeToo, three, five], TODAY);
    expect(result.map(c => c.habit.id)).toEqual(['b-five', 'a-three', 'z-three']);
  });
});

// ---------------------------------------------------------------------------
// Stage 6 — per-member candidate selection (`freezeMode: 'per_member'`).
// Same fixed calendar; attribution lives in `completedBy`.
// ---------------------------------------------------------------------------

const PAUL = 'uid-paul';
const JEN = 'uid-jen';

/** `completedBy` giving every uid in `uids` one completion on each of `dates`. */
const attributed = (dates: string[], uids: string[]) =>
  Object.fromEntries(dates.map(d => [d, Object.fromEntries(uids.map(u => [u, 1]))]));

describe('selectMemberAutoFreezeCandidates', () => {
  it('selects only the member whose own 3-day chain would break', () => {
    // Paul completed Sun-Tue and missed yesterday; Jen also did yesterday.
    const h = habit({
      completedDates: ['2026-07-05', '2026-07-06', '2026-07-07', YESTERDAY],
      completedBy: {
        ...attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL, JEN]),
        [YESTERDAY]: { [JEN]: 1 },
      },
    });

    const result = selectMemberAutoFreezeCandidates([h], [PAUL, JEN], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.memberId).toBe(PAUL);
    expect(result[0]!.protectedStreak).toBe(3);
  });

  it('ignores completedDates: a household completion is not the member\'s own', () => {
    // The habit "was completed" yesterday (Jen did it) so the SHARED selector
    // sees nothing to protect — but Paul's own chain still broke.
    const h = habit({
      completedDates: ['2026-07-05', '2026-07-06', '2026-07-07', YESTERDAY],
      completedBy: {
        ...attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL]),
        [YESTERDAY]: { [JEN]: 1 },
      },
    });
    expect(selectAutoFreezeCandidates([h], TODAY)).toEqual([]);
    expect(selectMemberAutoFreezeCandidates([h], [PAUL, JEN], TODAY).map(c => c.memberId))
      .toEqual([PAUL]);
  });

  it('skips a member below the 3-day protection threshold', () => {
    const h = habit({
      completedDates: ['2026-07-06', '2026-07-07'],
      completedBy: attributed(['2026-07-06', '2026-07-07'], [PAUL]),
    });
    expect(selectMemberAutoFreezeCandidates([h], [PAUL], TODAY)).toEqual([]);
  });

  it('skips a member with no attribution at all (grandfathered history)', () => {
    // completedDates exist, completedBy does not — nobody has a chain here.
    expect(selectMemberAutoFreezeCandidates([habit()], [PAUL, JEN], TODAY)).toEqual([]);
  });

  it('is idempotent: a member already frozen yesterday is not re-selected', () => {
    const h = habit({
      completedBy: attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL]),
      frozenDatesBy: { [YESTERDAY]: [PAUL] },
    });
    expect(selectMemberAutoFreezeCandidates([h], [PAUL], TODAY)).toEqual([]);
  });

  it('skips everyone when a household-wide freeze already bridges yesterday', () => {
    // `frozenDates` bridges every chain for free — spending a personal token on
    // top of it would be waste.
    const h = habit({
      completedBy: attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL, JEN]),
      frozenDates: [YESTERDAY],
    });
    expect(selectMemberAutoFreezeCandidates([h], [PAUL, JEN], TODAY)).toEqual([]);
  });

  it('bridges a second consecutive miss from the member\'s own prior freeze', () => {
    const h = habit({
      completedDates: ['2026-07-04', '2026-07-05', '2026-07-06'],
      completedBy: attributed(['2026-07-04', '2026-07-05', '2026-07-06'], [PAUL]),
      frozenDatesBy: { '2026-07-07': [PAUL] },
    });
    const result = selectMemberAutoFreezeCandidates([h], [PAUL], TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]!.protectedStreak).toBe(3);
  });

  it('never selects a weekly, negative, or paused habit', () => {
    const by = attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL]);
    const weekly = habit({ id: 'w', period: 'weekly', completedBy: by });
    const negative = habit({ id: 'n', type: 'negative', completedBy: by });
    const paused = habit({ id: 'p', pausedUntil: '2026-07-20', completedBy: by });
    expect(selectMemberAutoFreezeCandidates([weekly, negative, paused], [PAUL], TODAY)).toEqual([]);
  });

  it('orders deterministically: streak desc, then habit id, then member uid', () => {
    const fiveDates = ['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'];
    const a = habit({
      id: 'a-three',
      completedBy: attributed(['2026-07-05', '2026-07-06', '2026-07-07'], [PAUL, JEN]),
    });
    const z = habit({
      id: 'z-five',
      completedDates: fiveDates,
      completedBy: attributed(fiveDates, [PAUL]),
    });

    const result = selectMemberAutoFreezeCandidates([a, z], [PAUL, JEN], TODAY);
    expect(result.map(c => `${c.habit.id}:${c.memberId}`)).toEqual([
      `z-five:${PAUL}`,
      `a-three:${JEN}`,
      `a-three:${PAUL}`,
    ]);
  });
});
