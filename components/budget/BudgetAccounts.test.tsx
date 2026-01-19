import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BudgetAccounts from './BudgetAccounts';
import { Account } from '../../types/schema';

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

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    accounts: mockAccounts,
    updateAccountBalance: updateAccountBalanceMock,
    addAccount: addAccountMock,
    setAccountGoal: setAccountGoalMock,
    deleteAccount: deleteAccountMock,
    reorderAccounts: reorderAccountsMock,
  }),
}));

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
}));

// Mock Modal to avoid portal/fixed positioning issues in tests
vi.mock('../ui/Modal', () => ({
  Modal: ({ children, onClose }: { children: React.ReactNode, onClose: () => void }) => (
    <div data-testid="modal">
      <button onClick={onClose} aria-label="Close">X</button>
      {children}
    </div>
  )
}));

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
});
