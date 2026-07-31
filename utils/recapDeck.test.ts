import { describe, it, expect } from 'vitest';
import {
  UNATTRIBUTED_SERIES,
  buildHeadToHead,
  buildRecapChart,
  buildRecapDeck,
  hasCeremonyData,
  isBestWeekOfMonth,
  recapTotalPoints,
  recapTrendPct,
  weekNumberOf,
  weekRangeOf,
  weekdayNameOf,
} from '@/utils/recapDeck';
import type { HouseholdMember, RecapMemberFacts, WeeklyRecap } from '@/types/schema';

/**
 * 🛡️ Fixtures are anchored to their OWN week (Mon 2026-06-29 → Sun 2026-07-05),
 * never to an offset from today — a weekday-dependent recap test has blocked a
 * production deploy in this repo before.
 */
const WEEK = '2026-W27';
const DAYS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

const MEMBERS = [
  { uid: 'jen', avatarColor: undefined, isManaged: false },
  { uid: 'paul', avatarColor: undefined, isManaged: false },
] as unknown as HouseholdMember[];

function facts(memberId: string, name: string, points: number, extra: Partial<RecapMemberFacts> = {}): RecapMemberFacts {
  return {
    memberId,
    name,
    points,
    completions: 10,
    bestDay: null,
    topStreak: null,
    perfectHabits: [],
    ...extra,
  };
}

function recap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    id: WEEK,
    isoWeek: WEEK,
    generatedAt: '2026-07-06T11:00:00.000Z',
    totalSpend: 412,
    priorWeekSpend: 468,
    topCategoryDeltas: [],
    habitCompletions: 20,
    streaksAtRisk: [],
    pointsByMember: [
      { memberId: 'jen', name: 'Jen', points: 410 },
      { memberId: 'paul', name: 'Paul', points: 385 },
    ],
    upcomingBills: [],
    narrative: 'A strong week.',
    narrativeSource: 'ai',
    premium: true,
    memberFacts: [facts('jen', 'Jen', 410), facts('paul', 'Paul', 385)],
    dailyPoints: DAYS.map((date, i) => ({
      date,
      byMember: { jen: 50 + i, paul: 45 + i },
      unattributed: 0,
      total: 95 + i * 2,
    })),
    totalPoints: 795,
    priorWeekPoints: 710,
    ...overrides,
  };
}

describe('hasCeremonyData', () => {
  it('is false for a pre-ceremony recap and for a half-written one', () => {
    expect(hasCeremonyData(null)).toBe(false);
    expect(hasCeremonyData(recap({ memberFacts: undefined, dailyPoints: undefined }))).toBe(false);
    expect(hasCeremonyData(recap({ dailyPoints: undefined }))).toBe(false);
    expect(hasCeremonyData(recap({ memberFacts: [] }))).toBe(false);
  });

  it('is true once both series are present', () => {
    expect(hasCeremonyData(recap())).toBe(true);
  });
});

describe('recapTotalPoints / recapTrendPct', () => {
  it('falls back to the sum of pointsByMember when totalPoints is absent', () => {
    expect(recapTotalPoints(recap({ totalPoints: undefined }))).toBe(795);
  });

  it('returns null for a trend with no usable base', () => {
    expect(recapTrendPct(recap({ priorWeekPoints: undefined }))).toBeNull();
    expect(recapTrendPct(recap({ priorWeekPoints: 0 }))).toBeNull();
  });

  it('rounds the percent change', () => {
    expect(recapTrendPct(recap())).toBe(12);
  });
});

describe('isBestWeekOfMonth', () => {
  it('is true when no other recap in the same month scored higher', () => {
    const current = recap();
    const earlier = recap({ id: '2026-W26', isoWeek: '2026-W26', totalPoints: 500 });
    expect(isBestWeekOfMonth(current, [current, earlier])).toBe(true);
  });

  it('is false when another week that month beat it', () => {
    // W26 starts Jun 22 — the same (June) month as W27's Jun 29 Monday.
    const current = recap();
    const better = recap({ id: '2026-W26', isoWeek: '2026-W26', totalPoints: 900 });
    expect(isBestWeekOfMonth(current, [current, better])).toBe(false);
  });

  it('ignores weeks from other months', () => {
    // The month is the week's MONDAY: 2026-W27 starts Jun 29 (June), while
    // W28 starts Jul 6 and W31 Jul 27 (both July).
    const current = recap();
    const otherMonth = recap({ id: '2026-W31', isoWeek: '2026-W31', totalPoints: 5000 });
    expect(isBestWeekOfMonth(current, [current, otherMonth])).toBe(true);
  });

  it('never claims a best week on a zero-point week', () => {
    const zero = recap({ totalPoints: 0, pointsByMember: [] });
    expect(isBestWeekOfMonth(zero, [zero])).toBe(false);
  });
});

