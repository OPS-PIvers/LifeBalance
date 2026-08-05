import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DeleteUndoToast } from './ShoppingListTab';

// The full tab needs live context providers; the delete->undo affordance is
// the exported DeleteUndoToast rendered inside toast((t) => ...), so test it
// directly. Mock the context module so importing ShoppingListTab is inert.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useShopping: () => ({}),
  useHouseholdCore: () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeleteUndoToast', () => {
  it('shows the deleted item name', () => {
    render(<DeleteUndoToast itemName="Oat milk" onUndo={() => {}} />);
    expect(screen.getByText(/Oat milk/)).toBeInTheDocument();
  });

  it('invokes onUndo when the Undo button is tapped', () => {
    const onUndo = vi.fn();
    render(<DeleteUndoToast itemName="Oat milk" onUndo={onUndo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('keeps a comfortable (>=44px) tap target on the Undo button', () => {
    render(<DeleteUndoToast itemName="Oat milk" onUndo={() => {}} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });

  // Review finding: a parked item was never on the active shopping list, so
  // the generic "Deleted" copy (and the old literal "Removed from shopping
  // list" wording) is misleading/false for it. `isParked` must render
  // section-accurate copy WITHOUT touching the active-item wording at all.
  it('defaults to the plain "Deleted" copy — active-item wording unchanged', () => {
    render(<DeleteUndoToast itemName="Oat milk" onUndo={() => {}} />);
    expect(screen.getByText('Deleted "Oat milk"')).toBeInTheDocument();
  });

  it('renders the same "Deleted" copy when isParked is explicitly false', () => {
    render(<DeleteUndoToast itemName="Oat milk" isParked={false} onUndo={() => {}} />);
    expect(screen.getByText('Deleted "Oat milk"')).toBeInTheDocument();
  });

  it('renders parked-appropriate copy when isParked is true', () => {
    render(<DeleteUndoToast itemName="Bike rack" isParked onUndo={() => {}} />);
    expect(screen.getByText('Removed "Bike rack" from Saved for later')).toBeInTheDocument();
    expect(screen.queryByText(/^Deleted /)).not.toBeInTheDocument();
    expect(screen.queryByText(/shopping list/i)).not.toBeInTheDocument();
  });

  it('still invokes onUndo when parked', () => {
    const onUndo = vi.fn();
    render(<DeleteUndoToast itemName="Bike rack" isParked onUndo={onUndo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
