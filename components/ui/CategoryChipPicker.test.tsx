import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { CategoryChipPicker } from './CategoryChipPicker';
import { MAX_TODO_CATEGORY_LENGTH } from '@/utils/todoCategoryLimits';

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

  it('dismisses an open "+ Add" editor when an existing chip is picked instead', () => {
    const onChange = vi.fn();
    const onAddCategory = vi.fn();
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

    // Changing your mind and tapping an existing chip should not leave the
    // half-typed editor hanging beside the new selection.
    fireEvent.click(screen.getByRole('button', { name: 'Errands' }));

    expect(onChange).toHaveBeenCalledWith('Errands');
    expect(onAddCategory).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument();
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

  it('does NOT select the category when the write fails, and keeps the editor open with the name', async () => {
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

    // The user is told, the typed name survives, and nothing was selected — a
    // category whose vocabulary write failed would make the to-do write fail too.
    await screen.findByRole('alert');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New category name')).toHaveValue('Yard');
    errorSpy.mockRestore();
  });

  it('can retry after a failed write', async () => {
    const onAddCategory = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
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
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Yard'));
    expect(onAddCategory).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByLabelText('New category name')).not.toBeInTheDocument());
    errorSpy.mockRestore();
  });

  it('caps the name at 50 characters (the firestore.rules limit) instead of minting a broken chip', async () => {
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
    const input = screen.getByLabelText('New category name');
    // Typing is capped by the input itself…
    expect(input).toHaveAttribute('maxLength', String(MAX_TODO_CATEGORY_LENGTH));
    // …and a paste (which bypasses maxLength in some browsers) is refused with a
    // message rather than written.
    fireEvent.change(input, { target: { value: 'x'.repeat(MAX_TODO_CATEGORY_LENGTH + 10) } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Keep it to ${MAX_TODO_CATEGORY_LENGTH} characters or fewer.`,
    );
    expect(onAddCategory).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    // The editor stays open so the name can be shortened.
    expect(screen.getByLabelText('New category name')).toBeInTheDocument();
  });

  it('accepts a name of exactly the cap, and clears the message once edited', async () => {
    const onAddCategory = vi.fn(async () => {});
    const exactly = 'y'.repeat(MAX_TODO_CATEGORY_LENGTH);
    render(
      <CategoryChipPicker
        categories={CATEGORIES}
        value={undefined}
        onChange={() => {}}
        onAddCategory={onAddCategory}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a category' }));
    const input = screen.getByLabelText('New category name');
    fireEvent.change(input, { target: { value: 'z'.repeat(MAX_TODO_CATEGORY_LENGTH + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));
    await screen.findByRole('alert');

    fireEvent.change(input, { target: { value: exactly } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new category' }));
    await waitFor(() => expect(onAddCategory).toHaveBeenCalledWith(exactly));
  });

  it('renders with a null value (Firestore round-trip of a cleared category) without throwing, and selects nothing', () => {
    // ToDo.category is typed `string | undefined` but a to-do whose category
    // was cleared via the generic form-edit path comes back from Firestore as
    // a literal `null` (firestoreSanitizer converts `undefined` to `null` on
    // write). This is exactly the crash from the "Triage" banner: previously
    // `value.trim()` threw `TypeError: null is not an object`.
    expect(() =>
      render(
        <CategoryChipPicker
          categories={CATEGORIES}
          value={null}
          onChange={() => {}}
          onAddCategory={async () => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Errands' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('does not crash when the household vocabulary contains a non-string entry', () => {
    // The `categories` array is unvalidated in Firestore; a stray null in the
    // vocabulary should be skipped rather than crashing the same `.trim()`
    // path a null `value` used to.
    const withNullEntry = ['Home', null, 'Errands'] as unknown as string[];
    expect(() =>
      render(
        <CategoryChipPicker
          categories={withNullEntry}
          value={null}
          onChange={() => {}}
          onAddCategory={async () => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Errands' })).toBeInTheDocument();
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
