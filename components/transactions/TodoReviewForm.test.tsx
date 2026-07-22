import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TodoReviewForm from './TodoReviewForm';
import { ToDo, HouseholdMember } from '@/types/schema';

const {
  mockApproveTodo,
  mockDeleteToDo,
  mockOnDone,
  mockOnDeleted,
  mockToast,
  mockRequestDeleteConfirmation,
} = vi.hoisted(() => ({
  mockApproveTodo: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockDeleteToDo: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockOnDone: vi.fn(),
  mockOnDeleted: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  mockRequestDeleteConfirmation: vi.fn(),
}));

const members: Pick<HouseholdMember, 'uid' | 'displayName'>[] = [
  { uid: 'u1', displayName: 'Paul' },
  { uid: 'u2', displayName: 'Sam' },
];

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: () => ({
    approveTodo: mockApproveTodo,
    deleteToDo: mockDeleteToDo,
  }),
  useHouseholdCore: () => ({ members }),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

vi.mock('@/components/ui/confirmDialogStore', () => ({
  requestDeleteConfirmation: (request: { onConfirm: () => void | Promise<void> }) => {
    mockRequestDeleteConfirmation(request);
    return request.onConfirm();
  },
}));

const baseItem: ToDo = {
  id: 'todo-1',
  text: 'Buy dog food',
  completeByDate: '2026-08-01',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-20T00:00:00.000Z',
  needsReview: true,
};

describe('TodoReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills fields from the item', () => {
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    expect(screen.getByLabelText(/task/i)).toHaveValue('Buy dog food');
    expect(screen.getByLabelText(/due date/i)).toHaveValue('2026-08-01');
    expect(screen.getByLabelText(/assign to/i)).toHaveValue('u1');
    expect(screen.getByRole('button', { name: /important/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('approves with no overrides when nothing was edited', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveTodo).toHaveBeenCalledWith('todo-1', undefined);
    expect(mockOnDone).toHaveBeenCalled();
  });

  it('sends only the changed fields as overrides', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.click(screen.getByRole('button', { name: /important/i }));
    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveTodo).toHaveBeenCalledWith('todo-1', { isImportant: true });
  });

  it('reassigning to another member sends an assignedTo override', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.selectOptions(screen.getByLabelText(/assign to/i), 'u2');
    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveTodo).toHaveBeenCalledWith('todo-1', { assignedTo: 'u2' });
  });

  it('seeds an unassigned item to the first member and persists that choice on approve', async () => {
    const unassignedItem: ToDo = { ...baseItem, assignedTo: '' };
    const user = userEvent.setup();
    render(<TodoReviewForm item={unassignedItem} onDone={mockOnDone} />);

    // The displayed selection must match state — previously the <Select>
    // visually defaulted to the first member while state stayed empty.
    expect(screen.getByLabelText(/assign to/i)).toHaveValue('u1');

    await user.click(screen.getByRole('button', { name: /add to list/i }));

    expect(mockApproveTodo).toHaveBeenCalledWith('todo-1', { assignedTo: 'u1' });
  });

  it('disables Add to list when the task text is emptied', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.clear(screen.getByLabelText(/task/i));
    expect(screen.getByRole('button', { name: /add to list/i })).toBeDisabled();
  });

  it('Discard deletes the item and calls onDeleted', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} onDeleted={mockOnDeleted} />);

    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(mockRequestDeleteConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: 'Buy dog food' })
    );
    expect(mockDeleteToDo).toHaveBeenCalledWith('todo-1');
    expect(mockOnDeleted).toHaveBeenCalled();
    expect(mockOnDone).not.toHaveBeenCalled();
  });

  it('Discard falls back to onDone when onDeleted is omitted', async () => {
    const user = userEvent.setup();
    render(<TodoReviewForm item={baseItem} onDone={mockOnDone} />);

    await user.click(screen.getByRole('button', { name: /discard/i }));

    expect(mockDeleteToDo).toHaveBeenCalledWith('todo-1');
    expect(mockOnDone).toHaveBeenCalled();
  });
});
