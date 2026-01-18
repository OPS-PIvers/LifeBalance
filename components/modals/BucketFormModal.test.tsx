
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BucketFormModal from './BucketFormModal';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <span>X</span>,
  Trash2: () => <span>Trash2</span>,
}));

describe('BucketFormModal', () => {
  const mockAddBucket = vi.fn();
  const mockUpdateBucket = vi.fn();
  const mockDeleteBucket = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addBucket: mockAddBucket,
      updateBucket: mockUpdateBucket,
      deleteBucket: mockDeleteBucket,
    });
  });

  it('renders correctly when open', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('New Bucket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create bucket/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);
    const closeButton = screen.getByRole('button', { name: /x/i });
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders edit state correctly', () => {
    const bucket = {
      id: '1',
      name: 'Groceries',
      limit: 500,
      spent: 100,
      color: 'bg-blue-500',
      isVariable: true,
      isCore: true
    };
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} editingBucket={bucket} />);
    expect(screen.getByText('Edit Bucket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete bucket/i })).toBeInTheDocument();
  });
});
