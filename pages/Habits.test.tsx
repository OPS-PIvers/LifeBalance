/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Habits from './Habits';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { generateCsvExport } from '../utils/exportUtils';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('../utils/exportUtils', () => ({
  generateCsvExport: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock HabitCreatorWizard to avoid rendering complex child components
vi.mock('../components/modals/HabitCreatorWizard', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="habit-wizard">Wizard</div> : null
}));

// Mock HabitCard
vi.mock('../components/habits/HabitCard', () => ({
  default: ({ habit }: { habit: any }) => (
    <div data-testid={`habit-card-${habit.id}`}>{habit.title}</div>
  )
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Settings: () => <div data-testid="settings-icon" />,
  Database: () => <div data-testid="database-icon" />,
  ArrowRight: () => <div data-testid="arrow-right-icon" />,
  Download: () => <div data-testid="download-icon" />,
}));

describe('Habits Page Export', () => {
  const mockHabits = [
    {
      id: '1',
      title: 'Morning Jog',
      category: 'Health',
      type: 'positive',
      basePoints: 10,
      scoringType: 'threshold',
      period: 'daily',
      targetCount: 1,
      count: 1,
      totalCount: 50,
      completedDates: ['2023-01-01', '2023-01-02'],
      streakDays: 5,
      lastUpdated: '2023-01-02'
    },
    {
      id: '2',
      title: 'Read Book',
      category: 'Learning',
      type: 'positive',
      basePoints: 5,
      scoringType: 'incremental',
      period: 'weekly',
      targetCount: 3,
      count: 2,
      totalCount: 20,
      completedDates: ['2023-01-01'],
      streakDays: 2,
      lastUpdated: '2023-01-01'
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the export button', () => {
    (useHousehold as any).mockReturnValue({
      habits: mockHabits,
    });

    render(<Habits />);
    expect(screen.getByLabelText('Export habits to CSV')).toBeInTheDocument();
  });

  it('calls generateCsvExport with correct data when export button is clicked', () => {
    (useHousehold as any).mockReturnValue({
      habits: mockHabits,
    });

    render(<Habits />);

    const exportBtn = screen.getByLabelText('Export habits to CSV');
    fireEvent.click(exportBtn);

    expect(generateCsvExport).toHaveBeenCalledTimes(1);

    // Check arguments
    const [exportedData, filenamePrefix] = (generateCsvExport as any).mock.calls[0];

    expect(filenamePrefix).toBe('habits-export');
    expect(exportedData).toHaveLength(2);

    const jogHabit = exportedData.find((d: any) => d.Title === 'Morning Jog');
    expect(jogHabit).toBeDefined();
    expect(jogHabit.Category).toBe('Health');
    expect(jogHabit['Streak (Days)']).toBe(5);
    expect(jogHabit['Total Completions']).toBe(50);
    expect(jogHabit.Period).toBe('daily');

    const readHabit = exportedData.find((d: any) => d.Title === 'Read Book');
    expect(readHabit).toBeDefined();
    expect(readHabit.Category).toBe('Learning');
    expect(readHabit['Streak (Days)']).toBe(2);
  });

  it('disables export button when no habits exist', () => {
    (useHousehold as any).mockReturnValue({
      habits: [],
    });

    render(<Habits />);
    const exportBtn = screen.getByLabelText('Export habits to CSV');
    expect(exportBtn).toBeDisabled();
  });
});
