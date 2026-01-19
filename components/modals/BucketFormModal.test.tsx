
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

  it('calls addBucket with correct data when creating new bucket', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'New Bucket' } });
    fireEvent.change(screen.getByPlaceholderText(/monthly limit/i), { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: /create bucket/i }));

    expect(mockAddBucket).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Bucket',
      limit: 100,
      isVariable: true,
      isCore: true
    }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls updateBucket with correct data when editing existing bucket', () => {
    const bucket = {
      id: '1',
      name: 'Groceries',
      limit: 500,
      spent: 100,
      color: 'bg-emerald-500',
      isVariable: true,
      isCore: true
    };
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} editingBucket={bucket} />);

    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'Updated Groceries' } });
    fireEvent.change(screen.getByPlaceholderText(/monthly limit/i), { target: { value: '600' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockUpdateBucket).toHaveBeenCalledWith(expect.objectContaining({
      id: '1',
      name: 'Updated Groceries',
      limit: 600,
      color: 'bg-emerald-500'
    }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls deleteBucket when delete button is clicked and confirmed', () => {
    const bucket = {
      id: '1',
      name: 'Groceries',
      limit: 500,
      spent: 100,
      color: 'bg-emerald-500',
      isVariable: true,
      isCore: true
    };

    // Mock window.confirm
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValue(true);

    render(<BucketFormModal isOpen={true} onClose={mockOnClose} editingBucket={bucket} />);

    fireEvent.click(screen.getByRole('button', { name: /delete bucket/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteBucket).toHaveBeenCalledWith('1');
    expect(mockOnClose).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('does not submit if required fields are missing', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);

    // Attempt to save without filling anything
    fireEvent.click(screen.getByRole('button', { name: /create bucket/i }));

    expect(mockAddBucket).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
