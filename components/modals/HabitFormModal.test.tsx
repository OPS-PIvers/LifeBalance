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

// F-HABITS-03: the reminder is written straight to the member doc, so the
// Firestore surface the modal touches is stubbed. `deleteField()` is replaced by
// a recognizable sentinel so a "clear the reminder" write is assertable.
const { updateDocMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(() => Promise.resolve()),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => '__DELETE_FIELD__',
  updateDoc: updateDocMock,
}));
vi.mock('@/firebase.config', () => ({ db: {} }));

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

  it('guards a category add in flight: disables the control and ignores a second tap', async () => {
    let resolveWrite!: () => void;
    const mockUpdateHabitCategories = vi.fn(() => new Promise<void>(r => { resolveWrite = r; }));
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: vi.fn(),
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habitCategories: [],
      updateHabitCategories: mockUpdateHabitCategories,
    });

    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /add a category/i }));
    fireEvent.change(screen.getByLabelText(/new category name/i), { target: { value: 'Yoga' } });
    const confirm = screen.getByRole('button', { name: /confirm new category/i });
    fireEvent.click(confirm);

    // The write is in flight → the confirm control is disabled, so a second tap
    // can't fire a redundant duplicate write.
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(mockUpdateHabitCategories).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm);
    expect(mockUpdateHabitCategories).toHaveBeenCalledTimes(1);

    resolveWrite();
  });
});

describe('HabitFormModal — per-habit reminder save path (F-HABITS-03)', () => {
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();
  const MEMBER_PATH = 'households/test-household/members/u1';

  const mockCore = (notificationPreferences?: Record<string, unknown>) => {
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      members: [],
      householdId: 'test-household',
      currentUser: { uid: 'u1', fcmTokens: ['tok'], notificationPreferences },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: vi.fn(),
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
    mockCore();
  });

  const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  const memberWrite = () => {
    const call = (updateDocMock.mock.calls as unknown[][])[0];
    if (!call) throw new Error('expected a member-doc write');
    return { ref: call[0] as { path: string }, data: call[1] as Record<string, unknown> };
  };

  it('writes only the one habit key, so a concurrent Settings save cannot be clobbered', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    save();

    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    const { ref, data } = memberWrite();
    expect(ref.path).toBe(MEMBER_PATH);
    expect(data['notificationPreferences.perHabitReminders.h1']).toEqual({
      enabled: true,
      time: '08:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    });
    // Never the whole preferences object.
    expect(data).not.toHaveProperty('notificationPreferences');
  });

  it('recomputes the fan-out flag in the same write so it cannot drift', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    save();

    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    expect(memberWrite().data.anyNotificationsEnabled).toBe(true);
  });

  it('clears the key with deleteField when the reminder is switched off', async () => {
    mockCore({ perHabitReminders: { h1: { enabled: true, time: '08:00', days: [1] } } });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    save();

    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    expect(memberWrite().data['notificationPreferences.perHabitReminders.h1']).toBe(
      '__DELETE_FIELD__'
    );
  });

  it('does not touch the member doc when the reminder was not edited', async () => {
    mockCore({ perHabitReminders: { h1: { enabled: true, time: '08:00', days: [1] } } });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('seeds the editor from the stored reminder rather than the default', () => {
    mockCore({ perHabitReminders: { h1: { enabled: true, time: '19:30', days: [0, 6] } } });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    expect(screen.getByLabelText('Time')).toHaveValue('19:30');
    expect(screen.getByText('7:30 PM · Weekends')).toBeInTheDocument();
  });

  it('offers no reminder control when creating a habit, which has no id yet', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} />);
    expect(screen.queryByRole('checkbox', { name: 'Remind me' })).not.toBeInTheDocument();
  });
});

// 🏁 Household credit mode — the Credit control on the habit editor.
describe('HabitFormModal — Credit (household credit mode)', () => {
  const mockAddHabit = vi.fn();
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: mockAddHabit,
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  it('shows the control with its helper copy, defaulting to Individuals', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    expect(
      screen.getByText('Household habits award the household total. Nobody earns individual points.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Individuals' })).toHaveAttribute('aria-checked', 'true');
  });

  it('seeds from the stored creditMode and persists a flip to household', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Household' }));
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = (mockUpdateHabit.mock.calls as unknown[][])[0]![0] as Habit;
    expect(payload.creditMode).toBe('household');
  });

  it('writes an explicit "members" when flipping BACK, so the change sticks', async () => {
    render(
      <HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ creditMode: 'household' })} />,
    );
    expect(screen.getByRole('radio', { name: 'Household' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Individuals' }));
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = (mockUpdateHabit.mock.calls as unknown[][])[0]![0] as Habit;
    // An explicit value, not `undefined` — updateHabit's whitelist drops
    // undefined, which would leave the stored 'household' in place.
    expect(payload.creditMode).toBe('members');
  });

  it('CREATE omits the key entirely for a plain members habit (no migration, nothing new written)', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Homemade meal' } });
    fireEvent.click(screen.getByRole('button', { name: /create habit/i }));

    await waitFor(() => expect(mockAddHabit).toHaveBeenCalledTimes(1));
    const payload = (mockAddHabit.mock.calls as unknown[][])[0]![0] as Habit;
    expect('creditMode' in payload).toBe(false);
  });
});
