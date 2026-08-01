import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { CalendarDays, Plus, Star, Users, X } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';
import { Badge } from '@/components/ui/Badge';
import Eyebrow from '@/components/ui/Eyebrow';
import EmptyState from '@/components/ui/EmptyState';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';
import HabitAttributionPicker from '@/components/habits/HabitAttributionPicker';
import { getLocalDateString } from '@/utils/dateHelpers';
import { signedHabitPoints } from '@/utils/habitLogic';
import {
  attributedUnitsOnDate,
  habitFeedsMemberAttribution,
  isHouseholdCreditHabit,
} from '@/utils/habitAttribution';
import {
  dayPickerMembers,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  type HabitRowMemberContext,
} from '@/utils/habitRowAttribution';
import { haptic } from '@/utils/haptics';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';

interface DayHabitEditorProps {
  /**
   * Parent-visible habits (kid chores excluded), already sorted. Pass the same
   * set the calendar above is scored from — archived habits included; this
   * component drops them from the ROWS itself (see `visibleHabits`), because
   * the scoring set and the editable set are deliberately not the same list.
   */
  habits: Habit[];
  /** The day being edited (YYYY-MM-DD). */
  selectedDate: string;
  /** Human label for the day ("Today" / "Tuesday, July 8"). */
  selectedLabel: string;
  /** Units of a habit logged on a date (from useHabitCalendarData). */
  countForHabitOnDate: (habit: Habit, date: string) => number;
  /** Called after any successful mutation so the caller can refetch. */
  onMutated: () => void;
  /**
   * Roster + colors for the "who did this?" picker. Absent = no attribution UI
   * at all, and the plain tap keeps its pre-feature write exactly (mirroring
   * `HabitCard`'s optional `attribution`).
   */
  attribution?: HabitRowMemberContext;
}

/**
 * DayHabitEditor — the editable habit list for one calendar day, shared by
 * PastDayLogModal and the History tab's HabitHistoryCalendar so both surfaces
 * edit history identically.
 *
 * Interaction mirrors the Track tab's HabitCard: tapping a row logs one more
 * unit for THAT day (via the back-dating-aware `addHabitSubmission`, which
 * owns past-period points, the day's prospective streak multiplier, and the
 * no-double-award guard), and the small × on an active row clears the whole
 * day (`resetHabitDay`), reversing exactly the points that day earned. Points
 * labels are signed via `signedHabitPoints` — a negative habit reads "-2 pts"
 * regardless of which sign convention its basePoints were stored with.
 *
 * With an `attribution` context it also carries the Track tab's "who did this?"
 * picker: HOLD a row (or tap the trailing avatar/people control, because a
 * long-press is never the only path to an action) to credit "Me" / the other
 * adult / "Both of us" for THAT day, and tap a checked person to take it back.
 * Without it, a plain tap credits the signed-in member — the pre-existing
 * behaviour, now visible and correctable instead of silent.
 */
