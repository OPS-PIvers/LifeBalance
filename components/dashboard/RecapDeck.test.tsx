import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CeremonyTone, HouseholdMember, RecapMemberFacts, WeeklyRecap } from '@/types/schema';
import { buildRecapDeck } from '@/utils/recapDeck';

/**
 * RecapDeck — the rebuilt weekly ceremony (DECK-1).
 *
 * What this suite exists to hold down, in the owner's words about the shipped
 * 2026-W31 deck: "four cards but only three ideas" (the household total was the
 * hero twice), a personal tile reading `0` / "Nothing perfect this week",
 * Monday rendering as a zero-height column, no money anywhere in a household
 * FINANCE app's ceremony, and four branches of apologetic copy explaining why
 * the chart disagreed with the household number.
 *
 * Deck BEHAVIOUR lives here, against the component directly. The host drawer's
 * own suite keeps only the ONE-ARTIFACT gate (deck vs pre-deck layout).
 */

const mockCore = { householdSettings: { name: 'The Ivers Household', currency: 'USD' } };
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));

const reduceMotion = vi.fn(() => false);
vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => reduceMotion() }));

import { RecapDeck } from './RecapDeck';

// ---------------------------------------------------------------------------
// Fixtures — anchored to their OWN week (Mon 2026-07-27 → Sun 2026-08-02), the
// real 2026-W31. Never an offset from today: a weekday-dependent recap test has
// blocked a production deploy in this repo before.
// ---------------------------------------------------------------------------

const WEEK = '2026-W31';
const DAYS = [
  '2026-07-27',
  '2026-07-28',
  '2026-07-29',
  '2026-07-30',
  '2026-07-31',
  '2026-08-01',
  '2026-08-02',
];

const MEMBERS = [
  { uid: 'jen', displayName: 'Jen' },
  { uid: 'paul', displayName: 'Paul' },
] as unknown as HouseholdMember[];

function facts(
  memberId: string,
  name: string,
  points: number,
  extra: Partial<RecapMemberFacts> = {}
): RecapMemberFacts {
  return {
    memberId,
    name,
    points,
    completions: 12,
    bestDay: { date: '2026-08-01', points: 30 },
    topStreak: { habitTitle: 'Morning walk', days: 9, period: 'daily' },
    perfectHabits: ['Reading'],
    ...extra,
  };
}

/**
 * 🛡️ THE REAL W31 MONEY. $2,429.00 total against a $803.12 prior week reads as
 * a 3.3x blowout — and says nothing, because $1,306.77 of it was bills the
 * calendar had already budgeted. Day-to-day was $1,122.23 vs $803.12: a 1.4x
 * rise. That gap is why the money card exists and why it never leads with the
 * total.
 */
function makeRecap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    id: WEEK,
    isoWeek: WEEK,
    generatedAt: '2026-08-03T11:00:00.000Z',
    totalSpend: 2429.0,
    priorWeekSpend: 803.12,
    billsSpend: 1306.77,
    priorWeekBillsSpend: 0,
    dayToDaySpend: 1122.23,
    priorWeekDayToDaySpend: 803.12,
    topCategoryDeltas: [{ category: 'Groceries', current: 180, prior: 220 }],
    habitCompletions: 32,
    streaksAtRisk: [{ habitTitle: 'Exercise', streakDays: 5 }],
    pointsByMember: [
      { memberId: 'jen', name: 'Jen', points: 410 },
      { memberId: 'paul', name: 'Paul', points: 385 },
    ],
    upcomingBills: [{ title: 'Rent', amount: 1200, date: '2026-08-05' }],
    narrative: 'A strong week for the household.',
    narrativeSource: 'ai',
    premium: true,
    memberFacts: [facts('jen', 'Jen', 410), facts('paul', 'Paul', 385, { perfectHabits: [] })],
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

function renderDeck(
  overrides: Partial<WeeklyRecap> = {},
  opts: { viewerId?: string | null; tone?: CeremonyTone | null; onComplete?: () => void } = {}
): WeeklyRecap {
  const recap = makeRecap(overrides);
  const deck = buildRecapDeck({
    recap,
    recaps: [recap],
    members: MEMBERS,
    viewerId: opts.viewerId === undefined ? 'paul' : opts.viewerId,
    tone: opts.tone ?? null,
    unattributedColor: '#a19b8c',
  });
  render(
    <RecapDeck
      deck={deck}
      recap={recap}
      householdName="The Ivers Household"
      onComplete={opts.onComplete}
    />
  );
  return recap;
}

