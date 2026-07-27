import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { addDays, format } from 'date-fns';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToDo, HouseholdMember } from '@/types/schema';
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

  describe('fixed two-line row layout (paper cut #4)', () => {
    it('renders the meta line as a SIBLING of the edit button, never a descendant', () => {
      render(<TodoRow {...baseProps} />);
      const editButton = screen.getByRole('button', { name: `Edit task: ${item.text}` });
      const describedById = editButton.getAttribute('aria-describedby');
      const metaEl = document.getElementById(describedById as string);
      expect(metaEl).not.toBeNull();
      expect(editButton.contains(metaEl)).toBe(false);
      expect(metaEl?.contains(editButton)).toBe(false);
    });

    it('renders the meta line as a SIBLING of the title paragraph in selection mode too', () => {
      render(<TodoRow {...baseProps} isSelectionMode />);
      // In selection mode the whole Row becomes role=button (select-toggle),
      // so the sibling contract here is against the title <p>, not a button.
      const titleEl = screen.getByText(item.text).closest('p');
      const metaEl = document.getElementById(`todo-row-meta-${item.id}`);
      expect(titleEl).not.toBeNull();
      expect(metaEl).not.toBeNull();
      expect(titleEl?.contains(metaEl)).toBe(false);
      expect(metaEl?.contains(titleEl)).toBe(false);
    });

    it('keeps the subtask pill reachable and interactive inside the meta line', () => {
      const withSubtasks: ToDo = {
        ...item,
        subtasks: [{ id: 's1', text: 'Step one', isDone: false }],
      };
      render(<TodoRow {...baseProps} item={withSubtasks} />);
      const pill = screen.getByTestId('todo-subtask-pill');
      expect(pill.tagName).toBe('BUTTON');
      fireEvent.click(pill);
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Step one')).toBeInTheDocument();
      // Clicking the pill must not have bubbled up and opened the edit drawer.
      expect(handlers.onEdit).not.toHaveBeenCalled();
    });

    it('clamps a long title to two lines instead of wrapping unbounded', () => {
      const longTitle = 'Reorganize the entire garage including the workbench and every shelf on the back wall'.repeat(2);
      render(<TodoRow {...baseProps} item={{ ...item, text: longTitle }} />);
      const editButton = screen.getByRole('button', { name: `Edit task: ${longTitle}` });
      const titleSpan = editButton.querySelector('span');
      // Two lines, not one: a title cut off mid-word defeats the row's whole
      // purpose, so the clamp bounds row growth without hiding short titles.
      expect(titleSpan?.className).toMatch(/\bline-clamp-2\b/);
      expect(titleSpan?.className).not.toMatch(/\btruncate\b/);
      // The full title is still reachable off-screen (aria-label + native
      // title tooltip) for the rare title that overruns even two lines.
      expect(editButton.getAttribute('title')).toBe(longTitle);
    });

    it('does not reserve two title lines for a short title, so a one-line title yields a one-line-tall row (paper cut #12)', () => {
      // A prior version reserved `min-h-[2.75em]` on every row so heights
      // stayed uniform regardless of title length, but that left an ugly gap
      // under a short title. That reservation was reverted — only the
      // two-line CAP remains.
      render(<TodoRow {...baseProps} item={{ ...item, text: 'Milk' }} />);
      const editButton = screen.getByRole('button', { name: 'Edit task: Milk' });
      const titleSpan = editButton.querySelector('span');
      expect(titleSpan?.className).not.toContain('min-h-[2.75em]');
      expect(titleSpan?.className).toMatch(/\bline-clamp-2\b/);
      // `line-clamp-2` supplies display:-webkit-box; a competing `block` in the
      // same layer can win on stylesheet order and render the clamp inert.
      expect(titleSpan?.className).not.toMatch(/\bblock\b/);
    });

    it('still renders the meta line (holding just the due date) when there are no subtasks and no assignee — the row never collapses to a single line', () => {
      render(<TodoRow {...baseProps} assignee={undefined} />);
      const metaEl = document.getElementById(`todo-row-meta-${item.id}`);
      expect(metaEl).not.toBeNull();
      expect(screen.queryByTestId('todo-subtask-pill')).toBeNull();
      // No assignee and not a household-wide item (baseProps.item.assignedTo
      // is set) — the assignee slot is empty, not a stray placeholder.
      expect(metaEl?.querySelector('img')).toBeNull();
    });

    it('mutes a plain upcoming date (no urgency) instead of using the bold section-accent color reserved for overdue/today', () => {
      // baseProps.item is due 3 days out — not overdue, not today.
      render(<TodoRow {...baseProps} />);
      const dueLabel = screen.getByTestId('todo-due-label');
      expect(dueLabel.className).not.toMatch(/font-semibold/);
      expect(dueLabel.className).not.toMatch(/text-accent-600/);
    });

    it('keeps a bold, colored urgency signal for a to-do due today', () => {
      const today: ToDo = { ...item, completeByDate: format(new Date(), 'yyyy-MM-dd') };
      render(<TodoRow {...baseProps} item={today} />);
      const dueLabel = screen.getByTestId('todo-due-label');
      expect(dueLabel.textContent).toContain('Today');
      expect(dueLabel.className).toMatch(/font-semibold/);
      expect(dueLabel.className).toMatch(/text-accent-600/); // baseProps.color is 'accent'
    });

    it('keeps a bold, colored urgency signal for an overdue to-do', () => {
      const overdue: ToDo = { ...item, completeByDate: '2020-01-01' };
      render(<TodoRow {...baseProps} item={overdue} />);
      const dueLabel = screen.getByTestId('todo-due-label');
      expect(dueLabel.textContent).toContain('Overdue');
      expect(dueLabel.className).toMatch(/font-semibold/);
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

  describe('household assignment (paper cut #5)', () => {
    const memberA: HouseholdMember = { uid: 'user-1', displayName: 'Alice', role: 'admin' } as HouseholdMember;
    const memberB: HouseholdMember = { uid: 'user-2', displayName: 'Bob', role: 'member' } as HouseholdMember;
    const memberC: HouseholdMember = { uid: 'user-3', displayName: 'Cara', role: 'member' } as HouseholdMember;
    const memberD: HouseholdMember = { uid: 'user-4', displayName: 'Dev', role: 'member' } as HouseholdMember;
    const householdItem: ToDo = { ...item, assignedTo: undefined };

    it('renders a stacked avatar cluster (not a single dot) when a to-do has no single assignee', () => {
      const memberMap = new Map([[memberA.uid, memberA], [memberB.uid, memberB]]);
      render(<TodoRow {...baseProps} item={householdItem} memberMap={memberMap} />);
      const cluster = screen.getByRole('img', { name: /Assigned to the whole household \(2 members\)/ });
      // Both members render as chips (fallback initials since neither has a photoURL).
      expect(cluster.textContent).toContain('A');
      expect(cluster.textContent).toContain('B');
    });

    it('caps visible avatars and shows a "+N" chip for the remainder', () => {
      const memberMap = new Map(
        [memberA, memberB, memberC, memberD].map(m => [m.uid, m])
      );
      render(<TodoRow {...baseProps} item={householdItem} memberMap={memberMap} />);
      const cluster = screen.getByRole('img', { name: /Assigned to the whole household \(4 members\)/ });
      expect(cluster.textContent).toContain('+1');
    });

    it('keeps rendering exactly one chip for a single assigned member (unchanged behavior)', () => {
      const memberMap = new Map([[memberA.uid, memberA]]);
      render(<TodoRow {...baseProps} item={item} assignee={memberA} memberMap={memberMap} />);
      expect(screen.queryByRole('img', { name: /whole household/ })).toBeNull();
      expect(screen.getByTitle('Alice')).toBeInTheDocument();
    });

    it('degenerate case: a household of exactly one member still renders the household cluster (not the single-assignee chip)', () => {
      const memberMap = new Map([[memberA.uid, memberA]]);
      render(<TodoRow {...baseProps} item={householdItem} assignee={undefined} memberMap={memberMap} />);
      const cluster = screen.getByRole('img', { name: /Assigned to the whole household \(1 member\)/ });
      expect(cluster.textContent).toContain('A');
    });

    it('degenerate case: renders a photo avatar in the cluster for a member who has one, alongside an initials fallback for one who does not', () => {
      const withPhoto: HouseholdMember = { ...memberB, photoURL: 'https://example.com/bob.jpg' };
      const memberMap = new Map([[memberA.uid, memberA], [withPhoto.uid, withPhoto]]);
      render(<TodoRow {...baseProps} item={householdItem} assignee={undefined} memberMap={memberMap} />);
      const cluster = screen.getByRole('img', { name: /Assigned to the whole household \(2 members\)/ });
      const img = cluster.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', withPhoto.photoURL);
      // Alice has no photoURL — still falls back to her initial inside the cluster.
      expect(cluster.textContent).toContain('A');
    });

    it('does not render a household cluster (or any chip) when the household member list is unavailable', () => {
      render(<TodoRow {...baseProps} item={householdItem} assignee={undefined} memberMap={undefined} />);
      expect(screen.queryByRole('img', { name: /whole household/ })).toBeNull();
    });
  });
});
