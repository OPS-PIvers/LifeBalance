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

  it('renders character count when maxLength and showCount are provided', () => {
    render(<Input maxLength={50} showCount placeholder="Counted Input" />);
    // Initially 0/50
    const counter = screen.getByText('0/50');
    expect(counter).toBeInTheDocument();
  });

  it('updates character count on user input (uncontrolled)', async () => {
    const user = userEvent.setup();
    render(<Input maxLength={50} showCount placeholder="Counted Input" />);
    const input = screen.getByPlaceholderText('Counted Input');

    await user.type(input, 'Hello');
    const counter = screen.getByText('5/50');
    expect(counter).toBeInTheDocument();
  });

  it('updates character count in controlled mode', async () => {
    const user = userEvent.setup();
    const ControlledInput = () => {
        const [val, setVal] = React.useState('');
        return <Input maxLength={10} showCount value={val} onChange={(e) => setVal(e.target.value)} />;
    };
    render(<ControlledInput />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'ABC');

    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('renders character count with initial value', () => {
    render(<Input maxLength={50} showCount defaultValue="Init" />);
    const counter = screen.getByText('4/50');
    expect(counter).toBeInTheDocument();
  });

  it('renders required indicator when required prop is present', () => {
    render(<Input label="Required Field" required />);
    const indicator = screen.getByText('*');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('text-money-neg');
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not render header div if no label and no showCount', () => {
    const { container } = render(<Input placeholder="No Header" />);
    // The header div has class 'flex justify-between items-end mb-1.5'
    // We check that it does not exist
    const header = container.querySelector('.flex.justify-between.items-end.mb-1\\.5');
    expect(header).toBeNull();
  });
});
