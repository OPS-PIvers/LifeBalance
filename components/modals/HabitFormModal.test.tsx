import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HabitFormModal from './HabitFormModal';
import { useGamification, useHouseholdCore, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';

// Mock the sliced context hooks the modal consumes.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
  useTodos: vi.fn(),
}));

// Kid Mode off by DEFAULT — the assign control never renders (dormant path).
// A hoisted box rather than a literal `false` so the one suite that needs the
// assign control (the chore/creditMode interaction below) can turn it on; every
// other suite reads the same `false` it always did.
const { kidMode } = vi.hoisted(() => ({ kidMode: { enabled: false } }));
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => kidMode.enabled,
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
      habits: [],
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

  // The chips are the HOUSEHOLD's vocabulary now — the hardcoded defaults are no
  // longer prepended (they're only a fallback for a household with neither a
  // stored list nor a habit), so "Health" has to be real data here.
  const mockGamification = (overrides: Record<string, unknown> = {}) => {
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: vi.fn(),
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habits: [],
      habitCategories: ['Health'],
      updateHabitCategories: vi.fn(),
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGamification();
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  it('lights up the canonical chip when a legacy category differs only in case', async () => {
    // Legacy habit stored "health" (lower-case) — must still select the
    // household's "Health" chip, since the chip-only UI has no text field to
    // show the raw value.
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

  // 🛡️ PAPER CUT #4: the built-in list is no longer prepended. A household that
  // has its own categories must see ONLY its own — a "Work" nobody uses is chip
  // noise the manage drawer could never delete, because it isn't data.
  it('offers only the household vocabulary, not the hardcoded defaults', () => {
    mockGamification({ habitCategories: ['Weekly Goals', 'Household'] });
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    expect(screen.getByRole('button', { name: 'Weekly Goals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Household' })).toBeInTheDocument();
    for (const builtIn of ['Health', 'Finance', 'Personal', 'Home', 'Work']) {
      expect(screen.queryByRole('button', { name: builtIn })).not.toBeInTheDocument();
    }
    // The first chip is the create-mode default.
    expect(screen.getByRole('button', { name: 'Weekly Goals' })).toHaveAttribute('aria-pressed', 'true');
  });

  // 🛡️ PAPER CUT #4: `habitCategories` was append-only and missed categories
  // real habits use, so a new habit could not be created into them at all.
  // Deriving them from the habits themselves heals that with no migration.
  it('backfills a category that only exists on a habit, so a NEW habit can use it', () => {
    mockGamification({
      habitCategories: ['Household'],
      habits: [baseHabit({ id: 'h9', category: 'Food & Nutrition' })],
    });
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    expect(screen.getByRole('button', { name: 'Food & Nutrition' })).toBeInTheDocument();
  });

  it('falls back to the built-ins only when the household has no categories AND no habits', () => {
    mockGamification({ habitCategories: [], habits: [] });
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    expect(screen.getByRole('button', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
  });

  it('guards a category add in flight: disables the control and ignores a second tap', async () => {
    let resolveWrite!: () => void;
    const mockUpdateHabitCategories = vi.fn(() => new Promise<void>(r => { resolveWrite = r; }));
    mockGamification({ habitCategories: [], updateHabitCategories: mockUpdateHabitCategories });

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
      habits: [],
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
      habits: [],
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

// 🔒 Regression (adversarial review, PR #1165). `handleSave` spreads
// `...editingHabit` FIRST, so a stored `creditMode: 'household'` rode into the
// payload even when the Credit control was HIDDEN — which is exactly what
// assigning the habit to a kid does. `updateHabit` then persisted it. Later
// un-assigning the kid re-opened the control ALREADY set to "Household" and
// saved it again: a plain un-assign silently produced a habit that credits
// nobody, from a setting the user was never shown.
//
// Kid Mode is dormant in production, so this is inert today — and the suite-wide
// `useKidModeEnabled` mock is why no existing test could reach it.
describe('HabitFormModal — a chore never carries a stale creditMode (Kid Mode ON)', () => {
  const mockAddHabit = vi.fn();
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();
  const KID = { uid: 'kid-1', displayName: 'Ada', isManaged: true };

  beforeEach(() => {
    vi.clearAllMocks();
    kidMode.enabled = true;
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: mockAddHabit,
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      habits: [],
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [KID] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  afterEach(() => {
    kidMode.enabled = false;
  });

  const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  const lastPayload = (index = 0): Habit =>
    (mockUpdateHabit.mock.calls as unknown[][])[index]![0] as Habit;
  const kidChip = () => screen.getByRole('button', { name: 'Ada' });

  it('the Credit control is hidden once the habit is assigned to a kid', () => {
    render(
      <HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ creditMode: 'household' })} />,
    );
    expect(screen.getByRole('radio', { name: 'Household' })).toBeInTheDocument();

    fireEvent.click(kidChip());

    expect(screen.queryByRole('radio', { name: 'Household' })).not.toBeInTheDocument();
  });

  it('assigning a household habit to a kid PERSISTS "members", not the stale value', async () => {
    render(
      <HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit({ creditMode: 'household' })} />,
    );

    fireEvent.click(kidChip()); // now a chore — the Credit control is gone
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(lastPayload().assignedTo).toBe('kid-1');
    // An EXPLICIT 'members', so `updateHabit` overwrites the stored 'household'
    // rather than dropping the key and leaving it in place.
    expect(lastPayload().creditMode).toBe('members');
  });

  it('assign → save → un-assign → save does NOT resurrect Household', async () => {
    // The full round trip, on a habit that ALREADY carries the stale field the
    // way one saved before this fix would (there is no migration).
    const stale = baseHabit({ assignedTo: 'kid-1', creditMode: 'household' });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={stale} />);

    // The chore's stored value must not pre-select the hidden control…
    expect(screen.queryByRole('radio', { name: 'Household' })).not.toBeInTheDocument();

    fireEvent.click(kidChip()); // un-assign
    // …so when the control reappears it reads "Individuals", not "Household".
    expect(screen.getByRole('radio', { name: 'Individuals' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Household' })).toHaveAttribute('aria-checked', 'false');

    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(lastPayload().assignedTo).toBeUndefined();
    expect(lastPayload().creditMode).toBe('members');
  });

  it('still lets an un-assigned habit be set to Household deliberately', async () => {
    // 🔒 Control: the fix must not make the setting unreachable with Kid Mode on.
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Household' }));
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(lastPayload().creditMode).toBe('household');
    expect(lastPayload().assignedTo).toBeUndefined();
  });
});

// HABIT-SIGN-1: basePoints must always be stored as a positive magnitude —
// the sign is conveyed entirely by `type` (see habitSign/signedHabitPoints in
// utils/habitLogic.ts). This form previously wrote whatever the user typed
// verbatim, so a negative entry on a `type: 'negative'` habit stored a
// "double negative" (the shape production has on "Lights out after
// 10:30pm": type 'negative', basePoints -1) — scoring already canonicalizes
// that shape correctly via Math.abs, but the form itself must not be able to
// (re)create it going forward.
describe('HabitFormModal — basePoints is always saved as a positive magnitude', () => {
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
      habits: [],
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

  it('clamps a negative entry to a positive magnitude on save (negative-type habit)', async () => {
    const habit = baseHabit({ type: 'negative', basePoints: 2 });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={habit} />);

    fireEvent.change(screen.getByLabelText(/points \(magnitude\)/i), { target: { value: '-5' } });
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    const payload = lastUpdatePayload();
    expect(payload.basePoints).toBe(5);
    expect(payload.type).toBe('negative');
  });

  it('re-saving a habit already stored with the legacy negative-basePoints shape normalizes it to a positive magnitude', async () => {
    // The exact production shape: type 'negative', basePoints -1.
    const legacyHabit = baseHabit({ type: 'negative', basePoints: -1 });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={legacyHabit} />);

    // The form seeds the field from the stored value verbatim ("-1")...
    expect(screen.getByLabelText(/points \(magnitude\)/i)).toHaveValue(-1);

    // ...but an unmodified save must still normalize it on write.
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(lastUpdatePayload().basePoints).toBe(1);
  });

  it('leaves a positive entry untouched', async () => {
    const habit = baseHabit({ type: 'positive', basePoints: 10 });
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={habit} />);

    fireEvent.change(screen.getByLabelText(/points \(magnitude\)/i), { target: { value: '15' } });
    save();

    await waitFor(() => expect(mockUpdateHabit).toHaveBeenCalledTimes(1));
    expect(lastUpdatePayload().basePoints).toBe(15);
  });
});

// 🩹 PAPER CUT #5: PR #1230 consolidated create+edit onto this form and retired
// CustomHabitForm, which had carried the only "Delete This Habit" affordance
// inside a habit form. Archive AND delete now live here, edit mode only.
describe('HabitFormModal — archive & delete (edit mode only)', () => {
  const mockArchiveHabit = vi.fn(() => Promise.resolve());
  const mockUnarchiveHabit = vi.fn(() => Promise.resolve());
  const mockDeleteHabit = vi.fn(() => Promise.resolve());
  const mockUpdateHabit = vi.fn(() => Promise.resolve());
  const mockAddHabit = vi.fn(() => Promise.resolve());
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      addHabit: mockAddHabit,
      updateHabit: mockUpdateHabit,
      setHabitPause: vi.fn(() => Promise.resolve()),
      archiveHabit: mockArchiveHabit,
      unarchiveHabit: mockUnarchiveHabit,
      deleteHabit: mockDeleteHabit,
      habits: [],
      habitCategories: [],
      updateHabitCategories: vi.fn(),
    });
    (useHouseholdCore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ members: [] });
    (useTodos as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ todos: [] });
  });

  const deleteTrigger = () => screen.getByRole('button', { name: 'Delete habit: Coffee run' });
  // Scoped to the confirmation dialog: the form's own trigger also matches
  // /delete/i, and the confirm button's accessible name gains a "Loading…"
  // prefix while the write is in flight.
  const confirmButton = () =>
    within(screen.getByRole('dialog', { name: 'Delete habit?' })).getByRole('button', { name: /delete/i });

  it('offers neither control when CREATING — there is nothing to archive or delete', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} />);

    expect(screen.queryByRole('button', { name: /archive habit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete habit:/i })).not.toBeInTheDocument();
  });

  it('archives the habit and closes the form', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive habit' }));

    await waitFor(() => expect(mockArchiveHabit).toHaveBeenCalledWith('h1'));
    expect(mockUnarchiveHabit).not.toHaveBeenCalled();
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
    // No confirmation: archiving is reversible from the very same control.
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('shows the UNarchive affordance for an archived habit and calls unarchiveHabit', async () => {
    render(
      <HabitFormModal
        isOpen
        onClose={mockOnClose}
        editingHabit={baseHabit({ archivedAt: '2026-07-04' })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Archive habit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive habit' }));

    await waitFor(() => expect(mockUnarchiveHabit).toHaveBeenCalledWith('h1'));
    expect(mockArchiveHabit).not.toHaveBeenCalled();
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
  });

  it('deletes only AFTER the confirmation is accepted, then closes', async () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(deleteTrigger());
    // The tap opens the dialog; nothing is written yet.
    expect(mockDeleteHabit).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(mockDeleteHabit).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
  });

  it('cancelling the confirmation deletes nothing and leaves the form open', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(deleteTrigger());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete habit?' })).getByRole('button', { name: 'Cancel' }));

    expect(mockDeleteHabit).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete habit?' })).not.toBeInTheDocument();
  });

  it('keeps the form (and the confirmation) open when the delete write is rejected', async () => {
    mockDeleteHabit.mockRejectedValueOnce(new Error('network down'));
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(deleteTrigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(mockDeleteHabit).toHaveBeenCalledTimes(1));
    // A rejected write must never read as a success: the form stays put so the
    // user can retry, and the confirmation is still on screen.
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('keeps the form open when the archive write is rejected', async () => {
    mockArchiveHabit.mockRejectedValueOnce(new Error('permission denied'));
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive habit' }));

    await waitFor(() => expect(mockArchiveHabit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive habit' })).not.toBeDisabled(),
    );
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('guards a delete in flight: the confirm control disables and a second tap is ignored', async () => {
    let resolveDelete!: () => void;
    mockDeleteHabit.mockReturnValueOnce(new Promise<void>(r => { resolveDelete = r; }));
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(deleteTrigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(mockDeleteHabit).toHaveBeenCalledTimes(1);
    fireEvent.click(confirmButton());
    expect(mockDeleteHabit).toHaveBeenCalledTimes(1);

    resolveDelete();
    await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
  });

  // 🛡️ The confirmation must tell the TRUTH: `deleteHabit` soft-deletes into the
  // 30-day trash, so "this action cannot be undone" was simply false.
  it('promises recovery rather than claiming the delete is permanent', () => {
    render(<HabitFormModal isOpen onClose={mockOnClose} editingHabit={baseHabit()} />);

    fireEvent.click(deleteTrigger());

    expect(screen.getByText(/restore it for 30 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });
});
