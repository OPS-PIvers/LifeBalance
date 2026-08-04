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

/**
 * "Saved for later" — the PARKED variant of this same row (never a fork).
 *
 * The load-bearing assertions are the two suppressions: a parked item is not
 * completable, so BOTH the checkbox and swipe-to-complete must be gone (leaving
 * either reachable would let a parked to-do be completed while still carrying
 * its inert placeholder date), and the due-date cluster must not render at all
 * (rendering the placeholder ships a fabricated red "Overdue" label).
 */
describe('TodoRow — saved-for-later (parked) variant', () => {
  // Deliberately dated in the PAST: the active row renders a red "Overdue (…)"
  // label for this date, so the positive control below proves the suppression
  // tests would notice a regression rather than passing on a neutral fixture.
  const parkedItem: ToDo = {
    ...item,
    id: 'parked-1',
    text: 'Look into a bike rack',
    completeByDate: format(addDays(new Date(), -5), 'yyyy-MM-dd'),
    savedForLater: true,
  };
  const onPromote = vi.fn();
  const parkedProps = { ...baseProps, item: parkedItem, variant: 'parked' as const, onPromote };

  beforeEach(() => {
    onPromote.mockClear();
  });

  it('positive control: the SAME fixture as an ACTIVE row does show an overdue label and a checkbox', () => {
    render(<TodoRow {...baseProps} item={parkedItem} />);
    expect(screen.getByTestId('todo-due-label').textContent).toMatch(/Overdue/);
    expect(
      screen.getByRole('checkbox', { name: `Complete task: ${parkedItem.text}` }),
    ).toBeInTheDocument();
  });

  it('renders NO due date — the stored date is an inert placeholder', () => {
    render(<TodoRow {...parkedProps} />);
    expect(screen.queryByTestId('todo-due-label')).toBeNull();
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });

  it('cannot be completed via the checkbox — there is no checkbox at all', () => {
    render(<TodoRow {...parkedProps} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it('suppresses the subtask pill and checklist — no path to completeToDo', () => {
    const withSteps: ToDo = {
      ...parkedItem,
      subtasks: [
        { id: 's1', text: 'First step', isDone: true },
        { id: 's2', text: 'Last step', isDone: false },
      ],
    };
    render(<TodoRow {...parkedProps} item={withSteps} />);

    // Checking the LAST step escalates to `completeToDo`, which refuses a
    // parked to-do — surfacing as a bare "Failed to update subtask". The
    // control should never have been offered.
    expect(screen.queryByTestId('todo-subtask-pill')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Last step')).toBeNull();
  });

  it('positive control: the SAME fixture as an ACTIVE row DOES show the pill', () => {
    const withSteps: ToDo = {
      ...parkedItem,
      subtasks: [
        { id: 's1', text: 'First step', isDone: true },
        { id: 's2', text: 'Last step', isDone: false },
      ],
    };
    render(<TodoRow {...baseProps} item={withSteps} />);
    expect(screen.getByTestId('todo-subtask-pill')).toBeInTheDocument();
  });

  it('offers NO path to completeToDo at all', () => {
    const withSteps: ToDo = {
      ...parkedItem,
      subtasks: [{ id: 's1', text: 'Only step', isDone: false }],
    };
    render(<TodoRow {...parkedProps} item={withSteps} />);

    // The three doors: the leading control, the start-swipe action, and the
    // subtask checklist's auto-complete escalation. Click everything the row
    // exposes and assert onComplete/onToggleSubtask were never reached.
    document.querySelectorAll('button').forEach(b => fireEvent.click(b));
    expect(handlers.onComplete).not.toHaveBeenCalled();
    expect(handlers.onToggleSubtask).not.toHaveBeenCalled();
  });

  it('offers no "Save for later" action — it is already parked', () => {
    render(<TodoRow {...parkedProps} onSaveForLater={vi.fn()} />);
    // By attribute: rail buttons are aria-hidden until the row opens, and an
    // aria-hidden element's accessible name computes to ''.
    expect(document.querySelector('button[aria-label^="Save for later"]')).toBeNull();
  });

  it('cannot be completed via swipe — the right-swipe action is Add, not Complete', () => {
    render(<TodoRow {...parkedProps} />);
    // SwipeActionRow renders every action as a real button (aria-hidden until
    // the row sticks open), so the absence of a Complete action is directly
    // observable without driving a pointer gesture.
    const swipeLabels = Array.from(document.querySelectorAll('button')).map(b => b.textContent);
    expect(swipeLabels.some(t => t?.includes('Complete'))).toBe(false);
    expect(swipeLabels.some(t => t?.includes('Add'))).toBe(true);
    expect(swipeLabels.some(t => t?.includes('Delete'))).toBe(true);
  });

  it('offers a keyboard-reachable + control that opens the promote sheet', () => {
    render(<TodoRow {...parkedProps} />);
    const promote = screen.getByRole('button', { name: `Add to your list: ${parkedItem.text}` });
    fireEvent.click(promote);
    expect(onPromote).toHaveBeenCalledWith(parkedItem);
  });

  it('still opens the edit drawer on a body tap (parking does not make a row inert)', () => {
    render(<TodoRow {...parkedProps} />);
    fireEvent.click(screen.getByRole('button', { name: `Edit task: ${parkedItem.text}` }));
    expect(handlers.onEdit).toHaveBeenCalledWith(parkedItem);
  });

  it('is selectable in selection mode, with no completion affordance', () => {
    render(<TodoRow {...parkedProps} isSelectionMode />);
    fireEvent.click(screen.getByRole('button', { name: `Select task: ${parkedItem.text}` }));
    expect(handlers.onToggleSelection).toHaveBeenCalledWith(parkedItem.id);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByTestId('todo-due-label')).toBeNull();
  });
});

/**
 * "Saved for later" — parking an ACTIVE row. Delete stays the PRIMARY end-rail
 * action (zero muscle-memory change); "Save for later" is a secondary, tappable
 * only once the row sticks open. The host also carries it in the Task-options
 * drawer, because swipes are disabled outright under prefers-reduced-motion.
 */
describe('TodoRow — save-for-later action on an active row', () => {
  const onSaveForLater = vi.fn();

  const railLabels = () =>
    Array.from(document.querySelectorAll('button'))
      .map(b => b.getAttribute('aria-label'))
      .filter((label): label is string => label !== null)
      .filter(label => label.endsWith(item.text) && !label.startsWith('Edit task'));

  beforeEach(() => {
    onSaveForLater.mockClear();
  });

  it('adds "Save for later" as a SECONDARY behind Delete', () => {
    render(<TodoRow {...baseProps} onSaveForLater={onSaveForLater} />);
    // The end rail renders `[...actions].reverse()` so the primary sits at the
    // outer edge — DOM order [secondary, primary] proves Delete is actions[0].
    expect(railLabels()).toEqual([
      `Save for later: ${item.text}`,
      `Delete task: ${item.text}`,
    ]);
  });

  it('fires onSaveForLater with the whole item (the caller needs it for undo)', () => {
    render(<TodoRow {...baseProps} onSaveForLater={onSaveForLater} />);
    // Queried by attribute, not by role+name: a rail button is `aria-hidden`
    // until the row sticks open, and an aria-hidden element's ACCESSIBLE NAME
    // computes to '' — so `getByRole(..., { name })` can't reach it even with
    // `hidden: true`. (Tapping it for real happens after the row opens, which
    // clears aria-hidden; this is a shortcut past the drag gesture.)
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Save for later: ${item.text}"]`,
    );
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(onSaveForLater).toHaveBeenCalledWith(item);
  });

  it('omits the action for a COMPLETED to-do — it cannot be parked', () => {
    render(
      <TodoRow
        {...baseProps}
        item={{ ...item, isCompleted: true }}
        onSaveForLater={onSaveForLater}
      />,
    );
    // The mirror of PR-1's guard stopping a parked to-do being completed.
    expect(railLabels()).toEqual([`Delete task: ${item.text}`]);
  });

  it('omits the action when the host passes no handler (unchanged for old callers)', () => {
    render(<TodoRow {...baseProps} />);
    expect(railLabels()).toEqual([`Delete task: ${item.text}`]);
  });
});
