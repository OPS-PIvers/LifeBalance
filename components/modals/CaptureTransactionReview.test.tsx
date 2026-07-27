import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureTransactionReview } from './CaptureTransactionReview';
import { ParsedTransaction } from '@/types/ui';
import { formatCurrency } from '@/utils/formatCurrency';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  AlertCircle: () => <div data-testid="icon-alert-circle" />,
}));

// CaptureTransactionReview now formats amounts via useFormatCurrency (which reads
// the household context). This component test renders without a provider, so back
// the hook with the real USD formatter — output is unchanged ($10.00, etc.).
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number) => formatCurrency(amount),
}));

const mockTransactions: ParsedTransaction[] = [
  {
    id: '1',
    merchant: 'Test Merchant',
    amount: 10.00,
    category: 'Food',
    date: '2023-10-01',
    selected: true,
  },
  {
    id: '2',
    merchant: 'Another Merchant',
    amount: 20.00,
    category: 'Transport',
    date: '2023-10-02',
    selected: false,
  }
];

describe('CaptureTransactionReview', () => {
  const mockOnUpdate = vi.fn();
  const mockOnToggle = vi.fn();
  const mockOnToggleAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders transactions list', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        dynamicCategories={['Food', 'Transport']}
        stores={[]}
        accounts={[]}
      />
    );

    expect(screen.getByText('Test Merchant')).toBeInTheDocument();
    expect(screen.getByText('Another Merchant')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });

  it('calls onToggleSelection when clicking checkbox', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        dynamicCategories={['Food', 'Transport']}
        stores={[]}
        accounts={[]}
      />
    );

    const selectButtons = screen.getAllByLabelText(/select transaction/i);
    const [firstButton, secondButton] = selectButtons as [HTMLElement, HTMLElement];

    // Toggle second transaction (currently unselected)
    fireEvent.click(secondButton);
    expect(mockOnToggle).toHaveBeenNthCalledWith(1, '2');

    // Toggle first transaction (currently selected)
    fireEvent.click(firstButton);
    expect(mockOnToggle).toHaveBeenNthCalledWith(2, '1');
  });

  it('calls onToggleAll when clicking Select/Deselect All', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        dynamicCategories={['Food', 'Transport']}
        stores={[]}
        accounts={[]}
      />
    );

    // Initial state: Not all selected, so button says "Select All"
    const toggleAllBtn = screen.getByText('Select All');
    fireEvent.click(toggleAllBtn);
    expect(mockOnToggleAll).toHaveBeenCalled();
  });

  // The "Add N to Action Queue" button no longer lives in this component — it
  // moved to the Drawer's fixed footer so it isn't a scroll away below a long
  // list of scanned rows. Its click and disabled-at-zero behaviour is covered
  // in CaptureModal.test.tsx ("puts the review bulk-add in the footer").
  it('renders no submit action of its own', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        dynamicCategories={['Food', 'Transport']}
        stores={[]}
        accounts={[]}
      />
    );

    expect(screen.queryByText(/to Action Queue/i)).not.toBeInTheDocument();
  });

  it('calls onUpdateTransaction when changing category', () => {
    render(
      <CaptureTransactionReview
        parsedTransactions={mockTransactions}
        onUpdateTransaction={mockOnUpdate}
        onToggleSelection={mockOnToggle}
        onToggleAll={mockOnToggleAll}
        dynamicCategories={['Food', 'Transport']}
        stores={[]}
        accounts={[]}
      />
    );

    // Click the 'Food' chip for the first transaction
    const foodChips = screen.getAllByText('Food');
    fireEvent.click(foodChips[0]!);
    expect(mockOnUpdate).toHaveBeenCalledWith('1', { category: 'Food' });
  });
});
