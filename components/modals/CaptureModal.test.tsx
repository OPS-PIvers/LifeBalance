import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import toast from 'react-hot-toast';
import CaptureModal from './CaptureModal';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Mock dependencies
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

// Controllable mocks for the dynamically-imported Gemini scan functions, so
// the cancellation-guard tests below can hold a scan "in flight" and resolve
// it on demand after the user has backed out.
const { parseReceiptLineItemsMock, parseBankStatementMock } = vi.hoisted(() => ({
  parseReceiptLineItemsMock: vi.fn(),
  parseBankStatementMock: vi.fn(),
}));
vi.mock('@/services/geminiService', () => ({
  parseReceiptLineItems: parseReceiptLineItemsMock,
  parseBankStatement: parseBankStatementMock,
}));

// Mock useHousehold
const mockUseHousehold = {
  addTransaction: vi.fn(),
  buckets: [] as unknown[],
  habits: [] as unknown[],
  transactions: [] as unknown[],
  addToDo: vi.fn(),
  members: [] as unknown[],
  currentUser: { uid: 'test-user' },
  addShoppingItem: vi.fn(),
  householdId: 'test-household',
  stores: [] as unknown[],
  accounts: [] as unknown[],
  shoppingList: [] as unknown[],
  groceryCatalog: [] as unknown[],
  loadFullGroceryCatalog: vi.fn().mockResolvedValue(undefined),
};

// Each slice hook returns the shared superset object; destructuring in the
// component picks the fields it needs from whichever slice it calls.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => mockUseHousehold,
  useGamification: () => mockUseHousehold,
  useHouseholdCore: () => mockUseHousehold,
  useTodos: () => mockUseHousehold,
  useShopping: () => mockUseHousehold,
}));

