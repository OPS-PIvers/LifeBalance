import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ToDo } from '@/types/schema';
import { PromoteToDoSheet } from './PromoteToDoSheet';
import { WHOLE_HOUSEHOLD_ASSIGNEE } from '@/utils/todoAssignee';

const mockPromoteTodo = vi.fn(() => Promise.resolve());
const mockUpdateTodoCategories = vi.fn(() => Promise.resolve());

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: () => ({
    todoCategories: ['Home', 'Work'],
    updateTodoCategories: mockUpdateTodoCategories,
    promoteTodo: mockPromoteTodo,
  }),
  useHouseholdCore: () => ({
    members: [
      { uid: 'u1', displayName: 'Alice', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
      { uid: 'u2', displayName: 'Bob', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
    ],
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// A PARKED to-do: `completeByDate` is the inert placeholder stamped by
// `addSavedForLaterTodo`, never a date the user chose.
const parked: ToDo = {
  id: 'parked-1',
  text: 'Look into a bike rack',
  completeByDate: '2026-08-04',
  isCompleted: false,
  savedForLater: true,
  createdBy: 'u1',
  createdAt: '2026-08-04T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PromoteToDoSheet', () => {
  it('never renders the inert placeholder due date', () => {
    render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);

    // Showing the placeholder would put a fabricated date in front of the user
    // and let them confirm it by accident — the exact failure this sheet exists
    // to prevent. The date field starts EMPTY.
    const dateInput = screen.getByLabelText('Or pick a date') as HTMLInputElement;
    expect(dateInput.value).toBe('');
    expect(screen.queryByText(/2026-08-04/)).not.toBeInTheDocument();
  });

  it('requires a due date before it can confirm', () => {
    render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);

    const confirm = screen.getByRole('button', { name: 'Add to list' });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Due today' }));
    expect(screen.getByRole('button', { name: 'Add to list' })).toBeEnabled();
  });

  it('applies every field in ONE promoteTodo write', async () => {
    const onClose = vi.fn();
    const onPromoted = vi.fn();
    render(<PromoteToDoSheet todo={parked} onClose={onClose} onPromoted={onPromoted} />);

    fireEvent.change(screen.getByLabelText('Or pick a date'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));

    await waitFor(() => {
      expect(mockPromoteTodo).toHaveBeenCalledTimes(1);
    });
    // ONE write carrying the whole classification: a split could let the to-do
    // reach the active list still wearing its placeholder date.
    expect(mockPromoteTodo).toHaveBeenCalledWith('parked-1', {
      completeByDate: '2026-09-15',
      assignedTo: 'u2',
      category: 'Home',
      isImportant: true,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onPromoted).toHaveBeenCalledWith('parked-1');
  });

  it('promotes with only a due date — every other field stays unset', async () => {
    render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Due tomorrow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));

    await waitFor(() => expect(mockPromoteTodo).toHaveBeenCalledTimes(1));
    const [, fields] = mockPromoteTodo.mock.calls[0] as unknown as [string, Record<string, unknown>];
    // "Whole household" is the default and stores an ABSENT assignedTo — the
    // sentinel never reaches Firestore.
    expect(fields.assignedTo).toBeUndefined();
    expect(fields.category).toBeUndefined();
    expect(fields.isImportant).toBe(false);
    expect(typeof fields.completeByDate).toBe('string');
    expect(fields.completeByDate).not.toBe('');
  });

  it('pre-fills the classification the item already carries', () => {
    render(
      <PromoteToDoSheet
        todo={{ ...parked, assignedTo: 'u1', category: 'Work', isImportant: true }}
        onClose={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Assign to') as HTMLSelectElement).value).toBe('u1');
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Unmark as important' })).toBeInTheDocument();
  });

  it('defaults an unassigned parked item to "Whole household"', () => {
    render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);
    expect((screen.getByLabelText('Assign to') as HTMLSelectElement).value).toBe(
      WHOLE_HOUSEHOLD_ASSIGNEE,
    );
  });

  it('writes NOTHING when the sheet is backed out of — the item stays parked', () => {
    const onClose = vi.fn();
    render(<PromoteToDoSheet todo={parked} onClose={onClose} />);

    // Stage a full classification, then cancel.
    fireEvent.click(screen.getByRole('button', { name: 'Due today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Nothing half-classified may reach the active list, and nothing at all is
    // persisted on the way out — this sheet stages locally and only writes on
    // confirm (unlike TodoTriageDrawer's write-on-tap).
    expect(mockPromoteTodo).not.toHaveBeenCalled();
    expect(mockUpdateTodoCategories).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open with the staged values when the write fails', async () => {
    mockPromoteTodo.mockRejectedValueOnce(new Error('permission-denied'));
    const onClose = vi.fn();
    render(<PromoteToDoSheet todo={parked} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Or pick a date'), { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));

    await waitFor(() => expect(mockPromoteTodo).toHaveBeenCalled());
    // A rejection must not discard the triage the user just did.
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Or pick a date') as HTMLInputElement).value).toBe('2026-09-15');
  });

  it('re-seeds when a DIFFERENT parked item is handed in', () => {
    const { rerender } = render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Due today' }));
    expect((screen.getByLabelText('Or pick a date') as HTMLInputElement).value).not.toBe('');

    rerender(
      <PromoteToDoSheet todo={{ ...parked, id: 'parked-2', text: 'Other' }} onClose={vi.fn()} />,
    );
    // The second item must not inherit the first's staged date.
    expect((screen.getByLabelText('Or pick a date') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('re-seeds when the SAME item is reopened after a close', () => {
    const { rerender } = render(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Due today' }));

    rerender(<PromoteToDoSheet todo={null} onClose={vi.fn()} />);
    rerender(<PromoteToDoSheet todo={parked} onClose={vi.fn()} />);

    expect((screen.getByLabelText('Or pick a date') as HTMLInputElement).value).toBe('');
  });
});
