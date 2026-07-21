import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { addDays, format } from 'date-fns';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToDo } from '@/types/schema';
import { TodoRow } from './TodoRow';

// TodoRow's SwipeActionRow reads the resolved theme from ThemeContext.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);

const item: ToDo = {
  id: 'todo-1',
  text: 'Take out the trash',
  completeByDate: format(addDays(new Date(), 3), 'yyyy-MM-dd'),
  assignedTo: 'user-1',
  isCompleted: false,
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
};

const handlers = {
  onComplete: vi.fn(),
  onUncomplete: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onMore: vi.fn(),
  onToggleSelection: vi.fn(),
};

const baseProps = {
  item,
  color: 'accent' as const,
  assignee: undefined,
  isSelected: false,
  isSelectionMode: false,
  ...handlers,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TodoRow', () => {
  it('the row-body button is not a nested ancestor of the checkbox control', () => {
    render(<TodoRow {...baseProps} />);
    const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });
    const checkbox = screen.getByRole('checkbox', { name: `Complete task: ${item.text}` });
    // The checkbox must be a SIBLING of the edit button, not nested inside it
    // (nesting would make the checkbox unreachable/invalid inside a <button>).
    expect(editButton.contains(checkbox)).toBe(false);
    expect(checkbox.contains(editButton)).toBe(false);
  });

  it('wires the meta line (due/reminder/details/assignee) via aria-describedby rather than folding it into aria-label', () => {
    render(<TodoRow {...baseProps} />);
    const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });
    const describedById = editButton.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const metaEl = document.getElementById(describedById as string);
    expect(metaEl).not.toBeNull();
    // The accessible name stays short (doesn't duplicate the meta content);
    // the meta content itself lives in the described element instead.
    expect(editButton.getAttribute('aria-label')).toBe(`Edit task: ${item.text}`);
    expect(metaEl?.textContent).toMatch(/Has details|Today|Tomorrow|\d/);
  });

  describe('long-press vs. native contextmenu race', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fires onMore exactly once when a long-press fires and the browser also synthesizes a contextmenu', () => {
      render(<TodoRow {...baseProps} />);
      const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });

      fireEvent.pointerDown(editButton, { button: 0, clientX: 10, clientY: 10 });
      // Advance past the long-press threshold — this fires onMore once.
      vi.advanceTimersByTime(600);
      expect(handlers.onMore).toHaveBeenCalledTimes(1);

      // Some platforms synthesize a contextmenu around the same ~500ms mark
      // as a fired long-press. It must be swallowed, not double-fire onMore.
      fireEvent.contextMenu(editButton);
      expect(handlers.onMore).toHaveBeenCalledTimes(1);

      // The gesture-artifact click that follows must also be swallowed —
      // it must not additionally pop the edit drawer.
      fireEvent.click(editButton);
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('a plain contextmenu (no long-press) opens options exactly once', () => {
      render(<TodoRow {...baseProps} />);
      const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });

      fireEvent.contextMenu(editButton);
      expect(handlers.onMore).toHaveBeenCalledTimes(1);
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });
  });
});