// Module visibility (Plan 090): mocked so each test can choose which capture
// modules are enabled. Defaults to all-on (full 3-tab layout = pre-090 behavior).
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` capture modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // To-Do/Shop capture require the Plan master AND the sub-tab to be on.
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
    isHomeVisible: true,
  });
};

// Mock child components to simplify testing. The footer slot matters now —
// every tab's Save button lives there (associated back to its form by id).
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen, header, footer }: { children: React.ReactNode; isOpen: boolean; header: React.ReactNode; footer?: React.ReactNode }) => isOpen ? (
    <div data-testid="drawer">
      <div data-testid="drawer-header">{header}</div>
      {children}
      {footer && <div data-testid="drawer-footer">{footer}</div>}
    </div>
  ) : null,
}));

// Expose onSelectImage so tests can drive the scan path without rendering the
// real file input (CaptureImageButton's own tests cover its internals).
vi.mock('./CaptureImageButton', () => ({
  CaptureImageButton: ({ onSelectImage }: { onSelectImage: (file: File) => void }) => (
    <button
      data-testid="add-from-image"
      onClick={() => onSelectImage(new File(['x'], 'receipt.png', { type: 'image/png' }))}
    >
      Scan a receipt or screenshot
    </button>
  ),
}));

vi.mock('./CaptureTransactionManual', () => ({
  CaptureTransactionManual: ({ formId }: { formId: string }) => (
    <form id={formId} data-testid="capture-transaction-manual">Manual Entry</form>
  ),
}));

vi.mock('./CaptureTransactionReview', () => ({
  CaptureTransactionReview: () => <div data-testid="capture-transaction-review">Review</div>,
}));

vi.mock('./CaptureTodoTab', () => ({
  CaptureTodoTab: () => <div data-testid="capture-todo-tab">Todo Tab</div>,
}));

vi.mock('./CaptureShoppingTab', () => ({
  CaptureShoppingTab: () => <div data-testid="capture-shopping-tab">Shopping Tab</div>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Camera: () => <span data-testid="icon-camera" />,
  Wallet: () => <span data-testid="icon-wallet" />,
  CheckSquare: () => <span data-testid="icon-check-square" />,
  ShoppingBag: () => <span data-testid="icon-shopping-bag" />,
  X: () => <span data-testid="icon-x" />,
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Store: () => <span data-testid="icon-store" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

describe('CaptureModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all capture modules enabled (pre-090 behavior). Plan is on so the
    // To-Do/Shop sub-tab destinations are reachable.
    setEnabledModules(['money', 'lists', 'todos', 'shopping']);
  });

  it('renders correctly when open', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    // Entry view with multiple capture types keeps the generic title — the
    // type selector below carries the specifics (round-3 critique).
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<CaptureModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('renders tab switcher labelled with the destination pages', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Money')).toBeInTheDocument();
    expect(screen.getByText('To-Dos')).toBeInTheDocument();
    expect(screen.getByText('Shopping')).toBeInTheDocument();
  });

  it('opens the Money tab straight onto the manual form, with a scan button above it', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // No two-card chooser any more: the form IS the landing state.
    expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
    expect(screen.getByTestId('add-from-image')).toBeInTheDocument();
  });

  it('switches to To-Do tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Initial state: Money tab (manual form)
    expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-todo-tab')).not.toBeInTheDocument();

    // Click To-Dos tab
    fireEvent.click(screen.getByText('To-Dos'));

    // Title stays the generic 'Capture' while the multi-type selector is
    // visible; the selected segment communicates the type.
    expect(screen.getByText('Capture')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-transaction-manual')).not.toBeInTheDocument();
  });

  it('switches to Shopping tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByText('Shopping'));

    // Generic title while the multi-type selector is visible (see above).
    expect(screen.getByText('Capture')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
  });

  it('switches back to the Money tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Go to Shopping first
    fireEvent.click(screen.getByText('Shopping'));
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();

    // Go back to Money
    fireEvent.click(screen.getByText('Money'));
    expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  // --- Footer save button (owner rule: never a scroll away) ---

  describe('footer save button', () => {
    it('renders a Save button in the Drawer footer targeting the active tab form', () => {
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      const footer = screen.getByTestId('drawer-footer');
      const saveButton = screen.getByRole('button', { name: 'Save transaction' });
      expect(footer).toContainElement(saveButton);
      expect(saveButton).toHaveAttribute('form', 'capture-transaction-form');
      expect(saveButton).toHaveAttribute('type', 'submit');
    });

    it('swaps the footer action with the tab', () => {
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('To-Dos'));
      expect(screen.getByRole('button', { name: 'Create task' })).toHaveAttribute('form', 'capture-todo-form');

      fireEvent.click(screen.getByText('Shopping'));
      expect(screen.getByRole('button', { name: 'Add to list' })).toHaveAttribute('form', 'capture-shopping-form');
    });

    // The review view is a LIST, not a form, so its bulk-add is the one footer
    // action wired by onClick rather than `form=`. It used to sit inline below
    // a list of every scanned row, i.e. always a scroll away on a phone.
    it('puts the review bulk-add in the footer, disabled when nothing is selected', async () => {
      parseReceiptLineItemsMock.mockResolvedValue({ merchant: 'Target', date: '2026-07-01', items: [] });
      parseBankStatementMock.mockResolvedValue([
        { merchant: 'Target', amount: 12, category: 'Shopping', date: '2026-07-01' },
        { merchant: 'Cub', amount: 8, category: 'Groceries', date: '2026-07-01' },
      ]);
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByTestId('capture-transaction-review');

      // Both parsed rows arrive selected.
      const addButton = screen.getByRole('button', { name: 'Add 2 to Action Queue' });
      expect(screen.getByTestId('drawer-footer')).toContainElement(addButton);
      expect(addButton).not.toBeDisabled();
      // Not form-associated — the review body has no <form> to submit.
      expect(addButton).not.toHaveAttribute('form');
    });
  });

  // --- Receipt vs. bank-transaction-list routing ---
  //
  // A bank/card activity screenshot is structurally identical to an itemized
  // receipt — rows of text + amount — so the itemizer happily "finds items" in
  // one. Routing on `items.length` therefore sent every statement down the
  // receipt path, where groupLineItemsByCategory summed a dozen separate
  // purchases into a couple of lump transactions sharing ONE merchant and ONE
  // date. The parser's explicit `documentType` verdict is the discriminator.
  describe('image classification routing', () => {
    beforeEach(() => {
      parseReceiptLineItemsMock.mockReset();
      parseBankStatementMock.mockReset();
    });

    it('re-parses as a statement when the verdict is transaction_list, even though items came back', async () => {
      parseReceiptLineItemsMock.mockResolvedValue({
        documentType: 'transaction_list',
        merchant: 'Wells Fargo',
        // A misbehaving model can return BOTH the verdict and items; the verdict
        // wins, and these rows must never be grouped into a receipt.
        items: [
          { description: 'PURCHASE JIMMY JOHNS', amount: 35.95, category: 'Dining' },
          { description: 'PURCHASE PRIME VIDEO', amount: 5.42, category: 'Dining' },
        ],
      });
      parseBankStatementMock.mockResolvedValue([
        { merchant: 'Jimmy Johns', amount: 35.95, category: 'Dining', date: '2026-07-23' },
        { merchant: 'Prime Video', amount: 5.42, category: 'Entertainment', date: '2026-07-23' },
        { merchant: 'Pure Hockey', amount: 33.32, category: 'Shopping', date: '2026-07-23' },
      ]);
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByTestId('capture-transaction-review');

      expect(parseBankStatementMock).toHaveBeenCalledTimes(1);
      // One row per purchase — NOT a category-grouped receipt split.
      expect(toast.success).toHaveBeenCalledWith('Found 3 transaction(s)');
      expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining('Split into'));
    });

    it('still splits a genuine multi-category receipt', async () => {
      parseReceiptLineItemsMock.mockResolvedValue({
        documentType: 'receipt',
        merchant: 'Target',
        date: '2026-07-23',
        items: [
          { description: 'Milk', amount: 4.29, category: 'Groceries' },
          { description: 'Socks', amount: 12, category: 'Shopping' },
        ],
      });
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByTestId('capture-transaction-review');

      expect(parseBankStatementMock).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Split into 2 categories — review below');
    });

    it('treats a response with no documentType as a receipt (back-compat)', async () => {
      parseReceiptLineItemsMock.mockResolvedValue({
        merchant: 'Target',
        date: '2026-07-23',
        items: [
          { description: 'Milk', amount: 4.29, category: 'Groceries' },
          { description: 'Socks', amount: 12, category: 'Shopping' },
        ],
      });
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByTestId('capture-transaction-review');

      expect(parseBankStatementMock).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Split into 2 categories — review below');
    });
  });

  // --- Plan 090: capture-tab cascade ---

  it('only renders tabs whose module is enabled', () => {
    setEnabledModules(['lists', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.queryByText('Money')).not.toBeInTheDocument();
    expect(screen.getByText('To-Dos')).toBeInTheDocument();
    expect(screen.getByText('Shopping')).toBeInTheDocument();
  });

  it('gates To-Do/Shopping tabs behind the Plan master (only Money when Plan is off)', () => {
    // todos + shopping flags on, but Plan off → their destinations are hidden,
    // so only the Money capture tab remains.
    setEnabledModules(['money', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Add Transaction')).toBeInTheDocument(); // Money active
    expect(screen.queryByText('To-Dos')).not.toBeInTheDocument();
    expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
  });

  it('defaults the active tab to the first enabled tab when the default (money) is off', () => {
    // Money disabled, so the transaction default is unavailable.
    setEnabledModules(['lists', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // First enabled tab is To-Dos — its content is active (title stays the
    // generic 'Capture' since To-Dos + Shopping are both selectable).
    expect(screen.getByText('Capture')).toBeInTheDocument();
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-transaction-manual')).not.toBeInTheDocument();
  });

  it('hides the tab switcher when only one capture module is enabled', () => {
    setEnabledModules(['lists', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Single enabled tab renders its content with no switchable strip.
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
    expect(screen.getByText('Add Item')).toBeInTheDocument();
    expect(screen.queryByText('Money')).not.toBeInTheDocument();
    expect(screen.queryByText('To-Dos')).not.toBeInTheDocument();
    // Sole tab's own label is not rendered as a switcher option.
    expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
  });

  it('renders a graceful empty state when no capture module is enabled', () => {
    setEnabledModules([]);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // No crash on tabOptions[0]; a guidance message is shown instead, and no
    // footer save action for a tab that doesn't exist.
    expect(screen.getByText(/No capture types are enabled/i)).toBeInTheDocument();
    expect(screen.queryByTestId('capture-transaction-manual')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-footer')).not.toBeInTheDocument();
  });

  // --- Back affordance (paper cut 2G.3) ---

  describe('back navigation', () => {
    it('shows no back button on the entry view (there is nothing above the form)', () => {
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
    });

    it('shows a Back button in the review sub-view and returns to the form', async () => {
      parseReceiptLineItemsMock.mockResolvedValue({ merchant: 'Target', date: '2026-07-01', items: [] });
      parseBankStatementMock.mockResolvedValue([
        { merchant: 'Target', amount: 12, category: 'Shopping', date: '2026-07-01' },
      ]);
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByTestId('capture-transaction-review');
      expect(screen.getByLabelText('Back')).toBeInTheDocument();
      // The tab strip steps aside for the review (the body is no longer a
      // capture form) — but the footer does NOT: its action becomes the
      // bulk-add, so Save is still never a scroll away.
      expect(screen.queryByText('To-Dos')).not.toBeInTheDocument();
      expect(screen.getByTestId('drawer-footer')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Back'));
      expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
      // Back is a pure navigation — it must not close the whole drawer.
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  // --- Processing-view cancellation guard (PR #1108 finding) ---

  describe('processing view cancellation guard', () => {
    beforeEach(() => {
      parseReceiptLineItemsMock.mockReset();
      parseBankStatementMock.mockReset();
      mockUseHousehold.addTransaction.mockReset();
    });

    it('hides the Back button while a scan is processing', async () => {
      // Never resolves — keeps the flow parked in 'processing'.
      parseReceiptLineItemsMock.mockReturnValue(new Promise(() => {}));
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));

      await screen.findByText('Processing');
      // Let the flow actually reach (and lock in) its call to the mocked
      // scan function before the test ends — otherwise the FileReader's
      // callback can fire LATE (after this test has finished and the next
      // test has reconfigured the shared mock's return value), so this
      // never-resolving promise would end up calling the NEXT test's mock
      // return value instead of its own, contaminating that test.
      await waitFor(() => expect(parseReceiptLineItemsMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
      // The header X (unlike Back) intentionally remains — it's guarded by
      // the cancellation ref instead, see the next test.
      expect(screen.getByLabelText('Close drawer')).toBeInTheDocument();
    });

    it('a scan resolving after the flow was abandoned performs no state update and no addTransaction call', async () => {
      let resolveScan: (data: { merchant: string; date: string; items: { description: string; amount: number; category: string }[] }) => void = () => {};
      parseReceiptLineItemsMock.mockReturnValue(
        new Promise((resolve) => { resolveScan = resolve; })
      );
      render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTestId('add-from-image'));
      await screen.findByText('Processing');

      // Back is hidden during processing (previous test), but the header X
      // is still reachable — the user force-closes the in-flight scan.
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      // ...and is returned to a fresh manual entry form.
      await screen.findByTestId('capture-transaction-manual');

      // The abandoned scan now resolves.
      resolveScan({
        merchant: 'Target',
        date: '2026-07-01',
        items: [{ description: 'Widget', amount: 10, category: 'Shopping' }],
      });
      // Flush the resolved scan's continuation (a couple of chained awaits)
      // before asserting nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // It must be a total no-op: no transaction written, and the manual
      // form the user is now typing into must not be clobbered.
      expect(mockUseHousehold.addTransaction).not.toHaveBeenCalled();
      expect(screen.getByTestId('capture-transaction-manual')).toBeInTheDocument();
      expect(screen.queryByText('Review')).not.toBeInTheDocument();
    });
  });
});
