import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DayHabitEditor from './DayHabitEditor';
import { Habit, HabitSubmission, HouseholdMember } from '@/types/schema';
import { buildHabitRowMemberContext } from '@/utils/habitRowAttribution';
import { getLocalDateString } from '@/utils/dateHelpers';
import { pointsForHabitOnDate } from '@/utils/habitLogic';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('@/utils/haptics', () => ({ haptic: vi.fn() }));

const { ctx } = vi.hoisted(() => ({
  ctx: {
    addHabitSubmission: vi.fn(() => Promise.resolve()),
    resetHabitDay: vi.fn(() => Promise.resolve()),
    deleteHabitSubmission: vi.fn(() => Promise.resolve()),
    getHabitSubmissions: vi.fn((): Promise<HabitSubmission[]> => Promise.resolve([])),
    uncreditHabitCompletion: vi.fn(() => Promise.resolve()),
    uncreditHouseholdCompletion: vi.fn(() => Promise.resolve()),
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

    // An archived habit only reaches the list at all when it HOLDS units on the
    // day (count > 0), so this case must be probed that way — with count 0 the
    // row is filtered out entirely and the assertion would pass for the wrong
    // reason, silently retiring the `canPick` archived gate from coverage.
    rerender(
      <DayHabitEditor
        habits={[baseHabit({ archivedAt: '2026-07-01T00:00:00Z', completedDates: [D] })]}
        selectedDate={D}
        selectedLabel={LABEL}
        countForHabitOnDate={() => 1}
        onMutated={() => {}}
        attribution={TWO_ADULTS}
      />
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
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

  // 🛡️ TWIN of `HabitCard`'s "reverses ALL of a multi-unit attributed doc"
  // test — the two surfaces undo the SAME credit, so the unit semantics must
  // stay in lockstep too, not just the match predicates. `deleteHabitSubmission`
  // decrements `count`/`totalCount` by the whole `submission.count`, so one tap
  // on a `count: 3` doc clears all three units rather than decrementing to 2.
  // Multi-unit docs are ordinary: `HabitSubmissionLogModal` passes a free-text
  // count straight to `addHabitSubmission`.
  it('reverses ALL of a multi-unit attributed doc in one tap, not a single unit', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      {
        id: 'sub-3', habitId: 'h1', habitTitle: 'Read', timestamp: `${D}T12:00:00`, date: D,
        count: 3, pointsEarned: 30, streakDaysAtTime: 1, multiplierApplied: 1,
        createdBy: PAUL, attributedTo: JEN, createdAt: `${D}T12:00:01`,
      } as HabitSubmission,
    ]);
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 3 } } })],
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });

    expect(ctx.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'sub-3');
    // The one-unit primitive must NOT also run, or the day loses 4 units for a
    // doc that only ever recorded 3.
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

  // --- Household credit mode ------------------------------------------------
  it('offers the Household row here too, logging ONE unattributed submission', async () => {
    renderEditor();
    fireEvent.click(whoButton());

    const household = screen.getByRole('menuitemcheckbox', { name: /^Household/ });
    expect(household).toHaveAttribute('aria-checked', 'false');
    await act(async () => { fireEvent.click(household); });

    // An EXPLICIT empty actor set — the "credit the household" signal.
    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, [],
    );
  });

  it('checks Household for a day whose units nobody holds, and undoes it', async () => {
    renderEditor({
      habits: [baseHabit({ completedDates: [D], creditMode: 'household' })],
      countForHabitOnDate: () => 1,
    });
    fireEvent.click(whoButton());

    const household = screen.getByRole('menuitemcheckbox', { name: /^Household/ });
    expect(household).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(household); });

    // No submission doc behind it → the attribution-only primitive.
    expect(ctx.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', D);
    expect(ctx.deleteHabitSubmission).not.toHaveBeenCalled();
  });

  it('undoes a household credit by deleting its own submission doc when one exists', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      // A pre-attribution doc on the same day: no `attributedTo` either, but it
      // must NOT be swept up by the household undo.
      { id: 'legacy', habitId: 'h1', date: D, count: 1, createdBy: PAUL,
        createdAt: '2026-07-15T08:00:00' } as HabitSubmission,
      { id: 'hh', habitId: 'h1', date: D, count: 1, createdBy: PAUL,
        creditsHousehold: true, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    renderEditor({
      habits: [baseHabit({ completedDates: [D], creditMode: 'household' })],
      countForHabitOnDate: () => 2,
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));
    });

    expect(ctx.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'hh');
    expect(ctx.uncreditHouseholdCompletion).not.toHaveBeenCalled();
  });

  // Reviewer-confirmed BLOCKING gap (fixed on HabitCard in PR #1166, ported
  // here): a doc written before EITHER attribution or household-credit
  // existed carries neither `attributedTo` nor `creditsHousehold`. Filtering
  // on `creditsHousehold === true` alone lets this shape fall through as "no
  // doc found", so the undo takes the attribution-only fallback and the
  // grandfathered doc survives — an orphan that a later corrective recompute
  // silently re-credits to the household pool. The probe mirrors the
  // reviewer's own reproduction: with the doc gone (as this fix ensures),
  // re-scoring the post-undo state must read 0, not the doc's stored award.
  it('sweeps up a GRANDFATHERED doc too (no attributedTo, no creditsHousehold) — proven via pointsForHabitOnDate', async () => {
    const legacyPoints = 10;
    ctx.getHabitSubmissions.mockResolvedValue([
      { id: 'legacy', habitId: 'h1', date: D, count: 1, pointsEarned: legacyPoints,
        createdBy: PAUL, createdAt: '2026-07-15T08:00:00' } as HabitSubmission,
    ]);
    // Nobody attributed (no `completedBy`) + count 1 → the unit reads as
    // household-credited regardless of which member-less doc shape backs it.
    renderEditor({
      habits: [baseHabit({ completedDates: [D], creditMode: 'household' })],
      countForHabitOnDate: () => 1,
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));
    });

    expect(ctx.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'legacy');
    expect(ctx.uncreditHouseholdCompletion).not.toHaveBeenCalled();

    // --- Probe -------------------------------------------------------------
    // Simulates the state AFTER a real `deleteHabitSubmission` commit: the
    // habit doc's own reversal (count 0, D out of completedDates) plus the
    // submission doc now GONE, so a fresh `fetchSubmissionTotals` would
    // return no entry for D.
    const postUndoHabit: Habit = baseHabit({ count: 0, completedDates: [], creditMode: 'household' });
    expect(pointsForHabitOnDate(postUndoHabit, D, D, new Map())).toBe(0);

    // Contrast: the PRE-fix bug reproduction — same post-undo habit state,
    // but with the leftover doc's stored total still present (i.e.
    // `deleteHabitSubmission` was never called because the old predicate
    // missed it). `pointsForHabitOnDate` reports it "as-is", silently
    // re-crediting the exact amount the undo above just reversed.
    const staleSubmissionTotals = new Map([[D, { count: 1, points: legacyPoints }]]);
    expect(pointsForHabitOnDate(postUndoHabit, D, D, staleSubmissionTotals)).toBe(legacyPoints);
  });

  // Guards the OTHER direction the reviewer flagged: broadening the
  // household predicate to `attributedTo == null` must never reach INTO a
  // doc some OTHER member is actually credited for (`attributedTo` set) —
  // that unit belongs to them, not to the household, no matter how
  // "unattributed" the rest of the day looks.
  it('household undo does not sweep up a doc a specific member is attributed for', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      { id: 'jens', habitId: 'h1', date: D, count: 1, attributedTo: JEN,
        createdBy: JEN, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    // Two units: Jen's attributed one, plus one nobody holds → Household
    // reads checked for that second, genuinely unattributed unit.
    renderEditor({
      habits: [baseHabit({
        completedDates: [D],
        creditMode: 'household',
        completedBy: { [D]: { [JEN]: 1 } },
      })],
      countForHabitOnDate: () => 2,
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));
    });

    expect(ctx.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(ctx.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', D);
  });

  // Guards the SAME bug class from the member side: `createdBy` is always
  // the tapping member regardless of who/what they credited, so the naive
  // `attributedTo ?? createdBy` fallback alone would match a household-credit
  // doc this member happens to have logged. That doc must survive a MEMBER
  // undo — deleting it would corrupt the pool's own unit instead of this
  // member's.
  it('member undo does not sweep up a household-credit doc logged by that same member', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      { id: 'hh', habitId: 'h1', date: D, count: 1, creditsHousehold: true,
        createdBy: JEN, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
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

  // 🛡️ THE `?? createdBy` FALLBACK IS THE BUG, not a safety net.
  //
  // `addHabitSubmission` writes `attributedTo` on EVERY member-credited doc
  // (`actor !== null ? { attributedTo: actor } : { creditsHousehold: true }`),
  // so the fallback can never reach a doc this member is genuinely credited
  // for. The ONLY docs it can reach carry neither field — the automation
  // writers (`transactionMutations`' keyword fire, `noSpendFire`, the backfill
  // script) and pre-attribution history. On the keyword fire `createdBy` is
  // whoever VERIFIED the triggering transaction: a REAL member uid, routinely
  // the same admin who also logs habits by hand — this household's actual
  // situation.
  //
  // Matching one is not a no-op. `deleteHabitSubmission` resolves
  // `creditedUid = attributedTo ?? createdBy` and runs `reversalMoves`, so the
  // wrong doc is deleted AND the member's genuine `completedBy` unit is
  // debited (probed directly against the real mutation: it writes
  // `completedBy.<date>.<uid>: -1` and `-10` to that member's points).
  it('member undo does not sweep up an AUTOMATION doc whose createdBy is that same member', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      // Writer #2 (`transactionMutations`): NO attributedTo, NO creditsHousehold,
      // `createdBy` = the member who verified the triggering transaction.
      { id: 'automation', habitId: 'h1', date: D, count: 1, pointsEarned: 10,
        createdBy: JEN, createdAt: '2026-07-15T10:00:00',
        sourceTransactionId: 'txn-1' } as HabitSubmission,
    ]);
    // Jen ALSO holds one genuine attributed unit on this same date — the
    // attribution the mis-delete would destroy.
    renderEditor({
      habits: [baseHabit({ completedDates: [D], completedBy: { [D]: { [JEN]: 1 } } })],
      countForHabitOnDate: () => 2,
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Jen/ }));
    });

    // The automation doc survives…
    expect(ctx.deleteHabitSubmission).not.toHaveBeenCalled();
    // …and Jen's real unit is reversed by the attribution-only primitive,
    // which is bounded by `completedBy` and cannot over-take.
    expect(ctx.uncreditHabitCompletion).toHaveBeenCalledWith('h1', JEN, D);
  });

  // 🛡️ The household analogue of the member-path automation test above, and
  // the reason `attributedTo == null` ALONE is too wide.
  //
  // A grandfathered doc and an automation doc are FIELD-IDENTICAL — neither
  // carries `attributedTo` or `creditsHousehold` — so no marker separates
  // them. What separates the SAFE case from the corrupting one is the date:
  // `deleteHabitSubmission` falls back to `creditedUid = createdBy` for any
  // doc without `creditsHousehold`, and `resolveReversalSources` provably
  // returns `[]` only when the date carries no attribution at all. Probed
  // against the real mutation, a neither-field doc with `createdBy: user1`
  // on a date where SOMEONE holds attribution writes
  // `completedBy.<date>.<holder>: -1` and `-10` to that holder's points —
  // and the holder is whoever `completedBy` records, not necessarily
  // `createdBy`. So a mixed date must fall through to the attribution-only
  // primitive; the clean date (the genuine grandfathered case, covered
  // above) still sweeps.
  it('household undo does not sweep up an AUTOMATION doc on a date that carries attribution', async () => {
    ctx.getHabitSubmissions.mockResolvedValue([
      { id: 'automation', habitId: 'h1', date: D, count: 1, pointsEarned: 10,
        createdBy: PAUL, createdAt: '2026-07-15T10:00:00',
        sourceTransactionId: 'txn-1' } as HabitSubmission,
    ]);
    // Two units: Jen's genuine attributed one, plus the automation's
    // unattributed one → Household reads checked for the second.
    renderEditor({
      habits: [baseHabit({
        completedDates: [D],
        creditMode: 'household',
        completedBy: { [D]: { [JEN]: 1 } },
      })],
      countForHabitOnDate: () => 2,
    });
    fireEvent.click(whoButton());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));
    });

    // Deleting it would have debited Jen's REAL `completedBy` unit — she is
    // the holder `reversalMoves` falls back to, and she never touched this doc.
    expect(ctx.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(ctx.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', D);
  });

  // Re-entrancy: the household-undo handler now does an `await
  // getHabitSubmissions(...)` before any write. `runGuarded`'s ref-held Set
  // (keyed by habit id) is the guard that closes that window — this proves
  // it also covers the household-uncredit path specifically, using the same
  // "two synchronous dispatches, no render in between" technique as the
  // "swallows a second tap" test above for the log path.
  it('swallows a second tap on Household undo before React can disable the picker', async () => {
    ctx.getHabitSubmissions.mockImplementation(() => new Promise<HabitSubmission[]>(() => {}));
    renderEditor({
      habits: [baseHabit({ completedDates: [D], creditMode: 'household' })],
      countForHabitOnDate: () => 1,
    });
    fireEvent.click(whoButton());
    const household = screen.getByRole('menuitemcheckbox', { name: /^Household/ });

    await act(async () => {
      household.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      household.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(ctx.getHabitSubmissions).toHaveBeenCalledTimes(1);
  });

  it('a plain tap on a household-credit habit leaves attribution to the hook', async () => {
    renderEditor({ habits: [baseHabit({ creditMode: 'household' })] });
    await act(async () => { fireEvent.click(row()); });

    // `undefined`, not `[PAUL]`: naming the tapper would credit a member on a
    // habit whose completions credit the household and nobody individually.
    expect(ctx.addHabitSubmission).toHaveBeenCalledWith(
      'h1', 1, `${D}T12:00:00`, undefined, undefined, undefined,
    );
  });

  // The hosts pass their SCORING set (archived habits included, so the calendar
  // above keeps scoring history); the editable rows are the Track tab's list.
  describe('archived habits', () => {
    const RETIRED = baseHabit({
      id: 'h2',
      title: 'Old preset',
      archivedAt: '2026-07-01T00:00:00Z',
    });

    it('drops a retired habit that holds nothing on this day', () => {
      renderEditor({ habits: [baseHabit(), RETIRED] });

      expect(screen.getByText('Read')).toBeInTheDocument();
      expect(screen.queryByText('Old preset')).not.toBeInTheDocument();
    });

    it('keeps — and badges — a retired habit that holds units on this day', () => {
      // Its points are inside the day's total, so hiding the row would leave a
      // figure with nothing behind it and no way to clear it.
      renderEditor({
        habits: [RETIRED],
        countForHabitOnDate: (h) => (h.id === 'h2' ? 1 : 0),
      });

      expect(screen.getByText('Old preset')).toBeInTheDocument();
      expect(screen.getByText('Archived')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Clear Old preset/ })).toBeInTheDocument();
    });

    it('reads as "no active habits", not "no habits yet", when every habit is retired', () => {
      renderEditor({ habits: [RETIRED] });

      expect(screen.getByText('No active habits')).toBeInTheDocument();
    });
  });
});
