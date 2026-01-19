import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DeveloperConsole from './DeveloperConsole';

// Mock Modal component
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean; onClose: () => void }) => {
    if (!isOpen) return null;
    return (
      <div role="dialog">
        {/* We do NOT add a close button here in the mock, to test if DeveloperConsole adds it */}
        {children}
      </div>
    );
  },
}));

// Mock Firebase
vi.mock('@/firebase.config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
  deleteDoc: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="icon-loader" />,
  Plus: () => <div data-testid="icon-plus" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Copy: () => <div data-testid="icon-copy" />,
  X: () => <div data-testid="icon-x" />,
}));

describe('DeveloperConsole', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly when open', async () => {
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Developer Console')).toBeInTheDocument();

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });
  });

  it('renders a close button', async () => {
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);

    // Wait for loading to finish first
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });
});
