import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import HabitCard from './HabitCard';
import { Habit } from '../../types/schema';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import React from 'react';

// Mock dependencies
const mockToggleHabit = vi.fn();
const mockDeleteHabit = vi.fn();
const mockResetHabit = vi.fn();

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    toggleHabit: mockToggleHabit,
    deleteHabit: mockDeleteHabit,
    resetHabit: mockResetHabit,
    activeChallenge: null,
  }),
}));

// Mock Drawer to render children directly (no portal)
vi.mock('../ui/Drawer', () => ({
  Drawer: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title?: string }) => (
    isOpen ? (
      <div data-testid="mock-drawer">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    ) : null
  ),
}));

// Mock Modals
vi.mock('../modals/HabitFormModal', () => ({
  default: () => <div data-testid="mock-habit-form-modal" />,
}));
vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: () => <div data-testid="mock-log-modal" />,
}));

// Mock useMediaQuery
vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

// Mock Data
const mockHabit: Habit = {
  id: 'habit-1',
  title: 'Test Habit',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  count: 0,
  targetCount: 1,
  totalCount: 10,
  streakDays: 5,
  lastUpdated: '2023-01-01',
  scoringType: 'incremental',
  basePoints: 10,
  completedDates: [],
  weatherSensitive: false,
};

describe('HabitCard Responsive Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Dropdown on Desktop', () => {
    (useMediaQuery as Mock).mockReturnValue(true); // isDesktop = true

    render(<HabitCard habit={mockHabit} />);

    // Open menu
    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    // Check for dropdown specific elements
    // The dropdown has role="menu"
    const dropdown = screen.getByRole('menu');
    expect(dropdown).toBeInTheDocument();

    // Check that Drawer is NOT rendered
    expect(screen.queryByTestId('mock-drawer')).not.toBeInTheDocument();

    // Check items
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('View Log')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renders Drawer on Mobile', () => {
    (useMediaQuery as Mock).mockReturnValue(false); // isDesktop = false

    render(<HabitCard habit={mockHabit} />);

    // Open menu
    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    // Check for Drawer
    const drawer = screen.getByTestId('mock-drawer');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByText('Habit Options')).toBeInTheDocument();

    // Check that Dropdown (role=menu) is NOT rendered
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Check items (Drawer buttons have different text/layout)
    // Mobile text: "Edit Habit", "View History", "Delete"
    expect(screen.getByText('Edit Habit')).toBeInTheDocument();
    expect(screen.getByText('View History')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('triggers delete action from Mobile Drawer', () => {
    (useMediaQuery as Mock).mockReturnValue(false); // Mobile

    render(<HabitCard habit={mockHabit} />);

    // Open menu
    fireEvent.click(screen.getByLabelText('Habit options menu'));

    // Click Delete
    fireEvent.click(screen.getByText('Delete'));

    expect(mockDeleteHabit).toHaveBeenCalledWith(mockHabit.id);
  });

  it('opens Edit Modal from Mobile Drawer', () => {
    (useMediaQuery as Mock).mockReturnValue(false); // Mobile

    render(<HabitCard habit={mockHabit} />);

    // Open menu
    fireEvent.click(screen.getByLabelText('Habit options menu'));

    // Click Edit Habit
    fireEvent.click(screen.getByText('Edit Habit'));

    // Check if modal is open (mock renders a div with this test id when open)
    expect(screen.getByTestId('mock-habit-form-modal')).toBeInTheDocument();
  });

  it('opens View History Modal from Mobile Drawer', () => {
    (useMediaQuery as Mock).mockReturnValue(false); // Mobile

    render(<HabitCard habit={mockHabit} />);

    // Open menu
    fireEvent.click(screen.getByLabelText('Habit options menu'));

    // Click View History
    fireEvent.click(screen.getByText('View History'));

    // Check if modal is open
    expect(screen.getByTestId('mock-log-modal')).toBeInTheDocument();
  });
});
