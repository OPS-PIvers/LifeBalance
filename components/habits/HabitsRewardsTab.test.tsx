import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  Household,
  HouseholdMember,
  RewardItem,
  RewardRedemption,
  RewardRedemptionRecord,
} from '@/types/schema';
import HabitsRewardsTab from './HabitsRewardsTab';

// --- Mocks -------------------------------------------------------------------
// The tab + its panels read the Kid Mode flag (useKidModeEnabled), the
// gamification slice (rewards + redeem/CRUD + redemption actions), and household
// core (members + household.pendingRedemptions/redemptionHistory). We drive each
// independently so the dormancy gates and the new all-households management
// surface can be exercised in isolation.
const mockUseKidModeEnabled = vi.fn<() => boolean>(() => false);
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockRewards = vi.fn<() => RewardItem[]>(() => []);
const mockPending = vi.fn<() => RewardRedemption[]>(() => []);
const mockHistory = vi.fn<() => RewardRedemptionRecord[]>(() => []);
const redeemRewardMock = vi.fn(async (_id: string) => {});
const approveRedemptionMock = vi.fn(async (_id: string) => {});
const denyRedemptionMock = vi.fn(async (_id: string) => {});

vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => mockUseKidModeEnabled(),
}));

// RewardManagerPanel's create/edit form now lives in a `Drawer` bottom sheet
// rather than inline — stub it the same way HabitCard.test.tsx does so the
// form's contents render unconditionally when `isOpen`, without needing a
// framer-motion mock.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: ReactNode;
    title?: string;
  }) =>
    isOpen ? (
      <div data-testid="reward-form-drawer">
        {title && <h1>{title}</h1>}
        {children}
      </div>
    ) : null,
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    members: mockMembers(),
    household: {
      pendingRedemptions: mockPending(),
      redemptionHistory: mockHistory(),
      currency: 'USD',
    } as Household,
  }),
  useGamification: () => ({
    rewardsInventory: mockRewards(),
    totalPoints: 100,
    redeemReward: redeemRewardMock,
    addReward: vi.fn(),
    updateReward: vi.fn(),
    deleteReward: vi.fn(),
    requestRedemption: vi.fn(),
    approveRedemption: approveRedemptionMock,
    denyRedemption: denyRedemptionMock,
  }),
}));

const makeReward = (overrides: Partial<RewardItem> = {}): RewardItem => ({
  id: 'rw1',
  title: 'Movie Night',
  cost: 50,
  icon: '🎬',
  createdBy: 'parent_1',
  active: true,
  ...overrides,
});

const makeRedemption = (overrides: Partial<RewardRedemption> = {}): RewardRedemption => ({
  id: 'redemption_1',
  rewardId: 'rw2',
  rewardTitle: '$5 Allowance',
  memberId: 'kid_leo',
  cost: 100,
  type: 'allowance',
  allowanceCents: 500,
  status: 'pending',
  requestedAt: new Date().toISOString(),
  requestedByUid: 'parent_1',
  ...overrides,
});

const KID: HouseholdMember = {
  uid: 'kid_leo',
  displayName: 'Leo',
  role: 'kid',
  points: { daily: 0, weekly: 0, total: 220 },
};

const PARENT: HouseholdMember = {
  uid: 'parent_1',
  displayName: 'Sam',
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 100 },
};

beforeEach(() => {
  mockUseKidModeEnabled.mockReturnValue(false);
  mockMembers.mockReturnValue([]);
  mockRewards.mockReturnValue([makeReward()]);
  mockPending.mockReturnValue([]);
  mockHistory.mockReturnValue([]);
  redeemRewardMock.mockClear();
  approveRedemptionMock.mockClear();
  denyRedemptionMock.mockClear();
});

describe('HabitsRewardsTab — store + redeem', () => {
  it('lists the active reward in the store and redeeming calls redeemReward with the reward id', () => {
    render(<HabitsRewardsTab />);
    // The manage list is collapsed by default, so only the store copy of the
    // title is present until "Manage rewards" is expanded.
    expect(screen.getAllByText('Movie Night').length).toBeGreaterThan(0);
    const redeem = screen.getByRole('button', { name: /^redeem$/i });
    fireEvent.click(redeem);
    expect(redeemRewardMock).toHaveBeenCalledWith('rw1');
  });

  it('excludes inactive rewards from the store grid but keeps them in the manage list once expanded', () => {
    mockRewards.mockReturnValue([makeReward({ id: 'rw1', title: 'Active One', active: true }),
      makeReward({ id: 'rw2', title: 'Hidden One', active: false })]);
    render(<HabitsRewardsTab />);
    // Store grid has a Redeem button only for the active reward.
    expect(screen.getAllByRole('button', { name: /^redeem$/i })).toHaveLength(1);
    // The manage list is collapsed by default — the edit affordance isn't
    // reachable until "Manage rewards" is expanded.
    expect(screen.queryByRole('button', { name: /edit hidden one/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /manage rewards/i }));
    // The inactive reward is still listed (with an edit affordance) in management.
    expect(screen.getByRole('button', { name: /edit hidden one/i })).toBeInTheDocument();
  });
});

