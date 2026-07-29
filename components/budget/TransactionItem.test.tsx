import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { INCOME_CATEGORY, type MerchantRule, type Transaction } from '@/types/schema';

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

import { TransactionItem, type TransactionItemProps } from './TransactionItem';

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

describe('TransactionItem — the row is the primary target (CRIT-01)', () => {
  const renderRow = (
    overrides: Partial<TransactionItemProps> = {},
    transaction: Transaction = baseTx
  ) => {
    const handlers = {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onSplit: vi.fn(),
      onMore: vi.fn(),
      onToggleSelection: vi.fn(),
    };
    render(
      <TransactionItem
        transaction={transaction}
        {...handlers}
        isSelectionMode={false}
        isSelected={false}
        {...overrides}
      />
    );
    return handlers;
  };

  describe('selection mode OFF', () => {
    it('exposes the row as a button naming the edit action, the sign and the merchant', () => {
      renderRow();
      const row = screen.getByRole('button', { name: 'Edit expense of $45.50 from Safeway, Jul 1, 2026' });
      expect(row).toHaveAttribute('tabindex', '0');
      expect(row).not.toHaveAttribute('aria-checked');
    });

    it('says "income" for an income row', () => {
      renderRow({}, { ...baseTx, category: INCOME_CATEGORY });
      expect(
        screen.getByRole('button', { name: 'Edit income of $45.50 from Safeway, Jul 1, 2026' })
      ).toBeInTheDocument();
    });

    it('opens the editor on click instead of doing nothing', async () => {
      const user = userEvent.setup();
      const handlers = renderRow();

      await user.click(screen.getByRole('button', { name: /^Edit expense/ }));

      expect(handlers.onEdit).toHaveBeenCalledTimes(1);
      expect(handlers.onEdit).toHaveBeenCalledWith(baseTx);
      expect(handlers.onToggleSelection).not.toHaveBeenCalled();
    });

    it.each(['{Enter}', ' '])('opens the editor when %s is pressed on the focused row', async (key) => {
      const user = userEvent.setup();
      const handlers = renderRow();

      const row = screen.getByRole('button', { name: /^Edit expense/ });
      row.focus();
      await user.keyboard(key);

      expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    });

    it('does not fire the row when the kebab is clicked', async () => {
      const user = userEvent.setup();
      const handlers = renderRow();

      await user.click(screen.getByLabelText('More options transaction from Safeway'));

      expect(handlers.onMore).toHaveBeenCalledTimes(1);
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('does not fire the row when an action button is activated by keyboard', async () => {
      const user = userEvent.setup();
      const handlers = renderRow();

      screen.getByLabelText('More options transaction from Safeway').focus();
      await user.keyboard('{Enter}');

      expect(handlers.onMore).toHaveBeenCalledTimes(1);
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    // ARIA forbids interactive descendants of role="button". Nesting the 1-5
    // action controls inside the row's own button subtree gave a keyboard user
    // 2-5 tab stops per row across a 100-row virtualized list, with the hover
    // "Edit" button firing the very same onEdit(tx) as its own container.
    it('renders every action control as a SIBLING of the row body, never inside it', () => {
      renderRow();

      const body = screen.getByRole('button', { name: /^Edit expense/ });
      expect(body.querySelector('button')).toBeNull();

      const actionLabels = [
        'Edit transaction from Safeway',
        'Duplicate transaction from Safeway',
        'Split transaction from Safeway',
        'Delete transaction from Safeway',
        'More options transaction from Safeway',
      ];
      for (const label of actionLabels) {
        const action = screen.getByLabelText(label);
        expect(body.contains(action)).toBe(false);
        // Same parent chain: the action cluster hangs off the row that also
        // hosts the body, so they are siblings within one visual row.
        expect(body.parentElement?.contains(action)).toBe(true);
      }
    });

    it('gives the row body exactly one tab stop, ahead of the action controls', async () => {
      const user = userEvent.setup();
      renderRow();

      const body = screen.getByRole('button', { name: /^Edit expense/ });
      await user.tab();
      expect(body).toHaveFocus();

      // The next stop must be an action control, not the row body a second time.
      await user.tab();
      expect(body).not.toHaveFocus();
      expect(document.activeElement).toBe(screen.getByLabelText('Edit transaction from Safeway'));
    });
  });

  describe('selection mode ON', () => {
    it('still announces as a checkbox carrying its checked state', () => {
      renderRow({ isSelectionMode: true, isSelected: true });
      const row = screen.getByRole('checkbox', { name: 'Select expense of $45.50 from Safeway, Jul 1, 2026' });
      expect(row).toHaveAttribute('aria-checked', 'true');
      expect(row).toHaveAttribute('tabindex', '0');
    });

    it('toggles selection on click and never opens the editor', async () => {
      const user = userEvent.setup();
      const handlers = renderRow({ isSelectionMode: true });

      await user.click(screen.getByRole('checkbox', { name: /^Select expense/ }));

      expect(handlers.onToggleSelection).toHaveBeenCalledWith('tx1');
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it.each(['{Enter}', ' '])('toggles selection when %s is pressed on the focused row', async (key) => {
      const user = userEvent.setup();
      const handlers = renderRow({ isSelectionMode: true });

      screen.getByRole('checkbox', { name: /^Select expense/ }).focus();
      await user.keyboard(key);

      expect(handlers.onToggleSelection).toHaveBeenCalledTimes(1);
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('leaves no stray "Select transaction" label on the hidden checkbox glyph', () => {
      renderRow({ isSelectionMode: true });
      expect(screen.queryByLabelText('Select transaction')).not.toBeInTheDocument();
    });

    // Selection mode hides every action button, so the role can safely sit on
    // the whole row here — but only while that stays true.
    it('hosts the checkbox role on a subtree with no interactive descendant', () => {
      renderRow({ isSelectionMode: true });
      const row = screen.getByRole('checkbox', { name: /^Select expense/ });
      expect(row.querySelector('button')).toBeNull();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('leading category glyph', () => {
    it('is not a 44x44 bordered box masquerading as an icon button', () => {
      renderRow();
      const glyph = screen.getByTestId('icon-up').parentElement;

      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      // `w-11 h-11 rounded-card border` + a filled bg was dimensionally identical
      // to `Button size="icon"`, so the row read as having a control it did not
      // have. Keep the glyph a bare icon.
      const classes = glyph?.className ?? '';
      expect(classes).not.toMatch(/\bw-11\b|\bh-11\b|\bborder\b|\bbg-/);
    });
  });
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
