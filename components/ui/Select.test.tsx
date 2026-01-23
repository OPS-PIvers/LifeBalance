import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Select from './Select';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  ChevronDown: () => <div data-testid="chevron-down" />,
}));

describe('Select', () => {
  it('renders correctly', () => {
    render(
      <Select data-testid="select">
        <option value="1">Option 1</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    expect(select).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(
      <Select label="Test Label">
        <option value="1">Option 1</option>
      </Select>
    );
    const label = screen.getByText('Test Label');
    expect(label).toBeInTheDocument();
  });

  it('renders error message when provided', () => {
    render(
      <Select error="Test Error">
        <option value="1">Option 1</option>
      </Select>
    );
    const error = screen.getByText('Test Error');
    expect(error).toBeInTheDocument();
  });

  it('handles selection change', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Select onChange={handleChange}>
        <option value="1">Option 1</option>
        <option value="2">Option 2</option>
      </Select>
    );
    const select = screen.getByRole('combobox');

    await user.selectOptions(select, '2');
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue('2');
  });

  it('renders icon when provided', () => {
    render(
      <Select icon={<span data-testid="test-icon">Icon</span>}>
        <option value="1">Option 1</option>
      </Select>
    );
    const icon = screen.getByTestId('test-icon');
    expect(icon).toBeInTheDocument();
  });

  it('generates id from label if not provided', () => {
    render(
      <Select label="Test Label">
         <option value="1">Option 1</option>
      </Select>
    );
    const select = screen.getByLabelText('Test Label');
    expect(select).toHaveAttribute('id', 'select-test-label');
  });

  it('uses provided id if available', () => {
    render(
      <Select label="Test Label" id="custom-id">
         <option value="1">Option 1</option>
      </Select>
    );
    const select = screen.getByLabelText('Test Label');
    expect(select).toHaveAttribute('id', 'custom-id');
  });

  it('always renders chevron icon', () => {
      render(
          <Select>
              <option value="1">Option 1</option>
          </Select>
      );
      expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });

  it('associates error message with select via ARIA attributes', () => {
    render(
      <Select error="Invalid selection" label="Test Label">
        <option value="1">Option 1</option>
      </Select>
    );
    const select = screen.getByLabelText('Test Label');
    const error = screen.getByText('Invalid selection');

    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', error.id);
    expect(error.id).toBeDefined();
    expect(error.id).toContain('error');
  });
});
