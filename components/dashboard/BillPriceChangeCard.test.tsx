import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BillPriceChangeCard } from './BillPriceChangeCard';
import type { Transaction } from '@/types/schema';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 't',
  amount: 0,
  merchant: 'M',
  category: 'Budgeted in Calendar',
  date: '2026-10-01',
  status: 'verified',
  isRecurring: false,
  source: 'bank-sync',
  autoCategorized: true,
  payPeriodId: '2026-09-26',
  ...overrides,
});

const acknowledgeBillPriceChange = vi.fn(async () => {});
let transactions: Transaction[] = [];

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ transactions, acknowledgeBillPriceChange }),
}));

vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `$${n.toFixed(2)}`,
}));

describe('BillPriceChangeCard', () => {
  beforeEach(() => {
    navigate.mockClear();
    acknowledgeBillPriceChange.mockClear();
  });

  it('renders nothing when no bill changed price', () => {
    transactions = [tx({ id: 'plain', amount: 50 })];
    const { container } = render(<BillPriceChangeCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains an increase and offers to adjust the budget', () => {
    transactions = [
      tx({ id: 'gas', amount: 187.4, billPriceChange: { billTitle: 'Gas', scheduledAmount: 142 } }),
    ];
    render(<BillPriceChangeCard />);
    expect(screen.getByText('Gas came in at $187.40')).toBeInTheDocument();
    expect(screen.getByText(/\$45\.40 more than the \$142\.00 planned/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adjust budget' }));
    expect(navigate).toHaveBeenCalledWith('/budget', { state: { tab: 'buckets' } });
  });

  it('does not offer a budget adjustment when the bill cost less', () => {
    transactions = [
      tx({ id: 'gas', amount: 37.91, billPriceChange: { billTitle: 'Gas', scheduledAmount: 142 } }),
    ];
    render(<BillPriceChangeCard />);
    expect(screen.getByText(/\$104\.09 less than the \$142\.00 planned/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust budget' })).toBeNull();
  });

  it('acknowledges the change for that transaction', async () => {
    transactions = [
      tx({ id: 'gas', amount: 187.4, billPriceChange: { billTitle: 'Gas', scheduledAmount: 142 } }),
    ];
    render(<BillPriceChangeCard />);
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }));
    await waitFor(() => expect(acknowledgeBillPriceChange).toHaveBeenCalledWith('gas'));
  });
});
