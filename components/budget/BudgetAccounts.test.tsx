import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BudgetAccounts from './BudgetAccounts';
import { Account } from '@/types/schema';

// Mock dependencies
const {
  updateAccountBalanceMock,
  addAccountMock,
  setAccountGoalMock,
  deleteAccountMock,
  reorderAccountsMock
} = vi.hoisted(() => ({
  updateAccountBalanceMock: vi.fn(),
  addAccountMock: vi.fn(),
  setAccountGoalMock: vi.fn(),
  deleteAccountMock: vi.fn(),
  reorderAccountsMock: vi.fn(),
}));

const mockAccounts: Account[] = [
  {
    id: 'acc1',
    name: 'Main Checking',
    type: 'checking',
    balance: 5000,
    lastUpdated: '2023-01-01',
    order: 1
  },
  {
    id: 'acc2',
    name: 'My Savings',
    type: 'savings',
    balance: 10000,
    lastUpdated: '2023-01-01',
    order: 2,
    monthlyGoal: 15000 // existing goal
  },
  {
    id: 'acc3',
    name: 'Visa Card',
    type: 'credit',
    balance: 200,
    lastUpdated: '2023-01-01',
    order: 3
  }
];

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // BudgetAccounts reads useFinance; alias every hook to the same value so the
  // mock data resolves regardless of which slice hook the component uses.
  // Also covers the nested SavingsGoals section (Plan 24), which reads
  // savingsGoals/its mutations off useFinance and `members` off useHouseholdCore.
  const value = () => ({
    accounts: mockAccounts,
    updateAccountBalance: updateAccountBalanceMock,
    addAccount: addAccountMock,
    setAccountGoal: setAccountGoalMock,
    setAccountCardLast4: vi.fn(),
    deleteAccount: deleteAccountMock,
    updateAccountOrder: vi.fn(),
    reorderAccounts: reorderAccountsMock,
    savingsGoals: [],
    addSavingsGoal: vi.fn(),
    updateSavingsGoal: vi.fn(),
    deleteSavingsGoal: vi.fn(),
    contributeToGoal: vi.fn(),
    members: [],
  });
  return {
    useHousehold: value,
    useFinance: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
    useGamification: value,
  };
});

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Pencil: () => <span data-testid="pencil-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  X: () => <span data-testid="x-icon" />,
  Target: () => <span data-testid="target-icon" />,
  Star: () => <span data-testid="star-icon" />,
  GripVertical: () => <span data-testid="grip-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  MoreVertical: () => <span data-testid="more-vertical-icon" />,
  PiggyBank: () => <span data-testid="piggy-bank-icon" />,
}));

// Mock Modal to avoid portal/fixed positioning issues in tests
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, onClose, isOpen }: { children: React.ReactNode, onClose: () => void, isOpen: boolean }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="modal">
        <button onClick={onClose} aria-label="Close">X</button>
        {children}
      </div>
    );
  }
}));

// Mock Drawer
vi.mock('@/components/ui/Drawer', () => {
  interface MockDrawerProps {
    children: React.ReactNode;
    isOpen: boolean;
    title?: string;
    onClose?: () => void;
  }
  return {
    Drawer: ({ children, isOpen, title, onClose }: MockDrawerProps) => {
      if (!isOpen) return null;
      return (
        <div data-testid="drawer">
          <h3>{title}</h3>
          {onClose && <button aria-label="Close drawer" onClick={onClose}>Close</button>}
          {children}
        </div>
      );
    },
  };
});

