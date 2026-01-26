import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Input from './Input';

describe('Input', () => {
  it('renders correctly', () => {
    render(<Input placeholder="Test Input" />);
    const input = screen.getByPlaceholderText('Test Input');
    expect(input).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Input label="Test Label" />);
    const label = screen.getByText('Test Label');
    expect(label).toBeInTheDocument();
  });

  it('renders error message when provided', () => {
    render(<Input error="Test Error" />);
    const error = screen.getByText('Test Error');
    expect(error).toBeInTheDocument();
  });

  it('handles user input', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} />);
    const input = screen.getByRole('textbox');

    await user.type(input, 'Hello');
    expect(handleChange).toHaveBeenCalledTimes(5);
  });

  it('renders icon when provided', () => {
    render(<Input icon={<span data-testid="test-icon">Icon</span>} />);
    const icon = screen.getByTestId('test-icon');
    expect(icon).toBeInTheDocument();
  });

  it('generates id from label if not provided', () => {
    render(<Input label="Test Label" />);
    const input = screen.getByLabelText('Test Label');
    expect(input).toHaveAttribute('id', 'input-test-label');
  });

  it('uses provided id if available', () => {
    render(<Input label="Test Label" id="custom-id" />);
    const input = screen.getByLabelText('Test Label');
    expect(input).toHaveAttribute('id', 'custom-id');
  });

  it('applies disabled styles', () => {
      render(<Input disabled placeholder="Disabled" />);
      const input = screen.getByPlaceholderText('Disabled');
      expect(input).toBeDisabled();
      expect(input).toHaveClass('disabled:opacity-50');
  });

  it('associates error message with input via ARIA attributes', () => {
    render(<Input error="Invalid input" label="Test Label" />);
    const input = screen.getByLabelText('Test Label');
    const error = screen.getByText('Invalid input');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(error.id).toBeDefined();
    expect(error.id).toContain('error');
  });

  it('associates error message with input via ARIA attributes when no label/id provided', () => {
    render(<Input error="Invalid input" />);
    const input = screen.getByRole('textbox');
    const error = screen.getByText('Invalid input');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(error.id).toBeDefined();
    expect(error.id).toContain('error');
  });
});
