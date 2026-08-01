import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TransactionReviewForm from './TransactionReviewForm';
import { CalendarItem, Transaction, MerchantRule } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { addDays, format, isSameDay, parseISO, startOfISOWeek, subDays } from 'date-fns';

// Hoisted mocks (available before the module imports run).
const {
  mockUpdateTransactionCategory,
  mockDeleteTransaction,
  mockMergeTransactions,
  mockKeepBothTransactions,
  mockAddCalendarItem,
  mockLinkBankTransactionToBill,
  mockOnDone,
  mockToast,
  mockRequestDeleteConfirmation,
} = vi.hoisted(() => ({
  mockUpdateTransactionCategory: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockDeleteTransaction: vi.fn((..._args: unknown[]) => Promise.resolve()),
  // Resolves TRUE by default: the real mutation reports whether the dupe was
  // actually merged away, and the settled-bill arm only advances on `true`.
  mockMergeTransactions: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
  mockKeepBothTransactions: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockAddCalendarItem: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockLinkBankTransactionToBill: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockOnDone: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  mockRequestDeleteConfirmation: vi.fn(),
}));

// Both confirmation paths route through this store — `utils/toastHelpers` for
// Delete, and the form directly for the amount-only settled-bill merge — so
// stubbing it here intercepts both without disturbing anything else.
vi.mock('@/components/ui/confirmDialogStore', () => ({
  requestDeleteConfirmation: mockRequestDeleteConfirmation,
}));

// Transactions the form's `useFinance().transactions` should resolve
// `possibleDuplicateOf` against — mutable per-test via `mockTransactions.length = 0; mockTransactions.push(...)`.
const mockTransactions: Transaction[] = [];
// Accounts, mutable the same way (credit-account tests seed a card).
const mockAccounts: { id: string; name: string; type: string }[] = [];
// Habits, mutable the same way (habit pre-selection tests seed these).
// Deliberately NOT `Partial<Habit>`: the existing fixtures declare `type` as a
// plain string, which can't narrow to Habit's 'positive' | 'negative' union.
// The optional fields are the ones the keyword-automation tests need.
const mockHabits: {
  id: string; title: string; category: string; type: string;
  period?: 'daily' | 'weekly';
  triggers?: { keywords?: string[] };
  completedDates?: string[];
}[] = [];
// Household merchant rules, mutable per-test the same way. Empty ⇒ the form
// renders exactly as it did before display-time renaming existed.
const mockMerchantRules: MerchantRule[] = [];
// Calendar items backing the settled-bill duplicate arm — the form resolves a
// counterpart's `paidCalendarItemId` against these.
const mockCalendarItems: CalendarItem[] = [];

// Mock the domain slices consumed by the form (same pattern as
// EditTransactionModal.test.tsx).
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({
    accounts: mockAccounts,
    buckets: [
      { id: '1', name: 'Groceries' },
      { id: '2', name: 'Gas' },
    ],
    transactions: mockTransactions,
    calendarItems: mockCalendarItems,
    updateTransactionCategory: mockUpdateTransactionCategory,
    deleteTransaction: mockDeleteTransaction,
    mergeTransactions: mockMergeTransactions,
    keepBothTransactions: mockKeepBothTransactions,
    addCalendarItem: mockAddCalendarItem,
    linkBankTransactionToBill: mockLinkBankTransactionToBill,
  }),
  useGamification: () => ({ habits: mockHabits }),
  // Backs useMerchantRules (display-time descriptor renaming).
  useHouseholdCore: () => ({ householdSettings: { merchantRules: mockMerchantRules } }),
  useExpandedCalendarItems: () => [],
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

// Mock Lucide icons to avoid rendering SVGs; each becomes a testid div.
vi.mock('lucide-react', () => ({
  Check: () => <div data-testid="icon-check" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  Copy: () => <div data-testid="icon-copy" />,
  Link2: () => <div data-testid="icon-link2" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Search: () => <div data-testid="icon-search" />,
  X: () => <div data-testid="icon-x" />,
}));

const baseTx: Transaction = {
  id: 'tx1',
  amount: 25,
  merchant: 'Coffee',
  category: 'Groceries',
  date: '2026-06-10',
  status: 'pending_review',
  payPeriodId: '2026-06-01',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
};

