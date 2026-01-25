
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
  Plus: () => <span>Plus</span>,
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
    const closeButton = screen.getByRole('button', { name: /close modal/i });
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

    fireEvent.change(screen.getByLabelText(/bucket name/i), { target: { value: 'New Bucket' } });
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: '100' } });

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

    fireEvent.change(screen.getByLabelText(/bucket name/i), { target: { value: 'Updated Groceries' } });
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: '600' } });

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

  it('disables submit if required fields are missing or invalid', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);

    const createButton = screen.getByRole('button', { name: /create bucket/i });
    expect(createButton).toBeDisabled();

    // 1. Fill only name -> Disabled
    fireEvent.change(screen.getByLabelText(/bucket name/i), { target: { value: 'New Bucket' } });
    expect(createButton).toBeDisabled();

    // 2. Fill invalid limit -> Disabled
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: '-10' } });
    expect(createButton).toBeDisabled();

    // 3. Fill valid limit -> Enabled
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: '100' } });
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);
    expect(mockAddBucket).toHaveBeenCalled();
  });

  it('supports accessible color selection', () => {
    render(<BucketFormModal isOpen={true} onClose={mockOnClose} />);

    // Verify radiogroup exists
    const radioGroup = screen.getByRole('radiogroup', { name: /bucket color/i });
    expect(radioGroup).toBeInTheDocument();

    // Verify all color options are present as radio buttons
    const colorOptions = screen.getAllByRole('radio');
    expect(colorOptions.length).toBeGreaterThan(0);

    // Verify selecting a color via label
    const blueOption = screen.getByLabelText(/select blue/i);
    fireEvent.click(blueOption);

    expect(blueOption).toBeChecked();

    // Verify submitting uses the selected color
    fireEvent.change(screen.getByLabelText(/bucket name/i), { target: { value: 'Blue Bucket' } });
    fireEvent.change(screen.getByLabelText(/monthly limit/i), { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: /create bucket/i }));

    expect(mockAddBucket).toHaveBeenCalledWith(expect.objectContaining({
      color: 'bg-blue-500'
    }));
  });
});
