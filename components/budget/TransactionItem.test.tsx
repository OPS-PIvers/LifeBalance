import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import type { Transaction } from '@/types/schema';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ householdSettings: null }),
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
