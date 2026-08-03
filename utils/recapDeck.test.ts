import { describe, it, expect } from 'vitest';
import {
  UNATTRIBUTED_SERIES,
  buildHeadToHead,
  buildPersonalTiles,
  buildRecapChart,
  buildRecapDeck,
  buildRecapMoney,
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

  // --- Negative days are LEGIBLE, not invisible (DECK-1) --------------------

  it('gives a net-negative day a below-baseline deficit instead of drawing nothing at all', () => {
    // The real 2026-W31 shape: Monday netted -5 while the rest of the week
    // scored. Pre-DECK-1 that day had heightPct 0, no segments and no other
    // signal whatsoever — the chart simply showed six days and a blank.
    const days = [
      { date: DAYS[0] as string, byMember: { jen: -5 }, unattributed: 0, total: -5 },
      { date: DAYS[1] as string, byMember: { jen: 40 }, unattributed: 0, total: 40 },
    ];
    const chart = buildRecapChart(days, colors, '#a19b8c');

    // The positive stack is UNCHANGED — the chart stays positive-only.
    expect(chart[0]?.heightPct).toBe(0);
    expect(chart[0]?.segments).toEqual([]);
    // ...but the day is now marked and measurable.
    expect(chart[0]?.negative).toBe(true);
    expect(chart[0]?.deficitPct).toBe(100);
    expect(chart[1]?.negative).toBe(false);
    expect(chart[1]?.deficitPct).toBe(0);
  });

  it('scales deficits against the week\'s DEEPEST loss, never against the positive maximum', () => {
    // A -5 day beside a +400 day would be 1.25% of the positive scale — a
    // sub-pixel smear. Against the deficit scale it is a full-height stub.
    const days = [
      { date: DAYS[0] as string, byMember: { jen: -5 }, unattributed: 0, total: -5 },
      { date: DAYS[1] as string, byMember: { jen: -20 }, unattributed: 0, total: -20 },
      { date: DAYS[2] as string, byMember: { jen: 400 }, unattributed: 0, total: 400 },
    ];
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart[0]?.deficitPct).toBe(25); // 5 of 20
    expect(chart[1]?.deficitPct).toBe(100); // the week's deepest
  });

  it('leaves deficitPct at 0 for a week with no losing day, so no gutter is drawn', () => {
    const days = DAYS.map(date => ({ date, byMember: { jen: 10 }, unattributed: 0, total: 10 }));
    const chart = buildRecapChart(days, colors, '#a19b8c');
    expect(chart.every(d => !d.negative && d.deficitPct === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Money (DECK-1)
// ---------------------------------------------------------------------------

describe('buildRecapMoney', () => {
  /**
   * 🛡️ THE REAL 2026-W31 FIGURES. Total $2,429.00 against a $803.12 prior week
   * is a "3.3x blowout" headline — and a meaningless one, because $1,306.77 of
   * it was bills the calendar had already budgeted. Day-to-day was $1,122.23
   * vs $803.12: a 1.4x rise. This is the whole reason the money card leads with
   * `dayToDay` and never with `totalSpend`.
   */
  const W31 = {
    totalSpend: 2429.0,
    priorWeekSpend: 803.12,
    billsSpend: 1306.77,
    priorWeekBillsSpend: 0,
    dayToDaySpend: 1122.23,
    priorWeekDayToDaySpend: 803.12,
  };

  it('leads with day-to-day and compares each half to its OWN prior week', () => {
    const money = buildRecapMoney(recap(W31));
    expect(money.hasSplit).toBe(true);
    expect(money.dayToDay?.amount).toBe(1122.23);
    expect(money.dayToDay?.prior).toBe(803.12);
    // +40%, i.e. 1.4x — NOT the 202% the undivided total would have claimed.
    expect(money.dayToDay?.changePct).toBe(40);
    expect(money.bills?.amount).toBe(1306.77);
    expect(money.total.amount).toBe(2429.0);
    expect(money.total.changePct).toBe(202);
  });

  it('reports a bills week with no prior bills as "no percentage", never as an infinite spike', () => {
    const money = buildRecapMoney(recap(W31));
    // A prior of exactly 0 cannot yield a percentage — the card says
    // "nothing here last week" rather than dividing by zero.
    expect(money.bills?.prior).toBe(0);
    expect(money.bills?.changePct).toBeNull();
    expect(money.bills?.delta).toBe(1306.77);
  });

  it('degrades to the total-only story when the split is absent — never a confident $0 day-to-day', () => {
    const money = buildRecapMoney(recap());
    expect(money.hasSplit).toBe(false);
    expect(money.dayToDay).toBeNull();
    expect(money.bills).toBeNull();
    expect(money.total.amount).toBe(412);
    expect(money.total.prior).toBe(468);
    expect(money.total.changePct).toBe(-12);
  });

  it('treats HALF a split as no split at all', () => {
    // One half without the other is not a decomposition, and rendering the
    // missing half as $0 would invent a figure the document never held.
    expect(buildRecapMoney(recap({ billsSpend: 100 })).hasSplit).toBe(false);
    expect(buildRecapMoney(recap({ dayToDaySpend: 100 })).hasSplit).toBe(false);
  });

  it('drops a prior figure the document does not carry, rather than reading it as zero', () => {
    const money = buildRecapMoney(
      recap({ billsSpend: 100, dayToDaySpend: 50, priorWeekDayToDaySpend: undefined })
    );
    expect(money.hasSplit).toBe(true);
    expect(money.dayToDay?.prior).toBeNull();
    expect(money.dayToDay?.delta).toBeNull();
    expect(money.dayToDay?.changePct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The personal card's tiles (DECK-1)
// ---------------------------------------------------------------------------

describe('buildPersonalTiles', () => {
  it('never emits a zero tile for a member with no perfect habit', () => {
    // The exact defect on the real W31 deck: a tile reading `0` / "Every day" /
    // "Nothing perfect this week" — an absence formatted as a statistic.
    const tiles = buildPersonalTiles(
      facts('paul', 'Paul', 28, {
        perfectHabits: [],
        completions: 6,
        topStreak: { habitTitle: 'Morning walk', days: 9, period: 'daily' },
      })
    );
    expect(tiles.map(t => t.id)).toEqual(['streak', 'completions']);
    expect(tiles.some(t => t.value === '0')).toBe(false);
    expect(tiles.some(t => t.label === 'Every day')).toBe(false);
  });

  it('prefers the streak and the perfect habit when both are real', () => {
    const tiles = buildPersonalTiles(
      facts('jen', 'Jen', 410, {
        perfectHabits: ['Reading', 'Water'],
        topStreak: { habitTitle: 'Morning walk', days: 9, period: 'daily' },
      })
    );
    expect(tiles.map(t => t.id)).toEqual(['streak', 'perfect']);
    expect(tiles[0]?.value).toBe('9');
    expect(tiles[1]?.value).toBe('7/7');
    expect(tiles[1]?.detail).toBe('Reading +1 more');
  });

  it('treats a zero-day streak as no streak', () => {
    const tiles = buildPersonalTiles(
      facts('paul', 'Paul', 10, {
        topStreak: { habitTitle: 'Morning walk', days: 0, period: 'daily' },
        completions: 4,
      })
    );
    expect(tiles.map(t => t.id)).toEqual(['completions']);
  });

  it('falls back to the best day when nothing else qualifies', () => {
    const tiles = buildPersonalTiles(
      facts('paul', 'Paul', 12, { completions: 0, bestDay: { date: '2026-07-04', points: 12 } })
    );
    expect(tiles.map(t => t.id)).toEqual(['bestDay']);
    expect(tiles[0]?.value).toBe('12');
    expect(tiles[0]?.detail).toBe('Saturday');
  });

  it('returns NO tiles for a genuinely empty week, rather than a row of zeroes', () => {
    const tiles = buildPersonalTiles(
      facts('paul', 'Paul', 0, { completions: 0, bestDay: null, topStreak: null, perfectHabits: [] })
    );
    expect(tiles).toEqual([]);
  });

  it('never emits a BLANK detail — the tile renders it unconditionally', () => {
    // An untitled habit would otherwise leave an empty line of whitespace
    // inside the tile. The streak is still real; only its name is missing.
    const tiles = buildPersonalTiles(
      facts('paul', 'Paul', 30, {
        perfectHabits: [],
        completions: 0,
        topStreak: { habitTitle: '   ', days: 4, period: 'daily' },
      })
    );
    expect(tiles[0]?.id).toBe('streak');
    expect(tiles[0]?.detail).toBe('your longest run');
    expect(tiles.every(t => t.detail.trim().length > 0)).toBe(true);
    expect(tiles.every(t => t.value.trim().length > 0)).toBe(true);
  });

  it('never emits more than two tiles', () => {
    const tiles = buildPersonalTiles(
      facts('jen', 'Jen', 410, {
        perfectHabits: ['Reading'],
        completions: 20,
        topStreak: { habitTitle: 'Walk', days: 9, period: 'daily' },
        bestDay: { date: '2026-07-04', points: 40 },
      })
    );
    expect(tiles).toHaveLength(2);
  });
});

describe('buildRecapDeck', () => {
  const base = {
    recaps: [recap()],
    members: MEMBERS,
    unattributedColor: '#a19b8c',
  };

  /**
   * 🛡️ ONE JOB PER CARD (DECK-1). Six cards, six questions, and — critically —
   * the household total is the hero exactly once. The pre-DECK-1 deck was four
   * cards carrying three ideas because `totalPoints` anchored both the week
   * card and the finish card.
   */
  it('orders the DECK-1 sequence, with the VIEWER\'s personal card after the household week', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'paul' });
    expect(deck.cards.map(c => c.kind)).toEqual([
      'cover',
      'money',
      'week',
      'personal',
      'standings',
      'finish',
    ]);
    expect(deck.cards[3]?.memberId).toBe('paul');
    expect(deck.viewer?.name).toBe('Paul');
  });

  it('shows the OTHER member their own card, from the same recap', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' });
    expect(deck.cards[3]?.memberId).toBe('jen');
    expect(deck.viewer?.name).toBe('Jen');
  });

  it('drops the personal card for a viewer with no facts, rather than showing an empty one', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'someone-else' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'money', 'week', 'standings', 'finish']);
    expect(deck.viewer).toBeNull();
  });

  it('drops the standings card entirely when there is no one to compare against', () => {
    const solo = recap({ memberFacts: [facts('jen', 'Jen', 410)] });
    const deck = buildRecapDeck({ ...base, recap: solo, viewerId: 'jen' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'money', 'week', 'personal', 'finish']);
  });

  it('drops the standings card when the only other member is a MANAGED kid (adults only)', () => {
    // Leo's chore points are an allowance ledger, not a competitive score — a
    // one-adult household has nothing to stand against, so no standings card.
    const withKid = recap({
      memberFacts: [facts('kid_leo', 'Leo', 900, { isManaged: true }), facts('jen', 'Jen', 410)],
    });
    const deck = buildRecapDeck({ ...base, recap: withKid, viewerId: 'jen' });
    expect(deck.cards.map(c => c.kind)).toEqual(['cover', 'money', 'week', 'personal', 'finish']);
  });

  // --- The tone MOVES the head-to-head; it no longer duplicates a figure ----

  it('PROMOTES the standings ahead of the household week under the podium tone', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'paul', tone: 'podium' });
    expect(deck.cards.map(c => c.kind)).toEqual([
      'cover',
      'money',
      'standings',
      'week',
      'personal',
      'finish',
    ]);
    expect(deck.framing).toBe('podium');
  });

  it('DEMOTES the standings behind the personal card under household_first', () => {
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'paul', tone: 'household_first' });
    expect(deck.cards.map(c => c.kind).indexOf('standings')).toBeGreaterThan(
      deck.cards.map(c => c.kind).indexOf('personal')
    );
    expect(deck.framing).toBe('together');
  });

  it('adaptive promotes the standings only on a RUNAWAY week', () => {
    const close = buildRecapDeck({ ...base, recap: recap(), viewerId: 'paul', tone: 'adaptive' });
    expect(close.cards.map(c => c.kind).indexOf('standings')).toBeGreaterThan(
      close.cards.map(c => c.kind).indexOf('week')
    );
    expect(close.framing).toBe('together');

    // 600 vs 200: margin 400 clears both the 50-point floor and 25% of 200.
    const runaway = recap({ memberFacts: [facts('jen', 'Jen', 600), facts('paul', 'Paul', 200)] });
    const crowned = buildRecapDeck({ ...base, recap: runaway, viewerId: 'paul', tone: 'adaptive' });
    expect(crowned.cards.map(c => c.kind).indexOf('standings')).toBeLessThan(
      crowned.cards.map(c => c.kind).indexOf('week')
    );
    expect(crowned.framing).toBe('podium');
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
    expect(deck.cards.map(c => c.kind)).toEqual([
      'cover',
      'money',
      'week',
      'personal',
      'standings',
      'finish',
    ]);
    expect(deck.householdSharePoints).toBe(15);
  });

  // --- The household series has a NAME now (DECK-1 / RECAP-MATH) ------------

  it('reads the week-total unattributedSplit when the server wrote one', () => {
    const withSplit = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 5,
        total: i === 0 ? 115 : 100,
      })),
      unattributedSplit: { householdCredit: 44, unclaimed: 6 },
    });
    const deck = buildRecapDeck({ ...base, recap: withSplit, viewerId: 'jen' });
    expect(deck.householdSplit).toEqual({ householdCredit: 44, unclaimed: 6 });
    expect(deck.householdSharePoints).toBe(50);
  });

  it('falls back to summing the PER-DAY splits when no week total was written', () => {
    const perDay = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 115 : 95,
        unattributedSplit: i === 0 ? { householdCredit: 15, unclaimed: 5 } : { householdCredit: 0, unclaimed: 0 },
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: perDay, viewerId: 'jen' });
    expect(deck.householdSplit).toEqual({ householdCredit: 15, unclaimed: 5 });
  });

  it('REFUSES a partial per-day fallback rather than under-reporting the household credit', () => {
    // Tuesday carries 30 unattributed points and no split. Summing only the
    // days that explain themselves would report 15 + 5 = 20 against a
    // householdSharePoints of 50 — breaking the one invariant the pair holds.
    const partial = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : i === 1 ? 30 : 0,
        total: 95,
        ...(i === 0 ? { unattributedSplit: { householdCredit: 15, unclaimed: 5 } } : {}),
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: partial, viewerId: 'jen' });
    expect(deck.householdSplit).toBeNull();
    expect(deck.householdSharePoints).toBe(50);
  });

  it('reports NULL (unknown), never a confident zero, for a recap that predates the split', () => {
    // 🛡️ The card must not render "0 household credit" for a week that never
    // measured the question — that is the difference between "nobody earned
    // points together" and "we don't know who earned them".
    const deck = buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' });
    expect(deck.householdSplit).toBeNull();
  });

  // --- Negative days, on the deck ------------------------------------------

  it('names the week\'s DEEPEST losing day as worstDay, and nothing when the week never dipped', () => {
    const withLoss = recap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: i === 0 ? -5 : i === 1 ? -30 : 50 },
        unattributed: 0,
        total: i === 0 ? -5 : i === 1 ? -30 : 50,
      })),
    });
    const deck = buildRecapDeck({ ...base, recap: withLoss, viewerId: 'jen' });
    expect(deck.worstDay?.date).toBe(DAYS[1]);
    expect(deck.worstDay?.total).toBe(-30);
    expect(deck.chart[0]?.negative).toBe(true);

    expect(buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' }).worstDay).toBeNull();
  });

  // --- The narrative is a THREE-state field (ARCH-1) ------------------------

  it('reports hasNarrative independently of `premium`, so an absent narrative is its own state', () => {
    expect(buildRecapDeck({ ...base, recap: recap(), viewerId: 'jen' }).hasNarrative).toBe(true);
    expect(
      buildRecapDeck({ ...base, recap: recap({ premium: false }), viewerId: 'jen' }).hasNarrative
    ).toBe(true);
    // A client-derived recap: real numbers, no prose. `premium` stays truthful.
    expect(
      buildRecapDeck({ ...base, recap: recap({ narrative: '' }), viewerId: 'jen' }).hasNarrative
    ).toBe(false);
    expect(
      buildRecapDeck({ ...base, recap: recap({ narrative: '   ' }), viewerId: 'jen' }).hasNarrative
    ).toBe(false);
    expect(
      buildRecapDeck({
        ...base,
        recap: recap({ narrative: undefined as unknown as string }),
        viewerId: 'jen',
      }).hasNarrative
    ).toBe(false);
  });

  it('carries the money model onto the deck', () => {
    const deck = buildRecapDeck({
      ...base,
      recap: recap({
        totalSpend: 2429.0,
        priorWeekSpend: 803.12,
        billsSpend: 1306.77,
        priorWeekBillsSpend: 0,
        dayToDaySpend: 1122.23,
        priorWeekDayToDaySpend: 803.12,
      }),
      viewerId: 'jen',
    });
    expect(deck.money.hasSplit).toBe(true);
    expect(deck.money.dayToDay?.changePct).toBe(40);
  });
});