describe('buildHeadToHead', () => {
  const colors = { jen: '#b87a29', paul: '#285742' };

  it('sorts standings by points and identifies a strict leader', () => {
    const h2h = buildHeadToHead(recap(), 'podium', colors);
    expect(h2h.standings.map(s => s.name)).toEqual(['Jen', 'Paul']);
    expect(h2h.leader?.name).toBe('Jen');
    expect(h2h.margin).toBe(25);
    expect(h2h.framing).toBe('podium');
  });

  it('household_first never frames a podium, however big the margin', () => {
    const blowout = recap({ memberFacts: [facts('jen', 'Jen', 900), facts('paul', 'Paul', 100)] });
    expect(buildHeadToHead(blowout, 'household_first', colors).framing).toBe('together');
  });

  it('adaptive crowns only a runaway week', () => {
    const close = recap();
    const runaway = recap({ memberFacts: [facts('jen', 'Jen', 600), facts('paul', 'Paul', 200)] });
    expect(buildHeadToHead(close, 'adaptive', colors).framing).toBe('together');
    expect(buildHeadToHead(runaway, 'adaptive', colors).framing).toBe('podium');
  });

  it('crowns the strict leader even in a net-negative week — lost the least still wins', () => {
    // Paul -5, Jen -20: matches the Scoreboard widget's and the Points
    // Breakdown drawer's crown rule via the shared `findLeaderId` predicate —
    // the old `points > 0` scorers filter here silently un-crowned exactly
    // this week while the other two surfaces still crowned it.
    const netNegative = recap({
      memberFacts: [facts('paul', 'Paul', -5), facts('jen', 'Jen', -20)],
    });
    const h2h = buildHeadToHead(netNegative, 'podium', colors);
    expect(h2h.leader?.memberId).toBe('paul');
    expect(h2h.runnerUp?.memberId).toBe('jen');
    expect(h2h.margin).toBe(15);
    expect(h2h.framing).toBe('podium');
  });

  it('treats a tie for first as no podium at all', () => {
    const tied = recap({ memberFacts: [facts('jen', 'Jen', 300), facts('paul', 'Paul', 300)] });
    const h2h = buildHeadToHead(tied, 'podium', colors);
    expect(h2h.framing).toBe('together');
    expect(h2h.leader).toBeNull();
  });

  it('matches the SERVER runaway thresholds exactly (25% and 50 points)', () => {
    // 250 vs 200: margin 50 clears the floor AND 25% of 200 — a runaway.
    const atThreshold = recap({ memberFacts: [facts('jen', 'Jen', 250), facts('paul', 'Paul', 200)] });
    expect(buildHeadToHead(atThreshold, 'adaptive', colors).runaway).toBe(true);
    // 249 vs 200: margin 49 misses the absolute floor.
    const belowFloor = recap({ memberFacts: [facts('jen', 'Jen', 249), facts('paul', 'Paul', 200)] });
    expect(buildHeadToHead(belowFloor, 'adaptive', colors).runaway).toBe(false);
    // 1000 vs 900: margin 100 clears the floor but is under 25% of 900.
    const belowRatio = recap({ memberFacts: [facts('jen', 'Jen', 1000), facts('paul', 'Paul', 900)] });
    expect(buildHeadToHead(belowRatio, 'adaptive', colors).runaway).toBe(false);
  });

  it('excludes a managed kid from the standings — a chore week never crowns them', () => {
    // Leo's points come from chores credited to his own member doc, not the
    // household pool, so they are an allowance ledger rather than a
    // competitive score (same population as `selectAdultStandings`).
    const withKid = recap({
      memberFacts: [
        facts('kid_leo', 'Leo', 900, { isManaged: true }),
        facts('jen', 'Jen', 410),
        facts('paul', 'Paul', 385),
      ],
    });
    const h2h = buildHeadToHead(withKid, 'podium', colors);
    expect(h2h.standings.map(s => s.name)).toEqual(['Jen', 'Paul']);
    expect(h2h.leader?.name).toBe('Jen');
    expect(h2h.margin).toBe(25);
  });

  it('still gives a managed kid their own personal card as the viewer', () => {
    const withKid = recap({
      memberFacts: [
        facts('kid_leo', 'Leo', 900, { isManaged: true }),
        facts('jen', 'Jen', 410),
      ],
    });
    const deck = buildRecapDeck({
      recap: withKid,
      recaps: [withKid],
      members: MEMBERS,
      viewerId: 'kid_leo',
      unattributedColor: '#a19b8c',
    });
    expect(deck.viewer?.memberId).toBe('kid_leo');
    expect(deck.cards.map(c => c.kind)).toContain('personal');
  });
});

