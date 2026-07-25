import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { CategoryChipPicker } from './CategoryChipPicker';

const CATEGORIES = ['Home', 'Errands'];

describe('CategoryChipPicker', () => {
  it('renders a pressable chip per category with the selection marked', () => {
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value="Home"
        onChange={() => {}}
        onAddCategory={async () => {}}
        label="Category"
      />,
    );
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Errands' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects a category on tap', () => {
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={onChange}
        onAddCategory={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Errands' }));
    expect(onChange).toHaveBeenCalledWith('Errands');
  });

  it('clears the selection when the selected chip is tapped and allowClear is set', () => {
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value="Home"
        onChange={onChange}
        onAddCategory={async () => {}}
        allowClear
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('does NOT clear when allowClear is omitted', () => {
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value="Home"
        onChange={onChange}
        onAddCategory={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a selected value that is not in the vocabulary as a chip', () => {
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value="Legacy"
        onChange={() => {}}
        onAddCategory={async () => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Legacy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds a new category and selects it (happy path)', async () => {
    const onAddCategory = vi.fn(async () => {});
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: '  Yard  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));

    await waitFor(() => expect(onAddCategory).toHaveBeenCalledWith('Yard'));
    expect(onChange).toHaveBeenCalledWith('Yard');
    // Editor closes again.
    await waitFor(() => expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument());
  });

  it('an empty input just closes the editor without writing', async () => {
    const onAddCategory = vi.fn(async () => {});
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));

    await waitFor(() => expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument());
    expect(onAddCategory).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a case-insensitive duplicate selects the existing chip without writing', async () => {
    const onAddCategory = vi.fn(async () => {});
    const onChange = vi.fn();
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Home'));
    expect(onAddCategory).not.toHaveBeenCalled();
  });

  it('guards against a double-tap issuing two writes', async () => {
    let resolveAdd: (() => void) | undefined;
    const onAddCategory = vi.fn(() => new Promise<void>(resolve => { resolveAdd = resolve; }));
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={() => {}}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Yard' } });

    const confirm = screen.getByRole('button', { name: 'Confirm new category' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onAddCategory).toHaveBeenCalledTimes(1);
    resolveAdd?.();
    await waitFor(() => expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument());
  });

  it('swallows an onAddCategory rejection (the mutation owns the toast) and closes', async () => {
    const onAddCategory = vi.fn(async () => { throw new Error('nope'); });
    const onChange = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={onChange}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Yard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));

    await waitFor(() => expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('disables every control when disabled', () => {
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={() => {}}
        onAddCategory={async () => {}}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a category' })).toBeDisabled();
  });
});
