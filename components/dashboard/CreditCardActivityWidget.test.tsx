import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CreditCardActivityWidget } from './CreditCardActivityWidget';
import type { Account, Transaction } from '@/types/schema';

const PERIOD = '2026-06-01';

const checking: Account = { id: 'chk', name: 'Checking', type: 'checking', balance: 1000, lastUpdated: '' };
const card: Account = { id: 'cc', name: 'Visa', type: 'credit', balance: 500, lastUpdated: '' };

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  amount: 0,
  merchant: 'M',
  category: 'Groceries',
  date: '2026-06-10',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  payPeriodId: PERIOD,
  ...overrides,
});

const state = {
  accounts: [checking, card] as Account[],
  currentPeriodId: PERIOD,
  householdSettings: undefined,
  transactions: [
    tx({ accountId: 'cc', amount: 120 }),                          // charge
    tx({ accountId: 'cc', amount: 30 }),                           // charge → total 150
    tx({ accountId: 'cc', amount: 50, creditPayment: true }),      // payment
    tx({ accountId: 'cc', amount: 999, payPeriodId: '2026-05-01' }), // other period → ignored
    tx({ accountId: 'chk', amount: 80 }),                          // not this card → ignored
  ] as Transaction[],
};

const mockHook = vi.fn(() => state);

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockHook();
  return {
    useFinance: value,
    useHouseholdCore: value,
  };
});

describe('CreditCardActivityWidget', () => {
  it('renders charges, payments, net and balance for the current period only', () => {
    render(<CreditCardActivityWidget onPayDown={() => {}} />);

    expect(screen.getByText('Credit card activity')).toBeInTheDocument();
    expect(screen.getByText('Visa')).toBeInTheDocument();
    // charges 120 + 30 = 150 (the other-period 999 is excluded)
    expect(screen.getByText('+$150.00')).toBeInTheDocument();
    // payments 50
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
    // net 150 − 50 = 100
    expect(screen.getByText('+$100.00')).toBeInTheDocument();
    // current balance
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });

  it('invokes onPayDown with the card id', () => {
    const onPayDown = vi.fn();
    render(<CreditCardActivityWidget onPayDown={onPayDown} />);
    screen.getByRole('button', { name: /pay down/i }).click();
    expect(onPayDown).toHaveBeenCalledWith('cc');
  });

  it('renders nothing when there are no credit accounts', () => {
    mockHook.mockReturnValueOnce({ ...state, accounts: [checking] });
    const { container } = render(<CreditCardActivityWidget onPayDown={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
