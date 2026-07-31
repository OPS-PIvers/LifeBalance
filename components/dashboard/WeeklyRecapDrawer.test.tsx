import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HouseholdMember, RecapMemberFacts, WeeklyRecap } from '@/types/schema';
import { track } from '@/services/analytics';

/**
 * WeeklyRecapDrawer — the ceremony's host surface (per-member points, stage 5).
 *
 * The two behaviours worth pinning are the two halves of the ONE-ARTIFACT rule:
 * a recap WITH the per-member fields opens as the story deck (money detail
 * still reachable underneath), and a recap WITHOUT them renders the pre-deck
 * layout byte-for-byte as it always did.
 */

const mockCore: {
  householdSettings: Record<string, unknown> | null;
  members: HouseholdMember[];
  currentUser: { uid: string } | null;
  recaps: WeeklyRecap[];
} = {
  householdSettings: { name: 'The Ivers Household' },
  members: [],
  currentUser: { uid: 'paul' },
  recaps: [],
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

// The Drawer primitive is a portal + focus trap + framer-motion sheet; none of
// that is under test here, so it's reduced to a plain container (the same
// approach WeeklyRecapCard.test.tsx takes with the drawer itself).
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, title, children }: { isOpen: boolean; title?: string; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

import { WeeklyRecapDrawer } from './WeeklyRecapDrawer';

function facts(memberId: string, name: string, points: number, extra: Partial<RecapMemberFacts> = {}): RecapMemberFacts {
  return {
    memberId,
    name,
    points,
    completions: 12,
    bestDay: { date: '2026-07-04', points: 30 },
    topStreak: { habitTitle: 'Morning walk', days: 9, period: 'daily' },
    perfectHabits: ['Reading'],
    ...extra,
  };
}

const DAYS = [
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
];

function makeRecap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    id: '2026-W27',
    isoWeek: '2026-W27',
    generatedAt: '2026-07-06T11:00:00.000Z',
    totalSpend: 412,
    priorWeekSpend: 468,
    topCategoryDeltas: [{ category: 'Groceries', current: 180, prior: 220 }],
    habitCompletions: 20,
    streaksAtRisk: [{ habitTitle: 'Exercise', streakDays: 5 }],
    pointsByMember: [
      { memberId: 'jen', name: 'Jen', points: 410 },
      { memberId: 'paul', name: 'Paul', points: 385 },
    ],
    upcomingBills: [{ title: 'Rent', amount: 1200, date: '2026-07-08' }],
    narrative: 'A strong week for the household.',
    narrativeSource: 'ai',
    premium: true,
    ...overrides,
  };
}

/** The same recap, plus everything the ceremony deck needs. */
function ceremonyRecap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return makeRecap({
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
  });
}

