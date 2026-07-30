import { describe, it, expect } from 'vitest';
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import type { Habit, HouseholdMember } from '@/types/schema';
import {
  buildHabitRowMemberContext,
  rowCompletionSegments,
  sameHabitRowMemberContext,
} from '@/utils/habitRowAttribution';

// 🛡️ Anchored to the FIXTURE's own Monday, never to "today" — a suite that
// offsets from the real clock passes Mon–Tue and fails once a UTC runner rolls
// the date (this repo has had a deploy blocked by exactly that).
const MONDAY = format(startOfISOWeek(parseISO('2026-06-17')), 'yyyy-MM-dd');
const d = (n: number): string => format(addDays(parseISO(MONDAY), n), 'yyyy-MM-dd');

const PAUL = 'paul-uid';
const JEN = 'jen-uid';
const LEO = 'kid_leo';

const member = (uid: string, displayName: string, extra: Partial<HouseholdMember> = {}): HouseholdMember => ({
  uid,
  displayName,
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
  ...extra,
});

const ROSTER: HouseholdMember[] = [
  member(PAUL, 'Paul', { role: 'admin' }),
  member(JEN, 'Jen'),
  member(LEO, 'Leo', { role: 'kid', isManaged: true, avatarColor: '#9f5618' }),
];

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Morning walk',
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

describe('buildHabitRowMemberContext', () => {
  it('lists adults only, in roster order, and colors everyone', () => {
    const ctx = buildHabitRowMemberContext(ROSTER, PAUL);
    expect(ctx.adults.map(a => a.uid)).toEqual([PAUL, JEN]);
    expect(ctx.adults[0]?.color).toBe('#285742');
    expect(ctx.adults[1]?.color).toBe('#b87a29');
    // The managed kid is excluded from the picker but still colorable, because
    // an assigned chore records their attribution and the row draws it.
    expect(ctx.byUid[LEO]?.color).toBe('#9f5618');
    expect(ctx.currentUserId).toBe(PAUL);
  });

  it('tolerates an unknown signed-in member', () => {
    expect(buildHabitRowMemberContext(ROSTER, undefined).currentUserId).toBe('');
    expect(buildHabitRowMemberContext([], null).adults).toEqual([]);
  });
});

describe('sameHabitRowMemberContext', () => {
  it('is true across a rebuild that only moved points', () => {
    // The page memoizes the context on `members`, and every habit toggle writes
    // members/{uid}.points — which hands it a brand-new array. The row must not
    // re-render for that.
    const before = buildHabitRowMemberContext(ROSTER, PAUL);
    const afterPointsWrite = buildHabitRowMemberContext(
      ROSTER.map(m => ({ ...m, points: { daily: 10, weekly: 20, total: 30 } })),
      PAUL
    );
    expect(before).not.toBe(afterPointsWrite);
    expect(sameHabitRowMemberContext(before, afterPointsWrite)).toBe(true);
  });

  it('is false when anything a row actually reads changes', () => {
    const base = buildHabitRowMemberContext(ROSTER, PAUL);
    expect(sameHabitRowMemberContext(base, buildHabitRowMemberContext(ROSTER, JEN))).toBe(false);
    expect(
      sameHabitRowMemberContext(
        base,
        buildHabitRowMemberContext(ROSTER.map(m => (m.uid === JEN ? { ...m, displayName: 'Jenny' } : m)), PAUL)
      )
    ).toBe(false);
    expect(
      sameHabitRowMemberContext(
        base,
        buildHabitRowMemberContext(ROSTER.map(m => (m.uid === JEN ? { ...m, avatarColor: '#197478' } : m)), PAUL)
      )
    ).toBe(false);
    // A member joining or leaving.
    expect(
      sameHabitRowMemberContext(base, buildHabitRowMemberContext(ROSTER.slice(0, 2), PAUL))
    ).toBe(false);
  });

  it('handles the absent context (a card rendered off the Habits page)', () => {
    const base = buildHabitRowMemberContext(ROSTER, PAUL);
    expect(sameHabitRowMemberContext(undefined, undefined)).toBe(true);
    expect(sameHabitRowMemberContext(base, undefined)).toBe(false);
    expect(sameHabitRowMemberContext(undefined, base)).toBe(false);
  });
});

describe('rowCompletionSegments', () => {
  const ctx = buildHabitRowMemberContext(ROSTER, PAUL);

  it('returns nothing for a habit with no attribution (the grandfathered row)', () => {
    // Completed, but before the feature existed: no completedBy at all. Such a
    // row must keep its original un-attributed look rather than show an empty pie.
    expect(rowCompletionSegments(habit({ completedDates: [d(0)], count: 1 }), ctx, d(0))).toEqual([]);
  });

  it('orders segments by the roster so the first adult always owns 12 o’clock', () => {
    const h = habit({
      count: 3,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [JEN]: 1, [PAUL]: 2 } },
    });
    const segments = rowCompletionSegments(h, ctx, d(0));
    expect(segments.map(s => s.memberId)).toEqual([PAUL, JEN]);
    expect(segments.map(s => s.units)).toEqual([2, 1]);
    expect(segments.map(s => s.displayName)).toEqual(['Paul', 'Jen']);
    expect(segments.map(s => s.color)).toEqual(['#285742', '#b87a29']);
  });

  it('carries each member’s OWN streak, not the habit’s', () => {
    // Paul has three consecutive days ending today; Jen only has today.
    const h = habit({
      count: 2,
      streakDays: 9,
      completedDates: [d(-2), d(-1), d(0)],
      completedBy: {
        [d(-2)]: { [PAUL]: 1 },
        [d(-1)]: { [PAUL]: 1 },
        [d(0)]: { [PAUL]: 1, [JEN]: 1 },
      },
    });
    const segments = rowCompletionSegments(h, ctx, d(0));
    expect(segments.find(s => s.memberId === PAUL)?.streak).toBe(3);
    expect(segments.find(s => s.memberId === JEN)?.streak).toBe(1);
  });

  it('spans the whole ISO week for a weekly habit', () => {
    const h = habit({
      period: 'weekly',
      count: 3,
      completedDates: [d(0), d(2)],
      completedBy: {
        [d(0)]: { [PAUL]: 2 },
        [d(2)]: { [JEN]: 1 },
        [d(-4)]: { [JEN]: 7 }, // previous week — must not bleed in
      },
    });
    const segments = rowCompletionSegments(h, ctx, d(4));
    expect(segments.map(s => [s.memberId, s.units])).toEqual([[PAUL, 2], [JEN, 1]]);
  });

  it('keeps a departed member’s slice visible with a stable color', () => {
    const h = habit({
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { 'gone-uid': 1 } },
    });
    const [segment] = rowCompletionSegments(h, ctx, d(0));
    expect(segment?.memberId).toBe('gone-uid');
    expect(segment?.displayName).toBe('Former member');
    expect(segment?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('includes a managed kid credited on an assigned chore, after the adults', () => {
    const h = habit({
      assignedTo: LEO,
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [LEO]: 1, [PAUL]: 1 } },
    });
    expect(rowCompletionSegments(h, ctx, d(0)).map(s => s.memberId)).toEqual([PAUL, LEO]);
  });

  it('ignores zero/negative residue counts', () => {
    const h = habit({
      count: 1,
      completedDates: [d(0)],
      completedBy: { [d(0)]: { [PAUL]: 0, [JEN]: 1 } },
    });
    expect(rowCompletionSegments(h, ctx, d(0)).map(s => s.memberId)).toEqual([JEN]);
  });
});
