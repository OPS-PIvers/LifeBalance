
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BudgetAccounts from './BudgetAccounts';
import { Account } from '../../types/schema';

// Mock dependencies
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
  it('renders accounts correctly', () => {
    render(<BudgetAccounts />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    // $1,000 appears in the account card and potentially in the net worth summary
    expect(screen.getAllByText('$1,000').length).toBeGreaterThan(0);
  });

  it('opens delete confirmation modal when trash icon is clicked', async () => {
    render(<BudgetAccounts />);

    // Find trash icon button by aria-label
    const deleteButton = screen.getByLabelText('Delete Checking account');
    fireEvent.click(deleteButton);

    // Check if modal appears
    expect(screen.getByText('Delete Account?')).toBeInTheDocument();

    // Check if delete button in modal exists
    const confirmDeleteButton = screen.getByText('Delete', { selector: 'button span' }).closest('button');
    expect(confirmDeleteButton).toBeInTheDocument();

    // Click delete
    if (confirmDeleteButton) {
        fireEvent.click(confirmDeleteButton);

        // Wait for delete to be called
        await waitFor(() => {
          expect(mockDeleteAccount).toHaveBeenCalledWith('acc1');
        });

        // Modal should be closed (we mock the modal to render children, but the state controlling it lives in parent)
        // Wait for modal to disappear
        await waitFor(() => {
             expect(screen.queryByText('Delete Account?')).not.toBeInTheDocument();
        });
    }
  });
});
