import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HouseholdMember, RecapMemberFacts, WeeklyRecap } from '@/types/schema';
import { track } from '@/services/analytics';

/**
 * WeeklyRecapDrawer — the ceremony's HOST surface.
 *
 * This suite covers only what the drawer itself owns: the two halves of the
 * ONE-ARTIFACT rule (a recap WITH the per-member fields opens as the story deck
 * with the money detail still reachable underneath; a recap WITHOUT them renders
 * the pre-deck layout byte-for-byte as it always did), and the analytics wiring
 * it hands the deck. The deck's own behaviour — card sequence, money card,
 * chart, tiles, tone framing, narrative states — lives in RecapDeck.test.tsx,
 * against the component directly.
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

  /**
   * 🛡️ `hasCeremonyData` IS THE ONLY GATE, and it must stay that way through
   * every rebuild of the deck. Stored recaps W27–W30 carry no `memberFacts` /
   * `dailyPoints` at all; they render the pre-deck layout forever.
   */
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

  it('renders the pre-deck layout even when the newer spend/split fields ARE present', () => {
    // A document can carry the RECAP-MATH money split without ever having been
    // given per-member facts. Money is now a deck card, so this is exactly the
    // shape that could tempt a future gate to widen — it must not.
    render(
      <WeeklyRecapDrawer
        recap={makeRecap({ billsSpend: 300, dayToDaySpend: 112, priorWeekBillsSpend: 280, priorWeekDayToDaySpend: 188 })}
        isOpen
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: 'Next card' })).not.toBeInTheDocument();
    expect(screen.getByText('Spending')).toBeInTheDocument();
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

  it('fires recap_deck_completed exactly once, on reaching the final card', async () => {
    render(<WeeklyRecapDrawer recap={ceremonyRecap()} isOpen onClose={() => {}} />);
    expect(vi.mocked(track)).not.toHaveBeenCalledWith('recap_deck_completed', expect.anything());

    // Walk to the end without pinning the card COUNT here — the sequence is the
    // deck's business, and its own suite asserts it.
    const next = () => screen.getByRole('button', { name: 'Next card' });
    while (!(next() as HTMLButtonElement).disabled) {
      fireEvent.click(next());
      await screen.findByRole('group', { name: /^Card / });
    }

    expect(vi.mocked(track)).toHaveBeenCalledWith('recap_deck_completed', {
      isoWeek: '2026-W27',
      tone: 'household_first',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    await screen.findByRole('group', { name: /^Card / });
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    await screen.findByRole('group', { name: /^Card / });

    const completions = vi
      .mocked(track)
      .mock.calls.filter(([event]) => event === 'recap_deck_completed');
    expect(completions).toHaveLength(1);
  });
});
