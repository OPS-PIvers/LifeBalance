import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import PointsBreakdownDrawer from './PointsBreakdownDrawer';
import type { Habit, HabitSubmission, HouseholdMember, WeeklyRecap } from '@/types/schema';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';

const mockUseGamification = vi.fn();
const mockUseHouseholdCore = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: () => mockUseGamification(),
  useHouseholdCore: () => mockUseHouseholdCore(),
}));

const mockUseKidModeEnabled = vi.fn();
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => mockUseKidModeEnabled(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Thursday inside the "current" Jul 27 - Aug 2 week — fixed so the
// Household row's date range is deterministic regardless of wall-clock date
// (see ScoreboardWidget.test.tsx for the same convention).
const mockToday = '2026-07-30';
vi.mock('@/utils/dateHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/dateHelpers')>();
  return { ...actual, getLocalDateString: () => mockToday };
});

// Simplify Drawer to a passthrough (header + children) so the test focuses on
// this drawer's own content — Drawer's own portal/focus-trap/motion behavior
// is covered by its own tests (mirrors SafeToSpendBreakdownDrawer.test.tsx).
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, header, children }: { isOpen: boolean; header?: ReactNode; children: ReactNode }) =>
    isOpen ? (
      <div data-testid="drawer">
        {header}
        {children}
      </div>
    ) : null,
}));

