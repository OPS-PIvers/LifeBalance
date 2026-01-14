
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BudgetAccounts from './BudgetAccounts';
import { Account } from '../../types/schema';

// Mock Modal: Since the Modal component handles portals/fixed positioning,
// we can usually rely on RTL to find it. But for simplicity in unit tests,
// we often just want to ensure it renders its children.
// However, since we are using the real Modal component which uses `fixed inset-0`,
// it should just appear in the body. RTL renders into a div appended to body.
// So we probably don't need to mock it unless we want to bypass the overlay logic.
// Let's try without mocking Modal first.

const mockDeleteAccount = vi.fn();
const mockAccounts: Account[] = [
  {
    id: 'acc1',
    name: 'Checking',
    type: 'checking',
    balance: 1000,
    lastUpdated: '2023-01-01',
    order: 1
  }
];

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    accounts: mockAccounts,
    updateAccountBalance: vi.fn(),
    addAccount: vi.fn(),
    setAccountGoal: vi.fn(),
    deleteAccount: mockDeleteAccount,
    reorderAccounts: vi.fn(),
    // BudgetAccounts derives these from accounts, but if it used the context values directly we'd need to mock them.
    // Looking at the code: "const { assetAccounts, ... } = useMemo(...)".
    // So it derives them internally. We just need to provide `accounts`.
  }),
}));

describe('BudgetAccounts', () => {
  it('renders accounts correctly', () => {
    render(<BudgetAccounts />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    // $1,000 appears in the account card and potentially in the net worth summary
    expect(screen.getAllByText('$1,000').length).toBeGreaterThan(0);
  });

  it('opens delete confirmation modal when trash icon is clicked', () => {
    render(<BudgetAccounts />);

    // Find trash icon button by aria-label
    const deleteButton = screen.getByLabelText('Delete Checking account');
    fireEvent.click(deleteButton);

    // Check if modal appears
    expect(screen.getByText('Delete Account?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this account? This action cannot be undone.')).toBeInTheDocument();

    // Check if delete button in modal exists
    const confirmDeleteButton = screen.getByText('Delete', { selector: 'button span' }).closest('button');
    expect(confirmDeleteButton).toBeInTheDocument();

    // Click delete
    if (confirmDeleteButton) {
        fireEvent.click(confirmDeleteButton);
        // Expect deleteAccount to be called
        expect(mockDeleteAccount).toHaveBeenCalledWith('acc1');
    }
  });
});
