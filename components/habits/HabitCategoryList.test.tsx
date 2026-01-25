import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import HabitCategoryList from './HabitCategoryList';
import { Habit } from '../../types/schema';

// Use vi.hoisted to handle mock variables that need to be accessed in mock factories
const { mockReorderHabits } = vi.hoisted(() => {
  return { mockReorderHabits: vi.fn().mockResolvedValue(undefined) };
});

// Mock framer-motion components
// Avoid using React types in the mock factory as it is hoisted above imports
vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children, className }: any) => (
      <div className={className} data-testid="reorder-group">
        {children}
      </div>
    ),
    Item: ({ children, value, dragListener, dragControls, onDragEnd, style, className }: any) => (
      <div
        data-testid="reorder-item"
        className={className}
        style={style}
      >
        {children}
      </div>
    ),
  },
  useDragControls: () => ({
    start: vi.fn(),
  }),
}));

// Mock icons
vi.mock('lucide-react', () => ({
  GripVertical: () => <span data-testid="grip-icon">Grip</span>,
}));

// Mock HabitCard
vi.mock('./HabitCard', () => ({
  default: ({ habit, dragHandle }: { habit: Habit; dragHandle: any }) => (
    <div data-testid={`habit-card-${habit.id}`}>
      <span>{habit.title}</span>
      {dragHandle}
    </div>
  ),
}));

// Mock useHousehold
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    reorderHabits: mockReorderHabits,
  }),
}));

const createMockHabit = (id: string, title: string, order?: number): Habit => ({
  id,
  title,
  category: 'Health',
  type: 'positive',
  basePoints: 10,
  scoringType: 'incremental',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: new Date().toISOString(),
  order,
});

describe('HabitCategoryList', () => {
  const habits = [
    createMockHabit('1', 'Drink Water', 0),
    createMockHabit('2', 'Exercise', 1),
    createMockHabit('3', 'Read', 2),
  ];

  it('renders all habits in the list', () => {
    render(<HabitCategoryList category="Health" habits={habits} />);

    expect(screen.getByTestId('reorder-group')).toBeInTheDocument();
    expect(screen.getAllByTestId('reorder-item')).toHaveLength(3);

    habits.forEach(habit => {
      expect(screen.getByTestId(`habit-card-${habit.id}`)).toBeInTheDocument();
      expect(screen.getByText(habit.title)).toBeInTheDocument();
    });
  });

  it('renders drag handles for each item', () => {
    render(<HabitCategoryList category="Health" habits={habits} />);

    const dragHandles = screen.getAllByTestId('grip-icon');
    expect(dragHandles).toHaveLength(3);
  });

  it('updates the list when habits prop changes', () => {
    const { rerender } = render(<HabitCategoryList category="Health" habits={habits} />);

    expect(screen.getAllByTestId('reorder-item')).toHaveLength(3);

    const newHabits = [
      ...habits,
      createMockHabit('4', 'Meditate', 3),
    ];

    rerender(<HabitCategoryList category="Health" habits={newHabits} />);

    expect(screen.getAllByTestId('reorder-item')).toHaveLength(4);
    expect(screen.getByText('Meditate')).toBeInTheDocument();
  });
});
