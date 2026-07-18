import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubViewHint } from './SubViewHint';
import { SUB_VIEW_HINT_KEY } from '@/utils/subViewHint';

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  X: () => <span data-testid="icon-x" />,
}));

describe('SubViewHint', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows on first visit as a polite status', () => {
    render(<SubViewHint menuOpened={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('hold more views');
  });

  it('does not show once the latch is set', () => {
    localStorage.setItem(SUB_VIEW_HINT_KEY, 'true');
    render(<SubViewHint menuOpened={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismisses and latches via the explicit ×', () => {
    render(<SubViewHint menuOpened={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(SUB_VIEW_HINT_KEY)).toBe('true');
  });

  it('dismisses and latches when a tab menu opens', () => {
    const { rerender } = render(<SubViewHint menuOpened={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<SubViewHint menuOpened />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(SUB_VIEW_HINT_KEY)).toBe('true');
  });

  it('latches on unmount (navigation away) while visible', () => {
    const { unmount } = render(<SubViewHint menuOpened={false} />);
    unmount();
    expect(localStorage.getItem(SUB_VIEW_HINT_KEY)).toBe('true');
  });
});