describe('buildRecapChart', () => {
  const colors = { jen: '#b87a29', paul: '#285742' };

  it('scales heights against the best day of the week and marks it', () => {
    const days = [
      { date: DAYS[0] as string, byMember: { jen: 100 }, unattributed: 0, total: 100 },
      { date: DAYS[1] as string, byMember: { jen: 50 }, unattributed: 0, total: 50 },
    ];
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart[0]?.heightPct).toBe(100);
    expect(chart[0]?.best).toBe(true);
    expect(chart[1]?.heightPct).toBe(50);
    expect(chart[1]?.best).toBe(false);
  });

  it('flags a quiet day well below the best', () => {
    const days = [
      { date: DAYS[0] as string, byMember: { jen: 100 }, unattributed: 0, total: 100 },
      { date: DAYS[1] as string, byMember: { jen: 10 }, unattributed: 0, total: 10 },
    ];
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart[0]?.quiet).toBe(false);
    expect(chart[1]?.quiet).toBe(true);
  });

  it('emits the unattributed remainder as its own neutral series', () => {
    const days = [{ date: DAYS[0] as string, byMember: { jen: 30 }, unattributed: 10, total: 40 }];
    const chart = buildRecapChart(days, colors, '#a19b8c');
    const segments = chart[0]?.segments ?? [];
    expect(segments.map(s => s.key)).toEqual(['jen', UNATTRIBUTED_SERIES]);
    expect(segments[1]?.color).toBe('#a19b8c');
    expect(Math.round(segments[1]?.pct ?? 0)).toBe(25);
  });

  it('never produces a negative height or a negative segment width', () => {
    const days = [
      { date: DAYS[0] as string, byMember: { jen: 40 }, unattributed: 0, total: 40 },
      { date: DAYS[1] as string, byMember: { jen: -30 }, unattributed: 0, total: -30 },
    ];
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart[1]?.heightPct).toBe(0);
    expect(chart[1]?.segments).toEqual([]);
    // The figure itself is still reported truthfully.
    expect(chart[1]?.total).toBe(-30);
  });

  it('handles an all-zero week without dividing by zero', () => {
    const days = DAYS.map(date => ({ date, byMember: {}, unattributed: 0, total: 0 }));
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart.every(d => d.heightPct === 0 && !d.best && !d.quiet)).toBe(true);
  });
});

