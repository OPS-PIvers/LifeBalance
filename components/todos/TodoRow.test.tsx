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
  onToggleSubtask: vi.fn(async () => ({ autoCompleted: false, toggledSubtaskId: 's2' })),
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

  describe('inline subtask access (checklist pill)', () => {
    const withSubtasks: ToDo = {
      ...item,
      subtasks: [
        { id: 's1', text: 'Gather bins', isDone: true },
        { id: 's2', text: 'Wheel to curb', isDone: false },
      ],
    };

    it('does not render the pill when the to-do has no subtasks', () => {
      render(<TodoRow {...baseProps} />);
      expect(screen.queryByTestId('todo-subtask-pill')).toBeNull();
    });

    it('renders a done/total pill and no longer renders the legacy steps-left hint', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const pill = screen.getByTestId('todo-subtask-pill');
      expect(pill.textContent).toContain('1/2');
      expect(screen.queryByTestId('todo-steps-left')).toBeNull();
    });

    it('tapping the pill expands the checklist without opening the edit drawer', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const pill = screen.getByTestId('todo-subtask-pill');
      // Collapsed by default.
      expect(screen.queryByText('Wheel to curb')).toBeNull();
      expect(pill.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(pill);
      expect(screen.getByText('Wheel to curb')).toBeInTheDocument();
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      // The pill's click must not bubble to the row body's edit handler.
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('checking a subtask calls onToggleSubtask with the row + subtask ids', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      fireEvent.click(screen.getByTestId('todo-subtask-pill'));
      const checkbox = screen.getByRole('checkbox', { name: /Wheel to curb/ });
      fireEvent.click(checkbox);
      expect(handlers.onToggleSubtask).toHaveBeenCalledWith('todo-1', 's2');
    });

    it('demotes subtasks out of the generic "has details" dot', () => {
      // A to-do whose ONLY extra content is subtasks shows the pill but not the
      // details dot (notes/recurrence are what the dot now signals).
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      expect(screen.getByTestId('todo-subtask-pill')).toBeInTheDocument();
      expect(screen.queryByTestId('todo-details-dot')).toBeNull();
    });

    it('renders the pill as a SIBLING of the edit button, not a descendant (ARIA: no interactive descendant of role=button)', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });
      const pill = screen.getByTestId('todo-subtask-pill');
      expect(editButton.contains(pill)).toBe(false);
    });

    it('keyboard activation on the pill does not bubble to the body and open the edit drawer', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const pill = screen.getByTestId('todo-subtask-pill');
      // Enter/Space on the focused pill must never reach the row body's
      // handleBodyKeyDown (which would preventDefault + open edit).
      fireEvent.keyDown(pill, { key: 'Enter' });
      fireEvent.keyDown(pill, { key: ' ' });
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('clicking the pill toggles expansion via the keyboard-reachable button path', () => {
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const pill = screen.getByTestId('todo-subtask-pill');
      // The pill is a real <button>, so keyboard users get native Enter/Space
      // activation (which fires click) — exercised here via click.
      fireEvent.click(pill);
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    describe('selection mode', () => {
      it('renders the pill as an inert count indicator (not a button)', () => {
        render(<TodoRow {...baseProps} item={withSubtasks} isSelectionMode />);
        const pill = screen.getByTestId('todo-subtask-pill');
        expect(pill.tagName).toBe('SPAN');
        expect(pill).not.toHaveAttribute('aria-expanded');
        expect(pill.textContent).toContain('1/2');
      });

      it('does not expose the expand/auto-complete path — clicking does not expand the checklist', () => {
        render(<TodoRow {...baseProps} item={withSubtasks} isSelectionMode />);
        const pill = screen.getByTestId('todo-subtask-pill');
        fireEvent.click(pill);
        // Inert indicator: no inline checklist, no onToggleSubtask reachable.
        expect(screen.queryByText('Wheel to curb')).toBeNull();
        expect(handlers.onToggleSubtask).not.toHaveBeenCalled();
      });
    });
  });
});
