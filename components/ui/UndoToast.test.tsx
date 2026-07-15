import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UndoToast } from './UndoToast';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UndoToast', () => {
  it('shows the provided message', () => {
    render(<UndoToast message="To-Do completed" onUndo={() => {}} />);
    expect(screen.getByText('To-Do completed')).toBeInTheDocument();
  });

  it('invokes onUndo when the Undo button is tapped', () => {
    const onUndo = vi.fn();
    render(<UndoToast message="To-Do completed" onUndo={onUndo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('keeps a comfortable (>=44px) tap target on the Undo button', () => {
    render(<UndoToast message="To-Do completed" onUndo={() => {}} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });
});