/**
 * `buildRecapChart` clamps every segment to its positive share, so a week whose
 * household share nets negative draws no Household bar. The chart STAYS
 * positive-only (a stacked bar can't honestly show a negative slice) — DECK-1
 * gives losing DAYS their own below-baseline register instead, and the LEGEND
 * still may not advertise a series with nothing drawn for it. These cases walk
 * the state space of `dailyPoints[].unattributed` signs across a week, plus the
 * case where a segment's EXISTENCE and its column's HEIGHT disagree.
 *
 * 🛡️ The gate is now `deck.chartHasHouseholdBar`, computed IN THE MODEL — the
 * component used to re-derive the expression, which meant this suite could only
 * mirror it and hope. One source, asserted directly.
 */
describe('household share vs. chart consistency (recap-chart-negative-days)', () => {
  const base = {
    recaps: [recap()],
    members: MEMBERS,
    unattributedColor: '#a19b8c',
  };

  const hasHouseholdBar = (deck: ReturnType<typeof buildRecapDeck>): boolean => deck.chartHasHouseholdBar;

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

    // ...but the rounding must not over-round to integers. This case pins
    // GRANULARITY, not a producible datum: a per-completion rate is
    // `sign × floor(|basePoints| × multiplier)` and units are integers, so the
    // writer cannot actually emit a `.5` (5 × 1.5 floors to 7). 7.5 is a
    // hand-built input standing in for anything fractional that reached the
    // model through `weeklyRecapConverter`'s untyped cast — 2dp leaves it
    // readable rather than flattening it.
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