describe('BudgetAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders assets and liabilities correctly', () => {
    render(<BudgetAccounts />);

    // Check for sections
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Liabilities')).toBeInTheDocument();

    // Check for account names
    expect(screen.getByText('Main Checking')).toBeInTheDocument();
    expect(screen.getByText('My Savings')).toBeInTheDocument();
    expect(screen.getByText('Visa Card')).toBeInTheDocument();

    // Check balances (using flexible matching for currency)
    // We search for elements containing both the currency symbol and the amount
    const checkBalance = (amount: string) => {
        const elements = screen.getAllByText((content) => content.includes(amount));
        expect(elements.length).toBeGreaterThan(0);
    };

    checkBalance('5,000');
    checkBalance('10,000');
    checkBalance('200');
  });

  it('calculates and displays net worth correctly', () => {
    render(<BudgetAccounts />);
    // Assets: 5000 + 10000 = 15000
    // Liabilities: 200
    // Net Worth: 14800

    // Check for Net Worth display
    // It might be split or formatted, so we look for the number
    expect(screen.getByText((content) => content.includes('14,800.00'))).toBeInTheDocument();
  });

  it('opens add account modal and adds account on save', async () => {
    const user = userEvent.setup();
    render(<BudgetAccounts />);

    // Click Add Account button
    await user.click(screen.getByText('Add Account'));

    // Fill form
    await user.type(screen.getByPlaceholderText('Account Name'), 'New Fund');
    await user.type(screen.getByPlaceholderText('Current Balance'), '500');
    // Select is a native select
    await user.selectOptions(screen.getByRole('combobox'), 'savings');

    // Click Save
    await user.click(screen.getByText('Save Account'));

    expect(addAccountMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Fund',
      balance: 500,
      type: 'savings'
    }));
  });

  it('edits account balance when clicked', async () => {
    const user = userEvent.setup();
    render(<BudgetAccounts />);

    // Click on checking balance ($5,000)
    const balanceDisplay = screen.getByRole('button', { name: /Edit balance for Main Checking/i });
    await user.click(balanceDisplay);

    // Input should appear with current value
    const input = screen.getByRole('spinbutton'); // type="number"
    expect(input).toHaveValue(5000);

    // Change value
    await user.clear(input);
    await user.type(input, '6000');

    // Click save (Check icon)
    // The check icon is inside a button
    const saveButton = screen.getByLabelText('Save balance');
    await user.click(saveButton);

    expect(updateAccountBalanceMock).toHaveBeenCalledWith('acc1', 6000);
  });

  it('opens goal modal and sets goal', async () => {
    const user = userEvent.setup();
    render(<BudgetAccounts />);

    // Click target icon for Savings account
    const targetBtn = screen.getByLabelText('Set savings goal for My Savings');
    await user.click(targetBtn);

    // Modal appears
    expect(screen.getByText('Set Savings Goal')).toBeInTheDocument();

    // Enter amount
    const input = screen.getByPlaceholderText('Goal Amount');
    await user.type(input, '20000');

    // Click Set Goal
    await user.click(screen.getByText('Set Goal'));

    expect(setAccountGoalMock).toHaveBeenCalledWith('acc2', 20000);
  });

  it('deletes account after confirmation', async () => {
    const user = userEvent.setup();
    render(<BudgetAccounts />);

    // Click trash for Visa Card
    const deleteBtn = screen.getByLabelText('Delete Visa Card account');
    await user.click(deleteBtn);

    // Modal appears
    expect(screen.getByText('Delete Account?')).toBeInTheDocument();

    // Click Delete in modal
    const modal = screen.getByTestId('modal');
    // Use `within` to scope to the modal
    // The button has a span with "Delete" text
    const confirmDeleteBtn = within(modal).getByRole('button', { name: /delete/i });

    await user.click(confirmDeleteBtn);

    await waitFor(() => {
        expect(deleteAccountMock).toHaveBeenCalledWith('acc3');
    });
  });

  // Mobile specific tests
  it('opens drawer and triggers actions for account', async () => {
    const user = userEvent.setup();
    render(<BudgetAccounts />);

    // Click 'More Options' for Savings Account
    const moreBtn = screen.getByLabelText('Options for My Savings');
    await user.click(moreBtn);

    // Verify Drawer opens
    const drawer = screen.getByTestId('drawer');
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText('My Savings')).toBeInTheDocument();

    // Verify actions exist
    expect(within(drawer).getByRole('button', { name: /Edit Balance/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Set Savings Goal/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Delete Account/i })).toBeInTheDocument();

    // Test Edit Balance trigger
    await user.click(within(drawer).getByRole('button', { name: /Edit Balance/i }));
    expect(drawer).not.toBeInTheDocument(); // Drawer should close
    // Edit input should appear
    expect(screen.getByRole('spinbutton')).toHaveValue(10000);

    // Re-open drawer for next action
    await user.click(moreBtn);

    // Get the new drawer instance
    const drawer2 = screen.getByTestId('drawer');

    // Test Set Goal trigger
    // Use fireEvent to ensure click handler fires immediately
    fireEvent.click(within(drawer2).getByRole('button', { name: /Set Savings Goal/i }));

    // Goal sheet (now a Drawer) should open with its content
    expect(await screen.findByText('What is your target balance for this account?')).toBeInTheDocument();

    // Close the goal drawer to reset
    await user.click(screen.getByLabelText('Close drawer'));
    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());

    // Re-open actions drawer for delete
    await user.click(moreBtn);

    // Get the new drawer instance
    const drawer3 = screen.getByTestId('drawer');

    // Test Delete trigger
    await user.click(within(drawer3).getByRole('button', { name: /Delete Account/i }));
    expect(screen.getByText('Delete Account?')).toBeInTheDocument();
  });
});
