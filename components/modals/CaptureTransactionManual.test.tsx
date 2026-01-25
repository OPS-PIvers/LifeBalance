import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { CaptureTransactionManual } from './CaptureTransactionManual';
import { Transaction, Habit, BudgetBucket } from '../../types/schema';

// Mock dependencies
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

vi.mock('../../utils/habitSuggestions', () => ({
  suggestHabitsForTransaction: vi.fn().mockReturnValue([]),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  CheckCircle2: () => <div data-testid="icon-check-circle" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  AlertCircle: () => <div data-testid="icon-alert-circle" />,
}));

describe('CaptureTransactionManual', () => {
  const mockOnAddTransaction = vi.fn();
  const mockOnClose = vi.fn();
  const mockCategories = ['Food', 'Transport', 'Utilities'];
  const mockHabits: Habit[] = [];
  const mockTransactions: Transaction[] = [];
  const mockBuckets: BudgetBucket[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form fields correctly', () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
      />
    );

    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Starbucks')).toBeInTheDocument();
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Save Transaction')).toBeInTheDocument();
  });

  it('handles successful submission', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Starbucks'), { target: { value: 'Pizza Place' } });

    // Ensure date is set (it defaults to today but good to be explicit if testing validation)
    // We'll leave the default date.

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0][0];
    expect(calledArg).toMatchObject({
      amount: 25.00,
      merchant: 'Pizza Place',
      category: 'Food', // Defaults to first category
      source: 'manual',
      status: 'verified',
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('validates required fields', async () => {
    render(
      <CaptureTransactionManual
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
      />
    );

    // Empty submit
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).not.toHaveBeenCalled();
    });

    // Fill amount but no merchant
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25.00' } });
    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).not.toHaveBeenCalled();
    });
  });

  it('populates from initialData', async () => {
    render(
      <CaptureTransactionManual
        initialData={{
            amount: '50',
            merchant: 'Test Merchant',
            category: 'Transport'
        }}
        onAddTransaction={mockOnAddTransaction}
        onClose={mockOnClose}
        dynamicCategories={mockCategories}
        habits={mockHabits}
        transactions={mockTransactions}
        buckets={mockBuckets}
      />
    );

    fireEvent.click(screen.getByText('Save Transaction'));

    await waitFor(() => {
      expect(mockOnAddTransaction).toHaveBeenCalledTimes(1);
    });

    const calledArg = mockOnAddTransaction.mock.calls[0][0];
    expect(calledArg).toMatchObject({
      amount: 50,
      merchant: 'Test Merchant',
      category: 'Transport',
    });
  });
});
