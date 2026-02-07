import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SmartTransactionShortcuts } from './SmartTransactionShortcuts';
import { Transaction } from '../../types/schema';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), loading: vi.fn(), error: vi.fn() },
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Plus: () => <div data-testid="plus-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
}));

describe('SmartTransactionShortcuts', () => {
  const mockOnAddTransaction = vi.fn();

  const transactions: Transaction[] = [
    {
      id: '1',
      merchant: 'Coffee Shop',
      amount: 5.00,
      category: 'Dining',
      date: '2023-01-01',
      source: 'manual',
      status: 'verified',
      isRecurring: false,
      autoCategorized: false,
    },
    {
      id: '2',
      merchant: 'Coffee Shop',
      amount: 5.00,
      category: 'Dining',
      date: '2023-01-02',
      source: 'manual',
      status: 'verified',
      isRecurring: false,
      autoCategorized: false,
    },
    {
      id: '3',
      merchant: 'Grocery Store',
      amount: 50.00,
      category: 'Groceries',
      date: '2023-01-03',
      source: 'manual',
      status: 'verified',
      isRecurring: false,
      autoCategorized: false,
    },
    // Only one instance of this, so it shouldn't appear (count < 2)
    {
      id: '4',
      merchant: 'One Time Purchase',
      amount: 100.00,
      category: 'Shopping',
      date: '2023-01-04',
      source: 'manual',
      status: 'verified',
      isRecurring: false,
      autoCategorized: false,
    },
    // Recurring should be ignored
    {
      id: '5',
      merchant: 'Netflix',
      amount: 15.00,
      category: 'Entertainment',
      date: '2023-01-05',
      source: 'recurring',
      isRecurring: true,
      status: 'verified',
      autoCategorized: true,
    },
    {
      id: '6',
      merchant: 'Netflix',
      amount: 15.00,
      category: 'Entertainment',
      date: '2023-02-05',
      source: 'recurring',
      isRecurring: true,
      status: 'verified',
      autoCategorized: true,
    }
  ];

  it('renders frequent manual transactions', () => {
    render(
      <SmartTransactionShortcuts
        transactions={transactions}
        onAddTransaction={mockOnAddTransaction}
      />
    );

    // Coffee Shop should appear (count 2)
    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();

    // Grocery Store should NOT appear (count 1)
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();

    // One Time Purchase should NOT appear (count 1)
    expect(screen.queryByText('One Time Purchase')).not.toBeInTheDocument();

    // Netflix should NOT appear (recurring)
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('calls onAddTransaction when shortcut is clicked', async () => {
    render(
      <SmartTransactionShortcuts
        transactions={transactions}
        onAddTransaction={mockOnAddTransaction}
      />
    );

    const button = screen.getByText('Coffee Shop').closest('button');
    fireEvent.click(button!);

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledWith(expect.objectContaining({
        merchant: 'Coffee Shop',
        amount: 5.00,
        category: 'Dining',
        source: 'manual',
        isRecurring: false,
        status: 'verified',
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // Should be today's date
      }));
    });
  });

  it('renders nothing if no shortcuts found', () => {
    const emptyTransactions: Transaction[] = [];
    const { container } = render(
      <SmartTransactionShortcuts
        transactions={emptyTransactions}
        onAddTransaction={mockOnAddTransaction}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
