
import { render, screen, fireEvent } from '@testing-library/react';
import { BudgetBucketCard } from './BudgetBucketCard';
import { BudgetBucket, MerchantRule, Transaction } from '@/types/schema';
import { formatCurrency } from '@/utils/formatCurrency';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// BudgetBucketCard formats amounts via useFormatCurrency (which reads the
// household context). These tests render the card without a provider, so back the
// hook with the real USD formatter — output is unchanged ($200.00, $500, etc.).
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number, options?: { decimals?: 0 | 2 }) =>
    formatCurrency(amount, options),
}));

// The inline transaction list resolves merchant names through `useMerchantRules`,
// which reads `useHouseholdCore()`. These tests render without a provider, so
// stand the core slice up here; `merchantRules` is mutable so a test can author a
// rule and assert the displayed name changes.
let merchantRules: MerchantRule[] | undefined;

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    householdSettings: merchantRules ? { merchantRules } : null,
  }),
}));

describe('BudgetBucketCard', () => {
  const mockBucket: BudgetBucket = {
    id: 'bucket1',
    name: 'Groceries',
    limit: 500,
    color: 'bg-green-500',
    isVariable: false,
    isCore: true
  };

  const mockSpent = { verified: 200, pending: 50 };

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      date: '2026-07-01',
      amount: 123.45,
      merchant: 'Grocery Store',
      category: 'Groceries',
      status: 'verified',
    } as Transaction,
    {
      id: 't2',
      date: '2026-06-28',
      amount: 76.5,
      merchant: 'Corner Market',
      category: 'Groceries',
      status: 'pending_review',
    } as Transaction,
  ];

  const defaultProps = {
    bucket: mockBucket,
    spent: mockSpent,
    transactions: [] as Transaction[],
    isExpanded: false,
    onExpand: vi.fn(),
    onEditBucket: vi.fn(),
    onReallocate: vi.fn(),
    onEditTransaction: vi.fn(),
    onDeleteTransaction: vi.fn(),
  };

  beforeEach(() => {
    merchantRules = undefined;
  });

  it('renders bucket information correctly', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    // The * was moved to a separate text element or removed from this specific span
    expect(screen.getByText('+$50.00')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });

  it('renders progress bar correctly', () => {
    const { container } = render(<BudgetBucketCard {...defaultProps} />);
    // Target the progress bar specifically (the track is the role=progressbar
    // wrapper; the fill is its first child).
    const progressBarWrapper = container.querySelector('[role="progressbar"]');
    const progressBar = progressBarWrapper?.firstElementChild;

    expect(progressBar).toHaveStyle('width: 50%'); // (250/500)*100
    expect(progressBar).toHaveClass('bg-green-500');
  });

  // The inline limit-edit affordance was collapsed into the ONE edit entry
  // (the pencil → full drawer) in impeccable r6 — the limit figure is plain
  // read-only data on the row now.
  it('renders the limit as plain text with no inline edit affordance', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    expect(screen.queryByLabelText(/Edit limit for/)).not.toBeInTheDocument();
    // The limit figure is not interactive.
    expect(screen.getByText('$500').closest('button')).toBeNull();
  });

  it('opens the full bucket editor from the one edit entry (pencil)', () => {
    render(<BudgetBucketCard {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Edit Groceries bucket'));
    expect(defaultProps.onEditBucket).toHaveBeenCalledWith(mockBucket);
  });

  it('hides the edit pencil for read-only pseudo-buckets (editable={false})', () => {
    render(<BudgetBucketCard {...defaultProps} editable={false} />);

    expect(screen.queryByLabelText('Edit Groceries bucket')).not.toBeInTheDocument();
  });

  it('calls onExpand when the bucket row is clicked', () => {
    render(<BudgetBucketCard {...defaultProps} transactions={mockTransactions} />);
    fireEvent.click(screen.getByRole('button', { name: /View 2 transactions for Groceries/i }));
    expect(defaultProps.onExpand).toHaveBeenCalledWith('bucket1');
  });

  it('marks the toggle collapsed/expanded via aria-expanded and rotates the chevron', () => {
    const { rerender, container } = render(<BudgetBucketCard {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: /View 0 transactions for Groceries/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('svg.lucide-chevron-down')).not.toHaveClass('rotate-180');

    rerender(<BudgetBucketCard {...defaultProps} isExpanded={true} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('svg.lucide-chevron-down')).toHaveClass('rotate-180');
  });

  it('lists the bucket transactions inline when expanded', () => {
    render(<BudgetBucketCard {...defaultProps} transactions={mockTransactions} isExpanded={true} />);

    expect(screen.getByText('2 transactions')).toBeInTheDocument();
    expect(screen.getByText('Grocery Store')).toBeInTheDocument();
    expect(screen.getByText('$123.45')).toBeInTheDocument();
    expect(screen.getByText('Jul 1')).toBeInTheDocument();
    expect(screen.getByText('Corner Market')).toBeInTheDocument();
    expect(screen.getByText('$76.50')).toBeInTheDocument();
    // Pending transactions carry a badge
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('hides the transaction list when collapsed', () => {
    render(<BudgetBucketCard {...defaultProps} transactions={mockTransactions} isExpanded={false} />);
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();
  });

  it('shows a subtle empty state when expanded with no transactions', () => {
    render(<BudgetBucketCard {...defaultProps} transactions={[]} isExpanded={true} />);
    expect(screen.getByText('No transactions yet this period')).toBeInTheDocument();
  });

  it('wires per-transaction edit and delete actions', () => {
    render(<BudgetBucketCard {...defaultProps} transactions={mockTransactions} isExpanded={true} />);

    fireEvent.click(screen.getByLabelText('Edit transaction: Grocery Store'));
    expect(defaultProps.onEditTransaction).toHaveBeenCalledWith(mockTransactions[0]);

    fireEvent.click(screen.getByLabelText('Delete transaction: Corner Market'));
    expect(defaultProps.onDeleteTransaction).toHaveBeenCalledWith('t2');
  });

  it('renames the inline transactions through the household merchant rules', () => {
    merchantRules = [
      { id: 'r1', pattern: 'Grocery Store', name: 'Safeway', createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    render(<BudgetBucketCard {...defaultProps} transactions={mockTransactions} isExpanded={true} />);

    expect(screen.getByText('Safeway')).toBeInTheDocument();
    expect(screen.queryByText('Grocery Store')).not.toBeInTheDocument();
    // The row's action labels follow the renamed merchant.
    expect(screen.getByLabelText('Edit transaction: Safeway')).toBeInTheDocument();
    // An unmatched row keeps its raw descriptor.
    expect(screen.getByText('Corner Market')).toBeInTheDocument();
  });

  it('shows the overspend line and calls onReallocate when Fix is clicked', () => {
    render(<BudgetBucketCard {...defaultProps} spent={{ verified: 600, pending: 0 }} />);

    expect(screen.getByText('$100.00 over budget')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Fix'));
    expect(defaultProps.onReallocate).toHaveBeenCalledWith('bucket1');
  });
});