/** Advance the deck one card per marker, waiting for each to arrive. */
async function advance(markers: (string | RegExp)[]): Promise<void> {
  for (const marker of markers) {
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    // Sequential by construction — each card must mount before the next click.
    await screen.findByText(marker);
  }
}

const MONEY = /The week's money/;
const WEEK_CARD = 'Together you scored';
const FINISH = /Final/;

beforeEach(() => {
  reduceMotion.mockReturnValue(false);
});

// ---------------------------------------------------------------------------

describe('RecapDeck — card sequence', () => {
  it('walks cover → money → household week → your week → standings → finish', async () => {
    renderDeck();
    // Cover: the week, and only the week.
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText('Jul 27 – Aug 2')).toBeInTheDocument();

    await advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split', FINISH]);
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled();
  });

  it('shows Jen her OWN personal card from the same recap', async () => {
    renderDeck({}, { viewerId: 'jen' });
    await advance([MONEY, WEEK_CARD, 'Your week, Jen']);
  });

  it('disables the edges rather than wrapping around', async () => {
    renderDeck();
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeDisabled();
    await advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split', FINISH]);
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled();
  });

  it('fires onComplete exactly once, on reaching the final card', async () => {
    const onComplete = vi.fn();
    renderDeck({}, { onComplete });
    expect(onComplete).not.toHaveBeenCalled();

    await advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split', FINISH]);
    expect(onComplete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    await screen.findByText('How the week split');
    await advance([FINISH]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — money is in the ceremony', () => {
  it('leads with DAY-TO-DAY spend against its own prior week, not the lumpy total', async () => {
    renderDeck();
    await advance([MONEY]);

    // The hero is the steerable half — $1,122 vs $803, a 40% rise.
    expect(screen.getByText('$1,122')).toBeInTheDocument();
    expect(screen.getByText('day to day')).toBeInTheDocument();
    expect(screen.getByText('vs $803 last week')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();

    // Bills are reported beside it, with their OWN comparison...
    expect(screen.getByText('Bills the calendar already had')).toBeInTheDocument();
    expect(screen.getByText('$1,307')).toBeInTheDocument();

    // ...and the total is a closing line, never the headline. The 202% swing
    // the undivided figure implies is nowhere on the card.
    expect(screen.getByText('$2,429 out the door all in')).toBeInTheDocument();
    expect(screen.queryByText('202%')).not.toBeInTheDocument();
  });

  it('paints a spend INCREASE in the negative tone — polarity is not the sign', async () => {
    // 🛡️ More points is good; more spending is not. The pre-DECK-1 chip
    // hard-coded "positive ⇒ green", which would have painted W31's 40%
    // day-to-day jump as a win.
    renderDeck();
    await advance([MONEY]);
    const chip = screen.getByText('40%').closest('span');
    expect(chip?.className).toContain('text-money-neg');
    expect(chip?.className).not.toContain('text-money-pos');
  });

  it('paints a spend DECREASE in the positive tone', async () => {
    renderDeck({ dayToDaySpend: 400, priorWeekDayToDaySpend: 803.12 });
    await advance([MONEY]);
    const chip = screen.getByText('50%').closest('span');
    expect(chip?.className).toContain('text-money-pos');
  });

  it('says "nothing here last week" rather than an infinite spike when the prior week had no bills', async () => {
    renderDeck();
    await advance([MONEY]);
    expect(screen.getByText('nothing here last week')).toBeInTheDocument();
  });

  it('degrades to the total-only story for a recap with no split — never a confident $0', async () => {
    renderDeck({ billsSpend: undefined, dayToDaySpend: undefined });
    await advance([MONEY]);
    expect(screen.getByText('$2,429')).toBeInTheDocument();
    expect(screen.getByText('spent')).toBeInTheDocument();
    expect(screen.queryByText('day to day')).not.toBeInTheDocument();
    expect(screen.queryByText('Bills the calendar already had')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — the household week', () => {
  it('makes the household total the hero EXACTLY ONCE — the finish card no longer repeats it', async () => {
    renderDeck();
    await advance([MONEY, WEEK_CARD]);
    expect(screen.getByText('795')).toBeInTheDocument();

    await advance(['Your week, Paul', 'How the week split', FINISH]);
    // The whole point of the rebuild: card 6 is a payoff, not card 3 again.
    expect(screen.queryByText('795')).not.toBeInTheDocument();
  });

  it('draws a net-negative day below the baseline instead of leaving a blank column', async () => {
    // Monday nets -5 — exactly the real W31 shape the owner flagged as "a
    // zero-height column". The stack above the line is still positive-only.
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 0 ? { jen: -5, paul: 0 } : { jen: 50, paul: 45 },
        unattributed: 0,
        total: i === 0 ? -5 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);

    expect(screen.getByTestId(`recap-chart-deficit-${DAYS[0]}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`recap-chart-deficit-${DAYS[1]}`)).not.toBeInTheDocument();

    // ...and the day is NAMED, so the mark has a meaning.
    const worst = screen.getByTestId('recap-worst-day');
    expect(worst).toHaveTextContent('Monday');
    expect(worst).toHaveTextContent('finished below zero');
    expect(worst).toHaveTextContent('-5');

    // The legend explains the new register.
    expect(screen.getByText('Below zero')).toBeInTheDocument();
  });

  it('draws no deficit gutter at all for a week that never dipped', async () => {
    renderDeck();
    await advance([MONEY, WEEK_CARD]);
    expect(screen.queryByTestId('recap-worst-day')).not.toBeInTheDocument();
    expect(screen.queryByText('Below zero')).not.toBeInTheDocument();
  });

  it('names the Household series from unattributedSplit — and carries NO apologetic copy', async () => {
    // 🛡️ `householdShareCopy` is DELETED. The household's own points are
    // deliberate (15 `creditMode: 'household'` habits here — groceries,
    // dinners, leftovers), so the card states them. `unclaimed` is its own
    // quiet line, never a caveat bolted onto the first.
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 115 : 95,
      })),
      unattributedSplit: { householdCredit: 14, unclaimed: 6 },
    });
    await advance([MONEY, WEEK_CARD]);

    const credit = screen.getByTestId('recap-household-credit');
    expect(credit).toHaveTextContent('14');
    expect(credit).toHaveTextContent('from habits the whole household shares');

    const unclaimed = screen.getByTestId('recap-household-unclaimed');
    expect(unclaimed).toHaveTextContent('6');
    expect(unclaimed).toHaveTextContent("couldn't trace back to a person");

    // Every branch of the deleted helper, gone.
    expect(screen.queryByText(/earned together/)).not.toBeInTheDocument();
    expect(screen.queryByText(/the chart draws no column/)).not.toBeInTheDocument();
    expect(screen.queryByText(/this loss is not in it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ended flat or down/)).not.toBeInTheDocument();
  });

  it('suppresses a zero half of the split rather than printing "0 household credit"', async () => {
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 115 : 95,
      })),
      unattributedSplit: { householdCredit: 20, unclaimed: 0 },
    });
    await advance([MONEY, WEEK_CARD]);
    expect(screen.getByTestId('recap-household-credit')).toBeInTheDocument();
    expect(screen.queryByTestId('recap-household-unclaimed')).not.toBeInTheDocument();
  });

  it('states the bare figure, with no apology, for a recap that predates the split', async () => {
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 115 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);

    const share = screen.getByTestId('recap-household-share');
    expect(share).toHaveTextContent('20');
    expect(share).toHaveTextContent('credited to no one member');
    // ...and NOT rendered as a confident "0 household credit".
    expect(screen.queryByTestId('recap-household-credit')).not.toBeInTheDocument();
    expect(screen.queryByText(/earned together/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — the Household legend never contradicts the chart', () => {
  // 🛡️ `chartHasHouseholdBar` is a NARROWER truth than "the household holds
  // any points this week": it requires a household segment to land on a bar
  // the chart actually DRAWS (`heightPct > 0`), not merely to exist somewhere
  // in `dailyPoints`. A legend gated on existence alone would advertise a
  // series the chart never drew — exactly the contradiction `unattributedSplit`
  // and the deleted `householdShareCopy` both existed to paper over. These four
  // cases pin both directions of the gate at `RecapDeck.tsx`'s `chartHasHouseholdBar &&`.
  // The positive control is load-bearing: without it, three negative
  // assertions would still pass if the legend were deleted outright.

  it('shows the legend when a household segment lands on a DRAWN bar (positive control)', async () => {
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 115 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);
    expect(screen.getByText('Household')).toBeInTheDocument();
  });

  it('hides the legend on a MIXED-SIGN week — the only household segment sits on a day that nets negative', async () => {
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 0 ? { jen: -30, paul: -5 } : { jen: 50, paul: 45 },
        unattributed: i === 0 ? 10 : 0,
        total: i === 0 ? -25 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);
    expect(screen.queryByText('Household')).not.toBeInTheDocument();
  });

  it('hides the legend for an ALL-NEGATIVE unattributed week — no household segment ever qualifies', async () => {
    renderDeck({
      dailyPoints: DAYS.map(date => ({
        date,
        byMember: { jen: 50, paul: 45 },
        unattributed: -5,
        total: 90,
      })),
    });
    await advance([MONEY, WEEK_CARD]);
    expect(screen.queryByText('Household')).not.toBeInTheDocument();
  });

  it('hides the legend when the household segment sits on a ZERO-HEIGHT column', async () => {
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 0 ? { jen: -30, paul: 10 } : { jen: 50, paul: 45 },
        unattributed: i === 0 ? 20 : 0,
        total: i === 0 ? 0 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);
    expect(screen.queryByText('Household')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — accessibility (visual/a11y review)', () => {
  it('gives the 7-day chart a text alternative that names every day AND calls out the negative one', async () => {
    // 🛡️ The below-baseline deficit stub is this PR's own fix for a losing day
    // drawing nothing — but a screen reader hears nothing from an unlabelled
    // chart of plain `<div>`s either, hitting the identical bug through a
    // different modality. `role="img"` collapses the whole chart to ONE
    // accessible name so the per-column weekday letters aren't announced a
    // second time.
    renderDeck({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 2 ? { jen: -6, paul: -4 } : { jen: 50, paul: 45 },
        unattributed: 0,
        total: i === 2 ? -10 : 95,
      })),
    });
    await advance([MONEY, WEEK_CARD]);

    const chart = screen.getByRole('img', { name: /Points by day/ });
    const label = chart.getAttribute('aria-label') ?? '';
    // Every winning day states just its total — no "net loss" tacked on.
    expect(label).toContain('Monday: 95 points;');
    expect(label).toContain('Sunday: 95 points.');
    // The one losing day is called out explicitly, by name and amount.
    expect(label).toContain('Wednesday: -10 points, a net loss;');
  });

  it('conveys the trend chip\'s direction to assistive tech, not just via the hidden icon', async () => {
    // The `Icon` is `aria-hidden` and the number was always unsigned — a
    // screen reader heard "1% vs $123 last week" with no way to tell which
    // way it moved. The added word is DIRECTION only, never a value judgment
    // (spending "up" is not "good", so the sr-only text can't say either).
    renderDeck();
    await advance([MONEY]);
    // Day-to-day spend ROSE 40% — the chip must say "up" for AT, regardless
    // of its (negative/bad) visual tone.
    const upChip = screen.getByText('40%').closest('span');
    expect(upChip).toHaveTextContent(/^up\s*40%$/);
  });

  it('says "down" for a decreasing trend', async () => {
    renderDeck({ dayToDaySpend: 400, priorWeekDayToDaySpend: 803.12 });
    await advance([MONEY]);
    const downChip = screen.getByText('50%').closest('span');
    expect(downChip).toHaveTextContent(/^down\s*50%$/);
  });

  it('wraps the Money card hero figure instead of clipping it for a long currency-formatted value', async () => {
    // 🛡️ `HeroNumber` previously had no `flex-wrap`, and its only prior callers
    // fed it 3-digit point totals. `MoneyCard` is the first caller to feed it
    // a currency-formatted string, and a two-char prefix (`CA$1,234`) or an
    // unconverted 5-6 digit JPY amount (`¥1,234,567`) can outgrow the card's
    // fixed mobile viewport width the single-character `$` assumed — measured
    // live in Test Mode, the unit label's right edge landed outside the
    // deck's `overflow-hidden` wrapper. jsdom does no real layout, so this
    // pins the STRUCTURAL fix (the row wraps rather than staying nowrap) —
    // the actual pixel measurement was done in a live browser, not here.
    renderDeck();
    await advance([MONEY]);
    const heroValue = screen.getByText('$1,122');
    const heroRow = heroValue.parentElement;
    expect(heroRow?.className).toContain('flex-wrap');
    expect(heroRow?.className).not.toMatch(/\bflex-nowrap\b/);
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — the personal card', () => {
  it('never renders a bare 0 tile for a member with no perfect habit', async () => {
    // The shipped defect verbatim: `0` / "Every day" / "Nothing perfect this
    // week". Paul has a streak and completions — both true, both useful.
    renderDeck();
    await advance([MONEY, WEEK_CARD, 'Your week, Paul']);

    expect(screen.queryByText('Nothing perfect this week')).not.toBeInTheDocument();
    expect(screen.queryByText('Every day')).not.toBeInTheDocument();
    expect(screen.getByText('Day streak')).toBeInTheDocument();
    expect(screen.getByText('Habits logged')).toBeInTheDocument();

    // 🛡️ POSITIVE CONTROL for the streak prose line. Every OTHER test that
    // touches "longest run" only asserts its ABSENCE (the zero-day case
    // below) — nothing in this suite previously proved the sentence renders
    // at all when a real streak exists, so deleting the whole `streak &&`
    // branch in `PersonalCard` would have left every assertion in the file
    // green. Paul's default fixture already carries a 9-day streak.
    const prose = screen.getByText(
      (_, element) => element?.tagName === 'P' && /longest run/.test(element.textContent ?? '')
    );
    expect(prose).toHaveTextContent('Morning walk');
    expect(prose).toHaveTextContent('longest run');
    expect(prose).toHaveTextContent('9 days');
  });

  it('shows the perfect-habit tile when there IS one', async () => {
    renderDeck({}, { viewerId: 'jen' });
    await advance([MONEY, WEEK_CARD, 'Your week, Jen']);
    expect(screen.getByText('Every day')).toBeInTheDocument();
    expect(screen.getByText('7/7')).toBeInTheDocument();
  });

  it('never announces a ZERO-day streak in the prose line either (one gate, shared with the tiles)', async () => {
    // `buildPersonalTiles` drops a 0-day streak; the paragraph beneath used to
    // guard only on the object's presence, so it would say "Morning walk is
    // your longest run · 0 days" beside a tile row that had correctly dropped
    // it. Both surfaces now read the same normalised value.
    renderDeck({
      memberFacts: [
        facts('jen', 'Jen', 410),
        facts('paul', 'Paul', 40, {
          perfectHabits: [],
          completions: 4,
          topStreak: { habitTitle: 'Morning walk', days: 0, period: 'daily' },
        }),
      ],
    });
    await advance([MONEY, WEEK_CARD, 'Your week, Paul']);
    expect(screen.queryByText(/longest run/)).not.toBeInTheDocument();
    expect(screen.queryByText('Day streak')).not.toBeInTheDocument();
    // The true stat survives.
    expect(screen.getByText('Habits logged')).toBeInTheDocument();
  });

  it('replaces the tiles with a true sentence for a genuinely empty week', async () => {
    renderDeck({
      memberFacts: [
        facts('jen', 'Jen', 410),
        facts('paul', 'Paul', 0, {
          completions: 0,
          bestDay: null,
          topStreak: null,
          perfectHabits: [],
        }),
      ],
    });
    await advance([MONEY, WEEK_CARD, 'Your week, Paul']);
    expect(screen.getByTestId('recap-quiet-week')).toHaveTextContent('A quiet week under your name');
    expect(screen.queryByText('Day streak')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — tone framing', () => {
  it('podium: the head-to-head is PROMOTED ahead of the household week and crowned', async () => {
    renderDeck({}, { tone: 'podium' });
    await advance([MONEY, 'Won the week']);
    expect(screen.getByText('25 clear of Paul')).toBeInTheDocument();
    // The household week has NOT been read yet — that's what "promoted" means.
    expect(screen.queryByText(WEEK_CARD)).not.toBeInTheDocument();
    await advance([WEEK_CARD]);
  });

  it('household_first: the head-to-head sits AFTER the personal card and never crowns', async () => {
    renderDeck({}, { tone: 'household_first' });
    await advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split']);
    expect(screen.queryByText('Won the week')).not.toBeInTheDocument();
    expect(screen.queryByText('Ran away with the week')).not.toBeInTheDocument();
    expect(screen.getByText("Everyone's own score, chores included.")).toBeInTheDocument();
  });

  it('adaptive: a CLOSE week is framed flat, exactly like household_first', async () => {
    // 410 vs 385 — a 25-point margin misses both runaway thresholds (a 50-point
    // floor AND 25% of the runner-up), which are duplicated verbatim in
    // functions/src/recap/narrative.ts and unchanged by DECK-1.
    renderDeck({}, { tone: 'adaptive' });
    await advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split']);
    expect(screen.queryByText('Ran away with the week')).not.toBeInTheDocument();
  });

  it('adaptive: a RUNAWAY week promotes and crowns', async () => {
    renderDeck(
      { memberFacts: [facts('jen', 'Jen', 600), facts('paul', 'Paul', 200, { perfectHabits: [] })] },
      { tone: 'adaptive' }
    );
    await advance([MONEY, 'Ran away with the week']);
    expect(screen.getByText('400 clear of Paul')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — adults only', () => {
  it('keeps a managed kid out of the standings but still gives them their own card', async () => {
    // 🛡️ Leo's 900 points are chores credited to his own member doc — an
    // allowance ledger, not a competitive score. He must never crown the week.
    renderDeck(
      {
        memberFacts: [
          facts('kid_leo', 'Leo', 900, { isManaged: true, perfectHabits: [] }),
          facts('jen', 'Jen', 410),
          facts('paul', 'Paul', 385, { perfectHabits: [] }),
        ],
      },
      { viewerId: 'kid_leo', tone: 'podium' }
    );

    await advance([MONEY, 'Won the week']);
    // Jen leads on 410 — Leo's 900 is not in this comparison at all.
    expect(screen.getByText('25 clear of Paul')).toBeInTheDocument();
    expect(screen.queryByText('900')).not.toBeInTheDocument();
    expect(screen.queryByText('Leo')).not.toBeInTheDocument();

    // ...and Leo still gets his own personal card.
    await advance([WEEK_CARD, 'Your week, Leo']);
    expect(screen.getByText('900')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — the finish card and its THREE narrative states (ARCH-1)', () => {
  const walkToFinish = () => advance([MONEY, WEEK_CARD, 'Your week, Paul', 'How the week split', FINISH]);

  it('state 1 — premium WITH a narrative renders the prose, unblurred', async () => {
    renderDeck();
    await walkToFinish();
    const prose = screen.getByText('A strong week for the household.');
    expect(prose).toBeInTheDocument();
    expect(prose).not.toHaveClass('blur-sm');
    expect(screen.queryByText('Unlock your personal recap with Premium')).not.toBeInTheDocument();
  });

  it('state 2 — NOT premium WITH a narrative keeps the existing blur + upsell', async () => {
    // Pinned explicitly: the premium gate must not silently regress while
    // state 3 is being added.
    renderDeck({ premium: false });
    await walkToFinish();
    expect(screen.getByText('A strong week for the household.')).toHaveClass('blur-sm');
    expect(screen.getByText('Unlock your personal recap with Premium')).toBeInTheDocument();
  });

  it('state 3 — premium with NO narrative renders neither prose nor upsell', async () => {
    renderDeck({ narrative: '' });
    await walkToFinish();
    expect(screen.queryByText('Unlock your personal recap with Premium')).not.toBeInTheDocument();
    // The card still stands on its own.
    expect(screen.getByText(/That's a wrap on Week 31|Best week this month/)).toBeInTheDocument();
    expect(screen.getByTestId('recap-carry-forward')).toBeInTheDocument();
  });

  it('state 3 — NOT premium with NO narrative shows the SAME thing, never a paywall', async () => {
    // 🛡️ The bug this closes: a client-derived recap (real numbers, no prose)
    // used to fall into the not-premium branch and advertise Premium as the way
    // to unlock content that was never written.
    renderDeck({ premium: false, narrative: '' });
    await walkToFinish();
    expect(screen.queryByText('Unlock your personal recap with Premium')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your personalized weekly summary/)).not.toBeInTheDocument();
    expect(screen.getByTestId('recap-carry-forward')).toBeInTheDocument();
  });

  it('closes on a payoff — the week\'s verdict and what to carry forward', async () => {
    renderDeck();
    await walkToFinish();
    expect(screen.getByText('32')).toBeInTheDocument(); // things done together
    const carry = screen.getByTestId('recap-carry-forward');
    expect(carry).toHaveTextContent('Exercise');
    expect(carry).toHaveTextContent('5d');
  });
});

// ---------------------------------------------------------------------------

describe('RecapDeck — reduced motion', () => {
  it('disables drag and keeps every non-gestural path working', async () => {
    reduceMotion.mockReturnValue(true);
    renderDeck();
    const slide = screen.getByRole('group');
    // framer-motion's drag handling attaches a touch-action style; with drag
    // off, the element carries none.
    expect(slide.style.touchAction).toBe('');
    await advance([MONEY, WEEK_CARD]);
    expect(screen.getByText('795')).toBeInTheDocument();
  });

  it('DOES arm drag when motion is allowed', () => {
    reduceMotion.mockReturnValue(false);
    renderDeck();
    expect(screen.getByRole('group').style.touchAction).not.toBe('');
  });
});
