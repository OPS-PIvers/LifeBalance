import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TodoCategoryManagerDrawer } from './TodoCategoryManagerDrawer';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import type { ToDo } from '@/types/schema';

// The Drawer primitive animates through framer-motion; render its children
// immediately (same stub Drawer.test.tsx uses). ConfirmDialog's Modal is
// portal-only, so it needs no stub.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      onClick,
      ...props
    }: {
      children: React.ReactNode;
      className?: string;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <div className={className} onClick={onClick} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDragControls: () => ({ start: () => {} }),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useTodos: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockUpdateTodoCategories = vi.fn(() => Promise.resolve());
const mockRenameTodoCategory = vi.fn(() => Promise.resolve());
const mockDeleteTodoCategory = vi.fn(() => Promise.resolve());

const todo = (id: string, category?: string): ToDo => ({
  id,
  text: `Task ${id}`,
  completeByDate: '2026-07-25',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-20T00:00:00.000Z',
  ...(category === undefined ? {} : { category }),
});

// "home" (lowercase) must count toward "Home"; a completed task still counts,
// because the mutations rewrite completed to-dos too.
const defaultTodos: ToDo[] = [
  todo('t1', 'Home'),
  todo('t2', 'home'),
  { ...todo('t3', 'Work'), isCompleted: true },
  todo('t4'),
  todo('t5', '  '),
  todo('t6'),
];

const setupContext = (overrides: { todos?: ToDo[]; todoCategories?: string[] } = {}) => {
  (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    todos: overrides.todos ?? defaultTodos,
    todoCategories: overrides.todoCategories ?? ['Home', 'Work'],
    updateTodoCategories: mockUpdateTodoCategories,
    renameTodoCategory: mockRenameTodoCategory,
    deleteTodoCategory: mockDeleteTodoCategory,
  });
};

const renderDrawer = () =>
  render(<TodoCategoryManagerDrawer isOpen onClose={vi.fn()} />);

describe('TodoCategoryManagerDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  it('lists each category with its case-insensitive usage count', () => {
    renderDrawer();

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('2 tasks')).toBeInTheDocument(); // Home + home
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('1 task')).toBeInTheDocument(); // completed task counts
    // Absent and blank categories both land in the read-only Uncategorized row.
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('renders the empty state when the household has no categories', () => {
    setupContext({ todoCategories: [] });
    renderDrawer();

    expect(screen.getByText(/No categories yet/i)).toBeInTheDocument();
    // The add field is right there in the empty state.
    expect(screen.getByLabelText('New category')).toBeInTheDocument();
  });

  it('appends a trimmed new category to the vocabulary', async () => {
    renderDrawer();

    fireEvent.change(screen.getByLabelText('New category'), { target: { value: '  Errands  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mockUpdateTodoCategories).toHaveBeenCalledWith(['Home', 'Work', 'Errands']);
    });
    expect(mockUpdateTodoCategories).toHaveBeenCalledTimes(1);
  });

  it('does not write when the new category name is blank', async () => {
    renderDrawer();

    fireEvent.change(screen.getByLabelText('New category'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await screen.findByText('Give the category a name.');
    expect(mockUpdateTodoCategories).not.toHaveBeenCalled();
  });

  it('rejects a case-insensitive duplicate with a message instead of writing', async () => {
    renderDrawer();

    fireEvent.change(screen.getByLabelText('New category'), { target: { value: 'hOmE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await screen.findByText('"Home" is already on the list.');
    expect(mockUpdateTodoCategories).not.toHaveBeenCalled();
  });

  it('renames a category with the old and new names', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    const input = screen.getByLabelText('New name for Home');
    fireEvent.change(input, { target: { value: 'House' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name for Home' }));

    await waitFor(() => {
      expect(mockRenameTodoCategory).toHaveBeenCalledWith('Home', 'House');
    });
    expect(mockRenameTodoCategory).toHaveBeenCalledTimes(1);
  });

  it('does not write when a rename leaves the name unchanged', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save name for Home' }));

    await waitFor(() => {
      // Editor closed again…
      expect(screen.queryByLabelText('New name for Home')).not.toBeInTheDocument();
    });
    // …with no write.
    expect(mockRenameTodoCategory).not.toHaveBeenCalled();
  });

  it('does not write when a rename is cleared to blank', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Work' }));
    fireEvent.change(screen.getByLabelText('New name for Work'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name for Work' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('New name for Work')).not.toBeInTheDocument();
    });
    expect(mockRenameTodoCategory).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting and states the consequence', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));

    expect(mockDeleteTodoCategory).not.toHaveBeenCalled();
    expect(
      screen.getByText('Delete "Home"? 2 tasks will become Uncategorized. This can\'t be undone.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteTodoCategory).toHaveBeenCalledWith('Home');
    });
  });

  it('cancelling the delete confirmation performs no write', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText(/will become Uncategorized/)).not.toBeInTheDocument();
    });
    expect(mockDeleteTodoCategory).not.toHaveBeenCalled();
  });
});
