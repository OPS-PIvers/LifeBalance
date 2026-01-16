
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Habits from './Habits';
import { generateCsvExport } from '../utils/exportUtils';
import { Habit } from '../types/schema';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child components to simplify testing
vi.mock('../components/habits/HabitCard', () => ({
  default: ({ habit }: { habit: Habit }) => <div data-testid="habit-card">{habit.title}</div>,
}));

vi.mock('../components/modals/HabitCreatorWizard', () => ({
  default: () => <div data-testid="habit-wizard" />,
}));

// Mock the household context
const mockHabits = [
  {
    id: '1',
    title: 'Drink Water',
    category: 'Health',
    type: 'positive',
    period: 'daily',
    count: 2,
    targetCount: 8,
    streakDays: 5,
    totalCount: 50,
    completedDates: ['2023-01-01', '2023-01-02'],
    lastUpdated: '2023-01-02T10:00:00.000Z',
    scoringType: 'incremental',
    basePoints: 10,
  },
  {
    id: '2',
    title: 'Exercise',
    category: 'Fitness',
    type: 'positive',
    period: 'weekly',
    count: 1,
    targetCount: 3,
    streakDays: 2,
    totalCount: 15,
    completedDates: ['2023-01-01'],
    lastUpdated: null,
    scoringType: 'threshold',
    basePoints: 50,
  },
];

const mockUseHousehold = vi.fn(() => ({
  habits: mockHabits,
}));

vi.mock('../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockUseHousehold(),
}));

describe('Habits Page Export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the export button', () => {
    render(<Habits />);
    const exportButton = screen.getByRole('button', { name: /export habits to csv/i });
    expect(exportButton).toBeInTheDocument();
    expect(exportButton).not.toBeDisabled();
  });

  it('calls generateCsvExport with correct data when export button is clicked', () => {
    render(<Habits />);
    const exportButton = screen.getByRole('button', { name: /export habits to csv/i });
    fireEvent.click(exportButton);

    expect(generateCsvExport).toHaveBeenCalledTimes(1);

    // Verify the data passed to generateCsvExport
    const callArgs = vi.mocked(generateCsvExport).mock.calls[0];
    const exportData = callArgs[0];
    const filename = callArgs[1];

    expect(filename).toBe('habits-export');
    expect(exportData).toHaveLength(2);

    // Verify first item (sorted by Category then Title: Fitness/Exercise comes before Health/Drink Water)
    // Actually, 'Fitness' comes before 'Health', so Exercise should be first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exerciseItem = exportData.find((d: any) => d.Title === 'Exercise');
    expect(exerciseItem).toEqual({
      'Title': 'Exercise',
      'Category': 'Fitness',
      'Type': 'Positive',
      'Period': 'Weekly',
      'Current Count': 1,
      'Target Count': 3,
      'Streak Days': 2,
      'Lifetime Count': 15,
      'Total Completions (Days)': 1,
      'Last Updated': 'N/A',
      'Scoring Type': 'threshold',
      'Base Points': 50,
    });

    // Verify second item
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waterItem = exportData.find((d: any) => d.Title === 'Drink Water');
    expect(waterItem).toEqual({
      'Title': 'Drink Water',
      'Category': 'Health',
      'Type': 'Positive',
      'Period': 'Daily',
      'Current Count': 2,
      'Target Count': 8,
      'Streak Days': 5,
      'Lifetime Count': 50,
      'Total Completions (Days)': 2,
      'Last Updated': '2023-01-02', // Local date from '2023-01-02T10:00:00.000Z'
      'Scoring Type': 'incremental',
      'Base Points': 10,
    });
  });

  it('disables export button when there are no habits', () => {
    mockUseHousehold.mockReturnValueOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      habits: [] as any,
    });

    render(<Habits />);
    const exportButton = screen.getByRole('button', { name: /export habits to csv/i });
    expect(exportButton).toBeDisabled();
  });
});
