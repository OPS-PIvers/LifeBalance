import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ToDo } from '@/types/schema';
import { TodoTriageDrawer } from './TodoTriageDrawer';

const mockUpdateToDo = vi.fn(() => Promise.resolve());
const mockDeleteToDo = vi.fn(() => Promise.resolve());
const mockUpdateTodoCategories = vi.fn(() => Promise.resolve());

let mockTodos: ToDo[] = [];

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: () => ({
    todos: mockTodos,
    todoCategories: ['Home', 'Work'],
    updateTodoCategories: mockUpdateTodoCategories,
    updateToDo: mockUpdateToDo,
    deleteToDo: mockDeleteToDo,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const todo = (id: string, text: string, extra: Partial<ToDo> = {}): ToDo => ({
  id,
  text,
  completeByDate: '2026-07-01',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-06-27T00:00:00.000Z',
  ...extra,
});

const openDrawer = (todos: ToDo[]) => {
  mockTodos = todos;
  // Mount closed, then open, so the open-edge snapshot path is what builds the
  // queue — the same lifecycle the real page produces.
  const view = render(<TodoTriageDrawer isOpen={false} onClose={vi.fn()} />);
  view.rerender(<TodoTriageDrawer isOpen onClose={vi.fn()} />);
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTodos = [];
});

describe('TodoTriageDrawer', () => {
  it('queues only active, uncategorized to-dos', () => {
    openDrawer([
      todo('t1', 'Uncategorized task'),
      todo('t2', 'Already sorted', { category: 'Home' }),
      todo('t3', 'Blank category', { category: '   ' }),
      todo('t4', 'Done task', { isCompleted: true }),
    ]);

    // t1 and t3 qualify; t2 (categorized) and t4 (completed) do not.
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized task')).toBeInTheDocument();
    expect(screen.queryByText('Already sorted')).not.toBeInTheDocument();
    expect(screen.queryByText('Done task')).not.toBeInTheDocument();
  });

  it('saves the picked category and advances to the next card', async () => {
    openDrawer([todo('t1', 'First task'), todo('t2', 'Second task')]);

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    await waitFor(() => {
      expect(mockUpdateToDo).toHaveBeenCalledWith('t1', { category: 'Home' });
    });
    await screen.findByText('Second task');
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('does not reshuffle the queue when a save removes a card from the live filter', async () => {
    const first = todo('t1', 'First task');
    const second = todo('t2', 'Second task');
    const third = todo('t3', 'Third task');
    const view = openDrawer([first, second, third]);

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    await waitFor(() => expect(mockUpdateToDo).toHaveBeenCalledTimes(1));

    // Simulate the Firestore listener dropping the now-categorized to-do out of
    // the uncategorized set. A live-derived queue would slide t3 into position 2
    // and skip it; the snapshot must still show the originally-second task.
    mockTodos = [{ ...first, category: 'Work' }, second, third];
    view.rerender(<TodoTriageDrawer isOpen onClose={vi.fn()} />);

    expect(await screen.findByText('Second task')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('skips without writing anything', () => {
    openDrawer([todo('t1', 'First task'), todo('t2', 'Second task')]);

    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }));

    expect(mockUpdateToDo).not.toHaveBeenCalled();
    expect(mockDeleteToDo).not.toHaveBeenCalled();
    expect(screen.getByText('Second task')).toBeInTheDocument();
  });

  it('writes a due-date quick pick immediately on tap, without advancing', async () => {
    openDrawer([todo('t1', 'First task'), todo('t2', 'Second task')]);

    fireEvent.click(screen.getByRole('button', { name: 'Due tomorrow' }));

    await waitFor(() => expect(mockUpdateToDo).toHaveBeenCalledTimes(1));
    const call = mockUpdateToDo.mock.calls[0] as unknown as [string, Partial<ToDo>];
    expect(call[0]).toBe('t1');
    expect(call[1].completeByDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call[1].completeByDate).not.toBe('2026-07-01');
    // Still on the same card — only the category chip auto-advances.
    expect(screen.getByText('First task')).toBeInTheDocument();
  });

  it('writes the importance star immediately on tap, without advancing', async () => {
    openDrawer([todo('t1', 'First task')]);

    fireEvent.click(screen.getByRole('button', { name: 'Mark as important' }));

    await waitFor(() => {
      expect(mockUpdateToDo).toHaveBeenCalledWith('t1', { isImportant: true });
    });
    expect(await screen.findByRole('button', { name: 'Unmark as important' })).toBeInTheDocument();
    expect(screen.getByText('First task')).toBeInTheDocument();
  });

  it('confirms before deleting, then advances past the deleted card', async () => {
    openDrawer([todo('t1', 'First task'), todo('t2', 'Second task')]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete task: First task' }));
    expect(mockDeleteToDo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteToDo).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText('Second task')).toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });

  it('shows the completion state once the queue is exhausted', async () => {
    openDrawer([todo('t1', 'Only task')]);

    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }));

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows the completion state when there is nothing to triage on open', () => {
    openDrawer([todo('t1', 'Already sorted', { category: 'Home' })]);

    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });

  it('goes back to the previous card, showing its saved values', async () => {
    openDrawer([todo('t1', 'First task'), todo('t2', 'Second task')]);

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByText('Second task')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the previous task' }));

    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    // The category it was just given is reflected as the selected chip.
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
  });
});
