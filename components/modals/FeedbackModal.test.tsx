import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import FeedbackModal from './FeedbackModal';

// Mock contexts
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'test-user-id' }
  }),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    householdId: 'test-household-id'
  }),
}));

// Mock router
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/test-route' }),
}));

// Mock firebase
vi.mock('@/firebase.config', () => ({
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

// Mock icons
vi.mock('lucide-react', async () => {
  return {
    Loader2: () => <span data-testid="loader-icon" />,
    Send: () => <span data-testid="send-icon" />,
    X: () => <span data-testid="x-icon" />, // Mock X icon as we expect to use it
  };
});

describe('FeedbackModal', () => {
  it('renders correctly when open', () => {
    render(<FeedbackModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Send Feedback')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('I found a bug when...')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<FeedbackModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Send Feedback')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', () => {
    const handleClose = vi.fn();
    render(<FeedbackModal isOpen={true} onClose={handleClose} />);

    // We expect a Cancel button to exist.
    // Since it doesn't exist yet, this test is expected to fail.
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close (X) button is clicked', () => {
    const handleClose = vi.fn();
    render(<FeedbackModal isOpen={true} onClose={handleClose} />);

    // We expect a close button with aria-label "Close drawer" or similar.
    // Or we can look for the X icon.
    // Since it doesn't exist yet, this test is expected to fail.
    const closeButton = screen.getByLabelText('Close drawer');
    fireEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
