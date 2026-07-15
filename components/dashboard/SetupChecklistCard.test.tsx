import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Account, BudgetBucket, HouseholdMember } from '@/types/schema';

const mockCore = {
  householdId: 'hh-1',
  members: [{ uid: 'u1' }] as HouseholdMember[],
};
const mockFinance = {
  buckets: [] as BudgetBucket[],
  accounts: [] as Account[],
};
const mockNavigate = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
  useFinance: () => mockFinance,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('@/hooks/usePlaidEnabled', () => ({
  usePlaidEnabled: () => false,
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { SetupChecklistCard } from './SetupChecklistCard';

describe('SetupChecklistCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockCore.members = [{ uid: 'u1' } as HouseholdMember];
    mockFinance.buckets = [];
    mockFinance.accounts = [];
    mockNavigate.mockClear();
  });

  it('renders undone items and hides the bank item when Plaid is disabled', () => {
    render(<SetupChecklistCard />);
    expect(screen.getByText('Create a budget bucket')).toBeInTheDocument();
    expect(screen.getByText('Invite a household member')).toBeInTheDocument();
    expect(screen.queryByText('Connect a bank account')).not.toBeInTheDocument();
  });

  it('marks an item done from existing state (a bucket already exists)', () => {
    mockFinance.buckets = [{ id: 'b1' } as BudgetBucket];
    render(<SetupChecklistCard />);
    const bucketTitle = screen.getByText('Create a budget bucket');
    expect(bucketTitle.className).toContain('line-through');
  });

  it('navigates when a row is clicked', () => {
    render(<SetupChecklistCard />);
    fireEvent.click(screen.getByText('Create a budget bucket'));
    expect(mockNavigate).toHaveBeenCalledWith('/budget');
  });

  it('hides after dismiss and stays hidden across a re-mount (localStorage)', () => {
    const { unmount } = render(<SetupChecklistCard />);
    fireEvent.click(screen.getByLabelText('Dismiss setup checklist'));
    expect(screen.queryByText('Finish setting up')).not.toBeInTheDocument();
    unmount();
    render(<SetupChecklistCard />);
    expect(screen.queryByText('Finish setting up')).not.toBeInTheDocument();
  });

  it('renders nothing once every item is already done', () => {
    mockFinance.buckets = [{ id: 'b1' } as BudgetBucket];
    mockCore.members = [{ uid: 'u1' } as HouseholdMember, { uid: 'u2' } as HouseholdMember];
    const originalNotification = window.Notification;
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });
    render(<SetupChecklistCard />);
    expect(screen.queryByText('Finish setting up')).not.toBeInTheDocument();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: originalNotification,
    });
  });
});