const DayHabitEditor: React.FC<DayHabitEditorProps> = ({
  habits,
  selectedDate,
  selectedLabel,
  countForHabitOnDate,
  onMutated,
  attribution,
}) => {
  const {
    addHabitSubmission,
    resetHabitDay,
    deleteHabitSubmission,
    getHabitSubmissions,
    uncreditHabitCompletion,
    uncreditHouseholdCompletion,
  } = useGamification();

  // Habit ids with an in-flight write, so a slow network can't double-log a
  // tap. The ref-held mutable Set is the actual guard — it updates synchronously
  // inside the handler, so a fast double-tap that lands before React re-renders
  // is still caught. The state mirror only drives the disabled/dimmed row UI.
  const inFlightIdsRef = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  // Read off the context ONCE: the handlers below only need these two scalars,
  // and depending on the whole context object would re-create them on every
  // roster listener fire (every habit write touches `members/{uid}.points`).
  const currentUserId = attribution?.currentUserId;
  const adultCount = attribution?.adults.length ?? 0;

  // Only one press and one picker can ever be live at a time, so this is
  // editor-level state rather than a per-row sub-component.
  const [pickerHabitId, setPickerHabitId] = useState<string | null>(null);
  const [pickerPlacement, setPickerPlacement] = useState<'above' | 'below'>('above');
  const pressTimerRef = useRef<number | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  // Set when a long-press actually opened the picker, so the click that follows
  // the release doesn't ALSO log a unit.
  const suppressClickRef = useRef(false);

  /**
   * The rows for this day — the Track tab's habit list, not the calendar's
   * scoring list.
   *
   * Both hosts hand over EVERY parent-visible habit, archived ones included,
   * because the calendar above has to keep scoring a retired habit's past
   * completions (dropping it there would silently rewrite history's point
   * figures). Showing that same set as the editable list is what made "Log a
   * past day" read as a stale copy of the habit list: `pages/Habits.tsx` hides
   * archived habits (`showArchived ? !!h.archivedAt : !h.archivedAt`), so a
   * preset retired months ago still offered itself for logging here.
   *
   * An archived habit that actually HOLDS units on the selected day stays
   * visible: its points are inside that day's total, so hiding the row would
   * leave a figure with nothing behind it and no way to clear it. The Archived
   * badge on the row says why it is there.
   */
  const visibleHabits = useMemo(
    () => habits.filter(h => !h.archivedAt || countForHabitOnDate(h, selectedDate) > 0),
    [habits, countForHabitOnDate, selectedDate]
  );

  const groupedHabits = useMemo<[string, Habit[]][]>(() => {
    const groups = new Map<string, Habit[]>();
    visibleHabits.forEach(h => {
      const list = groups.get(h.category) ?? [];
      list.push(h);
      groups.set(h.category, list);
    });
    return Array.from(groups.entries());
  }, [visibleHabits]);

  const runGuarded = useCallback(async (habitId: string, action: () => Promise<void>) => {
    const inFlightIds = inFlightIdsRef.current;
    if (inFlightIds.has(habitId)) return;
    inFlightIds.add(habitId);
    setBusyIds(new Set(inFlightIds));
    try {
      await action();
      onMutated();
    } finally {
      inFlightIds.delete(habitId);
      setBusyIds(new Set(inFlightIds));
    }
  }, [onMutated]);

  const clearLongPress = useCallback(() => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressOriginRef.current = null;
  }, []);

  // Never leave a timer behind — this editor unmounts with its Drawer.
  useEffect(() => clearLongPress, [clearLongPress]);

  /**
   * Can this habit's day be attributed?
   *
   * No `isHabitPaused` gate: pause is a TODAY-scoped concept, and the editor
   * already lets you log a past day on a currently-paused habit — adding one
   * here would be a new restriction. The archived gate exists because
   * `addHabitSubmission` deliberately has none (HabitSubmissionLogModal must
   * keep editing an archived habit's log), so it lives in the UI as it does on
   * HabitCard.
   */
  const canPick = useCallback((habit: Habit): boolean =>
    !!attribution &&
    attribution.adults.length > 1 &&
    habitFeedsMemberAttribution(habit) &&
    !habit.archivedAt,
  [attribution]);

  const openPicker = useCallback((habit: Habit, anchor: Element | null) => {
    // Open upward (the finger is below the row) unless the row sits too close
    // to the top of the viewport for the sheet to fit, in which case flip below
    // rather than render it off-screen. Mirrors the picker's own row set: the
    // compound "Both of us" row only exists with two or more adults.
    // + 1 for the Household row, which every habit gets.
    const rows = adultCount + (adultCount > 1 ? 1 : 0) + 1;
    const rect = anchor?.getBoundingClientRect();
    setPickerPlacement(rect && rect.top < rows * 44 + 16 ? 'below' : 'above');
    setPickerHabitId(habit.id);
  }, [adultCount]);

  const closePicker = useCallback(() => {
    suppressClickRef.current = false;
    setPickerHabitId(null);
  }, []);

  const handleLog = useCallback((habit: Habit) => {
    // The press that just opened the picker also fires a click on release; that
    // click must not log anything.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    return runGuarded(habit.id, async () => {
      // One unit per tap — Track-tab parity (threshold habits fill toward their
      // target tap by tap; incremental habits score per action). Noon keeps the
      // timestamp unambiguously inside the chosen local day.
      //
      // The tap is an explicit SELF-credit when we know who "self" is. That is
      // the same member `addHabitSubmission` would have picked on its own, but
      // stating it routes the write through the per-member award rule, so the
      // stored figure is what the member and the pool actually received.
      //
      // An ASSIGNED chore is left to the hook's own `attributionActor`, which
      // credits the ASSIGNEE — naming the tapper there would credit the parent
      // for a kid's chore. (Both hosts filter assigned habits out today; this
      // keeps the component correct if one ever stops.)
      //
      // A `creditMode: 'household'` habit is left to the hook too: naming the
      // tapper there would credit a member on a habit whose whole point is that
      // a completion credits the household and nobody individually.
      const selfCredit =
        currentUserId && habitFeedsMemberAttribution(habit) && !isHouseholdCreditHabit(habit)
          ? [currentUserId]
          : undefined;
      await addHabitSubmission(
        habit.id,
        1,
        `${selectedDate}T12:00:00`,
        undefined,
        undefined,
        selfCredit,
      );
      track('habit_past_day_logged', {
        daysAgo: differenceInCalendarDays(parseISO(getLocalDateString()), parseISO(selectedDate)),
        positive: habit.type === 'positive',
        members: 1,
        picked: false,
      });
    });
  }, [addHabitSubmission, currentUserId, runGuarded, selectedDate]);

  const handleCredit = useCallback((habit: Habit, memberIds: string[]) =>
    runGuarded(habit.id, async () => {
      if (memberIds.length === 0) return;
      haptic('success');
      await addHabitSubmission(
        habit.id,
        1,
        `${selectedDate}T12:00:00`,
        undefined,
        undefined,
        memberIds,
      );
      track('habit_past_day_logged', {
        daysAgo: differenceInCalendarDays(parseISO(getLocalDateString()), parseISO(selectedDate)),
        positive: habit.type === 'positive',
        members: memberIds.length,
        picked: true,
      });
    }), [addHabitSubmission, runGuarded, selectedDate]);

  const handleUncredit = useCallback((habit: Habit, memberId: string) =>
    runGuarded(habit.id, async () => {
      haptic('light');
      // The picker's checkmark is derived from `completedBy[selectedDate]`, so
      // the member provably holds a unit on THIS date. Prefer taking back the
      // submission doc that recorded it: deleting it strips the doc's WHOLE
      // `submission.count` worth of attributed units — not one — (bounded by
      // `resolveReversalSources`), reverses exactly the points it
      // earned, drops the date from `completedDates` when it was the last one,
      // AND keeps `submissionTotals` in step with `completedBy` — un-crediting
      // without deleting the doc would leave the row badge reading 2 for 1
      // attributed unit.
      const subs = await getHabitSubmissions(habit.id, selectedDate, selectedDate);
      // 🛡️ THIS PREDICATE AND THE HOUSEHOLD ONE BELOW MUST STAY SEMANTICALLY
      // IDENTICAL TO `HabitCard`'s two `uncreditViaSubmissionOrFallback`
      // predicates — the two surfaces undo the SAME credit, so a divergence
      // means one of them deletes a doc the other would not. Change together.
      //
      // 🛡️ `attributedTo` ONLY — NEVER an `?? s.createdBy` fallback.
      //
      // `addHabitSubmission` writes
      // `actor !== null ? { attributedTo: actor } : { creditsHousehold: true }`,
      // so EVERY member-credited doc carries `attributedTo`. The fallback can
      // therefore never reach a doc this member is genuinely credited for — it
      // can only reach a doc carrying NEITHER field, which is written by the
      // automation paths (`transactionMutations`' keyword fire, `noSpendFire`,
      // the backfill script) and by pre-attribution history. Those credited
      // NOBODY, and `createdBy` on them is the OPERATOR — for the keyword fire
      // that is whoever VERIFIED the triggering transaction, i.e. a real member
      // uid, routinely the same admin who logs habits by hand.
      //
      // Matching one is not a harmless no-op: un-crediting "Me" would delete an
      // unrelated automation doc. It also used to debit this member's REAL
      // `completedBy` attribution for the day, because `deleteHabitSubmission`
      // resolved `creditedUid = attributedTo ?? createdBy` and ran
      // `reversalMoves` (probe: a neither-field doc with `createdBy: user1` on a
      // date where user1 holds one genuine unit wrote
      // `completedBy.<date>.user1: -1` and `-10` to user1's points). That
      // fallback is now GONE — a doc naming no creditee reverses the POOL alone
      // — but deleting the wrong doc is harm enough on its own, so this
      // predicate stays `attributedTo`-only. Dropping the fallback costs nothing
      // and falls through to `uncreditHabitCompletion`, the correct reversal.
      //
      // `creditsHousehold !== true` is deliberately NOT kept: the two fields are
      // mutually exclusive by construction above, so a household doc has no
      // `attributedTo` and can never satisfy `=== memberId`. Keeping it would
      // imply the two can coexist, which is precisely the confusion that
      // produced the `?? createdBy` fallback.
      const mine = subs
        .filter(s => s.attributedTo === memberId && s.count > 0)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const newest = mine[0];
      if (newest) await deleteHabitSubmission(habit.id, newest.id);
      // No doc behind the credit (a Habits-page credit on today, a quickAdd
      // fire): the attribution-only primitive is the right reversal.
      else await uncreditHabitCompletion(habit.id, memberId, selectedDate);
    }), [deleteHabitSubmission, getHabitSubmissions, runGuarded, selectedDate, uncreditHabitCompletion]);

  /**
   * Household credit mode — log ONE completion for the household on this day,
   * credited to nobody individually. The empty `attributeTo` array is the
   * explicit "credit the household" signal (see `addHabitSubmission`).
   */
  const handleCreditHousehold = useCallback((habit: Habit) =>
    runGuarded(habit.id, async () => {
      haptic('success');
      await addHabitSubmission(
        habit.id,
        1,
        `${selectedDate}T12:00:00`,
        undefined,
        undefined,
        [],
      );
      track('habit_past_day_logged', {
        daysAgo: differenceInCalendarDays(parseISO(getLocalDateString()), parseISO(selectedDate)),
        positive: habit.type === 'positive',
        members: 0,
        picked: true,
      });
    }), [addHabitSubmission, runGuarded, selectedDate]);

  const handleUncreditHousehold = useCallback((habit: Habit) =>
    runGuarded(habit.id, async () => {
      haptic('light');
      // Same preference as the member path: take back the SUBMISSION doc that
      // recorded the credit when there is one, so the day's submission totals
      // stay in step with the row counter and the reversal undoes exactly what
      // was credited.
      //
      // NOT `s.creditsHousehold === true` alone — that misses a GRANDFATHERED
      // doc (written before either attribution or household-credit existed:
      // no `attributedTo`, no `creditsHousehold`), which orphans identically
      // to the bug this guard exists to close.
      //
      // But `attributedTo == null` alone is TOO WIDE, and this is the whole
      // subtlety: a grandfathered doc is FIELD-IDENTICAL to an automation doc
      // (`transactionMutations`' keyword fire, `noSpendFire`, the backfill
      // script all write neither field). There is no marker that separates
      // them, and enumerating `sourceTransactionId`/`sourceNoSpendDate` would
      // just be whack-a-mole against the next writer.
      //
      // 🛡️ So guard the INVARIANT instead of the marker. The harm was entirely
      // downstream: `deleteHabitSubmission` used to resolve
      // `creditedUid = attributedTo ?? createdBy` for any doc without
      // `creditsHousehold`, so an automation doc whose `createdBy` is a real
      // member uid made `reversalMoves` debit that member's genuine
      // `completedBy` — and when they held nothing, its holder fallback debited
      // whoever else did. That root cause is now FIXED at the source — a doc
      // with no `attributedTo` reverses the POOL alone, so all three rows below
      // land on the third one's behaviour. The guard is kept because narrowing
      // which docs this branch sweeps is a behaviour change in its own right
      // (which doc gets deleted, and the tie-break warned about below), not
      // because the harm is still live. Probed on the real mutation, PRE-fix:
      //   • neither-field doc, `createdBy: user1`, user1 holds a unit that day
      //     → `completedBy.<date>.user1: -1`, user1 points -10   ← corruption
      //   • same doc, jen-uid holds the unit instead
      //     → `completedBy.<date>.jen-uid: -1`, jen points -10   ← corruption
      //   • same doc, NO attribution anywhere on the date
      //     → no `completedBy` write, no member write, pool -10  ← correct
      // Only a MIXED date can corrupt, and it falls through to
      // `uncreditHouseholdCompletion`, i.e. exactly the pre-fix behaviour.
      // Under-reversing beats debiting the wrong ledger.
      //
      // 🛡️ WHAT `dateHasNoAttribution` DOES AND DOES NOT BUY. It is
      // DATE-scoped; a reversal's member blast radius is PERIOD-scoped. All it
      // ever guaranteed is that `reversalMoves` → `resolveReversalSources`
      // returns `[]`, so `deleteHabitSubmission` takes nothing off the doc's own
      // `createdBy` (nor off a holder-fallback member) — the three rows above;
      // that now holds for ANY doc with no `attributedTo`, guard or no guard.
      // It does NOT mean no member is debited: `queueHabitPointsMove` writes
      // `move.perMember` UNCONDITIONALLY (`attributionMoved` gates only the
      // POOL term), and `periodPointsMove` scopes members to
      // `periodScoredDates` — the whole week for a weekly habit. Executed
      // against the real mutation (weekly threshold habit, `targetCount: 2`,
      // Monday unattributed + Wednesday attributed to Jen, neither-field doc
      // dated Monday):
      //     jen-uid `points.{total,daily,weekly}: -10`, pool -10
      // Jen is debited although MONDAY carries no attribution. That is not a
      // defect and not new: the pre-fix `uncreditHouseholdCompletion` fallback
      // writes the identical member deltas on the identical input. Losing a
      // threshold period's award strips it from every holder in that period,
      // which is the intended reversal — just don't read this branch as "no
      // member can be debited".
      //
      // 🛡️ THIS BRANCH ROUTINELY SWEEPS AUTOMATION DOCS, and that is the
      // point — automation is NOT the case `dateHasNoAttribution` excludes.
      // `transactionMutations` writes NO attribution at all on a keyword fire
      // (just count/totalCount/completedDates/streakDays/hasSubmissionTracking
      // plus the submission), so a habit fired only by a keyword transaction
      // has `attributedUnitsOnDate === 0` on that date AND
      // `count - attributedUnits > 0` — which is exactly what makes the
      // Household chip read as credited in the first place. Deleting that doc
      // IS the correct undo: the two unit kinds are indistinguishable to this
      // UI, and leaving the doc behind is the orphan re-credit this guard
      // exists to close.
      //
      // ⚠️ One bad sub-case, knowingly accepted: a date carrying BOTH an
      // automation doc and a manual `creditsHousehold` doc. Both match, and the
      // sort picks by newest `createdAt`, so the automation doc may be the one
      // deleted — permanently destroying its `sourceTransactionId` audit
      // record, and `firedHabitIds` (`transactionMutations`, `arrayUnion`,
      // cleared only by un-verifying the transaction) then means that habit can
      // never re-fire from it. A `creditsHousehold`-first tie-break would fix
      // it, but it is NOT points-neutral — the two classes reverse the pool by
      // different arithmetic (`isHouseholdSubmission` takes the derived
      // decomposition, a neither-field doc takes its stored `pointsEarned`) —
      // so it is deliberately left out of this fix rather than smuggled in
      // unprobed.
      //
      // ⚠️ Path change, pre-existing behaviour: routing a
      // grandfathered/automation household undo through `deleteHabitSubmission`
      // puts it on that function's ABSOLUTE `count`/`totalCount` writes
      // (computed from the client cache) where the
      // `uncreditHouseholdCompletion` fallback used `increment()` deltas — the
      // same absolute-write shape behind the 2026-07-15 habit-history clobber.
      // That is `deleteHabitSubmission`'s own long-standing behaviour on every
      // submission delete, not something introduced here.
      const subs = await getHabitSubmissions(habit.id, selectedDate, selectedDate);
      const dateHasNoAttribution = attributedUnitsOnDate(habit, selectedDate) === 0;
      const householdDocs = subs
        .filter(s => (s.creditsHousehold === true || (s.attributedTo == null && dateHasNoAttribution)) && s.count > 0)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const newest = householdDocs[0];
      if (newest) await deleteHabitSubmission(habit.id, newest.id);
      // No doc behind the credit (a Habits-page household credit, a toggle-path
      // or grandfathered completion): the attribution-only primitive is the
      // right reversal.
      else await uncreditHouseholdCompletion(habit.id, selectedDate);
    }), [deleteHabitSubmission, getHabitSubmissions, runGuarded, selectedDate, uncreditHouseholdCompletion]);

  const handleClearDay = useCallback((habit: Habit) => runGuarded(habit.id, async () => {
    await resetHabitDay(habit.id, selectedDate);
  }), [resetHabitDay, runGuarded, selectedDate]);

  const handlePointerDown = (habit: Habit) => (e: React.PointerEvent<HTMLButtonElement>) => {
    // Start every gesture from a clean slate: a touch long-press does not always
    // emit the trailing click, and a flag left standing would swallow the NEXT
    // tap (or a keyboard Enter, which fires click with no pointerdown).
    suppressClickRef.current = false;
    if (!canPick(habit)) return;
    // Secondary buttons (right-click, stylus barrel) never start a long-press.
    if (e.button !== 0) return;
    clearLongPress();
    pressOriginRef.current = { x: e.clientX, y: e.clientY };
    const row = e.currentTarget.closest('[data-habit-row]') ?? e.currentTarget;
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = true;
      haptic('light');
      openPicker(habit, row);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const origin = pressOriginRef.current;
    if (!origin) return;
    if (
      Math.abs(e.clientX - origin.x) > LONG_PRESS_SLOP ||
      Math.abs(e.clientY - origin.y) > LONG_PRESS_SLOP
    ) {
      clearLongPress();
    }
  };

  if (visibleHabits.length === 0) {
    // Two different empty days: nothing created yet, or everything retired.
    // Telling them apart matters here — "create a habit first" is wrong advice
    // for a household whose habits all exist but are archived.
    const allArchived = habits.length > 0;
    return (
      <EmptyState
        variant="dashed"
        icon={<CalendarDays size={28} />}
        title={allArchived ? 'No active habits' : 'No habits yet'}
        description={
          allArchived
            ? 'Every habit is archived. Restore one from the Habits list to log it here.'
            : 'Create a habit first, then come back to log past days.'
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <h4 className="font-display font-semibold text-brand-800 dark:text-brand-100">
          {selectedLabel}
        </h4>
        <span className="text-xs font-medium text-brand-400 dark:text-brand-450">
          {adultCount > 1
            ? 'Tap to log · hold to pick who · × clears the day'
            : 'Tap to log · × clears the day'}
        </span>
      </div>

      {groupedHabits.map(([category, categoryHabits]) => (
        <div key={category}>
          <Eyebrow as="h3" className="mb-2 px-1">{category}</Eyebrow>
          <div className={cn(
            'surface-section [&>*:first-child]:border-t-0',
            // The picker is a non-portalled Popover anchored on a row INSIDE
            // this box, so `overflow-hidden` would clip it. Rows are transparent
            // at rest (only :hover and the open-row tint paint a background) and
            // the end rows carry the section's own radius here, so dropping the
            // clip for the group holding the open picker costs nothing visually.
            '[&>*:first-child]:rounded-t-card [&>*:last-child]:rounded-b-card',
            !categoryHabits.some(h => h.id === pickerHabitId) && 'overflow-hidden',
          )}>
            {categoryHabits.map(habit => {
              const isPositive = habit.type === 'positive';
              const dayCount = countForHabitOnDate(habit, selectedDate);
              const isBusy = busyIds.has(habit.id);
              const dayPoints = signedHabitPoints(habit);
              const pickable = canPick(habit);
              const pickerMembers = pickable && attribution
                ? dayPickerMembers(habit, attribution, selectedDate)
                : [];
              const credited = pickerMembers.filter(m => m.credited);
              // Household credit: units logged on this day that NOBODY holds —
              // the same `max(count − attributed, 0)` the unattributed scorer
              // computes, and exactly the unit the Household row takes back.
              const householdCredited =
                pickable && dayCount - attributedUnitsOnDate(habit, selectedDate) > 0;
              const creditedNames = [
                ...(householdCredited ? ['the household'] : []),
                ...credited.map(m => (m.isSelf ? 'you' : m.displayName)),
              ];
              return (
                <div
                  key={habit.id}
                  data-habit-row
                  className={cn(
                    'relative w-full px-4 py-3 hairline-divider flex items-center gap-3 text-left transition-colors duration-(--duration-fast)',
                    'hover:bg-brand-50 dark:hover:bg-brand-700/40',
                    // `select-none` matches HabitCard's containerClasses and is
                    // load-bearing on touch, not cosmetic: without it iOS runs
                    // its native long-press text-selection gesture on the row's
                    // label during the same 500ms hold that opens the picker,
                    // so the selection loupe fights the popover. preventing
                    // onContextMenu below is NOT sufficient — the selection
                    // gesture is separate and fires first.
                    'select-none',
                    // Background ONLY — never a transform. A transform on this
                    // row would create a stacking context that traps the
                    // non-portalled picker behind the page's sticky tab strip
                    // (see HabitCard's containerClasses for the full account).
                    pickerHabitId === habit.id && 'bg-brand-100 dark:bg-brand-700/60',
                    isBusy && 'opacity-60'
                  )}
                >
                  {/* Row-wide tap target: logs one more unit for this day, and
                      carries the hold that opens the "who did this?" picker.
                      Disabled while a write is in flight, so no pointerdown
                      fires and a long-press cannot start mid-write. */}
                  <button
                    type="button"
                    onClick={() => handleLog(habit)}
                    onPointerDown={handlePointerDown(habit)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onContextMenu={(e) => { if (pickable) e.preventDefault(); }}
                    disabled={isBusy}
                    className="absolute inset-0 w-full h-full cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-none"
                    aria-label={
                      dayCount > 0
                        ? `Log ${habit.title} again for ${selectedLabel} (currently ${dayCount})`
                        : `Log ${habit.title} for ${selectedLabel}`
                    }
                    style={{ zIndex: 1 }}
                  />

                  <span className="relative shrink-0" style={{ zIndex: 2 }}>
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full border font-bold font-mono pointer-events-none',
                        dayCount > 0
                          ? isPositive
                            ? 'bg-money-pos border-money-pos text-white'
                            : 'bg-money-neg border-money-neg text-white'
                          : 'border-brand-300 dark:border-brand-600 text-brand-300 dark:text-brand-500'
                      )}
                      aria-hidden="true"
                    >
                      {dayCount > 0 ? dayCount : <Plus size={16} />}
                    </span>
                    {/* Clear-day ×: Track-tab reset parity, scoped to this date. */}
                    {dayCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearDay(habit);
                        }}
                        disabled={isBusy}
                        className="absolute -top-1.5 -right-1.5 bg-white dark:bg-brand-700 border border-brand-200 dark:border-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 dark:text-brand-300 active:scale-90 hover:bg-money-bgNeg dark:hover:bg-money-neg/20 hover:text-money-neg dark:hover:text-money-negDark hover:border-money-neg/30 transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-1 focus:ring-money-neg/50 after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
                        aria-label={`Clear ${habit.title} for ${selectedLabel}`}
                        style={{ zIndex: 3 }}
                      >
                        <X size={12} strokeWidth={3} />
                      </button>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 pointer-events-none" style={{ zIndex: 2 }}>
                    <span className={cn(
                      'block text-sm font-semibold truncate',
                      dayCount > 0 ? 'text-brand-900 dark:text-brand-50' : 'text-brand-800 dark:text-brand-100'
                    )}>
                      {habit.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xxs font-medium text-brand-400 dark:text-brand-450">
                      <span className={cn(
                        'inline-flex items-center gap-0.5 font-bold',
                        isPositive
                          ? 'text-money-pos dark:text-money-posDark'
                          : 'text-money-neg dark:text-money-negDark'
                      )}>
                        <Star size={10} className="fill-current text-habit-gold" aria-hidden="true" />
                        {dayPoints > 0 ? `+${dayPoints}` : dayPoints} pts
                      </span>
                      {habit.period === 'weekly' && <Badge variant="neutral" size="sm">Weekly</Badge>}
                      {/* Only ever reached by an archived habit that holds
                          units on this day (see `visibleHabits`) — the label
                          explains why a retired habit is in this list. */}
                      {habit.archivedAt && <Badge variant="outline" size="sm">Archived</Badge>}
                    </span>
                  </span>

                  {/* The non-long-press path to the picker, doubling as the day's
                      attribution display — a long-press must never be the only
                      way to reach an action, and until now there was no way to
                      SEE who a past day was credited to. It measures the ROW
                      (not itself) so the above/below flip matches the hold. */}
                  {pickable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPicker(habit, e.currentTarget.closest('[data-habit-row]') ?? e.currentTarget);
                      }}
                      disabled={isBusy}
                      aria-haspopup="menu"
                      aria-expanded={pickerHabitId === habit.id}
                      aria-label={
                        creditedNames.length > 0
                          ? `Who did ${habit.title} on ${selectedLabel}? Currently ${creditedNames.join(' and ')}`
                          : `Who did ${habit.title} on ${selectedLabel}?`
                      }
                      className="relative shrink-0 flex min-h-11 min-w-11 items-center justify-center rounded-full text-brand-400 dark:text-brand-450 hover:bg-brand-100 dark:hover:bg-brand-700/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
                      style={{ zIndex: 2 }}
                    >
                      {credited.length > 0 || householdCredited ? (
                        <span className="flex">
                          {householdCredited && <HouseholdAvatar size={20} />}
                          {credited.map((m, i) => (
                            <span
                              key={m.uid}
                              className={i > 0 || householdCredited ? '-ml-1.5' : undefined}
                            >
                              <MemberAvatar
                                name={m.displayName}
                                photoURL={m.photoURL}
                                color={m.color}
                                size={20}
                              />
                            </span>
                          ))}
                        </span>
                      ) : (
                        <Users size={16} aria-hidden="true" />
                      )}
                    </button>
                  )}

                  {pickable && attribution && pickerHabitId === habit.id && (
                    <HabitAttributionPicker
                      isOpen
                      onClose={closePicker}
                      habitTitle={habit.title}
                      members={pickerMembers}
                      placement={pickerPlacement}
                      onCredit={(ids) => { void handleCredit(habit, ids); }}
                      onUncredit={(id) => { void handleUncredit(habit, id); }}
                      householdCredited={householdCredited}
                      householdFirst={isHouseholdCreditHabit(habit)}
                      onCreditHousehold={() => { void handleCreditHousehold(habit); }}
                      onUncreditHousehold={() => { void handleUncreditHousehold(habit); }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="px-1 text-xs text-brand-400 dark:text-brand-450">
        Edits apply to this day with the streak that applied then — daily, weekly, and total points adjust automatically.
      </p>
    </div>
  );
};

export default DayHabitEditor;