describe('buildRecapDeck', () => {
  const base = {
    recaps: [recap()],
    members: MEMBERS,
    unattributedColor: '#a19b8c',
  };

  it('orders the four approved cards with the VIEWER\'s personal card third', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'paul' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'week', 'personal', 'finish']);
    expect(deck.cards[2]?.memberId).toBe('paul');
    expect(deck.viewer?.name).toBe('Paul');
  });

  it('shows the OTHER member their own card, from the same recap', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' });
    expect(deck.cards[2]?.memberId).toBe('jen');
    expect(deck.viewer?.name).toBe('Jen');
  });

  it('drops the personal card for a viewer with no facts, rather than showing an empty one', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'someone-else' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'week', 'finish']);
    expect(deck.viewer).toBeNull();
  });

  it('falls back to the recap\'s stored tone when the household passes none', () => {
    const deck = buildRecapDeck({
      ...base,
      recap: recap({ ceremonyTone: 'podium' }),
      viewerId: 'jen',
      tone: null,
    });
    expect(deck.tone).toBe('podium');
    expect(deck.framing).toBe('podium');
  });

  it('defaults to household_first when neither the household nor the recap says', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen', tone: null });
    expect(deck.tone).toBe('household_first');
    expect(deck.framing).toBe('together');
  });

  it('lets the LIVE household tone win over the recap\'s stored one', () => {
    const deck = buildRecapDeck({
      ...base,
      recap: recap({ ceremonyTone: 'podium' }),
      viewerId: 'jen',
      tone: 'household_first',
    });
    expect(deck.framing).toBe('together');
  });

  it('carries the week label, trend and best day', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' });
    expect(deck.weekNumber).toBe(27);
    expect(deck.weekRange).toBe('Jun 29 – Jul 5');
    expect(deck.trendPct).toBe(12);
    expect(deck.bestDay?.date).toBe('2026-07-05');
    expect(deck.totalPoints).toBe(795);
  });

  it('sums householdSharePoints from dailyPoints[].unattributed, not from totalPoints (household-points-visibility)', () => {
    // The base fixture's week has zero unattributed history.
    expect(buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' }).householdSharePoints).toBe(0);

    const withHousehold = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 15 : i === 3 ? 5 : 0,
        total: i === 0 ? 110 : i === 3 ? 100 : 95,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: withHousehold, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(20); // 15 + 5, summed across the week
  });

  it('treats a LEGACY day with no `unattributed` field as 0, never NaN (household-points-visibility)', () => {
    // `weeklyRecapConverter` spreads raw Firestore data with `as WeeklyRecap`,
    // so a recap written before `unattributed` joined `RecapDayPoints` carries
    // days without it. Un-guarded, `sum + undefined` is NaN — and NaN !== 0
    // passes the render guard, printing "NaN pts" on the household card.
    const legacy = recap({
      dailyPoints: DAYS.map((date, i) => {
        const day = { date, byMember: { jen: 50, paul: 45 }, unattributed: i === 0 ? 15 : 0, total: 95 };
        if (i !== 0) delete (day as Partial<typeof day>).unattributed;
        return day as (typeof day) & { unattributed: number };
      }),
    });
    const deck = buildRecapDeck({ ...base, recap: legacy, viewerId: 'jen' });
    expect(Number.isNaN(deck.householdSharePoints)).toBe(false);
    expect(deck.householdSharePoints).toBe(15);
  });

  it('nets a MIXED-SIGN week — a positive unattributed day and a negative one — to the correct signed total (household-points-visibility, finding 2)', () => {
    // Monday +15 (legacy history), Wednesday -20 (e.g. a legacy penalty habit
    // whose completion reverted but whose submission still stands — see
    // ScoreboardWidget.test.tsx's "submission outlives completion" case for
    // the underlying scenario). `buildRecapChart` clamps segments to their
    // POSITIVE share (see the `buildRecapChart` describe block above), so the
    // chart draws only Monday's +15 segment and drops Wednesday's negative
    // one entirely — `householdSharePoints` must NOT mirror that clamp: it's
    // the signed sum, deliberately allowed to go negative.
    const mixedSign = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 15 : i === 2 ? -20 : 0,
        total: i === 0 ? 110 : i === 2 ? 75 : 95,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: mixedSign, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(-5); // 15 + (-20)

    // Grounding the contradiction this guards against: `buildRecapChart`
    // (unchanged by this fix — see the "never produces a negative height"
    // test above) drops Wednesday's -20 segment entirely — only members'
    // segments survive that day — while Monday's +15 DOES draw a household
    // segment. So the chart visually reads as "some positive household
    // amount", never as -5: a legend printing the signed -5 next to that
    // chart would contradict what's actually drawn, which is exactly what
    // RecapDeck.tsx's legend must no longer do (see the component-level test
    // in WeeklyRecapDrawer.test.tsx).
    const monday = deck.chart[0];
    const wednesday = deck.chart[2];
    expect(monday?.segments.some(s => s.key === UNATTRIBUTED_SERIES)).toBe(true);
    expect(wednesday?.segments.some(s => s.key === UNATTRIBUTED_SERIES)).toBe(false);
  });

  it('still builds a full deck for a recap with ceremony data after the household relabel/figure work (hasCeremonyData regression guard)', () => {
    const withHousehold = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 15 : 0,
        total: i === 0 ? 110 : 95,
      })),
    });
    expect(hasCeremonyData(withHousehold)).toBe(true);
    const deck = buildRecapDeck({ ...base, recap: withHousehold, viewerId: 'jen' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'week', 'personal', 'finish']);
    expect(deck.householdSharePoints).toBe(15);
  });
});

/**
 * TODO §3 "Recap chart hides non-positive unattributed days": `buildRecapChart`
 * clamps every segment to its positive share, so a week whose household share
 * nets negative draws no Household bar. The product decision is that the
 * chart STAYS positive-only (a stacked bar can't honestly show a negative
 * slice) — the fix is on the household card's LABEL, which must never assert
 * a figure the rest of the card gives no visible cause for. These cases walk
 * the state space of `dailyPoints[].unattributed` signs across a week, plus
 * the case where a segment's EXISTENCE and its column's HEIGHT disagree.
 */