const member = (
  overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>,
): HouseholdMember => ({
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const JEN = member({ uid: 'jen', displayName: 'Jen', points: { daily: 40, weekly: 325, total: 1000 } });
const PAUL = member({ uid: 'paul', displayName: 'Paul', points: { daily: 20, weekly: 285, total: 900 } });
const LEO = member({
  uid: 'kid_leo',
  displayName: 'Leo',
  isManaged: true,
  points: { daily: 999, weekly: 999, total: 999 },
});

const makeHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h-1',
    title: 'Workout',
    category: 'Health',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as unknown as Habit);

const recap = (pointsByMember: WeeklyRecap['pointsByMember']): WeeklyRecap => ({
  id: '2026-W29',
  isoWeek: '2026-W29',
  generatedAt: '2026-07-20T09:00:00.000Z',
  totalSpend: 0,
  priorWeekSpend: 0,
  topCategoryDeltas: [],
  habitCompletions: 0,
  streaksAtRisk: [],
  pointsByMember,
  upcomingBills: [],
  narrative: '',
  narrativeSource: 'template',
  premium: false,
});

const setup = (config: {
  members?: HouseholdMember[];
  household?: { pendingRedemptions?: unknown[] };
  recaps?: WeeklyRecap[];
  dailyPoints?: number;
  weeklyPoints?: number;
  totalPoints?: number;
  kidModeEnabled?: boolean;
  habits?: Habit[];
  getHabitSubmissions?: (habitId: string, startDate?: string, endDate?: string) => Promise<HabitSubmission[]>;
}) => {
  mockUseGamification.mockReturnValue({
    dailyPoints: config.dailyPoints ?? 60,
    weeklyPoints: config.weeklyPoints ?? 610,
    totalPoints: config.totalPoints ?? 12480,
    habits: config.habits ?? [],
    getHabitSubmissions: config.getHabitSubmissions ?? (async () => []),
  });
  mockUseHouseholdCore.mockReturnValue({
    members: config.members ?? [JEN, PAUL],
    household: config.household ?? { pendingRedemptions: [] },
    recaps: config.recaps ?? [],
  });
  mockUseKidModeEnabled.mockReturnValue(config.kidModeEnabled ?? false);
};

const renderDrawer = (open = true) =>
  render(<PointsBreakdownDrawer open={open} onClose={vi.fn()} />);

/**
 * Scope a query to the household hero row. Every figure in this drawer is a
 * bare number, and `getByText` THROWS on multiple matches — scoping to the row
 * that owns the figure is what keeps these assertions about the hero (or a
 * member) rather than about "some number, somewhere".
 */
const hero = () => within(screen.getByTestId('points-drawer-hero-row'));
/** The standings row that renders `name` — the Row div wrapping the name span. */
const memberRow = (name: string) => within(screen.getByText(name).closest('div')!);

describe('PointsBreakdownDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    setup({});
    renderDrawer(false);
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('defaults to Week and shows the household total, standings, and the sole leader crown', () => {
    setup({});
    renderDrawer();

    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    expect(hero().getByText('610')).toBeInTheDocument();

    expect(memberRow('Jen').getByText('325')).toBeInTheDocument();
    expect(screen.getByText('Jen is leading')).toBeInTheDocument();
    expect(screen.queryByText('Paul is leading')).not.toBeInTheDocument();
  });

  it('renders the hero on the same [avatar] · Household · ——— · points silhouette as a member row', () => {
    setup({});
    renderDrawer();

    const heroRow = screen.getByTestId('points-drawer-hero-row');
    // Household badge, in the same leading slot a member avatar occupies.
    expect(within(heroRow).getByTestId('points-drawer-hero-badge')).toBeInTheDocument();
    // The label is just "Household" — the owner struck the word "total".
    expect(within(heroRow).getByText('Household')).toBeInTheDocument();
    expect(screen.queryByText('household total')).not.toBeInTheDocument();
    // The total, and the period as the subtitle line beneath the label.
    // `dateLabel` is built from a real `new Date()` (not the mocked
    // `getLocalDateString`), so match its SHAPE — pinning "Jul 27 – Aug 2"
    // would make this test fail on a different wall-clock week.
    expect(within(heroRow).getByText('610')).toBeInTheDocument();
    expect(within(heroRow).getByText(/^This week · \w{3} \d{1,2} – \w{3} \d{1,2}$/)).toBeInTheDocument();
  });

  it('switches the hero subtitle to the day label in Day view', () => {
    setup({});
    renderDrawer();

    fireEvent.click(screen.getByRole('radio', { name: 'Day' }));

    expect(hero().getByText(/^Today · \w{3} \d{1,2}$/)).toBeInTheDocument();
    expect(hero().queryByText(/This week/)).not.toBeInTheDocument();
  });

  it('switches to per-day figures when Day is selected', () => {
    setup({});
    renderDrawer();

    fireEvent.click(screen.getByRole('radio', { name: 'Day' }));

    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
    // Household total switches from weeklyPoints (610) to dailyPoints (60).
    expect(hero().getByText('60')).toBeInTheDocument();
    expect(hero().queryByText('610')).not.toBeInTheDocument();
    // Jen's daily figure (40) replaces her weekly one (325).
    expect(memberRow('Jen').getByText('40')).toBeInTheDocument();
    expect(memberRow('Jen').queryByText('325')).not.toBeInTheDocument();
  });

  it('excludes managed kids from standings (adults-only)', () => {
    setup({ members: [JEN, PAUL, LEO] });
    renderDrawer();
    expect(screen.queryByText('Leo')).not.toBeInTheDocument();
  });

  it('colors each standing row through the shared MemberColorMap (memberColorFor), not a uid-hashed resolveAvatarColor', () => {
    setup({});
    renderDrawer();

    const colors = buildMemberColorMap([JEN, PAUL]);
    const jenAvatar = screen.getByTestId('points-drawer-avatar-jen');
    const paulAvatar = screen.getByTestId('points-drawer-avatar-paul');
    expect(jenAvatar).toHaveStyle({ backgroundColor: memberColorFor(colors, 'jen') });
    expect(paulAvatar).toHaveStyle({ backgroundColor: memberColorFor(colors, 'paul') });
    // Pin against the palette's known assignment order (roster order: Jen
    // first, Paul second) so a regression to uid-hashing — which swapped
    // these two colors in Test Mode before this fix — is caught concretely.
    expect(memberColorFor(colors, 'jen')).toBe('#285742'); // first adult — evergreen
    expect(memberColorFor(colors, 'paul')).toBe('#b87a29'); // second adult — amber
  });

  it('never crowns a tied field', () => {
    setup({
      members: [
        member({ uid: 'jen', displayName: 'Jen', points: { daily: 10, weekly: 50, total: 0 } }),
        member({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 50, total: 0 } }),
      ],
    });
    renderDrawer();
    expect(screen.queryByText(/is leading/)).not.toBeInTheDocument();
  });

  it('one-member edge: renders the single standing with no crown', () => {
    setup({ members: [JEN] });
    renderDrawer();
    expect(screen.getByText('Jen')).toBeInTheDocument();
    expect(screen.queryByText(/is leading/)).not.toBeInTheDocument();
  });

  it('empty edge: renders no standings panel when there are no adults', () => {
    setup({ members: [LEO] });
    renderDrawer();
    expect(screen.queryByText('Leo')).not.toBeInTheDocument();
    expect(screen.queryByText(/is leading/)).not.toBeInTheDocument();
    // The household hero and reward pool panels still render.
    expect(hero().getByText('610')).toBeInTheDocument();
    expect(screen.getByText(/Reward pool/)).toBeInTheDocument();
  });

  it('shows the vs-last-week trend chip from the newest recap in Week view only', () => {
    setup({ weeklyPoints: 610, recaps: [recap([{ memberId: 'jen', name: 'Jen', points: 545 }])] });
    renderDrawer();
    // (610 - 545) / 545 ≈ 11.9% → rounds to 12%.
    expect(screen.getByText('12%')).toBeInTheDocument();
    // The arrow carrying the direction is aria-hidden, so the chip spells it
    // out sr-only — otherwise a screen reader hears a bare "12%".
    expect(screen.getByText(/up vs last week/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
    expect(screen.queryByText('12%')).not.toBeInTheDocument();
  });

  it('omits the trend chip when there is no recap yet', () => {
    setup({ recaps: [] });
    renderDrawer();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('shows the lifetime reward pool total and a Rewards link that navigates and closes', () => {
    const onClose = vi.fn();
    setup({ totalPoints: 12480 });
    render(<PointsBreakdownDrawer open={true} onClose={onClose} />);

    expect(screen.getByText('12480 pts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rewards/ }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/habits', { state: { tab: 'rewards' } });
  });

  it('shows the pending-redemption count only when Kid Mode is on and a request is waiting', () => {
    setup({ kidModeEnabled: true, household: { pendingRedemptions: [{}, {}] } });
    renderDrawer();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
  });

  it('hides the pending-redemption count when Kid Mode is off, even with pending requests stored', () => {
    setup({ kidModeEnabled: false, household: { pendingRedemptions: [{}, {}] } });
    renderDrawer();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  describe('Shared habits row (household-points-visibility)', () => {
    // The Household row's figure is now sourced from an async
    // `submissionTotals` fetch (see PointsBreakdownDrawer.tsx), so every test
    // here awaits it settling — `findByTestId` polls until the row appears;
    // `act(async () => {})` flushes the fetch before asserting an ABSENCE, so
    // that assertion can't pass vacuously just because the fetch hasn't
    // resolved yet.
    it('shows a Shared habits row for a legacy (pre-attribution) completion this week', async () => {
      const habits = [makeHabit({ completedDates: ['2026-07-28'], completedBy: undefined })];
      setup({ habits });
      renderDrawer();

      const householdRow = await screen.findByTestId('points-drawer-household-row');
      // Labelled "Shared habits", not "Household" — the hero row above is the
      // household now, and two identically-badged "Household" rows would be
      // indistinguishable.
      expect(householdRow).toHaveTextContent('Shared habits');
      // Threshold habit, basePoints 10, no streak — 10 points, attributed to nobody.
      expect(householdRow).toHaveTextContent('10');
    });

    it('still shows the Shared habits row at 0 when there is no unattributed remainder', async () => {
      setup({ habits: [] });
      renderDrawer();
      // Let the submission fetch settle before asserting the value.
      await act(async () => {});
      // The row stays visible even when its value is 0 — same as the
      // per-member rows — so the drawer doesn't change height across the
      // Day/Week toggle (see the row's render guard in the component).
      const householdRow = await screen.findByTestId('points-drawer-household-row');
      expect(householdRow).toHaveTextContent('Shared habits');
      expect(householdRow).toHaveTextContent('0');
      // …and the hero, which is a different thing, still stands.
      expect(hero().getByText('Household')).toBeInTheDocument();
    });

    it('switches the Household value between Day and Week the same as the standings do', async () => {
      // A legacy completion TODAY counts in both Day and Week windows. `count:
      // 1` matters — a same-day 0 counter reads as "reset back off" rather
      // than "still completed" (see `pointsForHabitOnDate`'s current-period
      // gate in utils/habitLogic.ts).
      const habits = [makeHabit({ completedDates: ['2026-07-30'], completedBy: undefined, count: 1 })];
      setup({ habits });
      renderDrawer();

      expect(await screen.findByTestId('points-drawer-household-row')).toHaveTextContent('10');

      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
      expect(await screen.findByTestId('points-drawer-household-row')).toHaveTextContent('10');
    });

    it('narrows the Household value to today in Day view while the WEEK figure covers the whole week', async () => {
      // Monday (the week start) plus today, both legacy/unattributed. Week must
      // see both (20), Day only today's (10) — the assertion that the fix
      // didn't simply widen Day's window to the week along with the fetch.
      const habits = [
        makeHabit({ completedDates: ['2026-07-27', '2026-07-30'], completedBy: undefined, count: 1 }),
      ];
      setup({ habits });
      renderDrawer();

      expect(await screen.findByTestId('points-drawer-household-row')).toHaveTextContent('20');

      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
      expect(screen.getByTestId('points-drawer-household-row')).toHaveTextContent('10');
    });

    // The display glitch this pair pins: the submissions fetch window used to
    // narrow to today for Day, so every Day↔Week tap changed
    // `submissionCacheKey`, sent `householdShare` back to `undefined`, and
    // UNMOUNTED this row until a fresh fetch resolved. A bottom sheet is sized
    // by its content, so losing a row mid-toggle dropped the whole drawer and
    // snapped it back. The window is the week for both periods now (the day
    // window is a strict subset of it), making a period switch a pure
    // synchronous recompute.
    it('keeps the Shared habits row mounted across a Day↔Week switch, with no intermediate blank frame', async () => {
      const habits = [
        makeHabit({ completedDates: ['2026-07-27', '2026-07-30'], completedBy: undefined, count: 1 }),
      ];
      setup({ habits });
      renderDrawer();
      await screen.findByTestId('points-drawer-household-row');

      // Synchronous `getBy*` immediately after each click — NOT `findBy*`,
      // which would poll right past the missing frame this test exists to
      // catch.
      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
      expect(screen.getByTestId('points-drawer-household-row')).toHaveTextContent('10');

      fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
      expect(screen.getByTestId('points-drawer-household-row')).toHaveTextContent('20');
    });

    it('issues no additional submissions fetch when the period changes', async () => {
      const getHabitSubmissions = vi.fn(async () => []);
      setup({
        habits: [
          makeHabit({
            id: 'h-tracked',
            hasSubmissionTracking: true,
            completedDates: ['2026-07-30'],
            completedBy: undefined,
            count: 1,
          }),
        ],
        getHabitSubmissions,
      });
      renderDrawer();
      await act(async () => {});
      expect(getHabitSubmissions).toHaveBeenCalledTimes(1);
      // The one fetch covers the whole week, so both periods read from it.
      expect(getHabitSubmissions).toHaveBeenCalledWith('h-tracked', '2026-07-27', mockToday);

      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));
      await act(async () => {});
      fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
      await act(async () => {});

      expect(getHabitSubmissions).toHaveBeenCalledTimes(1);
    });

    it('threads submissionTotals through the CURRENT window so a submission that OUTLIVES its completion date still counts toward the Household row (finding 1)', async () => {
      // A legacy incremental habit whose completion was reverted — the date
      // is gone from `completedDates` — but its submission doc (worth -20)
      // still stands (a down-toggle removes the completion date but never
      // deletes the submission; see `pointsForHabitOnDate`'s doc comment in
      // utils/habitLogic.ts).
      const habits = [
        makeHabit({
          id: 'h-reverted',
          type: 'negative',
          scoringType: 'incremental',
          basePoints: 20,
          hasSubmissionTracking: true,
          completedDates: [],
          completedBy: undefined,
        }),
      ];
      const getHabitSubmissions = async (habitId: string): Promise<HabitSubmission[]> => {
        if (habitId !== 'h-reverted') return [];
        return [
          {
            id: 's-reverted',
            habitId: 'h-reverted',
            habitTitle: 'Workout',
            timestamp: '2026-07-28T20:00:00.000Z',
            date: '2026-07-28',
            count: 1,
            pointsEarned: -20,
            streakDaysAtTime: 1,
            multiplierApplied: 1,
            createdBy: 'paul',
            createdAt: '2026-07-28T20:00:00.000Z',
          },
        ];
      };
      setup({ habits, getHabitSubmissions });
      renderDrawer();

      const householdRow = await screen.findByTestId('points-drawer-household-row');
      expect(householdRow).toHaveTextContent('-20');
    });

    describe('submission fetch caching (perf: avoid re-fetch on every habit toggle)', () => {
      // This drawer is reachable from the always-mounted TopToolbar, so a
      // habits snapshot on ANY habit toggle (a fresh array identity, since
      // Firestore listeners never hand back the same array) previously
      // re-issued a `getHabitSubmissions` query per `hasSubmissionTracking`
      // habit even when nothing the fetch depends on had actually changed.
      // See `submissionCacheKey`'s doc comment in
      // utils/habitSubmissionTotals.ts for the fingerprint this cache keys on.
      const trackedHabit = (lastUpdated: string) =>
        makeHabit({
          id: 'h-tracked',
          type: 'positive',
          scoringType: 'incremental',
          basePoints: 10,
          hasSubmissionTracking: true,
          completedDates: ['2026-07-28'],
          completedBy: { '2026-07-28': { paul: 1 } },
          lastUpdated,
        });

      it('does not re-fetch when re-rendered with a new habits array identity but an unchanged fingerprint', async () => {
        const getHabitSubmissions = vi.fn(async () => []);
        setup({ habits: [trackedHabit('2026-07-28T12:00:00.000Z')], getHabitSubmissions });
        const { rerender } = renderDrawer();
        await act(async () => {});
        expect(getHabitSubmissions).toHaveBeenCalledTimes(1);

        // A fresh array/object identity (as every Firestore snapshot has)
        // but the SAME tracked habit's lastUpdated — nothing that could have
        // touched a submission.
        setup({ habits: [trackedHabit('2026-07-28T12:00:00.000Z')], getHabitSubmissions });
        rerender(<PointsBreakdownDrawer open={true} onClose={vi.fn()} />);
        await act(async () => {});

        expect(getHabitSubmissions).toHaveBeenCalledTimes(1);
      });

      it('re-fetches once a tracked habit\'s lastUpdated actually changes', async () => {
        const getHabitSubmissions = vi.fn(async () => []);
        setup({ habits: [trackedHabit('2026-07-28T12:00:00.000Z')], getHabitSubmissions });
        const { rerender } = renderDrawer();
        await act(async () => {});
        expect(getHabitSubmissions).toHaveBeenCalledTimes(1);

        // A submission mutation stamps the habit doc's lastUpdated, which
        // arrives on the live listener as a new snapshot.
        setup({ habits: [trackedHabit('2026-07-28T18:00:00.000Z')], getHabitSubmissions });
        rerender(<PointsBreakdownDrawer open={true} onClose={vi.fn()} />);
        await act(async () => {});

        expect(getHabitSubmissions).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('row disclosure (itemized breakdown)', () => {
    const ledgerHabits = [
      makeHabit({
        id: 'h-run',
        title: 'Morning run',
        completedDates: ['2026-07-28', '2026-07-30'],
        count: 1,
        completedBy: { '2026-07-28': { jen: 1 }, '2026-07-30': { paul: 1 } },
      }),
      // No completedBy — belongs to nobody, so it lands on the Shared row.
      makeHabit({ id: 'h-dishes', title: 'Dishes', basePoints: 8, completedDates: ['2026-07-28'] }),
    ];

    it('expands a member row into the habits and dates behind their total', () => {
      setup({ habits: ledgerHabits });
      renderDrawer();

      const row = screen.getByTestId('points-drawer-row-jen');
      expect(row).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(row);

      expect(row).toHaveAttribute('aria-expanded', 'true');
      const detail = document.getElementById('points-drawer-ledger-jen');
      expect(detail).toHaveTextContent('Morning run');
      expect(detail).toHaveTextContent('Tue, Jul 28');
      // Paul's completion of the same habit belongs on HIS row, and an
      // unattributed one belongs to nobody.
      expect(detail).not.toHaveTextContent('Today');
      expect(detail).not.toHaveTextContent('Dishes');
    });

    it('expands the Shared habits row into the completions that belong to nobody', async () => {
      setup({ habits: ledgerHabits });
      renderDrawer();

      fireEvent.click(await screen.findByTestId('points-drawer-row-shared'));

      const detail = document.getElementById('points-drawer-ledger-shared');
      expect(detail).toHaveTextContent('Dishes');
      expect(detail).toHaveTextContent('Tue, Jul 28');
      expect(detail).not.toHaveTextContent('Morning run');
    });

    it('re-scopes an open receipt to today when the period switches to Day', () => {
      setup({ habits: ledgerHabits });
      renderDrawer();

      fireEvent.click(screen.getByTestId('points-drawer-row-paul'));
      expect(document.getElementById('points-drawer-ledger-paul')).toHaveTextContent('Today');

      // Jen's only completion is Tuesday, so her Day receipt is empty — the
      // range narrows with the figure the row reports.
      fireEvent.click(screen.getByTestId('points-drawer-row-jen'));
      fireEvent.click(screen.getByRole('radio', { name: 'Day' }));

      expect(document.getElementById('points-drawer-ledger-jen')).toHaveTextContent(
        "Jen hasn't logged a habit today."
      );
    });

    it('keeps one row open at a time', () => {
      setup({ habits: ledgerHabits });
      renderDrawer();

      fireEvent.click(screen.getByTestId('points-drawer-row-jen'));
      fireEvent.click(screen.getByTestId('points-drawer-row-paul'));

      expect(screen.getByTestId('points-drawer-row-jen')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('points-drawer-row-paul')).toHaveAttribute('aria-expanded', 'true');
    });

    it('collapses an open receipt on close, since the drawer stays mounted between opens', () => {
      setup({ habits: ledgerHabits });
      const onClose = vi.fn();
      const { rerender } = render(<PointsBreakdownDrawer open onClose={onClose} />);

      fireEvent.click(screen.getByTestId('points-drawer-row-jen'));
      fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
      expect(onClose).toHaveBeenCalled();

      rerender(<PointsBreakdownDrawer open onClose={onClose} />);
      expect(screen.getByTestId('points-drawer-row-jen')).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
