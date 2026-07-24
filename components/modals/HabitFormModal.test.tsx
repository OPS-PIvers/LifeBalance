import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HabitFormModal from './HabitFormModal';
import { useGamification, useHouseholdCore, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';

// Mock the sliced context hooks the modal consumes.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
  useTodos: vi.fn(),
}));

// Kid Mode off — the assign control never renders (dormant path).
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => false,
}));

// Stub the Automations section with a controllable harness so this test targets
// the save-payload CONTRACT (how HabitFormModal builds `triggers`) rather than
// the section's own keyword/geolocation UI (covered by its own units). The stub
// exposes buttons that drive the controlled keyword state up to the modal.
vi.mock('@/components/habits/HabitAutomationsSection', () => ({
  default: ({
    keywords,
    onKeywordsChange,
    onLocationsChange,
  }: {
    keywords: string[];
    onKeywordsChange: (k: string[]) => void;
    onLocationsChange: (l: unknown[]) => void;
  }) => (
    <div>
      <span data-testid="kw">{keywords.join(',')}</span>
      <button type="button" onClick={() => onKeywordsChange([...keywords, 'coffee'])}>
        add-kw
      </button>
      <button
        type="button"
        onClick={() => {
          onKeywordsChange([]);
          onLocationsChange([]);
        }}
      >
        clear-automations
      </button>
    </div>
  ),
}));

const baseHabit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Coffee run',
  category: 'Health',
  type: 'positive',
  basePoints: 10,
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('HabitFormModal — Automations save-payload contract (PRD #1065)', () => {
  const mockAddHabit = vi.fn();
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockSetHabitPause = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: mockAddHabit,
      updateHabit: mockUpdateHabit,
      setHabitPause: mockSetHabitPause,
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  const lastUpdatePayload = (): Habit => {
    const call = (mockUpdateHabit.mock.calls as unknown[][])[0];
    if (!call) throw new Error('expected updateHabit to have been called');
    return call[0] as Habit;
  };

  it('carries stored triggers forward unchanged on an untouched edit (key present + populated)', async () => {
    const triggers = { keywords: ['target'], locations: [{ id: 'l1', name: 'Target', lat: 1, lng: 2, radiusMeters: 150 }] };
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ triggers })} />);

    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = lastUpdatePayload();
    expect('triggers' in payload).toBe(true);
    expect(payload.triggers).toEqual(triggers);
  });

  it('clearing the last automation sends the triggers key present with an undefined value (routes to deleteField)', async () => {
    const triggers = { keywords: ['target'], locations: [] };
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ triggers })} />);

    fireEvent.click(screen.getByRole('button', { name: 'clear-automations' }));
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = lastUpdatePayload();
    // hasOwnProperty semantics: the key must be PRESENT (so updateHabit clears
    // the stored field) but its value undefined (nothing configured anymore).
    expect(Object.prototype.hasOwnProperty.call(payload, 'triggers')).toBe(true);
    expect(payload.triggers).toBeUndefined();
  });

  it('adding a keyword to a trigger-less habit builds a populated triggers object', async () => {
    const habit = baseHabit();
    expect('triggers' in habit).toBe(false);
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={habit} />);

    fireEvent.click(screen.getByRole('button', { name: 'add-kw' }));
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = lastUpdatePayload();
    expect(payload.triggers).toEqual({ keywords: ['coffee'] });
  });

  it('does not attach a triggers key when creating a new habit', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'New habit' } });
    fireEvent.click(screen.getByRole('button', { name: /create habit/i }));

    await waitFor(() => expect(mockAddHabit).toHaveBeenCalledTimes(1));
    const call = (mockAddHabit.mock.calls as unknown[][])[0];
    if (!call) throw new Error('expected addHabit to have been called');
    const payload = call[0] as Habit;
    expect('triggers' in payload).toBe(false);
  });

  it('does not clobber unsaved keyword state when editingHabit is a new object with the same id (concurrent listener rebuild)', async () => {
    const habit = baseHabit({ triggers: { keywords: ['target'] } });
    const { rerender } = render(
      <HabitFormModal isOpen onClose={mockOnClose} editingHabit={habit} />,
    );

    // Simulate the user adding an unsaved keyword mid-edit.
    fireEvent.click(screen.getByRole('button', { name: 'add-kw' }));
    expect(screen.getByTestId('kw').textContent).toBe('target,coffee');

    // Simulate a concurrent Firestore snapshot: same habit id, but the
    // listener rebuilt a BRAND NEW object reference (as it does on every
    // snapshot) with unrelated fields changed. This must NOT reset the form.
    const rebuiltSameHabit = baseHabit({
      triggers: { keywords: ['target'] },
      lastUpdated: '2026-07-02T00:00:00.000Z',
    });
    expect(rebuiltSameHabit).not.toBe(habit);
    rerender(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={rebuiltSameHabit} />);

    expect(screen.getByTestId('kw').textContent).toBe('target,coffee');
  });
});

describe('HabitFormModal — category chip seeding', () => {
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: vi.fn(),
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  it('lights up the canonical chip when a legacy category differs only in case', async () => {
    // Legacy habit stored "health" (lower-case) — must still select the
    // "Health" default chip, since the chip-only UI has no text field to show
    // the raw value.
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ category: 'health' })} />);

    const healthChip = screen.getByRole('button', { name: 'Health' });
    expect(healthChip).toHaveAttribute('aria-pressed', 'true');

    // Saving untouched normalizes the stored value to the canonical casing.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const call = (mockUpdateHabit.mock.calls as unknown[][])[0];
    if (!call) throw new Error('expected updateHabit to have been called');
    expect((call[0] as Habit).category).toBe('Health');
  });

  it('renders an unmatched legacy category as its own selected chip', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ category: 'Meditation' })} />);
    const chip = screen.getByRole('button', { name: 'Meditation' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});
