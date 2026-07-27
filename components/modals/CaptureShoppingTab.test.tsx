import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Store } from '@/types/schema';
import { CaptureShoppingTab } from './CaptureShoppingTab';

const stores: Store[] = [
  { id: 'store-1', name: 'Costco' },
  { id: 'store-2', name: "Trader Joe's" },
];

const baseProps = {
  formId: 'capture-shopping-form',
  name: 'Milk',
  setName: vi.fn(),
  category: undefined,
  setCategory: vi.fn(),
  quantity: undefined,
  setQuantity: vi.fn(),
  smartDefaults: { category: 'Uncategorized' as const },
  onSubmit: vi.fn(),
};

/** Opens the collapsed "Add details" section so the Store field is visible. */
const openDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('Add details'));
};

describe('CaptureShoppingTab store picker', () => {
  it('lists the household\'s existing stores as options', async () => {
    const user = userEvent.setup();
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={vi.fn()}
        stores={stores}
        onAddStore={vi.fn()}
      />
    );
    await openDetails(user);

    const select = screen.getByLabelText('Store (optional)') as HTMLSelectElement;
    const optionNames = Array.from(select.options).map(o => o.textContent);
    expect(optionNames).toEqual(['No store', 'Costco', "Trader Joe's"]);
  });

  it('still offers the picker and the add flow when the household has no stores yet', async () => {
    // Cold start is the case this field exists for — a household's FIRST store
    // is usually typed at capture time. A free-text fallback here would record
    // the name on the item without adding it to the shared list, so the next
    // capture would offer nothing again and the list would never fill up.
    const user = userEvent.setup();
    const setStore = vi.fn();
    const onAddStore = vi.fn().mockResolvedValue('Aldi');
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={setStore}
        stores={[]}
        onAddStore={onAddStore}
      />
    );
    await openDetails(user);

    const select = screen.getByLabelText('Store (optional)') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['No store']);

    await user.click(screen.getByText('+ Add a new store'));
    await user.type(screen.getByLabelText('New store name'), 'Aldi');
    await user.click(screen.getByRole('button', { name: 'Confirm new store' }));

    expect(onAddStore).toHaveBeenCalledWith('Aldi');
    expect(setStore).toHaveBeenCalledWith('Aldi');
  });

  it('picking an existing store calls setStore with it', async () => {
    const user = userEvent.setup();
    const setStore = vi.fn();
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={setStore}
        stores={stores}
        onAddStore={vi.fn()}
      />
    );
    await openDetails(user);

    await user.selectOptions(screen.getByLabelText('Store (optional)'), 'Costco');
    expect(setStore).toHaveBeenCalledWith('Costco');
  });

  it('adding a new store persists it (via onAddStore) and selects the canonical name', async () => {
    const user = userEvent.setup();
    const setStore = vi.fn();
    const onAddStore = vi.fn().mockResolvedValue('Target');
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={setStore}
        stores={stores}
        onAddStore={onAddStore}
      />
    );
    await openDetails(user);

    await user.click(screen.getByText('+ Add a new store'));
    await user.type(screen.getByLabelText('New store name'), '  Target  ');
    await user.click(screen.getByRole('button', { name: 'Confirm new store' }));

    expect(onAddStore).toHaveBeenCalledWith('Target'); // trimmed
    expect(setStore).toHaveBeenCalledWith('Target');
    // The inline editor closes back to the "+ Add a new store" affordance.
    expect(await screen.findByText('+ Add a new store')).toBeInTheDocument();
  });

  it('leaves the field empty and skips the write when the new-store draft is blank', async () => {
    const user = userEvent.setup();
    const onAddStore = vi.fn();
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={vi.fn()}
        stores={stores}
        onAddStore={onAddStore}
      />
    );
    await openDetails(user);

    await user.click(screen.getByText('+ Add a new store'));
    await user.click(screen.getByRole('button', { name: 'Confirm new store' }));

    expect(onAddStore).not.toHaveBeenCalled();
  });

  it('keeps the store field optional — "No store" is selectable and is the default', async () => {
    const user = userEvent.setup();
    render(
      <CaptureShoppingTab
        {...baseProps}
        store={undefined}
        setStore={vi.fn()}
        stores={stores}
        onAddStore={vi.fn()}
      />
    );
    await openDetails(user);

    expect(screen.getByLabelText('Store (optional)')).toHaveValue('');
  });
});