describe('household share vs. chart consistency (recap-chart-negative-days)', () => {
  const base = {
    recaps: [recap()],
    members: MEMBERS,
    unattributedColor: '#a19b8c',
  };

  /**
   * Mirrors the exact expression `RecapDeck.tsx`'s `WeekCard` uses to gate the
   * chart legend and the household-share wording. A Household bar is DRAWN
   * only when a positive `unattributed` segment sits on a column that has
   * height: segment existence follows from `day.unattributed`, height from
   * `day.total`, and those are independent figures — see case (g).
   */
  const hasHouseholdBar = (deck: ReturnType<typeof buildRecapDeck>): boolean =>
    deck.chart.some(d => d.heightPct > 0 && d.segments.some(s => s.key === UNATTRIBUTED_SERIES));

  it('(a) all-positive unattributed week: every day draws a Household segment, matching a positive card figure', () => {
    const allPositive = recap({
      dailyPoints: DAYS.map(date => ({ date, byMember: { jen: 50, paul: 45 }, unattributed: 5, total: 100 })),
    });
    const deck = buildRecapDeck({ ...base, recap: allPositive, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(35); // 5 * 7 days
    expect(hasHouseholdBar(deck)).toBe(true);
  });

  it('(b) all-negative unattributed week: NO day ever draws a Household segment, while the card figure is still nonzero — the exact contradiction this fix closes', () => {
    const allNegative = recap({
      dailyPoints: DAYS.map(date => ({ date, byMember: { jen: 50, paul: 45 }, unattributed: -5, total: 90 })),
    });
    const deck = buildRecapDeck({ ...base, recap: allNegative, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(-35);
    expect(hasHouseholdBar(deck)).toBe(false);
    // ...and the reason is emphatically NOT "the chart only shows positive
    // days". Every one of the seven days IS drawn, at FULL height (50+45-5=90,
    // identical all week, so each column is the week's best). What the chart
    // omits is the negative SEGMENT, not the day — which is why the card's
    // wording has to speak about points gained, never about days shown.
    expect(deck.chart.every(d => d.heightPct === 100)).toBe(true);
  });

  it('(c) mixed-sign week netting POSITIVE: the positive day draws a segment, matching the positive card figure', () => {
    const mixedPositive = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : i === 2 ? -5 : 0,
        total: i === 0 ? 115 : i === 2 ? 90 : 95,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: mixedPositive, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(15); // 20 + (-5)
    expect(hasHouseholdBar(deck)).toBe(true);
    expect(deck.chart[0]?.segments.some(s => s.key === UNATTRIBUTED_SERIES)).toBe(true);
    expect(deck.chart[2]?.segments.some(s => s.key === UNATTRIBUTED_SERIES)).toBe(false);
  });

  it('(d) mixed-sign week netting NEGATIVE: the positive day still draws a segment, so the negative card figure has a visible cause and is unaffected by this fix', () => {
    const mixedNegative = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 15 : i === 2 ? -20 : 0,
        total: i === 0 ? 110 : i === 2 ? 75 : 95,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: mixedNegative, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(-5); // 15 + (-20)
    // Monday's segment is the visible cause — this is the (already-shipped,
    // #1164) "mixed-sign netting negative" case and stays unchanged here.
    expect(hasHouseholdBar(deck)).toBe(true);
  });

  it('(e) mixed-sign week netting to EXACTLY ZERO: a segment is still drawn, but the card figure is suppressed (0) so nothing is asserted', () => {
    const mixedZero = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 10 : i === 2 ? -10 : 0,
        total: i === 0 ? 105 : i === 2 ? 85 : 95,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: mixedZero, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(0);
    // The chart doesn't lie about Monday, but `householdSharePoints !== 0`
    // gates the card line off entirely, so there is nothing left to disagree.
    expect(hasHouseholdBar(deck)).toBe(true);
  });

  it('(f) no unattributed activity at all — explicit zeros: no segment anywhere, and the card figure is suppressed', () => {
    const noActivity = recap({
      dailyPoints: DAYS.map(date => ({ date, byMember: { jen: 50, paul: 45 }, unattributed: 0, total: 95 })),
    });
    const deck = buildRecapDeck({ ...base, recap: noActivity, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(0);
    expect(hasHouseholdBar(deck)).toBe(false);
  });

  it('(f) no unattributed activity at all — a LEGACY week missing the field on every day scores identically to explicit zeros, and never zeroes out a real member segment', () => {
    // Mirrors the "treats a LEGACY day..." test above (buildRecapDeck), but
    // asserts on `buildRecapChart`'s own segment math, which has its own
    // un-guarded `day.unattributed` read. Drop the `?? 0` and
    // `Math.max(0, undefined)` is NaN, which poisons `segmentTotal`; the
    // observable damage is NOT a NaN `pct` (`segmentTotal > 0` is false for
    // NaN, so `pct` falls to the literal 0) but a SILENT 0 on every segment of
    // that day — jen's and paul's real points included. Assert the real share,
    // which is the only thing that tells those two apart.
    const legacyDays = DAYS.map(date => {
      const day = { date, byMember: { jen: 50, paul: 45 }, unattributed: 0, total: 95 };
      delete (day as Partial<typeof day>).unattributed;
      return day as typeof day;
    });
    const legacyWeek = recap({ dailyPoints: legacyDays as unknown as WeeklyRecap['dailyPoints'] });

    const deck = buildRecapDeck({ ...base, recap: legacyWeek, viewerId: 'jen' });
    expect(deck.householdSharePoints).toBe(0);
    expect(hasHouseholdBar(deck)).toBe(false);

    for (const day of deck.chart) {
      const jenSegment = day.segments.find(s => s.key === 'jen');
      expect(jenSegment?.pct).toBeCloseTo((50 / 95) * 100);
    }
  });

  it('(g) a POSITIVE household day the members net into the red: the segment EXISTS but its column has zero height, so nothing is drawn (fix 1)', () => {
    // Segment existence derives from `day.unattributed`; column height derives
    // from `day.total`. They are independent, and negative/penalty habits make
    // the disagreement reachable: the members bleed points on a day a
    // Household-credit habit scores. Gating the legend and the card's wording
    // on existence alone paints a "Household" swatch and claims points "earned
    // together" over a column of zero pixels.
    const householdOnlyGain = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 0 ? { jen: -60, paul: -55 } : { jen: 0, paul: 0 },
        unattributed: i === 0 ? 10 : 0,
        total: i === 0 ? -105 : 0,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: householdOnlyGain, viewerId: 'jen' });

    // The figure is POSITIVE here — so the "no visible cause" branch is NOT
    // reachable only for a loss, and its copy may not assume one.
    expect(deck.householdSharePoints).toBe(10);

    const monday = deck.chart[0];
    expect(monday?.segments.some(s => s.key === UNATTRIBUTED_SERIES)).toBe(true);
    expect(monday?.heightPct).toBe(0);
    expect(hasHouseholdBar(deck)).toBe(false);
  });

  it('normalizes float-summation epsilon out of householdSharePoints without flattening a real half-point (fix 5)', () => {
    // 0.1 + 0.2 - 0.3 is 5.551115123125783e-17 in binary floats — a value that
    // renders verbatim on the card AND slips past its `!== 0` gate, so a week
    // that truly nets zero would announce a household share in scientific
    // notation.
    const epsilon = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 0.1 : i === 1 ? 0.2 : i === 2 ? -0.3 : 0,
        total: 95,
      })),
    });
    expect(buildRecapDeck({ ...base, recap: epsilon, viewerId: 'jen' }).householdSharePoints).toBe(0);

    // ...but streak multipliers are 1.5x, so a genuine half-point is real data
    // and must survive untouched — this is not integer rounding.
    const fractional = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 7.5 : 0,
        total: 95,
      })),
    });
    expect(buildRecapDeck({ ...base, recap: fractional, viewerId: 'jen' }).householdSharePoints).toBe(7.5);
  });
});

describe('week label helpers', () => {
  it('parses the week number and returns null on a malformed id', () => {
    expect(weekNumberOf('2026-W31')).toBe(31);
    expect(weekNumberOf('nonsense')).toBeNull();
  });

  it('renders the week range and degrades to an empty string when unresolvable', () => {
    expect(weekRangeOf('2026-W27')).toBe('Jun 29 – Jul 5');
    expect(weekRangeOf('2026-W99')).toBe('');
  });

  it('names the weekday of a local date string', () => {
    expect(weekdayNameOf('2026-07-04')).toBe('Saturday');
    expect(weekdayNameOf('')).toBe('');
  });
});
