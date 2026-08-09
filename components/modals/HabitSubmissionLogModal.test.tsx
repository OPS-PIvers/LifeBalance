import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HabitSubmissionLogModal from './HabitSubmissionLogModal';
import type { Habit, HabitSubmission } from '@/types/schema';

// `getHabitSubmissions` never rejects in production (see the module's own
// doc comment) — the modal's timeout/retry logic is what has to fail
// gracefully instead, so this is the one surface these tests exercise.
const mockGetHabitSubmissions = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: () => ({
    getHabitSubmissions: mockGetHabitSubmissions,
    addHabitSubmission: vi.fn(),
    updateHabitSubmission: vi.fn(),
    deleteHabitSubmission: vi.fn(),
  }),
}));

// Matches the module-private `SUBMISSION_LOAD_TIMEOUT_MS` constant in
// HabitSubmissionLogModal.tsx (not exported — kept in lockstep here).
const SUBMISSION_LOAD_TIMEOUT_MS = 15_000;

const baseHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h-1',
    title: 'Workout',
    category: 'Health',
    type: 'positive',
    period: 'daily',
    scoringType: 'threshold',
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-15T12:00:00Z',
    ...overrides,
  } as unknown as Habit);

const submission = (overrides: Partial<HabitSubmission> = {}): HabitSubmission => ({
  id: 'sub-1',
  habitId: 'h-1',
  habitTitle: 'Workout',
  timestamp: '2026-07-28T20:00:00.000Z',
  date: '2026-07-28',
  count: 1,
  pointsEarned: 10,
  streakDaysAtTime: 1,
  multiplierApplied: 1,
  createdBy: 'paul',
  createdAt: '2026-07-28T20:00:00.000Z',
  ...overrides,
});

const renderModal = (habit: Habit = baseHabit()) =>
  render(<HabitSubmissionLogModal isOpen onClose={vi.fn()} habit={habit} />);

describe('HabitSubmissionLogModal — load timeout & retry', () => {
  beforeEach(() => {
    mockGetHabitSubmissions.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads and renders a submission when the fetch resolves normally (positive control)', async () => {
    // count:1 → the row's own "×1" multiplier badge. The day-total header
    // badge in the same group also happens to read "+10 pts" for a single
    // submission, so assert on the count badge (unique to the row) rather
    // than the points figure, which `getByText` would find twice.
    mockGetHabitSubmissions.mockResolvedValue([submission({ id: 'sub-normal', count: 1, pointsEarned: 10 })]);

    renderModal();

    expect(await screen.findByText('×1')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load history")).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('shows a retryable error panel instead of spinning forever when the fetch never settles', async () => {
    vi.useFakeTimers();
    mockGetHabitSubmissions.mockImplementation(() => new Promise<HabitSubmission[]>(() => {}));

    renderModal();

    // The spinner is up while the race is still pending.
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBMISSION_LOAD_TIMEOUT_MS);
    });

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load history")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries successfully: a second fetch that resolves clears the error and renders the submission', async () => {
    vi.useFakeTimers();
    mockGetHabitSubmissions
      .mockImplementationOnce(() => new Promise<HabitSubmission[]>(() => {}))
      .mockImplementationOnce(async () => [submission({ id: 'sub-retry', count: 2, pointsEarned: 25 })]);

    renderModal();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBMISSION_LOAD_TIMEOUT_MS);
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Couldn't load history")).not.toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('does not let a stale, still-in-flight first call clobber a later successful load (generation guard)', async () => {
    // NOTE on why this doesn't use the timeout/Retry path: once the timeout
    // branch of `Promise.race` wins, the loser promise (the real
    // `getHabitSubmissions()` call) becomes inert — JS ignores a settle on an
    // already-settled `Promise.race`, so a first call resolving *after* its
    // own timeout can never reach `setSubmissions`/`setLoadError` regardless
    // of the generation guard. The guard instead protects the case where a
    // SECOND load starts (e.g. the user closes and reopens the modal) while
    // the first is still genuinely in flight, and the two settle out of
    // order — reproduced directly here with a deferred first promise.
    vi.useFakeTimers();
    let resolveFirst!: (subs: HabitSubmission[]) => void;
    const firstCall = new Promise<HabitSubmission[]>((resolve) => {
      resolveFirst = resolve;
    });
    mockGetHabitSubmissions
      .mockImplementationOnce(() => firstCall)
      .mockImplementationOnce(async () => [submission({ id: 'sub-B', count: 3, pointsEarned: 20 })]);

    const habit = baseHabit();
    const { rerender } = render(<HabitSubmissionLogModal isOpen onClose={vi.fn()} habit={habit} />);
    expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(1);

    // The user closes and reopens the modal well before the first fetch
    // (still stuck on `firstCall`, nowhere near its own 15s timeout) settles.
    // This re-fires the load effect and starts a second, independent
    // generation while the first is still outstanding.
    rerender(<HabitSubmissionLogModal isOpen={false} onClose={vi.fn()} habit={habit} />);
    rerender(<HabitSubmissionLogModal isOpen onClose={vi.fn()} habit={habit} />);
    await act(async () => {});

    expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(2);
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load history")).not.toBeInTheDocument();

    // The original (first, still-pending) call finally resolves with a
    // DIFFERENT submission A (×7). Without the generation guard this would
    // overwrite the list the second, already-settled load just populated.
    await act(async () => {
      resolveFirst([submission({ id: 'sub-A', count: 7, pointsEarned: 99 })]);
    });

    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.queryByText('×7')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load history")).not.toBeInTheDocument();
  });
});
