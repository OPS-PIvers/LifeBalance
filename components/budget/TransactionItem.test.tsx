import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { MerchantRule, Transaction } from '@/types/schema';

// The row reads the household's merchant rules through `useMerchantRules`, which
// resolves them from `useHouseholdCore().householdSettings`. Drive that from a
// mutable binding so a test can author rules before rendering. Read lazily inside
// the hook (not captured at factory time), so the hoisted mock stays valid.
let merchantRules: MerchantRule[] | undefined;

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    householdSettings: merchantRules ? { merchantRules } : null,
  }),
}));

vi.mock('lucide-react', () => ({
  History: () => <div data-testid="icon-history" />,
  FileText: () => <div data-testid="icon-file-text" />,
  ArrowUpRight: () => <div data-testid="icon-up" />,
  ArrowDownLeft: () => <div data-testid="icon-down" />,
  Edit: () => <div data-testid="icon-edit" />,
  Trash2: () => <div data-testid="icon-trash" />,
  CheckSquare: () => <div data-testid="icon-check" />,
  Copy: () => <div data-testid="icon-copy" />,
  Scissors: () => <div data-testid="icon-scissors" />,
  MoreVertical: () => <div data-testid="icon-more" />,
  MessageSquare: () => <div data-testid="icon-message-square" />,
}));

import { TransactionItem } from './TransactionItem';

const baseTx: Transaction = {
  id: 'tx1',
  amount: 45.5,
  merchant: 'Safeway',
  category: 'Groceries',
  date: '2026-07-01',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
};

const noop = () => {};

beforeEach(() => {
  merchantRules = undefined;
});

describe('TransactionItem — Plan 23 comment count badge', () => {
  it('renders no comment indicator when commentCount is absent/0', () => {
    render(
      <TransactionItem
        transaction={baseTx}
        onEdit={noop} onDelete={noop} onDuplicate={noop} onSplit={noop}
        isSelectionMode={false} isSelected={false} onToggleSelection={noop}
      />
    );
    expect(screen.queryByTestId('icon-message-square')).not.toBeInTheDocument();
  });

  it('renders the comment count when commentCount > 0', () => {
    render(
      <TransactionItem
        transaction={{ ...baseTx, commentCount: 3 }}
        onEdit={noop} onDelete={noop} onDuplicate={noop} onSplit={noop}
        isSelectionMode={false} isSelected={false} onToggleSelection={noop}
      />
    );
    expect(screen.getByTestId('icon-message-square')).toBeInTheDocument();
    expect(screen.getByLabelText('3 comments')).toBeInTheDocument();
  });

  it('uses singular "comment" for a count of exactly 1', () => {
    render(
      <TransactionItem
        transaction={{ ...baseTx, commentCount: 1 }}
        onEdit={noop} onDelete={noop} onDuplicate={noop} onSplit={noop}
        isSelectionMode={false} isSelected={false} onToggleSelection={noop}
      />
    );
    expect(screen.getByLabelText('1 comment')).toBeInTheDocument();
  });
});

describe('TransactionItem — merchant rules (display-time rename)', () => {
  const uglyTx: Transaction = { ...baseTx, merchant: 'APPLE.COM/BILL 866-712-7753 CA' };

  const renderRow = (transaction: Transaction) =>
    render(
      <TransactionItem
        transaction={transaction}
        onEdit={noop} onDelete={noop} onDuplicate={noop} onSplit={noop} onMore={noop}
        isSelectionMode={false} isSelected={false} onToggleSelection={noop}
      />
    );

  it('renders the raw bank descriptor when the household has no rules', () => {
    renderRow(uglyTx);
    expect(screen.getByText('APPLE.COM/BILL 866-712-7753 CA')).toBeInTheDocument();
  });

  it('renders the rule name instead of the raw descriptor when a rule matches', () => {
    merchantRules = [
      { id: 'r1', pattern: 'APPLE.COM/BILL', name: 'Apple', createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    renderRow(uglyTx);

    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('APPLE.COM/BILL 866-712-7753 CA')).not.toBeInTheDocument();
  });

  it('uses the renamed merchant in the row action labels', () => {
    merchantRules = [
      { id: 'r1', pattern: 'APPLE.COM/BILL', name: 'Apple', createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    renderRow(uglyTx);

    expect(screen.getByLabelText('Edit transaction from Apple')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete transaction from Apple')).toBeInTheDocument();
    expect(screen.getByLabelText('More options transaction from Apple')).toBeInTheDocument();
  });

  it('leaves the descriptor alone for a category-only rule that carries no name', () => {
    merchantRules = [
      { id: 'r1', pattern: 'APPLE.COM/BILL', category: 'Subscriptions', createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    renderRow(uglyTx);

    expect(screen.getByText('APPLE.COM/BILL 866-712-7753 CA')).toBeInTheDocument();
  });

  it('honours an amount-qualified rule using the row amount', () => {
    merchantRules = [
      { id: 'r1', pattern: 'APPLE.COM/BILL', name: 'Apple One', amount: 45.5, createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    // baseTx.amount is 45.5, so the cent-exact qualifier is satisfied.
    renderRow(uglyTx);
    expect(screen.getByText('Apple One')).toBeInTheDocument();
  });

  it('does not apply an amount-qualified rule at a different amount', () => {
    merchantRules = [
      { id: 'r1', pattern: 'APPLE.COM/BILL', name: 'Apple One', amount: 9.99, createdAt: '2026-07-01T00:00:00.000Z' },
    ];

    renderRow(uglyTx);
    expect(screen.getByText('APPLE.COM/BILL 866-712-7753 CA')).toBeInTheDocument();
  });
});
