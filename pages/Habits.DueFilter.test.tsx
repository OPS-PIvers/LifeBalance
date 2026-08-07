import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Habits from './Habits';
import type { Habit } from '@/types/schema';

/**
 * F-HABITS-03 — the `?due=<id>,<id>` deep link a per-habit reminder push opens
 * with. The push already names the habits it nudged about; landing on the full
 * list would make the user hunt for them again.
 */

const searchParams = { current: new URLSearchParams() };
const setSearchParams = vi.fn(
  (updater: (prev: URLSearchParams) => URLSearchParams, _options?: { replace?: boolean }) => {
    searchParams.current = updater(new URLSearchParams(searchParams.current));
  }
);

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ key: 'default', pathname: '/habits', state: null }),
  useSearchParams: () => [searchParams.current, setSearchParams],
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/habits/HabitCard', () => ({
  default: ({ habit }: { habit: Habit }) => <div data-testid="habit-card">{habit.title}</div>,
}));

vi.mock('@/components/modals/HabitCreatorWizard', () => ({
  default: () => <div data-testid="habit-wizard" />,
}));

// The page now owns the shared habit form (create + edit) as a sibling of the
// wizard, so it mounts on every render. Stubbed like the wizard above — these
// suites assert on the habit list, not on the form.
vi.mock('@/components/modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />,
}));

const habit = (id: string, title: string, category: string): Habit =>
  ({
    id,
    title,
    category,
    type: 'positive',
    period: 'daily',
    count: 0,
    targetCount: 1,
    streakDays: 0,
    totalCount: 0,
    completedDates: [],
    lastUpdated: '2026-07-24T10:00:00.000Z',
    scoringType: 'threshold',
    basePoints: 10,
  }) as Habit;

const mockHabits = [
  habit('h1', 'Morning run', 'Fitness'),
  habit('h2', 'Vitamins', 'Health'),
  habit('h3', 'Read 30 mins', 'Mind'),
];

const mockUseHousehold = vi.fn(() => ({ habits: mockHabits, members: [] }));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

const renderedTitles = () =>
  screen.getAllByTestId('habit-card').map((node) => node.textContent);

describe('Habits page — reminder deep-link filter (F-HABITS-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.current = new URLSearchParams();
  });

  it('shows every habit when no reminder link is present', () => {
    render(<Habits />);
    expect(renderedTitles()).toEqual(['Morning run', 'Vitamins', 'Read 30 mins']);
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  it('narrows the list to the habits the push named', () => {
    searchParams.current = new URLSearchParams('due=h1,h3');
    render(<Habits />);
    expect(renderedTitles()).toEqual(['Morning run', 'Read 30 mins']);
  });

  it('says how many habits are showing so a filtered list is never mistaken for all of them', () => {
    searchParams.current = new URLSearchParams('due=h1,h3');
    render(<Habits />);
    expect(screen.getByText('From your reminder: 2 habits')).toBeInTheDocument();
  });

  it('singularizes the count for a one-habit reminder', () => {
    searchParams.current = new URLSearchParams('due=h2');
    render(<Habits />);
    expect(screen.getByText('From your reminder: 1 habit')).toBeInTheDocument();
  });

  it('drops the param when "Show all" is tapped', () => {
    searchParams.current = new URLSearchParams('due=h1');
    render(<Habits />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(setSearchParams).toHaveBeenCalledTimes(1);
    expect(searchParams.current.has('due')).toBe(false);
    // Replace, not push: "Show all" is a correction, not a step to go back over.
    expect(setSearchParams.mock.calls[0]![1]).toEqual({ replace: true });
  });

  // A habit deleted between the push and the tap must not strand the user on an
  // empty page — degrade to the normal list instead.
  it('ignores a link whose habits no longer exist', () => {
    searchParams.current = new URLSearchParams('due=gone,alsogone');
    render(<Habits />);
    expect(renderedTitles()).toEqual(['Morning run', 'Vitamins', 'Read 30 mins']);
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  // No banner renders for an all-stale link, so there'd be no "Show all" to
  // clear the param — the page has to drop it itself.
  it('drops a fully stale param instead of leaving it stuck in the URL', () => {
    searchParams.current = new URLSearchParams('due=gone,alsogone');
    render(<Habits />);
    expect(setSearchParams).toHaveBeenCalledTimes(1);
    expect(searchParams.current.has('due')).toBe(false);
  });

  it('leaves a resolving param alone', () => {
    searchParams.current = new URLSearchParams('due=h1');
    render(<Habits />);
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it('keeps the habits that do resolve when only some of the ids are stale', () => {
    searchParams.current = new URLSearchParams('due=h2,gone');
    render(<Habits />);
    expect(renderedTitles()).toEqual(['Vitamins']);
  });

  // The two views can't both hold — a reminder never names an archived habit —
  // so asking for archived habits suspends the filter instead of intersecting to
  // nothing and reporting "0 habits".
  it('suspends the filter while archived habits are showing, and restores it after', () => {
    searchParams.current = new URLSearchParams('due=h1');
    render(<Habits />);
    expect(screen.getByText('From your reminder: 1 habit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /habit actions menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show archived habits' }));
    expect(screen.queryByText(/From your reminder/)).not.toBeInTheDocument();
    // Suspended, not discarded: the link is still in the URL.
    expect(searchParams.current.get('due')).toBe('h1');

    fireEvent.click(screen.getByRole('button', { name: /habit actions menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show active habits' }));
    expect(screen.getByText('From your reminder: 1 habit')).toBeInTheDocument();
  });

  it('ignores an empty due param', () => {
    searchParams.current = new URLSearchParams('due=');
    render(<Habits />);
    expect(renderedTitles()).toHaveLength(3);
  });
});