describe('HabitsRewardsTab — management for ALL households', () => {
  it('exposes the "Add reward" control even when Kid Mode is OFF', () => {
    mockUseKidModeEnabled.mockReturnValue(false);
    render(<HabitsRewardsTab />);
    expect(screen.getByRole('button', { name: /add reward/i })).toBeInTheDocument();
  });

  it('collapses the manage list by default showing only the count, and "Add reward" opens the form Drawer without expanding it', () => {
    mockRewards.mockReturnValue([makeReward({ id: 'rw1', title: 'Movie Night' })]);
    render(<HabitsRewardsTab />);
    const manageToggle = screen.getByRole('button', { name: /manage rewards/i });
    expect(manageToggle).toHaveAttribute('aria-expanded', 'false');
    // The count is visible while collapsed.
    expect(manageToggle).toHaveTextContent('1');
    // The manage-list edit affordance isn't in the DOM yet.
    expect(screen.queryByRole('button', { name: /edit movie night/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add reward/i }));
    // The form Drawer opened...
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    // ...without expanding the manage list.
    expect(manageToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the Kid-Mode reward-type field for a normal household', () => {
    mockUseKidModeEnabled.mockReturnValue(false);
    render(<HabitsRewardsTab />);
    fireEvent.click(screen.getByRole('button', { name: /add reward/i }));
    // The form is open (Title field present)...
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    // ...but the Kid-Mode reward type toggle is not.
    expect(screen.queryByRole('button', { name: 'Real-world' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Target kid')).not.toBeInTheDocument();
  });

  it('disables submit for a negative cost (a negative-cost reward can never be saved)', () => {
    mockUseKidModeEnabled.mockReturnValue(false);
    render(<HabitsRewardsTab />);
    fireEvent.click(screen.getByRole('button', { name: /add reward/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Exploit' } });
    fireEvent.change(screen.getByLabelText('Cost (points)'), { target: { value: '-10' } });
    // When the form is open, the only /add reward/i button is the form submit.
    expect(screen.getByRole('button', { name: /add reward/i })).toBeDisabled();
  });

  it('shows the Kid-Mode reward-type field when Kid Mode is ON', () => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([PARENT, KID]);
    render(<HabitsRewardsTab />);
    fireEvent.click(screen.getByRole('button', { name: /add reward/i }));
    expect(screen.getByRole('radio', { name: 'Real-world' })).toBeInTheDocument();
    expect(screen.getByLabelText('Target kid')).toBeInTheDocument();
  });
});

describe('HabitsRewardsTab — parent review queue (Plan 080d-2)', () => {
  it('does NOT render the queue when Kid Mode is off even if requests exist', () => {
    mockUseKidModeEnabled.mockReturnValue(false);
    mockPending.mockReturnValue([makeRedemption()]);
    render(<HabitsRewardsTab />);
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('does NOT render the queue when there are no pending requests (dormant)', () => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([PARENT, KID]);
    mockPending.mockReturnValue([]);
    render(<HabitsRewardsTab />);
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('lists a request and Approve wires approveRedemption when Kid Mode is on', () => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([PARENT, KID]);
    mockPending.mockReturnValue([makeRedemption()]);
    render(<HabitsRewardsTab />);
    expect(screen.getByText(/pending requests \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Leo · \$5 Allowance/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve \$5 allowance for leo/i }));
    expect(approveRedemptionMock).toHaveBeenCalledWith('redemption_1');
    expect(denyRedemptionMock).not.toHaveBeenCalled();
  });

  it('Deny wires denyRedemption when Kid Mode is on', () => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([PARENT, KID]);
    mockPending.mockReturnValue([makeRedemption()]);
    render(<HabitsRewardsTab />);

    fireEvent.click(screen.getByRole('button', { name: /deny \$5 allowance for leo/i }));
    expect(denyRedemptionMock).toHaveBeenCalledWith('redemption_1');
    expect(approveRedemptionMock).not.toHaveBeenCalled();
  });
});

describe('HabitsRewardsTab — recently redeemed history', () => {
  it('renders nothing for the history section when empty', () => {
    mockHistory.mockReturnValue([]);
    render(<HabitsRewardsTab />);
    expect(screen.queryByText(/recently redeemed/i)).not.toBeInTheDocument();
  });

  it('lists redemption records with title, cost, and who redeemed', () => {
    mockMembers.mockReturnValue([PARENT]);
    mockHistory.mockReturnValue([
      {
        id: 'h1',
        rewardId: 'rw1',
        rewardTitle: 'Movie Night',
        icon: '🎬',
        cost: 50,
        redeemedByUid: 'parent_1',
        redeemedAt: new Date().toISOString(),
      },
    ]);
    render(<HabitsRewardsTab />);
    expect(screen.getByText(/recently redeemed/i)).toBeInTheDocument();
    expect(screen.getByText('−50 pts')).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
  });

  it('caps the visible history at 5 with a show-more row, and expanding reveals the rest', () => {
    mockMembers.mockReturnValue([PARENT]);
    const records: RewardRedemptionRecord[] = Array.from({ length: 7 }, (_, i) => ({
      id: `h${i}`,
      rewardId: `rw${i}`,
      rewardTitle: `Reward ${i}`,
      icon: '🎁',
      cost: 10 + i,
      redeemedByUid: 'parent_1',
      redeemedAt: new Date().toISOString(),
    }));
    mockHistory.mockReturnValue(records);
    render(<HabitsRewardsTab />);

    expect(screen.getAllByText(/^Reward \d$/)).toHaveLength(5);
    const showMore = screen.getByRole('button', { name: /\+ 2 more redemptions/i });
    expect(showMore).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(showMore);
    expect(screen.getAllByText(/^Reward \d$/)).toHaveLength(7);
    expect(screen.getByRole('button', { name: /show fewer/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
