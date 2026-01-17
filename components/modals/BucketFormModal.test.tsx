import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BucketFormModal from './BucketFormModal';

// Mock the household context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    addBucket: vi.fn(),
    updateBucket: vi.fn(),
    deleteBucket: vi.fn(),
  }),
}));

describe('BucketFormModal', () => {
  it('renders correctly when open', () => {
    render(<BucketFormModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('New Bucket')).toBeInTheDocument();
  });

  it('has accessible inputs and labels', () => {
    render(<BucketFormModal isOpen={true} onClose={() => {}} />);

    // Should have visible labels
    expect(screen.getByLabelText('Bucket Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly Limit')).toBeInTheDocument();

    // Close button should have label
    expect(screen.getByLabelText('Close modal')).toBeInTheDocument();

    // Color picker should be accessible
    // Note: We use getAllByRole('button') to exclude the container which also matches the label text
    const colorButtons = screen.getAllByRole('button', { name: /Select color/ });
    expect(colorButtons.length).toBeGreaterThan(0);

    // First color is selected by default
    expect(colorButtons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders correctly when editing', () => {
    const mockBucket = {
      id: '123',
      name: 'Groceries',
      limit: 500,
      spent: 100,
      color: 'bg-emerald-500',
      isVariable: true,
      isCore: true
    };
    render(<BucketFormModal isOpen={true} onClose={() => {}} editingBucket={mockBucket} />);
    expect(screen.getByText('Edit Bucket')).toBeInTheDocument();
    expect(screen.getByLabelText('Bucket Name')).toHaveValue('Groceries');
    expect(screen.getByLabelText('Monthly Limit')).toHaveValue(500);
  });
});
