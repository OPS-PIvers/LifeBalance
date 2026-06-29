import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QuickAddBar } from './QuickAddBar';

describe('QuickAddBar', () => {
  it('renders an input and a submit button', () => {
    render(
      <QuickAddBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Add item..."
        submitLabel="Add item"
      />
    );

    expect(screen.getByPlaceholderText('Add item...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add item' })).toHaveAttribute('type', 'submit');
  });

  it('renders the controlled value', () => {
    render(
      <QuickAddBar
        value="Milk"
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Add item..."
      />
    );

    expect(screen.getByRole('textbox')).toHaveValue('Milk');
  });

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <QuickAddBar
        value=""
        onChange={handleChange}
        onSubmit={() => {}}
        placeholder="Add item..."
      />
    );

    await user.type(screen.getByRole('textbox'), 'Hi');
    expect(handleChange).toHaveBeenCalledTimes(2);
    expect(handleChange).toHaveBeenLastCalledWith('i');
  });

  it('calls onSubmit when the form is submitted', async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <QuickAddBar
        value="Milk"
        onChange={() => {}}
        onSubmit={handleSubmit}
        placeholder="Add item..."
        submitLabel="Add item"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables the submit button when disabled is set', () => {
    render(
      <QuickAddBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Add item..."
        submitLabel="Add item"
        disabled
      />
    );

    expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled();
  });

  it('forwards the input ref and applies the aria-label', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(
      <QuickAddBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Add item..."
        inputRef={ref}
        aria-label="Quick add"
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Quick add')).toBe(ref.current);
  });
});
