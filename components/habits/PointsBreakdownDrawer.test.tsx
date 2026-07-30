import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import PointsBreakdownDrawer from './PointsBreakdownDrawer';
import type { HouseholdMember, WeeklyRecap } from '@/types/schema';
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
}) => {
  mockUseGamification.mockReturnValue({
    dailyPoints: config.dailyPoints ?? 60,
    weeklyPoints: config.weeklyPoints ?? 610,
    totalPoints: config.totalPoints ?? 12480,
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
    expect(screen.getByText('610')).toBeInTheDocument();

    const jenRow = screen.getByText('Jen').closest('div')!;
    expect(jenRow).toHaveTextContent('325');
    expect(screen.getByText('Jen is leading')).toBeInTheDocument();
    expect(screen.queryByText('Paul is leading')).not.toBeInTheDocument();
  });

  it('switches to per-day figures when Day is selected', () => {
    setup({});
    renderDrawer();

    fireEvent.click(screen.getByRole('radio', { name: 'Day' }));

    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
    // Household total switches from weeklyPoints (610) to dailyPoints (60).
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.queryByText('610')).not.toBeInTheDocument();
    // Jen's daily figure (40) replaces her weekly one (325).
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.queryByText('325')).not.toBeInTheDocument();
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
    // The household total and reward pool panels still render.
    expect(screen.getByText('610')).toBeInTheDocument();
    expect(screen.getByText(/Reward pool/)).toBeInTheDocument();
  });

  it('shows the vs-last-week trend chip from the newest recap in Week view only', () => {
    setup({ weeklyPoints: 610, recaps: [recap([{ memberId: 'jen', name: 'Jen', points: 545 }])] });
    renderDrawer();
    // (610 - 545) / 545 ≈ 11.9% → rounds to 12%.
    expect(screen.getByText('12%')).toBeInTheDocument();

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
});
