import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MoneyPulseWidget } from './MoneyPulseWidget';

const mockUseFinance = vi.fn();
const mockUseDashboardTransactionStats = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => mockUseFinance(),
  useHouseholdCore: () => ({ householdSettings: undefined }),
}));

vi.mock('@/hooks/useDashboardTransactionStats', () => ({
  useDashboardTransactionStats: () => mockUseDashboardTransactionStats(),
}));

const renderWidget = () =>
  render(
    <MemoryRouter>
      <MoneyPulseWidget />
    </MemoryRouter>
  );

describe('MoneyPulseWidget', () => {
  it('shows an add-first-transaction CTA instead of nothing when there are no transactions', () => {
    mockUseFinance.mockReturnValue({ transactions: [] });
    mockUseDashboardTransactionStats.mockReturnValue({
      thisWeekSpend: 0,
      lastWeekSpend: 0,
      recentTransactions: [],
    });

    renderWidget();

    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to money/i })).toBeInTheDocument();
  });

  it('renders the pulse content when transactions exist', () => {
    mockUseFinance.mockReturnValue({ transactions: [{ id: '1' }] });
    mockUseDashboardTransactionStats.mockReturnValue({
      thisWeekSpend: 100,
      lastWeekSpend: 50,
      recentTransactions: [],
    });

    renderWidget();

    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    expect(screen.getByText('Spent this week')).toBeInTheDocument();
  });
});