describe('WeeklyRecapDrawer', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    mockCore.householdSettings = { name: 'The Ivers Household' };
    mockCore.members = [
      { uid: 'jen', displayName: 'Jen' },
      { uid: 'paul', displayName: 'Paul' },
    ] as unknown as HouseholdMember[];
    mockCore.currentUser = { uid: 'paul' };
    mockCore.recaps = [];
  });

  it('renders nothing without a recap', () => {
    const { container } = render(<WeeklyRecapDrawer recap={null} isOpen onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  // --- Graceful degrade ----------------------------------------------------

  it('renders the PRE-DECK layout for a recap with no per-member fields', () => {
    render(<WeeklyRecapDrawer recap={makeRecap()} isOpen onClose={() => {}} />);
    expect(screen.getByText('Spending')).toBeInTheDocument();
    expect(screen.getByText('Bills this week')).toBeInTheDocument();
    // The narrative keeps its own section (it only moves onto the finish card
    // when there IS a deck), and no deck chrome is mounted.
    expect(screen.getByText('Your recap')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument();
    expect(screen.queryByText('Week details')).not.toBeInTheDocument();
  });

  it('renders the pre-deck layout when only HALF the ceremony fields were written', () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap({ dailyPoints: undefined })} isOpen onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument();
    expect(screen.getByText('Your recap')).toBeInTheDocument();
  });

  // --- Deck ----------------------------------------------------------------

  it('opens as the story deck, on the cover, when the ceremony fields are present', () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    expect(screen.getByText('The Ivers Household')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('Jun 29 – Jul 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next card' })).toBeInTheDocument();
  });

  it('keeps the money detail reachable beneath the deck', () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    expect(screen.getByText('Week details')).toBeInTheDocument();
    expect(screen.getByText('Spending')).toBeInTheDocument();
    expect(screen.getByText('Bills this week')).toBeInTheDocument();
    // ...but the narrative now belongs to the finish card, not a section here.
    expect(screen.queryByText('Your recap')).not.toBeInTheDocument();
  });

  /**
   * Advance the deck one card per marker, waiting for each to arrive.
   *
   * `AnimatePresence mode="wait"` unmounts the outgoing card before mounting
   * the next, so every hop has to be awaited — two clicks in one tick would
   * assert against a card that has not arrived yet.
   */
  async function advance(markers: string[]): Promise<void> {
    for (const marker of markers) {
      fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
      // Sequential by construction — each card must mount before the next click.
      await screen.findByText(marker);
    }
  }

  const WEEK_CARD = 'Together you scored';
  const FINISH_CARD = 'A strong week for the household.';

  it('walks cover → week → your week → finish, landing on the VIEWER\'s own card', async () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);

    await advance([WEEK_CARD]);
    expect(screen.getByText('795')).toBeInTheDocument();

    // The signed-in member is Paul, so the personal card is Paul's.
    await advance(['Your week, Paul']);
    expect(screen.getByText('385')).toBeInTheDocument();

    await advance([FINISH_CARD]);
    expect(screen.getByText(/Final/)).toBeInTheDocument();
  });

  it('shows Jen her OWN personal card from the same recap', async () => {
    mockCore.currentUser = { uid: 'jen' };
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    await advance([WEEK_CARD, 'Your week, Jen']);
  });

  it('never lets the "Household" legend contradict the chart on a MIXED-SIGN week — the signed total moves to the household card instead (household-points-visibility, finding 2)', async () => {
    // Monday +15 (legacy history), Wednesday -20 (e.g. a legacy penalty habit
    // whose completion reverted but whose submission still stands). The chart
    // (buildRecapChart, unchanged by this fix) clamps segments to their
    // POSITIVE share, so it draws only Monday's +15 household segment and
    // drops Wednesday's -20 entirely — a legend printing the signed net (-5)
    // beside that chart would contradict what's actually drawn.
    const mixedSignRecap = ceremonyRecap({
      dailyPoints: DAYS.map((date, i) => {
        const byMember = { jen: 50, paul: 45 };
        const unattributed = i === 0 ? 15 : i === 2 ? -20 : 0;
        return { date, byMember, unattributed, total: byMember.jen + byMember.paul + unattributed };
      }),
    });
    render(<WeeklyRecapDrawer recap={mixedSignRecap} isOpen onClose={() => {}} />);

    await advance([WEEK_CARD]);

    // The legend shows the plain "Household" label — no figure that could
    // disagree with the chart.
    const legendEntry = screen.getByText('Household');
    expect(legendEntry).toHaveTextContent('Household');
    expect(legendEntry.textContent).toBe('Household');
    expect(screen.queryByText(/Household ·/)).not.toBeInTheDocument();

    // The signed net (15 + -20 = -5) instead shows on the household card...
    const householdShare = screen.getByTestId('recap-household-share');
    expect(householdShare).toHaveTextContent('-5');
    expect(householdShare).toHaveTextContent('credited to no one member');

    // ...and a LOSS is never framed as a gain, in this branch either: the
    // all-negative case below already refuses "earned together", and a week
    // that merely nets negative gets the same treatment.
    expect(householdShare).not.toHaveTextContent('earned together');

    // Monday's +15 IS drawn, so this branch must NOT claim the figure is
    // missing from the chart — part of it is right there.
    expect(householdShare).not.toHaveTextContent('not in it');
  });

  it('names the RIGHT reason when an ALL-NEGATIVE unattributed week leaves NO Household segment anywhere (recap-chart-negative-days)', async () => {
    // Every day negative — `buildRecapChart` clamps every segment to its
    // positive share, so unlike the mixed-sign case above, there is no day
    // left to draw a Household bar on at all. Without an acknowledgment, the
    // household card would assert a figure ("-35 earned together") that
    // nothing else on the card shows any cause for.
    //
    // Note WHAT is missing: each day still totals 50+45-5 = 90, so all SEVEN
    // columns are drawn at full height. The omitted unit is the negative
    // SEGMENT, not the day — copy blaming "only positive days are shown" is
    // flatly false about this, the very fixture it was written for.
    const allNegativeRecap = ceremonyRecap({
      dailyPoints: DAYS.map(date => {
        const byMember = { jen: 50, paul: 45 };
        const unattributed = -5;
        return { date, byMember, unattributed, total: byMember.jen + byMember.paul + unattributed };
      }),
    });
    render(<WeeklyRecapDrawer recap={allNegativeRecap} isOpen onClose={() => {}} />);

    await advance([WEEK_CARD]);

    // No "Household" legend entry — the chart never draws a segment for it.
    expect(screen.queryByText('Household')).not.toBeInTheDocument();

    // The card still surfaces the signed total, but now says so plainly
    // instead of claiming it was "earned together" with nothing to show for it.
    const householdShare = screen.getByTestId('recap-household-share');
    expect(householdShare).toHaveTextContent('-35');
    expect(householdShare).not.toHaveTextContent('earned together');
    expect(householdShare).toHaveTextContent('the chart only draws points gained, so this loss is not in it');
    // The old wording, which the fixture itself disproves — all seven days are
    // drawn.
    expect(householdShare).not.toHaveTextContent('only shows positive days');
  });

  it('never claims a Household presence when the segment sits on a ZERO-HEIGHT column (recap-chart-negative-days, fix 1)', async () => {
    // The members bleed points on a day a Household-credit habit scores:
    // `unattributed` is +10 (so `buildRecapChart` emits a segment) while the
    // day totals -105 (so the column has NO height). Segment existence and
    // column height are independent, and gating on existence alone paints a
    // "Household" legend swatch and claims points "earned together" over zero
    // drawn pixels. Note the figure here is POSITIVE — the "no visible cause"
    // branch is not a negative-only branch.
    const householdOnlyGain = ceremonyRecap({
      dailyPoints: DAYS.map((date, i) => ({
        date,
        byMember: i === 0 ? { jen: -60, paul: -55 } : { jen: 0, paul: 0 },
        unattributed: i === 0 ? 10 : 0,
        total: i === 0 ? -105 : 0,
      })),
      totalPoints: -105,
    });
    render(<WeeklyRecapDrawer recap={householdOnlyGain} isOpen onClose={() => {}} />);

    await advance([WEEK_CARD]);

    // Nothing is drawn for it, so the legend must not advertise it.
    expect(screen.queryByText('Household')).not.toBeInTheDocument();

    const householdShare = screen.getByTestId('recap-household-share');
    expect(householdShare).toHaveTextContent('10');
    // The gain is real, so it still reads as earned — but the card says why
    // the chart shows nothing for it rather than leaving a figure hanging.
    expect(householdShare).toHaveTextContent('the chart draws no column for them');
    // ...and never the loss wording, which would be wrong about a gain.
    expect(householdShare).not.toHaveTextContent('this loss is not in it');
  });

  it('scopes the positive/no-bar reason to the days the share was GAINED on, not every day it touched (recap-chart-negative-days, finding 1)', async () => {
    // The mirror of the all-negative case above, and the one this branch's
    // first wording got wrong. The share nets POSITIVE (+10 − 3 = 7) with no
    // Household bar anywhere, but the two days it lands on disagree about why:
    //
    //   Mon  unattributed +10, total -105  → segment exists, column has NO height
    //   Tue  unattributed  -3, total  +92  → clamped away, column is the week's MAX
    //
    // "the days it FELL ON ended flat or down" is false about Tuesday — it is
    // drawn at full height, and the chart very much does draw a column for it.
    // Only the days carrying a POSITIVE contribution are provably flat-or-down
    // here (a positive contribution on a day with height is exactly what
    // `hasHouseholdBar` detects), so the claim has to be scoped to those.
    const mixedNoBar = ceremonyRecap({
      dailyPoints: DAYS.map((date, i) => {
        if (i === 0) return { date, byMember: { jen: -60, paul: -55 }, unattributed: 10, total: -105 };
        if (i === 1) return { date, byMember: { jen: 50, paul: 45 }, unattributed: -3, total: 92 };
        return { date, byMember: { jen: 0, paul: 0 }, unattributed: 0, total: 0 };
      }),
      totalPoints: -13,
    });
    render(<WeeklyRecapDrawer recap={mixedNoBar} isOpen onClose={() => {}} />);

    await advance([WEEK_CARD]);

    // No Household bar anywhere: Monday's segment sits on a zero-height column
    // and Tuesday's negative contribution is clamped out of the chart entirely.
    expect(screen.queryByText('Household')).not.toBeInTheDocument();

    const householdShare = screen.getByTestId('recap-household-share');
    expect(householdShare).toHaveTextContent('7');
    expect(householdShare).toHaveTextContent('the days it was gained on ended flat or down');
    // The over-broad noun phrase this test exists to keep out: Tuesday IS one
    // of "the days it fell on", it ended UP, and it is the tallest column on
    // the chart.
    expect(householdShare).not.toHaveTextContent('the days it fell on');
  });

  it('leads the week card with the head-to-head under the podium tone', async () => {
    mockCore.householdSettings = { name: 'The Ivers Household', ceremonyTone: 'podium' };
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    await advance(['Won the week']);
    // The head-to-head numbers lead; the household's own total is demoted.
    expect(screen.getByText('410')).toBeInTheDocument();
    expect(screen.getByText('385')).toBeInTheDocument();
    expect(screen.queryByText(WEEK_CARD)).not.toBeInTheDocument();
  });

  it('blurs the narrative on the finish card for a free-tier recap', async () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap({ premium: false })} isOpen onClose={() => {}} />);
    await advance([WEEK_CARD, 'Your week, Paul', 'Unlock your personal recap with Premium']);
    expect(screen.getByText(FINISH_CARD)).toHaveClass('blur-sm');
  });

  it('fires recap_deck_completed exactly once, on reaching the final card', async () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);

    expect(vi.mocked(track)).not.toHaveBeenCalledWith('recap_deck_completed', expect.anything());
    await advance([WEEK_CARD, 'Your week, Paul', FINISH_CARD]);
    expect(vi.mocked(track)).toHaveBeenCalledWith('recap_deck_completed', {
      isoWeek: '2026-W27',
      tone: 'household_first',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    await screen.findByText('Your week, Paul');
    await advance([FINISH_CARD]);
    const completions = vi
      .mocked(track)
      .mock.calls.filter(([event]) => event === 'recap_deck_completed');
    expect(completions).toHaveLength(1);
  });

  it('disables the edges of the deck rather than wrapping around', async () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeDisabled();
    await advance([WEEK_CARD, 'Your week, Paul', FINISH_CARD]);
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled();
  });
});
