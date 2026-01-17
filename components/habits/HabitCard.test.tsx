import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HabitCard from './HabitCard';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Habit } from '../../types/schema';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

// Mock Child Modals
vi.mock('../modals/HabitFormModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="edit-modal">Edit Modal</div> : null
}));

vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="log-modal">Log Modal</div> : null
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
  Flame: () => <div data-testid="flame-icon" />,
  MoreVertical: () => <div data-testid="more-vertical-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Target: () => <div data-testid="target-icon" />,
  Calendar: () => <div data-testid="calendar-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
}));

describe('HabitCard', () => {
  const mockToggleHabit = vi.fn();
  const mockDeleteHabit = vi.fn();
  const mockResetHabit = vi.fn();
  const mockAddHabit = vi.fn();

  const mockHabit: Habit = {
    id: 'habit-1',
    title: 'Drink Water',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 8,
    count: 2,
    totalCount: 100,
    completedDates: ['2023-01-01'],
    streakDays: 5,
    lastUpdated: '2023-01-02T12:00:00Z',
    isShared: true,
    hasSubmissionTracking: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHousehold).mockReturnValue({
      toggleHabit: mockToggleHabit,
      deleteHabit: mockDeleteHabit,
      resetHabit: mockResetHabit,
      addHabit: mockAddHabit,
      activeChallenge: null,
    } as unknown as ReturnType<typeof useHousehold>);
  });

  it('renders habit details correctly', () => {
    render(<HabitCard habit={mockHabit} />);
    expect(screen.getByText('Drink Water')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Current count
  });

  it('opens menu and shows options', () => {
    render(<HabitCard habit={mockHabit} />);

    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('View Log')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('duplicates habit when "Duplicate" is clicked', async () => {
    render(<HabitCard habit={mockHabit} />);

    // Open menu
    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    // Click Duplicate
    const duplicateButton = screen.getByText('Duplicate');
    fireEvent.click(duplicateButton);

    // Verify addHabit was called with correct data
    await waitFor(() => {
      expect(mockAddHabit).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Drink Water (Copy)',
        category: 'Health',
        type: 'positive',
        basePoints: 10,
        count: 0,
        totalCount: 0,
        completedDates: [],
        streakDays: 0,
      }));

      const callArgs = mockAddHabit.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('id');
      expect(callArgs).not.toHaveProperty('hasSubmissionTracking');
    });
  });
});
