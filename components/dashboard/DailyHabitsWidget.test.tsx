import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { format, startOfToday, subDays } from 'date-fns';
import type { Habit } from '@/types/schema';
import { DailyHabitsWidget } from './DailyHabitsWidget';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
}));

const TODAY = format(startOfToday(), 'yyyy-MM-dd');
const daysAgo = (n: number) => format(subDays(startOfToday(), n), 'yyyy-MM-dd');

const makeHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h',
    title: 'Habit',
    category: 'General',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    order: 500,
    lastUpdated: `${TODAY}T00:00:00.000Z`,
    ...overrides,
  } as unknown as Habit);

const renderWith = (habits: Habit[]) => {
  vi.mocked(useGamification).mockReturnValue({
    habits,
    toggleHabit: vi.fn(),
  } as unknown as ReturnType<typeof useGamification>);
  const { container } = render(
    <MemoryRouter>
      <DailyHabitsWidget />
    </MemoryRouter>
  );
  // Habit titles render as the semibold truncated <p> in each row.
  return Array.from(container.querySelectorAll('p.font-semibold')).map(p =>
    p.textContent?.trim()
  );
};

describe('DailyHabitsWidget smart ranking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ranks a bigger active streak above a smaller one', () => {
    const order = renderWith([
      makeHabit({ id: 'a', title: 'Small streak', streakDays: 2, order: 1 }),
      makeHabit({ id: 'b', title: 'Big streak', streakDays: 9, order: 2 }),
    ]);
    expect(order).toEqual(['Big streak', 'Small streak']);
  });

  it('ranks any active/at-risk streak above a no-streak habit, ignoring manual order', () => {
    const order = renderWith([
      makeHabit({ id: 'a', title: 'No streak', streakDays: 0, order: 1 }),
      makeHabit({ id: 'b', title: 'Has streak', streakDays: 1, order: 999 }),
    ]);
    expect(order).toEqual(['Has streak', 'No streak']);
  });

  it('sinks completed-today habits below incomplete ones', () => {
    const order = renderWith([
      makeHabit({ id: 'a', title: 'Done today', streakDays: 9, completedDates: [TODAY], order: 1 }),
      makeHabit({ id: 'b', title: 'Not done', streakDays: 0, order: 2 }),
    ]);
    expect(order).toEqual(['Not done', 'Done today']);
  });

  it('breaks no-streak ties by recency, then frequency', () => {
    const order = renderWith([
      makeHabit({ id: 'a', title: 'Older', streakDays: 0, completedDates: [daysAgo(10)], order: 1 }),
      makeHabit({ id: 'b', title: 'Recent', streakDays: 0, completedDates: [daysAgo(2)], order: 2 }),
    ]);
    expect(order).toEqual(['Recent', 'Older']);
  });

  it('excludes weekly habits and kid-assigned chores', () => {
    const order = renderWith([
      makeHabit({ id: 'a', title: 'Daily one', streakDays: 0 }),
      makeHabit({ id: 'b', title: 'Weekly one', period: 'weekly', streakDays: 5 }),
      makeHabit({ id: 'c', title: 'Kid chore', assignedTo: 'kid-1', streakDays: 5 }),
    ]);
    expect(order).toEqual(['Daily one']);
  });
});
