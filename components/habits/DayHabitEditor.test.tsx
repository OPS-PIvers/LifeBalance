import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DayHabitEditor from './DayHabitEditor';
import { Habit, HabitSubmission, HouseholdMember } from '@/types/schema';
import { buildHabitRowMemberContext } from '@/utils/habitRowAttribution';
import { getLocalDateString } from '@/utils/dateHelpers';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('@/utils/haptics', () => ({ haptic: vi.fn() }));

const { ctx } = vi.hoisted(() => ({
  ctx: {
    addHabitSubmission: vi.fn(() => Promise.resolve()),
    resetHabitDay: vi.fn(() => Promise.resolve()),
    deleteHabitSubmission: vi.fn(() => Promise.resolve()),
    getHabitSubmissions: vi.fn((): Promise<HabitSubmission[]> => Promise.resolve([])),
    uncreditHabitCompletion: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => ctx;
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

const PAUL = 'user-1';
const JEN = 'jen-uid';

const member = (uid: string, displayName: string, extra: Partial<HouseholdMember> = {}) => ({
  uid,
  displayName,
  email: `${uid}@example.com`,
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  joinedAt: '2026-01-01T00:00:00Z',
  ...extra,
}) as HouseholdMember;

const TWO_ADULTS = buildHabitRowMemberContext([member(PAUL, 'Paul'), member(JEN, 'Jen')], PAUL);
const ONE_ADULT = buildHabitRowMemberContext([member(PAUL, 'Paul')], PAUL);

/** Wednesday of a fixed week — never derived from the real clock. */
const D = '2026-07-15';
const LABEL = 'Wednesday, July 15';
const MONDAY = '2026-07-13';

const baseHabit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Read',
  category: 'Growth',
  type: 'positive',
  period: 'daily',
  scoringType: 'incremental',
  basePoints: 10,
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-15T12:00:00Z',
  ...overrides,
});

const renderEditor = (props: Partial<React.ComponentProps<typeof DayHabitEditor>> = {}) =>
  render(
    <DayHabitEditor
      habits={[baseHabit()]}
      selectedDate={D}
      selectedLabel={LABEL}
      countForHabitOnDate={() => 0}
      onMutated={() => {}}
      attribution={TWO_ADULTS}
      {...props}
    />
  );

const row = () => screen.getByRole('button', { name: /^Log Read for/ });
const whoButton = () => screen.getByRole('button', { name: /Who did Read on/ });

/** pointerdown → 600ms → pointerup → click, the shape a real hold produces. */
const longPress = (element: HTMLElement) => {
  fireEvent.pointerDown(element, { clientX: 10, clientY: 10, button: 0 });
  act(() => { vi.advanceTimersByTime(600); });
  fireEvent.pointerUp(element);
  fireEvent.click(element);
};

describe('DayHabitEditor — past-day attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.getHabitSubmissions.mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs a plain tap as an explicit SELF credit', async () => {
    renderEditor();
    await act(async () => { fireEvent.click(row()); });

    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);
    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, [PAUL],
    );
  });

  it('opens the picker on a long-press and credits the picked member — without also logging', async () => {
    renderEditor();
    longPress(row());

    expect(screen.getByRole('menu', { name: 'Who completed Read?' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });

    // Exactly ONE call, carrying Jen — the trailing click of the hold must not
    // also fire handleLog.
    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);
    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, [JEN],
    );
  });

  it('credits everyone from the compound row', async () => {
    renderEditor();
    longPress(row());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Both of us/ }));
    });

    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, [PAUL, JEN],
    );
  });

  it('cancels the long-press once the finger passes the slop threshold', () => {
    renderEditor();

    fireEvent.pointerDown(row(), { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(row(), { clientX: 10, clientY: 40 }); // +30px → a scroll
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.pointerUp(row());

    // …but a small wander inside the slop still opens it.
    fireEvent.pointerDown(row(), { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(row(), { clientX: 10, clientY: 20 }); // +10px
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole('menu', { name: 'Who completed Read?' })).toBeInTheDocument();
  });

  it('opens the picker from the trailing control with no long-press at all', () => {
    // A long-press must NEVER be the only path to an action.
    renderEditor();
    const trigger = whoButton();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(screen.getByRole('menu', { name: 'Who completed Read?' })).toBeInTheDocument();
    expect(whoButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the attribution affordance with no roster, one adult, or an archived habit', () => {
    const { rerender } = renderEditor({ attribution: undefined });
    expect(screen.queryByRole('button', { name: /Who did Read on/ })).not.toBeInTheDocument();

    rerender(
      <DayHabitEditor
        habits={[baseHabit()]}
        selectedDate={D}
        selectedLabel={LABEL}
        countForHabitOnDate={() => 0}
        onMutated={() => {}}
        attribution={ONE_ADULT}
      />
    );
    expect(screen.queryByRole('button', { name: /Who did Read on/ })).not.toBeInTheDocument();

    rerender(
      <DayHabitEditor
        habits={[baseHabit({ archivedAt: '2026-07-01T00:00:00Z' })]}
        selectedDate={D}
        selectedLabel={LABEL}
        countForHabitOnDate={() => 0}
        onMutated={() => {}}
        attribution={TWO_ADULTS}
      />
    );
    expect(screen.queryByRole('button', { name: /Who did Read on/ })).not.toBeInTheDocument();
  });

  it('derives credited state from the SELECTED DAY, not the period', () => {
    // A WEEKLY habit whose only unit lives on Monday: the picker for Wednesday
    // must show Jen UNCHECKED, because Wednesday is what undo would target and
    // `uncreditHabitCompletion` no-ops when the member holds nothing there.
    renderEditor({
      habits: [baseHabit({
        period: 'weekly',
        completedDates: [MONDAY],
        completedBy: { [MONDAY]: { [JEN]: 1 } },
      })],
    });
    fireEvent.click(whoButton());

    expect(screen.getByRole('menuitemcheckbox', { name: /Jen/ })).toHaveAttribute(
      'aria-checked', 'false',
    );
    expect(screen.queryByText('Tap to undo')).not.toBeInTheDocument();
  });

  it('renders a member credited ON the selected day as checked, with the undo hint', () => {
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 1 } } })],
    });
    fireEvent.click(whoButton());

    expect(screen.getByRole('menuitemcheckbox', { name: /Jen/ })).toHaveAttribute(
      'aria-checked', 'true',
    );
    expect(screen.getByText('Tap to undo')).toBeInTheDocument();
  });

  it('names the credited members on the trailing control for screen readers', () => {
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 1 } } })],
    });
    expect(
      screen.getByRole('button', { name: `Who did Read on ${LABEL}? Currently Jen` })
    ).toBeInTheDocument();
  });

  it('undoes by DELETING the submission doc that recorded the credit', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      {
        id: 'sub-1', habitId: 'h1', habitTitle: 'Read', timestamp: `${D}T12:00:00`, date: D,
        count: 1, pointsEarned: 10, streakDaysAtTime: 1, multiplierApplied: 1,
        createdBy: PAUL, attributedTo: JEN, createdAt: `${D}T12:00:01`,
      } as HabitSubmission,
    ]);
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 1 } } })],
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });

    expect(ctx.getHabitSubmissions).toHaveBeenCalledWith('h1', D, D);
    expect(ctx.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'sub-1');
    expect(ctx.uncreditHabitCompletion).not.toHaveBeenCalled();
  });

  it('falls back to un-crediting when no submission doc backs the credit', async () => {
    // A Habits-page credit or an automated fire leaves attribution with no doc.
    ctx.getHabitSubmissions.mockResolvedValue([]);
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 1 } } })],
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });

    expect(ctx.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(ctx.uncreditHabitCompletion).toHaveBeenCalledWith('h1', JEN, D);
  });

  it('targets TODAY when today is the selected day (the shared-node case)', async () => {
    const today = getLocalDateString();
    ctx.getHabitSubmissions.mockResolvedValue([]);
    renderEditor({
      selectedDate: today,
      selectedLabel: 'Today',
      habits: [baseHabit({ completedDates: [today], completedBy: { [today]: { [JEN]: 1 } } })],
    });
    fireEvent.click(screen.getByRole('button', { name: /Who did Read on Today/ }));

    expect(screen.getByRole('menuitemcheckbox', { name: /Jen/ })).toHaveAttribute(
      'aria-checked', 'true',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });
    expect(ctx.uncreditHabitCompletion).toHaveBeenCalledWith('h1', JEN, today);
  });

  it('will not issue a second write while one is already in flight', async () => {
    ctx.addHabitSubmission.mockImplementation(() => new Promise<void>(() => {}));
    renderEditor();

    fireEvent.click(whoButton());
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });
    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);

    // Both entry points go disabled while the write is outstanding, so neither
    // a hold nor a click can reach the picker again.
    expect(row()).toBeDisabled();
    expect(whoButton()).toBeDisabled();
    fireEvent.click(whoButton());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);
  });

  it('swallows a second tap that lands before React can disable the row', async () => {
    // The disabled attribute is one render behind; `runGuarded`'s ref-held Set
    // is the guard that actually catches a fast double-tap.
    ctx.addHabitSubmission.mockImplementation(() => new Promise<void>(() => {}));
    renderEditor();

    const target = row();
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);
  });

  it('drops overflow-hidden from the group holding the open picker, and only then', () => {
    // The picker is a non-portalled Popover anchored INSIDE this box; the clip
    // would slice it. Guards the fix against a silent CSS regression.
    const { container } = renderEditor();
    const section = container.querySelector('.surface-section');
    expect(section).not.toBeNull();
    expect(section!.classList.contains('overflow-hidden')).toBe(true);

    fireEvent.click(whoButton());
    expect(
      container.querySelector('.surface-section')!.classList.contains('overflow-hidden')
    ).toBe(false);
  });

  it('still names the tapper explicitly in a ONE-ADULT household (the common shape)', async () => {
    // Most households have a single adult, so there is no picker at all here —
    // but the plain tap must STILL pass `[currentUserId]` rather than falling
    // back to the hook's implicit actor, or the one surface everybody uses would
    // be the one taking the un-stated path.
    renderEditor({ attribution: ONE_ADULT });
    expect(screen.queryByRole('button', { name: /Who did Read on/ })).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(row()); });

    expect(ctx.addHabitSubmission).toHaveBeenCalledTimes(1);
    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, [PAUL],
    );
  });

  it('cancels a pending long-press on pointercancel', () => {
    // The browser fires pointercancel when it takes the gesture over (a scroll
    // hand-off, a system sheet). The timer must not survive it and pop a picker
    // over whatever the user is now looking at.
    renderEditor();

    fireEvent.pointerDown(row(), { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerCancel(row());
    act(() => { vi.advanceTimersByTime(600); });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('prevents the native context menu on a pickable row, and only there', () => {
    // A touch long-press raises the OS context menu on top of our own picker.
    // `fireEvent` returns false when a handler called preventDefault.
    const { rerender } = renderEditor();
    expect(fireEvent.contextMenu(row())).toBe(false);

    // A row with no picker has nothing to protect, so the browser keeps its own
    // menu (text selection, "open in new tab", the accessibility affordances).
    rerender(
      <DayHabitEditor
        habits={[baseHabit()]}
        selectedDate={D}
        selectedLabel={LABEL}
        countForHabitOnDate={() => 0}
        onMutated={() => {}}
        attribution={ONE_ADULT}
      />
    );
    expect(fireEvent.contextMenu(row())).toBe(true);
  });

  it('never shows two pickers at once when a second row is pressed', () => {
    // `pickerHabitId` is a single value, and the Popover's own full-screen
    // backdrop swallows the press that would reach a second row in a real
    // browser. Pinned here because the picker is rendered per-row.
    renderEditor({ habits: [baseHabit(), baseHabit({ id: 'h2', title: 'Walk' })] });

    fireEvent.click(screen.getByRole('button', { name: /Who did Read on/ }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menu', { name: 'Who completed Read?' })).toBeInTheDocument();

    // Hold the OTHER row: the open picker is replaced, never joined.
    longPress(screen.getByRole('button', { name: /^Log Walk for/ }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menu', { name: 'Who completed Walk?' })).toBeInTheDocument();
  });
});
