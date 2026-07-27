import { render as rtlRender, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { MerchantRule } from '@/types/schema';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost';
import { ActionQueueItemCard } from './ActionQueueItem';
import type {
  ActionQueueItem,
  CalendarQueueItem,
  ToDoActionQueueItem,
  TransactionQueueItem,
} from '@/hooks/useActionQueue';

// Household-authored merchant rules, mutable per-test. Empty ⇒ every merchant
// renders exactly as it did before display-time renaming existed.
const { mockMerchantRules } = vi.hoisted(() => ({ mockMerchantRules: [] as MerchantRule[] }));

// The card reads the household currency for its amount column and the merchant
// rules for its transaction label; stub the slice so the test doesn't need the
// full Firebase provider tree.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ householdSettings: { merchantRules: mockMerchantRules } }),
}));

// The transaction review drawer is context-driven and has its own test suite
// (TransactionReviewForm.test.tsx covers its confirmation-gated delete); stub
// it so this file exercises only the card's own delete paths.
vi.mock('@/components/transactions/TransactionReviewForm', () => ({
  default: () => <div data-testid="transaction-review-form" />,
}));

const todoItem: ToDoActionQueueItem = {
  queueType: 'todo',
  id: 'todo-1',
  text: 'Buy milk',
  date: '2026-07-15',
  assignedTo: 'user-1',
  isCompleted: false,
  createdBy: 'user-1',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const calendarItem: CalendarQueueItem = {
  queueType: 'calendar',
  id: 'cal-1',
  title: 'Electric bill',
  amount: 120,
  date: '2026-07-14',
  type: 'expense',
  isPaid: false,
};

const transactionItem: TransactionQueueItem = {
  queueType: 'transaction',
  id: 'tx-1',
  amount: 25,
  merchant: 'Coffee',
  category: 'Groceries',
  date: '2026-07-13',
  status: 'pending_review',
  payPeriodId: '2026-07-01',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
};

const makeHandlers = () => ({
  updateToDo: vi.fn(() => Promise.resolve()),
  deleteToDo: vi.fn(() => Promise.resolve()),
  completeToDo: vi.fn(() => Promise.resolve()),
  deferCalendarItem: vi.fn(() => Promise.resolve()),
  deleteCalendarItem: vi.fn(() => Promise.resolve()),
  deleteTransaction: vi.fn(() => Promise.resolve()),
});

type Handlers = ReturnType<typeof makeHandlers>;

const renderCard = (
  item: ActionQueueItem,
  handlers: Handlers,
  { isExpanded = false, approveDetail }: { isExpanded?: boolean; approveDetail?: string } = {}
) => {
  const ui: ReactElement = (
    // MemoryRouter: the card's Review button calls useNavigate() for to-do items.
    <MemoryRouter>
    <ThemeProvider>
      {/* Real app-level confirmation host, so these tests assert the actual
          end-to-end gate (request → centered ConfirmDialog → callback). */}
      <ConfirmDialogHost />
      <ActionQueueItemCard
        item={item}
        isExpanded={isExpanded}
        setExpandedId={() => {}}
        openPaySheet={() => {}}
        selectionMode={false}
        isSelected={false}
        onToggleSelect={() => {}}
        onEnterSelectionMode={() => {}}
        onSwipeApprove={() => {}}
        onSwipeDefer={() => {}}
        approveDetail={approveDetail}
        buckets={[]}
        transactions={[]}
        members={[]}
        {...handlers}
      />
    </ThemeProvider>
    </MemoryRouter>
  );
  return rtlRender(ui);
};

/** The swipe rail's Delete zone button (rendered aria-hidden while the row is
 *  closed; a partial swipe promotes it to a real tap target). fireEvent
 *  reaches it either way, which is exactly what we want: even if a pointer
 *  event lands on it, the delete must still be confirmation-gated. */
const getRailDeleteButton = (itemLabel: string): HTMLElement => {
  const button = screen
    .getAllByRole('button', { hidden: true })
    .find(b => b.getAttribute('aria-label') === `Delete ${itemLabel}`);
  if (!button) throw new Error(`Rail delete button for "${itemLabel}" not found`);
  return button;
};

/** The centered confirmation dialog, addressed by its accessible name so it is
 *  never confused with the (also role="dialog") review drawer. */
const findConfirmDialog = (itemName: string) =>
  screen.findByRole('dialog', { name: `Delete this ${itemName}?` });

describe('ActionQueueItemCard approve pre-commit disclosure', () => {
  it('shows the amount + target account in the approve rail and its accessible name', () => {
    const handlers = makeHandlers();
    renderCard(transactionItem, handlers, { approveDetail: '$25.00 → Joint Checking' });

    // Visual rail disclosure (drag-time affordance, aria-hidden)...
    expect(screen.getByText('$25.00 → Joint Checking')).toBeInTheDocument();
    // ...and the same information on the approve button's accessible name, so
    // the tap/keyboard path (stuck-open rail button) carries it too.
    const approveButton = screen
      .getAllByRole('button', { hidden: true })
      .find(b => b.getAttribute('aria-label')?.startsWith('Approve Coffee'));
    expect(approveButton).toBeDefined();
    expect(approveButton).toHaveAttribute(
      'aria-label',
      'Approve Coffee · $25.00 → Joint Checking'
    );
  });

  it('falls back to the plain approve affordance when no disclosure is provided', () => {
    const handlers = makeHandlers();
    renderCard(transactionItem, handlers);

    const approveButton = screen
      .getAllByRole('button', { hidden: true })
      .find(b => b.getAttribute('aria-label') === 'Approve Coffee');
    expect(approveButton).toBeDefined();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});

describe('ActionQueueItemCard merchant rules', () => {
  const rawDescriptor = 'APPLE.COM/BILL 866-712-7753 CA';
  const appleTransaction: TransactionQueueItem = { ...transactionItem, merchant: rawDescriptor };

  afterEach(() => {
    mockMerchantRules.length = 0;
  });

  it('renders the rule’s friendly name instead of the raw bank descriptor', () => {
    mockMerchantRules.push({
      id: 'rule-apple',
      pattern: 'APPLE.COM/BILL',
      name: 'Apple',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    renderCard(appleTransaction, makeHandlers());

    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText(rawDescriptor)).not.toBeInTheDocument();
    // The rename carries into the row's action labels too, so what a screen
    // reader announces matches what is on screen.
    expect(screen.getByRole('button', { name: 'Review Apple' })).toBeInTheDocument();
  });

  it('falls back to the raw descriptor when no rule matches', () => {
    mockMerchantRules.push({
      id: 'rule-netflix',
      pattern: 'NETFLIX',
      name: 'Netflix',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    renderCard(appleTransaction, makeHandlers());

    expect(screen.getByText(rawDescriptor)).toBeInTheDocument();
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });
});

// Owner paper cut (PC#1/PC#4): the overdue mark must never be an alarming red
// "Overdue" text badge — it's a small circled-! (AlertCircle), warm/amber, with
// the word "Overdue" only for screen readers (sr-only) plus a title tooltip.
describe('ActionQueueItemCard overdue mark', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a titled circled-! mark (no visible "Overdue" text) for a past-due to-do', () => {
    vi.useFakeTimers({ now: new Date('2026-07-20T12:00:00') });
    const handlers = makeHandlers();
    renderCard({ ...todoItem, date: '2026-07-15' }, handlers);

    const mark = screen.getByTitle('Overdue');
    expect(mark).toBeInTheDocument();
    // The word is present for assistive tech only, not as visible red text.
    expect(within(mark).getByText('Overdue')).toHaveClass('sr-only');
  });

  it('does not show the mark for a to-do due today or later', () => {
    vi.useFakeTimers({ now: new Date('2026-07-10T12:00:00') });
    const handlers = makeHandlers();
    renderCard({ ...todoItem, date: '2026-07-15' }, handlers);

    expect(screen.queryByTitle('Overdue')).not.toBeInTheDocument();
  });
});

describe('ActionQueueItemCard delete confirmation', () => {
  describe('swipe-rail Delete', () => {
    it('opens the confirm dialog without deleting the to-do', async () => {
      const handlers = makeHandlers();
      renderCard(todoItem, handlers);

      fireEvent.click(getRailDeleteButton('Buy milk'));

      expect(await findConfirmDialog('task')).toBeInTheDocument();
      expect(handlers.deleteToDo).not.toHaveBeenCalled();
      expect(handlers.deleteCalendarItem).not.toHaveBeenCalled();
      expect(handlers.deleteTransaction).not.toHaveBeenCalled();
    });

    it('keeps the to-do when the dialog is cancelled', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(todoItem, handlers);

      fireEvent.click(getRailDeleteButton('Buy milk'));
      const dialog = await findConfirmDialog('task');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(handlers.deleteToDo).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Delete this task?' })).not.toBeInTheDocument()
      );
    });

    it('deletes the to-do only after the dialog is confirmed', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(todoItem, handlers);

      fireEvent.click(getRailDeleteButton('Buy milk'));
      const dialog = await findConfirmDialog('task');

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(handlers.deleteToDo).toHaveBeenCalledWith('todo-1'));
      expect(handlers.deleteCalendarItem).not.toHaveBeenCalled();
      expect(handlers.deleteTransaction).not.toHaveBeenCalled();
    });

    it('routes a confirmed calendar-item delete to deleteCalendarItem', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(calendarItem, handlers);

      fireEvent.click(getRailDeleteButton('Electric bill'));
      const dialog = await findConfirmDialog('calendar item');
      expect(handlers.deleteCalendarItem).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(handlers.deleteCalendarItem).toHaveBeenCalledWith('cal-1'));
      expect(handlers.deleteToDo).not.toHaveBeenCalled();
      expect(handlers.deleteTransaction).not.toHaveBeenCalled();
    });

    it('routes a confirmed transaction delete to deleteTransaction', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(transactionItem, handlers);

      fireEvent.click(getRailDeleteButton('Coffee'));
      const dialog = await findConfirmDialog('transaction');
      expect(handlers.deleteTransaction).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(handlers.deleteTransaction).toHaveBeenCalledWith('tx-1'));
      expect(handlers.deleteToDo).not.toHaveBeenCalled();
      expect(handlers.deleteCalendarItem).not.toHaveBeenCalled();
    });
  });

  describe('review-drawer Delete', () => {
    it('gates the to-do drawer Delete behind the confirm dialog', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(todoItem, handlers, { isExpanded: true });

      // The drawer's visible action row: Complete / Defer / Delete.
      const drawer = screen.getByRole('dialog', { name: 'Actions' });
      await user.click(within(drawer).getByRole('button', { name: 'Delete' }));

      const dialog = await findConfirmDialog('task');
      expect(handlers.deleteToDo).not.toHaveBeenCalled();

      // Cancel leaves the item intact...
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(handlers.deleteToDo).not.toHaveBeenCalled();

      // ...and confirming actually deletes.
      await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
      const dialog2 = await findConfirmDialog('task');
      await user.click(within(dialog2).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(handlers.deleteToDo).toHaveBeenCalledWith('todo-1'));
    });

    it('gates the calendar drawer Delete behind the confirm dialog', async () => {
      const user = userEvent.setup();
      const handlers = makeHandlers();
      renderCard(calendarItem, handlers, { isExpanded: true });

      const drawer = screen.getByRole('dialog', { name: 'Actions' });
      await user.click(within(drawer).getByRole('button', { name: 'Delete' }));

      const dialog = await findConfirmDialog('calendar item');
      expect(handlers.deleteCalendarItem).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(handlers.deleteCalendarItem).toHaveBeenCalledWith('cal-1'));
    });
  });
});
