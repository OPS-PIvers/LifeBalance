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
});
