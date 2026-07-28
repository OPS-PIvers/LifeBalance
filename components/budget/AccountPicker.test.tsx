import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import AccountPicker from './AccountPicker';
import type { Account } from '@/types/schema';

const mockUseHousehold = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

vi.mock('lucide-react', () => ({
  Sparkles: () => <div data-testid="sparkles" />,
  X: () => <div data-testid="x" />,
}));

const accounts: Account[] = [
  { id: 'acc-check', name: 'Checking', type: 'checking', balance: 1000, lastUpdated: '' },
  { id: 'acc-save', name: 'Savings', type: 'savings', balance: 900, lastUpdated: '' },
  { id: 'acc-card', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
];

describe('AccountPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHousehold.mockReturnValue({ accounts, householdSettings: null });
  });

  it('hides credit accounts by default — the bill-PAY flow funds a payment from checking', () => {
    render(<AccountPicker isOpen onClose={() => {}} onSelect={() => {}} />);

    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.queryByText('Visa')).not.toBeInTheDocument();
  });

  it('offers credit accounts with includeCredit — a bill CAN be charged to a card', () => {
    // Without this the settle flow could never pick the card a bill was actually
    // charged to, so it debited CHECKING instead and corrupted Safe-to-Spend.
    render(<AccountPicker isOpen onClose={() => {}} onSelect={() => {}} includeCredit />);

    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
  });

  it('adapts the empty-state copy to which accounts were on offer', () => {
    mockUseHousehold.mockReturnValue({ accounts: [], householdSettings: null });
    const { rerender } = render(<AccountPicker isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('No checking or savings accounts available.')).toBeInTheDocument();

    rerender(<AccountPicker isOpen onClose={() => {}} onSelect={() => {}} includeCredit />);
    expect(screen.getByText('No accounts available.')).toBeInTheDocument();
  });
});
