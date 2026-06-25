import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Household, HouseholdMember, RewardItem, RewardRedemption } from '@/types/schema';
import RewardsModal from './RewardsModal';

// --- Mocks -------------------------------------------------------------------
// The modal reads the Kid Mode flag (useKidModeEnabled), the gamification slice
// (rewards list + redeem/CRUD + redemption actions), and household core
// (members + household.pendingRedemptions). We drive the flag independently so the
// dormancy gate can be exercised in isolation, mirroring KidsChoresWidget.test.tsx.
const mockUseKidModeEnabled = vi.fn<() => boolean>(() => false);
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockRewards = vi.fn<() => RewardItem[]>(() => []);
const mockPendingRedemptions = vi.fn<() => RewardRedemption[]>(() => []);
const approveRedemptionMock = vi.fn(async (_id: string) => {});
const denyRedemptionMock = vi.fn(async (_id: string) => {});

vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => mockUseKidModeEnabled(),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    members: mockMembers(),
    household: { pendingRedemptions: mockPendingRedemptions(), currency: 'USD' } as Household,
  }),
  useGamification: () => ({
    rewardsInventory: mockRewards(),
    totalPoints: 100,
    redeemReward: vi.fn(),
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

const noop = () => {};

describe('RewardsModal — Kid Mode dormancy gate', () => {
  beforeEach(() => {
    mockUseKidModeEnabled.mockReturnValue(false);
    mockMembers.mockReturnValue([]);
    mockRewards.mockReturnValue([makeReward()]);
    mockPendingRedemptions.mockReturnValue([]);
    approveRedemptionMock.mockClear();
    denyRedemptionMock.mockClear();
  });

  it('hides the reward management panel when Kid Mode is disabled', () => {
    mockUseKidModeEnabled.mockReturnValue(false);

    render(<RewardsModal isOpen onClose={noop} />);

    // The read-only store still renders (lifetime points header is present)...
    expect(screen.getByText('Rewards Store')).toBeInTheDocument();
    // ...but the parent-facing management control must NOT be in the DOM.
    expect(
      screen.queryByRole('button', { name: /add reward/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Manage rewards')).not.toBeInTheDocument();
  });

  it('shows the reward management panel when Kid Mode is enabled', () => {
    mockUseKidModeEnabled.mockReturnValue(true);

    render(<RewardsModal isOpen onClose={noop} />);

    // The "Add reward" submit button is rendered only inside the management panel.
    expect(
      screen.getByRole('button', { name: /add reward/i }),
    ).toBeInTheDocument();
  });
});

describe('RewardsModal — parent review queue (Plan 080d-2)', () => {
  beforeEach(() => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([KID]);
    mockRewards.mockReturnValue([makeReward()]);
    mockPendingRedemptions.mockReturnValue([makeRedemption()]);
    approveRedemptionMock.mockClear();
    denyRedemptionMock.mockClear();
  });

  it('does NOT render the queue when there are no pending requests (dormant)', () => {
    mockPendingRedemptions.mockReturnValue([]);
    render(<RewardsModal isOpen onClose={noop} />);
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('does NOT render the queue when Kid Mode is off even if requests exist', () => {
    mockUseKidModeEnabled.mockReturnValue(false);
    mockPendingRedemptions.mockReturnValue([makeRedemption()]);
    render(<RewardsModal isOpen onClose={noop} />);
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('lists a pending request with kid name, reward title, cost, and allowance amount', () => {
    render(<RewardsModal isOpen onClose={noop} />);
    expect(screen.getByText(/pending requests \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Leo · \$5 Allowance/)).toBeInTheDocument();
    // Cost in points and the allowance dollar amount are both shown.
    expect(screen.getByText(/100 pts/)).toBeInTheDocument();
    expect(screen.getByText(/\$5\.00 allowance/)).toBeInTheDocument();
  });

  it('Approve button calls approveRedemption with the request id', async () => {
    const { findByRole } = render(<RewardsModal isOpen onClose={noop} />);
    const approve = await findByRole('button', { name: /approve \$5 allowance for leo/i });
    approve.click();
    expect(approveRedemptionMock).toHaveBeenCalledWith('redemption_1');
    expect(denyRedemptionMock).not.toHaveBeenCalled();
  });

  it('Deny button calls denyRedemption with the request id', async () => {
    const { findByRole } = render(<RewardsModal isOpen onClose={noop} />);
    const deny = await findByRole('button', { name: /deny \$5 allowance for leo/i });
    deny.click();
    expect(denyRedemptionMock).toHaveBeenCalledWith('redemption_1');
    expect(approveRedemptionMock).not.toHaveBeenCalled();
  });
});
