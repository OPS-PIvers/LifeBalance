import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import HabitLogIntent from './HabitLogIntent';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

vi.mock('react-hot-toast', () => {
  const fn = vi.fn() as unknown as { (msg: string, opts?: unknown): void; error: ReturnType<typeof vi.fn> };
  fn.error = vi.fn();
  return { default: fn };
});

const habit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h1',
    title: 'Read 30 mins',
    category: 'Personal',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-24T12:00:00.000Z',
    createdBy: 'u1',
    ...overrides,
  }) as Habit;

const setup = (opts: { habits?: Habit[]; isLoading?: boolean } = {}) => {
  const toggleHabit = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  vi.mocked(useHouseholdCore).mockReturnValue({
    isLoading: opts.isLoading ?? false,
  } as unknown as ReturnType<typeof useHouseholdCore>);
  vi.mocked(useGamification).mockReturnValue({
    habits: opts.habits ?? [habit()],
    toggleHabit,
  } as unknown as ReturnType<typeof useGamification>);
  return { toggleHabit, onDone };
};

describe('HabitLogIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs one unit up for the targeted habit', async () => {
    const { toggleHabit, onDone } = setup();
    render(<HabitLogIntent habitId="h1" onDone={onDone} />);

    await waitFor(() => expect(toggleHabit).toHaveBeenCalledWith('h1', 'up'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('renders nothing', () => {
    const { onDone } = setup();
    const { container } = render(<HabitLogIntent habitId="h1" onDone={onDone} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('passes no TriggerSource, so the log is attributed as a plain manual tap', async () => {
    const { toggleHabit, onDone } = setup();
    render(<HabitLogIntent habitId="h1" onDone={onDone} />);

    await waitFor(() => expect(toggleHabit).toHaveBeenCalled());
    expect(toggleHabit.mock.calls[0]).toHaveLength(2);
  });

  it('waits for the household to load before deciding the habit is missing', async () => {
    // An empty habits list mid-load must not be read as "no such habit" — that
    // would fire a false error on every cold open from a notification.
    const { toggleHabit, onDone } = setup({ habits: [], isLoading: true });
    render(<HabitLogIntent habitId="h1" onDone={onDone} />);

    await Promise.resolve();
    expect(toggleHabit).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports a habit that no longer exists instead of silently doing nothing', async () => {
    const { toggleHabit, onDone } = setup({ habits: [] });
    render(<HabitLogIntent habitId="gone" onDone={onDone} />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That habit no longer exists'));
    expect(toggleHabit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('explains an archived habit rather than letting the no-op look like a bug', async () => {
    const { toggleHabit, onDone } = setup({
      habits: [habit({ archivedAt: '2026-07-01T00:00:00.000Z' })],
    });
    render(<HabitLogIntent habitId="h1" onDone={onDone} />);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Read 30 mins is archived', expect.anything()),
    );
    expect(toggleHabit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('only fires once even if the habits list re-renders', async () => {
    const { toggleHabit, onDone } = setup();
    const { rerender } = render(<HabitLogIntent habitId="h1" onDone={onDone} />);
    await waitFor(() => expect(toggleHabit).toHaveBeenCalledTimes(1));

    // The habits listener rebuilds every habit object on each snapshot, so a new
    // array identity must not re-trigger the log.
    vi.mocked(useGamification).mockReturnValue({
      habits: [habit()],
      toggleHabit,
    } as unknown as ReturnType<typeof useGamification>);
    rerender(<HabitLogIntent habitId="h1" onDone={onDone} />);

    await Promise.resolve();
    expect(toggleHabit).toHaveBeenCalledTimes(1);
  });
});
