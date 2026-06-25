import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HouseholdMember, RewardItem } from '@/types/schema';
import RewardsModal from './RewardsModal';

// --- Mocks -------------------------------------------------------------------
// The modal reads the Kid Mode flag (useKidModeEnabled), the gamification slice
// (rewards list + redeem/CRUD actions), and household members (useHouseholdCore).
// We drive the flag independently so the dormancy gate can be exercised in
// isolation, mirroring the pattern in KidsChoresWidget.test.tsx.
const mockUseKidModeEnabled = vi.fn<() => boolean>(() => false);
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockRewards = vi.fn<() => RewardItem[]>(() => []);

vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => mockUseKidModeEnabled(),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ members: mockMembers() }),
  useGamification: () => ({
    rewardsInventory: mockRewards(),
    totalPoints: 100,
    redeemReward: vi.fn(),
    addReward: vi.fn(),
    updateReward: vi.fn(),
    deleteReward: vi.fn(),
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

const noop = () => {};

describe('RewardsModal — Kid Mode dormancy gate', () => {
  beforeEach(() => {
    mockUseKidModeEnabled.mockReturnValue(false);
    mockMembers.mockReturnValue([]);
    mockRewards.mockReturnValue([makeReward()]);
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
