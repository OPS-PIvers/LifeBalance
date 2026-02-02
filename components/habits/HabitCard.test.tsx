import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HabitCard from './HabitCard';
import { Habit } from '../../types/schema';

// Mock context
const { mockHouseholdContext } = vi.hoisted(() => ({
  mockHouseholdContext: {
    toggleHabit: vi.fn(),
    deleteHabit: vi.fn(),
    resetHabit: vi.fn(),
    activeChallenge: null,
  }
}));

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockHouseholdContext,
}));

// Mock child modals
vi.mock('../modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />
}));

vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: () => <div data-testid="habit-submission-log-modal" />
}));

// Mock Drawer
vi.mock('../ui/Drawer', () => ({
  Drawer: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title: string }) => isOpen ? (
    <div data-testid="mobile-drawer">
      <h1>{title}</h1>
      {children}
    </div>
  ) : null
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  Flame: () => <span data-testid="icon-flame" />,
  MoreVertical: () => <span data-testid="icon-more-vertical" />,
  Edit2: () => <span data-testid="icon-edit" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Target: () => <span data-testid="icon-target" />,
  Calendar: () => <span data-testid="icon-calendar" />,
}));

const mockHabit: Habit = {
  id: 'h1',
  title: 'Test Habit',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  targetCount: 1,
  count: 0,
  streakDays: 0,
  basePoints: 10,
  completedDates: [],
  lastUpdated: '2023-01-01',
  scoringType: 'threshold',
  weatherSensitive: false,
  totalCount: 0
};

const setupMatchMedia = (isDesktop: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: query === '(min-width: 640px)' ? isDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('HabitCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true); // Default to Desktop
  });

  it('renders dropdown menu on desktop', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Habit options menu'));

    // Check for dropdown content (using role="menu")
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Verify Drawer is NOT present
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument();
  });

  it('renders drawer menu on mobile', async () => {
    setupMatchMedia(false); // Mock Mobile

    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Habit options menu'));

    // Check for Drawer content
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();

    // Verify Dropdown is NOT present
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