describe('TransactionReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransactions.length = 0;
    mockAccounts.length = 0;
    mockHabits.length = 0;
    mockMerchantRules.length = 0;
    mockCalendarItems.length = 0;
  });

  it('pre-selects the Income option for an income transaction', () => {
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, category: 'Income', amount: 500 }}
        onDone={mockOnDone}
      />
    );

    // The Income option is prepended (not a bucket) and pre-selected.
    expect(screen.getByLabelText(/budget category/i)).toHaveValue('Income');
  });

  it('approves an income transaction with the Income category (never an expense bucket)', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, category: 'Income', amount: 500 }}
        onDone={mockOnDone}
      />
    );

    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(mockUpdateTransactionCategory).toHaveBeenCalledTimes(1);
    const call = mockUpdateTransactionCategory.mock.calls[0]!;
    expect(call[0]).toBe('tx1');
    expect(call[1]).toBe('Income');
    expect(mockOnDone).toHaveBeenCalled();
  });

  it('disables Approve for a $0 needsAmount stub until a valid amount is entered', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, amount: 0, needsAmount: true }}
        onDone={mockOnDone}
      />
    );

    const approve = screen.getByRole('button', { name: /^add amount$/i });
    expect(approve).toBeDisabled();

    // A sub-cent entry rounds to $0 and must stay rejected.
    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '0.004');
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();

    // A real amount unlocks it.
    await user.clear(amountInput);
    await user.type(amountInput, '12.50');
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeEnabled();
  });

  it('passes the entered amount as an override when approving a stub', async () => {
    const user = userEvent.setup();
    render(
      <TransactionReviewForm
        transaction={{ ...baseTx, amount: 0, needsAmount: true }}
        onDone={mockOnDone}
      />
    );

    const amountInput = screen.getByLabelText(/amount/i);
    await user.type(amountInput, '12.50');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    const call = mockUpdateTransactionCategory.mock.calls[0]!;
    expect(call[4]).toMatchObject({ amount: 12.5, clearNeedsAmount: true });
  });

  describe('credit-account handling', () => {
    const seedAccounts = () => {
      mockAccounts.push(
        { id: 'chk', name: 'Checking', type: 'checking' },
        { id: 'cc', name: 'Paul Visa', type: 'credit' },
      );
    };

    it('hides the budget-category dropdown and shows the Charge/Payment control for a credit-tagged transaction', () => {
      seedAccounts();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'cc' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByLabelText(/budget category/i)).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Charge' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Payment' })).toBeInTheDocument();
    });

    it('shows the category dropdown (no Charge/Payment control) when a checking account is selected', () => {
      seedAccounts();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'chk' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByLabelText(/budget category/i)).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Charge' })).not.toBeInTheDocument();
    });

    it('approves a credit charge under CREDIT_CARD_CATEGORY without requiring a category pick', async () => {
      const user = userEvent.setup();
      seedAccounts();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'cc', category: '' }}
          onDone={mockOnDone}
        />
      );

      const approve = screen.getByRole('button', { name: /^approve$/i });
      expect(approve).toBeEnabled();
      await user.click(approve);

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[1]).toBe('Credit Card');
      // A plain charge sends no creditPayment override (nothing changed).
      expect((call[4] as { creditPayment?: boolean } | undefined)?.creditPayment).toBeUndefined();
    });

    it('flipping the toggle to Payment sends a creditPayment override', async () => {
      const user = userEvent.setup();
      seedAccounts();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'cc', category: '' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('radio', { name: 'Payment' }));
      expect(screen.getByRole('radio', { name: 'Payment' })).toHaveAttribute('aria-checked', 'true');
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toMatchObject({ creditPayment: true });
    });

    it('re-tagging to checking sends creditPayment:false to clear a stored flag', async () => {
      const user = userEvent.setup();
      seedAccounts();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'cc', creditPayment: true }}
          onDone={mockOnDone}
        />
      );

      await user.selectOptions(screen.getByLabelText(/account/i), 'chk');
      // The category dropdown is back and required.
      await user.selectOptions(screen.getByLabelText(/budget category/i), 'Gas');
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[1]).toBe('Gas');
      expect(call[4]).toMatchObject({ creditPayment: false });
    });
  });

  describe('possible-duplicate notice (plan 03 PR-3)', () => {
    const otherTx: Transaction = {
      ...baseTx,
      id: 'tx2',
      merchant: 'Coffee Shop',
      amount: 24.99,
      date: '2026-06-11',
    };

    it('renders a notice with Merge / Keep both when possibleDuplicateOf resolves to an existing transaction', () => {
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText(/possible duplicate of/i)).toBeInTheDocument();
      expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^merge$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /keep both/i })).toBeInTheDocument();
    });

    it('renders no notice when possibleDuplicateOf points at a row that no longer exists', () => {
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'gone' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
    });

    it('renders no notice when the transaction has no possibleDuplicateOf', () => {
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);
      expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
    });

    it('Merge calls mergeTransactions with the pickKeeper-chosen keeper/dupe pair', async () => {
      const user = userEvent.setup();
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /^merge$/i }));

      expect(mockMergeTransactions).toHaveBeenCalledTimes(1);
      // Both rows are pending_review with no distinguishing richness/createdAt,
      // so pickKeeper's stable tiebreak keeps whichever is passed as `a`
      // (the flagged transaction itself) — assert a keeper/dupe pair from
      // {tx1, tx2}, not upstream identity-verdict details this test doesn't own.
      const [keeperId, dupeId] = mockMergeTransactions.mock.calls[0]!;
      expect([keeperId, dupeId].sort()).toEqual(['tx1', 'tx2']);
      expect(mockOnDone).toHaveBeenCalled();
    });

    it('Keep both calls keepBothTransactions with the flagged transaction id and does not call onDone', async () => {
      const user = userEvent.setup();
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /keep both/i }));

      expect(mockKeepBothTransactions).toHaveBeenCalledWith('tx1');
      expect(mockOnDone).not.toHaveBeenCalled();
      // The host drawer passes a SNAPSHOT transaction, so the prop never
      // updates — the banner must hide via local state after the dismiss.
      expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
    });

    it('keeps the banner visible when keepBothTransactions fails', async () => {
      const user = userEvent.setup();
      mockKeepBothTransactions.mockRejectedValueOnce(new Error('offline'));
      mockTransactions.push(otherTx);
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /keep both/i }));

      expect(mockToast.error).toHaveBeenCalledWith('Failed to update transaction');
      expect(screen.getByText(/possible duplicate of/i)).toBeInTheDocument();
    });
  });

  // utils/settledBillDuplicate.ts — the bank's own copy of a bill the household
  // already paid by hand. Distinct copy from the arm above on purpose (both to
  // say a different thing, and so those six /possible duplicate of/i assertions
  // stay unambiguous).
  describe('settled-bill duplicate notice', () => {
    const paidInstance: CalendarItem = {
      id: 'cal-paid',
      title: 'Centerpoint Energy (Natural Gas)',
      amount: 142,
      date: '2026-06-05',
      type: 'expense',
      isPaid: true,
      isRecurring: false,
      parentRecurringId: 'cal-tmpl',
    };

    /** The hand-paid row, exactly as `payCalendarItem` writes it. */
    const settledRow: Transaction = {
      id: 'tx-manual',
      amount: 142,
      merchant: 'Centerpoint Energy (Natural Gas)',
      category: 'Budgeted in Calendar',
      date: '2026-06-05',
      status: 'verified',
      isRecurring: true,
      source: 'recurring',
      autoCategorized: true,
      accountId: 'acc-check',
      paidCalendarItemId: 'cal-paid',
      createdAt: '2026-06-05T12:00:00.000Z',
    };

    /** The bank-sync copy — the row the drawer actually opens on. */
    const bankRow: Transaction = {
      ...baseTx,
      id: 'tx-bank',
      amount: 142,
      merchant: 'CPENERGY MNGCO 260805',
      category: 'Uncategorized',
      date: '2026-06-09',
      status: 'verified',
      source: 'bank-sync',
      accountId: 'acc-check',
      needsCategory: true,
      bankRef: 'synth:cpenergy',
      createdAt: '2026-06-04T12:00:00.000Z',
    };

    /**
     * Seeds the pair. `aliases` puts a learned descriptor on the TEMPLATE,
     * which is the only thing that lifts this fixture to the `descriptor` tier
     * — "CPENERGY MNGCO" and "Centerpoint Energy (Natural Gas)" share no
     * significant token at all, which is exactly why the server-side matcher
     * couldn't pair them and why this feature exists.
     */
    const seed = (settled: Transaction = settledRow, aliases?: string[]) => {
      mockAccounts.push({ id: 'acc-check', name: 'Checking', type: 'checking' });
      mockCalendarItems.push({
        id: 'cal-tmpl', title: 'Centerpoint Energy (Natural Gas)', amount: 142,
        date: '2026-06-05', type: 'expense', isPaid: false, isRecurring: true, frequency: 'monthly',
        ...(aliases ? { bankDescriptorAliases: aliases } : {}),
      }, paidInstance);
      mockTransactions.push(settled, bankRow);
    };
    /** Descriptor-tier seed: the bill already knows this exact descriptor. */
    const seedConfident = (settled: Transaction = settledRow) =>
      seed(settled, ['CPENERGY MNGCO 260805']);

    describe('descriptor evidence — states the finding, merges in one tap', () => {
      it('renders the settled-bill notice (not the possible-duplicate copy) with Merge / Keep both', () => {
        seedConfident();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        expect(screen.getByText(/already paid/i)).toBeInTheDocument();
        expect(screen.getByText(/your bank’s copy of/i)).toBeInTheDocument();
        // The other arm's copy must NOT appear — those assertions stay unique.
        expect(screen.queryByText(/possible duplicate of/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^merge$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /keep both/i })).toBeInTheDocument();
      });

      it('promises only that the descriptor is remembered — never that it cannot recur', () => {
        seedConfident();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        expect(screen.getByText(/we’ll remember this descriptor/i)).toBeInTheDocument();
        expect(screen.queryByText(/won’t happen again|will not happen again/i)).not.toBeInTheDocument();
      });

      // The whole reason the keeper is hard-coded: both rows are `verified`, so
      // pickKeeper falls through to createdAt and would name the BANK row keeper
      // whenever the sync wrote first — and mergeTransactions would then refuse
      // via its settled-bill guard, making the button a dead tap.
      it.each([
        ['bank row created FIRST', '2026-06-04T12:00:00.000Z', '2026-06-05T12:00:00.000Z'],
        ['settled row created FIRST', '2026-06-06T12:00:00.000Z', '2026-06-05T12:00:00.000Z'],
      ])('Merge passes (settled, bank) in that order — %s', async (_label, bankCreatedAt, settledCreatedAt) => {
        const user = userEvent.setup();
        seedConfident({ ...settledRow, createdAt: settledCreatedAt });
        const tx = { ...bankRow, createdAt: bankCreatedAt };
        // Keep the list in step with the transaction the drawer renders.
        mockTransactions.splice(mockTransactions.indexOf(bankRow), 1, tx);

        render(<TransactionReviewForm transaction={tx} onDone={mockOnDone} />);
        await user.click(screen.getByRole('button', { name: /^merge$/i }));

        expect(mockMergeTransactions).toHaveBeenCalledTimes(1);
        const [keeperId, dupeId] = mockMergeTransactions.mock.calls[0]!;
        expect(keeperId).toBe('tx-manual');
        expect(dupeId).toBe('tx-bank');
        expect(mockOnDone).toHaveBeenCalled();
      });

      it('Merge learns the RAW bank descriptor onto the recurring TEMPLATE', async () => {
        const user = userEvent.setup();
        seedConfident();
        // A rule that renames this descriptor on display — the alias must still
        // be the raw stored merchant, never the friendly name.
        mockMerchantRules.push({
          id: 'r1', pattern: 'CPENERGY', name: 'Natural gas',
          createdAt: '2026-06-01T00:00:00.000Z',
        });
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        await user.click(screen.getByRole('button', { name: /^merge$/i }));

        expect(mockMergeTransactions.mock.calls[0]![2]).toEqual({
          calendarItemId: 'cal-tmpl',
          descriptor: 'CPENERGY MNGCO 260805',
        });
        // No confirmation on this tier — the evidence carries it.
        expect(mockRequestDeleteConfirmation).not.toHaveBeenCalled();
      });

      // The host drawer passes a SNAPSHOT transaction, so the memo keeps
      // re-deriving the match from an unchanged prop; without a local hide the
      // banner offers to merge a row that no longer exists.
      it('hides the banner after a successful merge', async () => {
        const user = userEvent.setup();
        seedConfident();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        await user.click(screen.getByRole('button', { name: /^merge$/i }));

        expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
      });

      it('does NOT advance the review when the merge was refused', async () => {
        const user = userEvent.setup();
        // The mutation's own settled-bill guard writes nothing and toasts its
        // reason; advancing here would claim a merge that never happened.
        mockMergeTransactions.mockResolvedValueOnce(false);
        seedConfident();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        await user.click(screen.getByRole('button', { name: /^merge$/i }));

        expect(mockOnDone).not.toHaveBeenCalled();
        expect(screen.getByText(/your bank’s copy of/i)).toBeInTheDocument();
      });
    });

    describe('amount-only evidence — asks, and confirms before deleting anything', () => {
      it('phrases the notice as a QUESTION and names BOTH rows', () => {
        seed();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        expect(screen.getByText(/is this your bank’s copy of/i)).toBeInTheDocument();
        // Never the confident copy — the app has no evidence beyond arithmetic.
        expect(screen.queryByText(/already paid —/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/we’ll remember this descriptor/i)).not.toBeInTheDocument();
        // Both rows, each labelled and carrying its own merchant, amount and
        // date. (getByText compares an element's DIRECT text nodes, so the
        // bold label and its row read as two matches, not one.)
        expect(screen.getByText('This row:')).toBeInTheDocument();
        expect(screen.getByText(/CPENERGY MNGCO 260805 — \$142\.00 on 2026-06-09/)).toBeInTheDocument();
        expect(screen.getByText('Bill payment:')).toBeInTheDocument();
        expect(
          screen.getByText(/Centerpoint Energy \(Natural Gas\) — \$142\.00 on 2026-06-05/)
        ).toBeInTheDocument();
      });

      it('Merge opens a confirmation and writes NOTHING until it is confirmed', async () => {
        const user = userEvent.setup();
        seed();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        await user.click(screen.getByRole('button', { name: /^merge$/i }));

        expect(mockMergeTransactions).not.toHaveBeenCalled();
        expect(mockRequestDeleteConfirmation).toHaveBeenCalledTimes(1);
        const request = mockRequestDeleteConfirmation.mock.calls[0]![0] as {
          title: string; message: string; confirmLabel: string; itemName: string;
          onConfirm: () => Promise<void>;
        };
        expect(request.title).toMatch(/Centerpoint Energy \(Natural Gas\)/);
        expect(request.confirmLabel).toBe('Merge');
        // The noun is the thing on screen — a recent fix stopped this dialog
        // saying "task" over a transaction.
        expect(request.itemName).toBe('transaction');
        // Spells out what goes and what stays.
        expect(request.message).toMatch(/Removes this row — CPENERGY MNGCO 260805, \$142\.00 on 2026-06-09/);
        expect(request.message).toMatch(/Keeps the bill payment — Centerpoint Energy \(Natural Gas\), \$142\.00 on 2026-06-05/);
        expect(request.message).toMatch(/Recently Deleted/);

        await request.onConfirm();
        expect(mockMergeTransactions).toHaveBeenCalledTimes(1);
      });

      it('learns NO alias on this tier — the evidence does not earn a standing rule', async () => {
        const user = userEvent.setup();
        seed();
        render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

        await user.click(screen.getByRole('button', { name: /^merge$/i }));
        const request = mockRequestDeleteConfirmation.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
        await request.onConfirm();

        const [keeperId, dupeId, learnAlias] = mockMergeTransactions.mock.calls[0]!;
        expect(keeperId).toBe('tx-manual');
        expect(dupeId).toBe('tx-bank');
        // A wrong alias auto-settles future occurrences of this bill via
        // pickBillToPay, and nothing in the app can read or clear it.
        expect(learnAlias).toBeUndefined();
      });
    });

    it('Keep both scopes the dismissal to the counterpart on screen', async () => {
      const user = userEvent.setup();
      seed();
      render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);

      await user.click(screen.getByRole('button', { name: /keep both/i }));

      expect(mockKeepBothTransactions).toHaveBeenCalledWith('tx-bank', 'tx-manual');
      expect(mockOnDone).not.toHaveBeenCalled();
      expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
    });

    it('renders nothing once the row carries the persisted dismissal for THIS counterpart', () => {
      seed();
      render(
        <TransactionReviewForm
          transaction={{ ...bankRow, duplicateDismissedFor: 'tx-manual' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
    });

    it('still asks when the dismissal named a DIFFERENT counterpart', () => {
      seed();
      render(
        <TransactionReviewForm
          transaction={{ ...bankRow, duplicateDismissedFor: 'tx-some-older-payment' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText(/your bank’s copy of/i)).toBeInTheDocument();
    });

    it('renders nothing when the predicate fails (amounts one cent apart)', () => {
      seed();
      render(
        <TransactionReviewForm
          transaction={{ ...bankRow, amount: 142.01 }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
    });

    it('renders nothing when the bill it points at is no longer paid', () => {
      mockAccounts.push({ id: 'acc-check', name: 'Checking', type: 'checking' });
      mockCalendarItems.push({ ...paidInstance, isPaid: false });
      mockTransactions.push(settledRow, bankRow);

      render(<TransactionReviewForm transaction={bankRow} onDone={mockOnDone} />);
      expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
    });

    it('defers to the stored-flag arm when both could resolve', () => {
      seed();
      render(
        <TransactionReviewForm
          transaction={{ ...bankRow, possibleDuplicateOf: 'tx-manual' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText(/possible duplicate of/i)).toBeInTheDocument();
      expect(screen.queryByText(/your bank’s copy of/i)).not.toBeInTheDocument();
      // Exactly one Merge button — the two banners never stack.
      expect(screen.getAllByRole('button', { name: /^merge$/i })).toHaveLength(1);
    });
  });

  // PRD #1065: a transaction fires its keyword habits on the transaction's own
  // DATE, so the pre-selection has to reason about that date rather than today.
  describe('keyword automations — cross-source dedup and the back-date window', () => {
    const today = getLocalDateString();
    const fourDaysAgo = format(subDays(parseISO(today), 4), 'yyyy-MM-dd');
    const amazonHabit = {
      id: 'h-amazon',
      title: 'Order from Amazon',
      category: 'spending',
      type: 'negative',
      period: 'daily' as const,
      triggers: { keywords: ['amazon'] },
      completedDates: [] as string[],
    };
    // A recent charge, the shape the nightly bankEmailSync produces. Keeps
    // baseTx's category so the approve button is enabled.
    const recentAmazonTx: Transaction = {
      ...baseTx, merchant: 'AMAZON MKTPL', date: fourDaysAgo,
    };

    // Some OTHER day inside the transaction's ISO week — the week's Monday,
    // unless the transaction itself is that Monday, in which case Tuesday.
    // Anchoring to the transaction's own week (rather than an offset from
    // today) is what makes the weekly-suppression test independent of which
    // weekday the suite happens to run on.
    const txWeekStart = startOfISOWeek(parseISO(fourDaysAgo));
    const elsewhereInTxWeek = isSameDay(txWeekStart, parseISO(fourDaysAgo))
      ? addDays(txWeekStart, 1)
      : txWeekStart;

    it('pre-selects a keyword habit that has NOT been logged for the transaction date', async () => {
      const user = userEvent.setup();
      mockHabits.push({ ...amazonHabit, completedDates: [] });

      render(<TransactionReviewForm transaction={recentAmazonTx} onDone={mockOnDone} />);

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      expect(mockUpdateTransactionCategory.mock.calls[0]![2]).toEqual(['h-amazon']);
    });

    it('does NOT pre-select a habit already logged for that date, and says why', async () => {
      const user = userEvent.setup();
      // You tapped "Order from Amazon" by hand that day; the overnight sync's
      // charge for the same purchase must not log it a second time.
      mockHabits.push({ ...amazonHabit, completedDates: [fourDaysAgo] });

      render(<TransactionReviewForm transaction={recentAmazonTx} onDone={mockOnDone} />);

      expect(screen.getByText(/already logged/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      expect(mockUpdateTransactionCategory.mock.calls[0]![2]).toEqual([]);
    });

    it('lets you OVERRIDE the suppression for a genuine second purchase', async () => {
      const user = userEvent.setup();
      mockHabits.push({ ...amazonHabit, completedDates: [fourDaysAgo] });

      render(<TransactionReviewForm transaction={recentAmazonTx} onDone={mockOnDone} />);

      // Suppressed means "not pre-selected", NOT "removed" — the habit is still
      // in the picker, so ticking it forces the second log.
      await user.click(screen.getByRole('button', { name: /none — tap to connect/i }));
      await user.click(screen.getByRole('checkbox', { name: /order from amazon/i }));
      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      expect(mockUpdateTransactionCategory.mock.calls[0]![2]).toEqual(['h-amazon']);
    });

    it('suppresses on a completion ELSEWHERE IN THE WEEK for a weekly habit', async () => {
      mockHabits.push({
        ...amazonHabit,
        period: 'weekly',
        // A different day inside the TRANSACTION's own ISO week. Derived from
        // that week's Monday rather than offset from `today`: the suppression
        // compares the completion against the transaction's week (weekStartsOn:
        // 1, see habitLogic), and a fixed offset from today lands in the next
        // week whenever the transaction falls on a Sat/Sun — which made this
        // test fail every Wednesday and Thursday.
        completedDates: [format(elsewhereInTxWeek, 'yyyy-MM-dd')],
      });

      render(<TransactionReviewForm transaction={recentAmazonTx} onDone={mockOnDone} />);
      expect(screen.getByText(/already logged/i)).toBeInTheDocument();
    });

    it('warns that an out-of-window transaction records links only', () => {
      mockHabits.push({ ...amazonHabit, completedDates: [] });
      const ancient: Transaction = {
        ...recentAmazonTx,
        date: format(subDays(parseISO(today), 45), 'yyyy-MM-dd'),
      };

      render(<TransactionReviewForm transaction={ancient} onDone={mockOnDone} />);
      expect(screen.getByText(/too far back to log habits/i)).toBeInTheDocument();
    });
  });

  describe('habit pre-selection from merchant history', () => {
    const coffeeHabit = { id: 'h-coffee', title: 'Coffee out', category: 'coffee', type: 'negative' };

    // A verified prior transaction at (a bank-feed variant of) the same
    // merchant, tagged with the coffee habit.
    const priorTagged = (merchant: string): Transaction => ({
      ...baseTx,
      id: `prior-${merchant}`,
      merchant,
      status: 'verified',
      relatedHabitIds: ['h-coffee'],
    });

    it('pre-selects the consistently-tagged habit for an untagged pending transaction and approves with it', async () => {
      const user = userEvent.setup();
      mockHabits.push(coffeeHabit);
      mockTransactions.push(priorTagged('STARBUCKS #1234'));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Starbucks' }}
          onDone={mockOnDone}
        />
      );

      // The pre-selection hint is visible, and approving without touching the
      // chips carries the auto-selected habit through.
      expect(screen.getByText(/pre-selected from your history/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[2]).toEqual(['h-coffee']);
    });

    it('deselecting a pre-selected chip removes it (and the hint) before approve', async () => {
      const user = userEvent.setup();
      mockHabits.push(coffeeHabit);
      mockTransactions.push(priorTagged('Starbucks'));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Starbucks' }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /coffee out/i }));
      expect(screen.queryByText(/pre-selected from your history/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[2]).toEqual([]);
    });

    it('never overrides explicit relatedHabitIds already on the transaction', async () => {
      const user = userEvent.setup();
      const otherHabit = { id: 'h-other', title: 'Read a book', category: 'education', type: 'positive' };
      mockHabits.push(coffeeHabit, otherHabit);
      mockTransactions.push(priorTagged('Starbucks'));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Starbucks', relatedHabitIds: ['h-other'] }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/pre-selected from your history/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[2]).toEqual(['h-other']);
    });

    it('follows a merchant edit: typing a known merchant pre-selects its habit', async () => {
      const user = userEvent.setup();
      mockHabits.push(coffeeHabit);
      mockTransactions.push(priorTagged('Starbucks'));

      // 'Mystery' has no history → nothing pre-selected at mount.
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Mystery' }}
          onDone={mockOnDone}
        />
      );
      expect(screen.queryByText(/pre-selected from your history/i)).not.toBeInTheDocument();

      // Correcting the merchant to the known one pre-selects its usual habit.
      const merchantInput = screen.getByLabelText(/merchant/i);
      await user.clear(merchantInput);
      await user.type(merchantInput, 'Starbucks');
      expect(screen.getByText(/pre-selected from your history/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[2]).toEqual(['h-coffee']);
    });

    it('stops following merchant edits once the user touches the habit chips', async () => {
      const user = userEvent.setup();
      mockHabits.push(coffeeHabit);
      mockTransactions.push(priorTagged('Starbucks'));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Starbucks' }}
          onDone={mockOnDone}
        />
      );

      // Deselect the pre-selected chip (touch), then re-trigger the auto-select
      // edge by editing the merchant away and back — it must NOT re-select.
      await user.click(screen.getByRole('button', { name: /coffee out/i }));
      const merchantInput = screen.getByLabelText(/merchant/i);
      await user.clear(merchantInput);
      await user.type(merchantInput, 'Starbucks');

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[2]).toEqual([]);
    });

    it('does not pre-select when history is inconsistent for the merchant', () => {
      mockHabits.push(coffeeHabit);
      mockTransactions.push(
        priorTagged('Starbucks'),
        { ...baseTx, id: 'prior-untagged-1', merchant: 'Starbucks', status: 'verified' },
        { ...baseTx, id: 'prior-untagged-2', merchant: 'Starbucks', status: 'verified' },
      );

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: 'Starbucks' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/pre-selected from your history/i)).not.toBeInTheDocument();
    });
  });

  describe('actionsContainer (host drawer sticky footer)', () => {
    it('keeps the actions in the form body when no host opts in', () => {
      const { container } = render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      expect(
        within(container).getByRole('button', { name: /^approve$/i }),
      ).toBeInTheDocument();
      // Delete carries a VISIBLE word (not just an aria-label): its accessible
      // name must come from its own text content, so an accidental return to an
      // icon-only button fails here rather than silently shipping.
      const del = within(container).getByRole('button', { name: /delete/i });
      expect(del).toHaveTextContent('Delete');
      expect(del).not.toHaveAttribute('aria-label');
    });

    it('names a transaction, not a "task", in the delete confirmation', async () => {
      // `showDeleteConfirmation`'s itemName once defaulted to "task", so this
      // dialog used to read "Delete this task?" over a transaction. It mattered
      // little while Delete was an unlabelled glyph; it matters now that the
      // button carries its own word and invites the press.
      const user = userEvent.setup();
      const { container } = render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      await user.click(within(container).getByRole('button', { name: /delete/i }));

      expect(mockRequestDeleteConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ itemName: 'transaction' }),
      );
    });

    it('renders the actions into the host node instead, with approve still fully wired', async () => {
      const user = userEvent.setup();
      const host = document.createElement('div');
      document.body.appendChild(host);

      const { container } = render(
        <TransactionReviewForm transaction={baseTx} onDone={mockOnDone} actionsContainer={host} />,
      );

      // Moved OUT of the form body...
      expect(within(container).queryByRole('button', { name: /^approve$/i })).toBeNull();
      expect(within(container).queryByRole('button', { name: /delete/i })).toBeNull();

      // ...and into the host's footer, still driving the same approve call.
      await user.click(within(host).getByRole('button', { name: /^approve$/i }));

      expect(mockUpdateTransactionCategory).toHaveBeenCalledTimes(1);
      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[0]).toBe('tx1');
      expect(call[1]).toBe('Groceries');
      expect(mockOnDone).toHaveBeenCalled();

      host.remove();
    });

    it('keeps the canApprove gate on the portalled CTA (a $0 stub stays disabled)', async () => {
      const user = userEvent.setup();
      const host = document.createElement('div');
      document.body.appendChild(host);

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, amount: 0, needsAmount: true }}
          onDone={mockOnDone}
          actionsContainer={host}
        />,
      );

      expect(within(host).getByRole('button', { name: /^add amount$/i })).toBeDisabled();

      await user.type(screen.getByLabelText(/amount/i), '12.50');
      expect(within(host).getByRole('button', { name: /^approve$/i })).toBeEnabled();

      host.remove();
    });
  });

  describe('purchase note ("What was it?")', () => {
    it('passes a typed note through as an override on approve', async () => {
      const user = userEvent.setup();
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      await user.type(screen.getByLabelText(/what was it/i), 'Minecraft');
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toMatchObject({ notes: 'Minecraft' });
    });

    it('prefills stored notes and sends no override when unchanged', async () => {
      const user = userEvent.setup();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, notes: 'dog food' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByLabelText(/what was it/i)).toHaveValue('dog food');
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toBeUndefined();
    });

    it('emptying the field on a transaction that had notes sends a clearing override', async () => {
      const user = userEvent.setup();
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, notes: 'dog food' }}
          onDone={mockOnDone}
        />
      );

      await user.clear(screen.getByLabelText(/what was it/i));
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toMatchObject({ notes: '' });
    });
  });

  describe('recurring (subscription) toggle', () => {
    it('renders the toggle defaulted OFF and approves without any recurring side effects when untouched', async () => {
      const user = userEvent.setup();
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      const toggle = screen.getByRole('checkbox', { name: /recurring transaction/i });
      expect(toggle).not.toBeChecked();
      expect(screen.getByText(/creates a monthly entry under subscriptions/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toBeUndefined();
      expect(mockAddCalendarItem).not.toHaveBeenCalled();
    });

    it('approving with the toggle ON sets isRecurring and creates a monthly subscription calendar item from the edited values', async () => {
      const user = userEvent.setup();
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      // Clean up the noisy bank-alert merchant first — the calendar title must
      // use the edited value.
      const merchantInput = screen.getByLabelText(/merchant/i);
      await user.clear(merchantInput);
      await user.type(merchantInput, 'Peacock Premium');

      await user.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect(call[4]).toMatchObject({ isRecurring: true, merchant: 'Peacock Premium' });

      expect(mockAddCalendarItem).toHaveBeenCalledTimes(1);
      expect(mockAddCalendarItem.mock.calls[0]![0]).toMatchObject({
        title: 'Peacock Premium',
        amount: 25,
        date: '2026-06-10',
        type: 'expense',
        isPaid: false,
        isRecurring: true,
        frequency: 'monthly',
        isSubscription: true,
      });
      expect(mockOnDone).toHaveBeenCalled();
    });

    it('reveals a nested subscription switch (default ON) when Recurring is ON, and OFF creates a plain calendar bill', async () => {
      const user = userEvent.setup();
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      // Hidden until Recurring is ON.
      expect(screen.queryByRole('checkbox', { name: /this is a subscription/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));

      const subToggle = screen.getByRole('checkbox', { name: /this is a subscription/i });
      expect(subToggle).toBeChecked();

      // Turning it OFF flips the helper copy and the created item's flag.
      await user.click(subToggle);
      expect(screen.getByText(/creates a monthly bill on your calendar/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      expect(mockAddCalendarItem).toHaveBeenCalledTimes(1);
      expect(mockAddCalendarItem.mock.calls[0]![0]).toMatchObject({
        isRecurring: true,
        frequency: 'monthly',
        isSubscription: false,
      });
    });

    it('a calendar-creation failure after a successful approve toasts a partial error but still advances', async () => {
      const user = userEvent.setup();
      mockAddCalendarItem.mockRejectedValueOnce(new Error('offline'));
      render(<TransactionReviewForm transaction={baseTx} onDone={mockOnDone} />);

      await user.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));
      await user.click(screen.getByRole('button', { name: /^approve$/i }));

      expect(mockUpdateTransactionCategory).toHaveBeenCalledTimes(1);
      expect(mockToast.error).toHaveBeenCalledWith('Approved, but the recurring subscription entry failed.');
      expect(mockOnDone).toHaveBeenCalled();
    });

    it('hides the toggle in credit-card Payment mode and ignores a prior ON state on approve', async () => {
      const user = userEvent.setup();
      mockAccounts.push(
        { id: 'chk', name: 'Checking', type: 'checking' },
        { id: 'cc', name: 'Paul Visa', type: 'credit' },
      );
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, accountId: 'cc', category: '' }}
          onDone={mockOnDone}
        />
      );

      // Charge mode: toggle visible. Flip it ON, then switch to Payment mode.
      await user.click(screen.getByRole('checkbox', { name: /recurring transaction/i }));
      await user.click(screen.getByRole('radio', { name: 'Payment' }));
      expect(screen.queryByRole('checkbox', { name: /recurring transaction/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      const call = mockUpdateTransactionCategory.mock.calls[0]!;
      expect((call[4] as { isRecurring?: boolean } | undefined)?.isRecurring).toBeUndefined();
      expect(mockAddCalendarItem).not.toHaveBeenCalled();
    });
  });

  // Merchant rules rename at DISPLAY time only. The edit field must keep the
  // stored descriptor, and the bank's own words must stay visible underneath it
  // whenever a rule is relabelling the row.
  describe('merchant rules — raw bank descriptor disclosure', () => {
    const rawDescriptor = 'APPLE.COM/BILL 866-712-7753 CA';
    const appleTx: Transaction = { ...baseTx, merchant: rawDescriptor };
    const appleRule: MerchantRule = {
      id: 'rule-apple',
      pattern: 'APPLE.COM/BILL',
      name: 'Apple',
      createdAt: '2026-07-01T00:00:00.000Z',
    };

    it('discloses the raw descriptor when a rule renames the row, and keeps the field raw', () => {
      mockMerchantRules.push(appleRule);
      render(<TransactionReviewForm transaction={appleTx} onDone={mockOnDone} />);

      expect(screen.getByText(/your bank calls this/i)).toBeInTheDocument();
      expect(screen.getByText(rawDescriptor)).toBeInTheDocument();
      // The user is editing the stored row, not the label — the input stays raw.
      expect(screen.getByLabelText(/merchant/i)).toHaveValue(rawDescriptor);
    });

    it('shows no descriptor line when no rule matches', () => {
      mockMerchantRules.push({ ...appleRule, pattern: 'NETFLIX' });
      render(<TransactionReviewForm transaction={appleTx} onDone={mockOnDone} />);

      expect(screen.queryByText(/your bank calls this/i)).not.toBeInTheDocument();
    });

    it('shows no descriptor line for a rule that classifies without renaming', () => {
      // A category-only rule leaves the merchant text alone, so there is
      // nothing for the caption to explain.
      mockMerchantRules.push({ ...appleRule, name: undefined, category: 'Groceries' });
      render(<TransactionReviewForm transaction={appleTx} onDone={mockOnDone} />);

      expect(screen.queryByText(/your bank calls this/i)).not.toBeInTheDocument();
    });

    it('renames the merchant shown in the possible-duplicate notice', () => {
      mockMerchantRules.push(appleRule);
      mockTransactions.push({ ...appleTx, id: 'tx2', amount: 24.99 });
      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, possibleDuplicateOf: 'tx2' }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.queryByText(rawDescriptor)).not.toBeInTheDocument();
    });
  });

  describe('merchant rules — amount-qualified keyword suggestion', () => {
    const rawDescriptor = 'APPLE.COM/BILL 866-712-7753 CA';
    const icloudHabit = {
      id: 'h-icloud',
      title: 'Log a subscription charge',
      category: 'spending',
      type: 'negative',
      period: 'daily' as const,
      // Keyed on the FRIENDLY name, which is the point: the bank never says
      // "iCloud" anywhere in the descriptor.
      triggers: { keywords: ['icloud'] },
      completedDates: [] as string[],
    };

    it('pre-selects a habit keyed on a name only an amount-qualified rule produces', async () => {
      const user = userEvent.setup();
      mockHabits.push({ ...icloudHabit });
      mockMerchantRules.push({
        id: 'rule-icloud',
        pattern: 'APPLE.COM',
        amount: 2.99,
        name: 'iCloud storage',
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: rawDescriptor, amount: 2.99 }}
          onDone={mockOnDone}
        />
      );

      await user.click(screen.getByRole('button', { name: /^approve$/i }));
      expect(mockUpdateTransactionCategory.mock.calls[0]![2]).toEqual(['h-icloud']);
    });

    // A $0 row cannot be approved, so these assert on the keyword-match helper
    // text, which renders precisely when the amount-qualified rule resolved.
    // The date must sit INSIDE the back-date window, or the "too far back to log
    // habits" branch pre-empts that message.
    const recentDate = format(subDays(parseISO(getLocalDateString()), 2), 'yyyy-MM-dd');
    const preauthRule = (amount: number): MerchantRule => ({
      id: 'rule-preauth',
      pattern: 'APPLE.COM',
      amount,
      name: 'Apple pre-auth',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    it('honours a $0 amount qualifier rather than treating zero as "no amount"', () => {
      // Regression guard: `parseFloat(amount) || undefined` collapses a real 0
      // to undefined, which would make an amount-qualified rule for a $0 Apple
      // Pay pre-auth stub permanently unmatchable.
      mockHabits.push({ ...icloudHabit, id: 'h-preauth', triggers: { keywords: ['pre-auth'] } });
      mockMerchantRules.push(preauthRule(0));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: rawDescriptor, amount: 0, date: recentDate }}
          onDone={mockOnDone}
        />
      );

      expect(screen.getByText(/habit keyword matches/i)).toBeInTheDocument();
    });

    it('does not match that rule when the row is not $0', () => {
      // The negative control: without it, the test above would pass even if the
      // amount qualifier were being ignored entirely.
      mockHabits.push({ ...icloudHabit, id: 'h-preauth', triggers: { keywords: ['pre-auth'] } });
      mockMerchantRules.push(preauthRule(0));

      render(
        <TransactionReviewForm
          transaction={{ ...baseTx, merchant: rawDescriptor, amount: 12.5, date: recentDate }}
          onDone={mockOnDone}
        />
      );

      expect(screen.queryByText(/habit keyword matches/i)).not.toBeInTheDocument();
    });
  });
});
