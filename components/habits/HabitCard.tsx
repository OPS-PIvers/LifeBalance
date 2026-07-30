
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Habit } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { X, Edit2, Trash2, Target, Calendar, Snowflake, Pause, Play, Archive, ArchiveRestore, Users } from 'lucide-react';
import { cn } from '@/utils/cn';
import HabitFormModal from '@/components/modals/HabitFormModal';
import HabitSubmissionLogModal from '@/components/modals/HabitSubmissionLogModal';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import ProgressRing from '@/components/ui/ProgressRing';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { ListRow } from '@/components/ui/ListRow';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { subDays } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { haptic } from '@/utils/haptics';
import { getMultiplier, signedHabitPoints, isHabitPaused, isHabitStale } from '@/utils/habitLogic';
import {
  attributionFingerprint,
  habitFeedsMemberAttribution,
  memberFrozenDates,
  memberMostRecentUnitDateInPeriod,
  memberUnitsForPeriod,
} from '@/utils/habitAttribution';
import {
  rowCompletionSegments,
  sameHabitRowMemberContext,
  type HabitRowMemberContext,
} from '@/utils/habitRowAttribution';
import HabitPieCounter from './HabitPieCounter';
import HabitDoneByAvatars from './HabitDoneByAvatars';
import HabitAttributionPicker, { type AttributionPickerMember } from './HabitAttributionPicker';
import CountUp from './CountUp';

/** How long the toggle must be held before the "who did this?" picker opens. */
const LONG_PRESS_MS = 500;
/**
 * Movement (px) that turns a press into a scroll and cancels the long-press.
 * 16px, not 10: a finger wanders during a deliberate half-second hold, and a
 * hold that silently fails is worse than a scroll that also opened the picker
 * (a real scroll leaves this far behind within the same 500ms).
 */
const LONG_PRESS_SLOP = 16;

interface HabitCardProps {
  habit: Habit;
  /** Starts the parent Reorder.Item's drag; when set, ListRow renders the standard right-rail grip. */
  onGripPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  /**
   * Per-member attribution context (roster + colors), built once per roster
   * change by the Habits page. Absent = no attribution UI at all: the pie
   * counter, the flame-ring avatars and the picker are HABITS-PAGE ONLY, and a
   * card rendered anywhere else keeps its original look.
   */
  attribution?: HabitRowMemberContext;
}

const HabitCard: React.FC<HabitCardProps> = React.memo(({ habit, onGripPointerDown, attribution }) => {
  const {
    toggleHabit, deleteHabit, archiveHabit, unarchiveHabit, resetHabit, setHabitPause,
    activeChallenge, creditHabitCompletion, uncreditHabitCompletion,
  } = useGamification();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerPlacement, setPickerPlacement] = useState<'above' | 'below'>('above');
  const isDesktop = useMediaQuery('(min-width: 640px)');

  // Logic helpers
  const isPositive = habit.type === 'positive';
  // Staleness guard (parity with DailyHabitsWidget): a stale habit's live
  // counter belongs to a PREVIOUS period whose auto-reset hasn't landed yet
  // (throttled PWA timers), so render it as 0 — a pending-reset habit must
  // never show as selected/active the next morning. Recomputed every render
  // (cheap date compare) so a long-lived card crosses midnight correctly.
  const isStale = isHabitStale(habit);
  const count = isStale ? 0 : habit.count;
  const isActive = count > 0;
  const isThreshold = habit.scoringType === 'threshold';
  
  // Challenge Logic
  const isLinkedToChallenge = activeChallenge?.relatedHabitIds.includes(habit.id);
  
  // Completion Logic
  const isCompleted = count >= habit.targetCount;
  
  // Multipliers — period-aware (daily uses a 3/7-day ladder, weekly a 2/4-week
  // ladder). `habit.streakDays` holds the streak in the habit's own cadence, so
  // we feed it straight into the shared getMultiplier with habit.period.
  const streakMultiplier = getMultiplier(habit.streakDays, isPositive, habit.period);
  const totalMultiplier = streakMultiplier;

  // Canonical sign handling (habit.type drives the sign, |basePoints| the
  // magnitude) — negating raw basePoints here double-negated wizard-created
  // negative habits, which store basePoints as a negative number.
  const signedPointsDisplay = signedHabitPoints(habit, totalMultiplier);

  // Period-aware streak cadence — drives the multiplier nudge's unit word and
  // the screen-reader text on the badge row's flame-ring avatars.
  const isWeekly = habit.period === 'weekly';

  // Period-aware "one period from the next tier" nudge. Thresholds mirror
  // getMultiplier: daily 3→1.5x / 7→2x (nudge at 2 and 6), weekly 2→1.5x / 4→2x
  // (nudge at 1 and 3). Only shown for positive habits, like the streak badge.
  const nextTierNudge = ((): { unit: 'day' | 'week'; tier: '1.5x' | '2x' } | null => {
    if (!isPositive) return null;
    const oneFrom15 = isWeekly ? 1 : 2;
    const oneFrom2 = isWeekly ? 3 : 6;
    const unit = isWeekly ? 'week' : 'day';
    if (habit.streakDays === oneFrom15) return { unit, tier: '1.5x' };
    if (habit.streakDays === oneFrom2) return { unit, tier: '2x' };
    return null;
  })();

  // Plan 25: freezes are AUTO-applied at midnight/login — the manual "Repair
  // Streak" affordance is gone. Show a quiet indicator when yesterday's miss
  // was absorbed by a freeze. Recomputed on every render (a cheap string
  // format): card instances are long-lived (React.memo keyed list, sessions
  // span midnight via useMidnightScheduler), so memoizing per mount would
  // leave this pointing at the pre-rollover day.
  const yesterday = getLocalDateString(subDays(new Date(), 1));
  // Stage 6 (`freezeMode: 'per_member'`): a per-member freeze token bridges
  // only the spending member's own chain in `Habit.frozenDatesBy`, never the
  // household-wide `frozenDates` — so the badge must also consult the VIEWER's
  // own entry there, or a per-member freeze spends a real token with no
  // visible confirmation for the frozen member. `memberFrozenDates` returns
  // `[]` when the field is absent (shared/freeze_both households), so this is
  // a no-op everywhere except per-member mode.
  const isProtectedByFreeze =
    (habit.frozenDates ?? []).includes(yesterday) ||
    (!!attribution?.currentUserId &&
      memberFrozenDates(habit, attribution.currentUserId).includes(yesterday));

  // F-HABITS-01: while paused, the toggle is disabled and a badge shows the break.
  const isPaused = isHabitPaused(habit);

  // --- Per-member attribution (stage 2) --------------------------------------
  // Who is credited for THIS period's completions, in roster order. A stale row
  // renders as count 0 (its counter belongs to a period whose auto-reset hasn't
  // landed), so it shows no attribution either — the two must agree.
  const today = getLocalDateString();
  const segments = attribution && !isStale ? rowCompletionSegments(habit, attribution, today) : [];
  const attributedUnits = segments.reduce((sum, s) => sum + s.units, 0);
  // Pie mode only once someone is actually credited: a pre-feature
  // ("grandfathered") completion has no attribution and keeps the original
  // solid toggle, so untouched and legacy rows look exactly as they did.
  const showPie = isActive && attributedUnits > 0;

  // The picker edits per-member attribution, which an ASSIGNED chore does not
  // have (its points route to the assignee, not to the attribution layer), and
  // a paused/archived habit does not accept new completions.
  const canPickAttribution =
    !!attribution &&
    attribution.adults.length > 0 &&
    habitFeedsMemberAttribution(habit) &&
    !isPaused &&
    !habit.archivedAt;

  // Credited state is PERIOD-scoped (see memberUnitsForPeriod), matching the
  // pie's own span: a weekly habit completed by Jen on Monday must still show
  // her checked on Wednesday, or a second tap double-credits a unit she
  // already holds this week. For a daily habit the period IS the day, so this
  // degrades to exactly the old day-scoped behavior — no change there.
  const periodUnitsByMember = canPickAttribution ? memberUnitsForPeriod(habit, today) : {};
  const pickerMembers: AttributionPickerMember[] = canPickAttribution && attribution
    ? attribution.adults.map(member => ({
        ...member,
        credited: (periodUnitsByMember[member.uid] ?? 0) > 0,
        isSelf: member.uid === attribution.currentUserId,
      }))
    : [];

  const toggleRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  // Set when the long-press actually opened the picker, so the click that
  // follows the release doesn't ALSO increment the habit.
  const suppressClickRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  // A card is long-lived (memoized list rows); never leave a timer behind.
  useEffect(() => clearLongPress, [clearLongPress]);

  const openPicker = useCallback(() => {
    // Open upward (the mock's anchoring — the finger is below the toggle)
    // unless the row is too close to the top of the viewport for the sheet to
    // fit, in which case flip below rather than render it off-screen.
    const rect = toggleRef.current?.getBoundingClientRect();
    // Mirrors the picker's own row set: the compound "Both of us" row only
    // exists with two or more adults (see HabitAttributionPicker), so counting
    // it in a single-adult household would flip placement for a row that had
    // room above after all.
    const rows = pickerMembers.length + (pickerMembers.length > 1 ? 1 : 0);
    const estimatedHeight = rows * 44 + 16;
    setPickerPlacement(rect && rect.top < estimatedHeight ? 'below' : 'above');
    setIsPickerOpen(true);
    // Depends on the COUNT, not on `pickerMembers` itself: all this callback
    // needs is the sheet's height. The member list reaches the picker through
    // JSX props, so it is always current at render time — no stale closure to
    // fix with a useMemo here.
  }, [pickerMembers.length]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Start every gesture from a clean slate: a touch long-press does not
    // always emit the trailing click, and a flag left standing would swallow
    // the NEXT tap (or a keyboard Enter, which fires click with no pointerdown).
    suppressClickRef.current = false;
    if (!canPickAttribution) return;
    // Secondary buttons (right-click, stylus barrel) never start a long-press.
    if (e.button !== 0) return;
    clearLongPress();
    longPressOriginRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressClickRef.current = true;
      haptic('light');
      openPicker();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const origin = longPressOriginRef.current;
    if (!origin) return;
    if (Math.abs(e.clientX - origin.x) > LONG_PRESS_SLOP || Math.abs(e.clientY - origin.y) > LONG_PRESS_SLOP) {
      clearLongPress();
    }
  };

  const handleCreditMembers = (memberIds: string[]) => {
    if (memberIds.length === 0) return;
    haptic('success');
    // The mutation surfaces its own error toast before rejecting; swallowing
    // here only avoids an unhandled rejection.
    void creditHabitCompletion(habit.id, memberIds).catch(() => {});
  };

  const handleUncreditMember = (memberId: string) => {
    haptic('light');
    // Reverse the member's MOST RECENT attributed unit in the current period
    // (see memberMostRecentUnitDateInPeriod) — for a daily habit that is always
    // today, but for a weekly habit checked-from-Wednesday the unit may live on
    // Monday. `?? today` only matters if the row somehow renders a checkmark
    // for a member holding nothing this period, which canPickAttribution/the
    // picker's own `credited` derivation never allows.
    const targetDate = memberMostRecentUnitDateInPeriod(habit, memberId, today) ?? today;
    void uncreditHabitCompletion(habit.id, memberId, targetDate).catch(() => {});
  };

  // Grouped-flat ROW: borderless and hairline-separated by the parent
  // SurfaceList (HabitCategoryList) — never a floating, individually-bordered
  // card. Hierarchy comes from spacing + a quiet active tint (money-pos /
  // money-neg), not from a per-card border/shadow.
  // Extends ListRow's base anatomy classes (cn merges px/py overrides).
  const containerClasses = cn(
    "px-4 py-3.5 duration-(--duration-base) ease-(--ease-standard) select-none group/card",
    // `transform` leaves the transition list the instant the picker opens, so
    // the scale below snaps back to none rather than ANIMATING back over
    // --duration-base. A transform mid-transition is still a live stacking
    // context, so transitioning it out would keep the panel trapped for the
    // first frames it is visible — the same paper cut, just briefer.
    isPickerOpen ? "transition-[background-color]" : "transition-[transform,background-color]",
    // Tap-press affordance — suppressed while the attribution picker is open.
    // This row IS the Popover's positioned ancestor (Popover is deliberately
    // not portalled — it anchors to the nearest `relative` ancestor), and
    // `:active` fires for the whole duration of a long-press hold. Applying a
    // `transform` here while held creates a NEW STACKING CONTEXT on the row,
    // which traps the popover panel's z-dropdown inside it — its z-index then
    // only competes against the row's own (unset, so effectively 0) stacking
    // level, which paints BEHIND the page's sticky tab strip (z-30) until the
    // press releases and the transform (and the stacking context with it)
    // disappears. That is the "renders behind, then jumps to the front on
    // release" paper cut. Dropping the transform for the duration the picker
    // is open keeps the row un-transformed, so the panel's absolute z-index
    // resolves against the page like normal, with no re-layer flash.
    !isPickerOpen && "has-[.main-overlay:active]:scale-[0.99]",
    !isActive && "bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/40",
    isActive && isPositive && "bg-money-bgPos dark:bg-money-pos/10",
    isActive && !isPositive && "bg-money-bgNeg dark:bg-money-neg/10",
    // While the picker is up this row is the one being edited; the neutral
    // "pressed" fill says so without dimming everything else.
    isPickerOpen && "bg-brand-100 dark:bg-brand-700/60"
  );

  const buttonClasses = cn(
    "relative flex items-center justify-center w-14 h-14 rounded-card transition-colors duration-(--duration-fast) ease-(--ease-standard) z-10",
    // brand-450/brand-400 (not 400/450): the in-progress threshold count is
    // 18px/700 — below the WCAG large-text cutoff (18.66px bold) — so it needs
    // 4.5:1. brand-450 on brand-100 = 4.76:1 light; dark brand-400 on
    // brand-700 = 4.72:1 (the old 400/450 pair measured 4.19/3.70).
    !isActive && "bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 text-brand-450 dark:text-brand-400 group-hover/card:border-brand-300 dark:group-hover/card:border-brand-500 group-hover/card:bg-brand-200/60 dark:group-hover/card:bg-brand-600",
    isActive && isPositive && "bg-money-pos text-white border-0",
    isActive && !isPositive && "bg-money-neg text-white border-0",
    // Threshold visual overrides — in-progress positive threshold uses an evergreen tint
    isActive && isThreshold && !isCompleted && isPositive && "bg-accent-100 dark:bg-accent-800/40 text-accent-700 dark:text-accent-200 border border-accent-200 dark:border-accent-700",
    // Pie mode: the tile turns neutral so the member-colored disc inside it
    // carries ALL the color. It must not sit on the money-pos fill, which would
    // read as a second, competing state.
    showPie && "bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-600 text-white dark:text-white"
  );

  const handleCardClick = () => {
    clearLongPress();
    // The press that just opened the picker also fires a click on release; that
    // click must not credit anybody.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // F-HABITS-01: a paused habit is inert — taps don't increment it.
    if (isPaused) return;
    // Fire tactile feedback based on whether this tap completes the habit.
    // Reaching (or staying at) the target counts as a "success"; otherwise it
    // is a light increment nudge. Negative habits always use the light pattern.
    const willComplete = isPositive && !isCompleted && count + 1 >= habit.targetCount;
    haptic(willComplete ? 'success' : 'light');
    toggleHabit(habit.id, 'up');
  };

  const handleEdit = () => {
    setIsEditModalOpen(true);
    setIsMenuOpen(false);
  };

  const handleViewLog = () => {
    setIsLogModalOpen(true);
    setIsMenuOpen(false);
  };

  const handleDelete = () => {
    deleteHabit(habit.id);
    setIsMenuOpen(false);
  };

  const handleResume = () => {
    setHabitPause(habit.id, null);
    setIsMenuOpen(false);
  };

  const isArchived = !!habit.archivedAt;

  const handleArchiveToggle = () => {
    if (isArchived) {
      unarchiveHabit(habit.id);
    } else {
      archiveHabit(habit.id);
    }
    setIsMenuOpen(false);
  };

  // Shared action set for the desktop dropdown (Menu) and mobile Drawer.
  //
  // No "Reflect" entry: the owner removed the affordance from the habit row
  // outright (it is NOT merely relocated). Notes and moods are still written
  // and read — "View Log" below opens HabitSubmissionLogModal, which edits and
  // renders `HabitSubmission.note`/`.mood` — and no stored reflection data was
  // touched. Only the one-tap shortcut is gone.
  const handleWhoDidThis = () => {
    setIsMenuOpen(false);
    openPicker();
  };

  const menuItems: MenuItem[] = [
    // Long-press is a discoverability shortcut, never the only path: the picker
    // must be reachable by keyboard and screen reader too.
    ...(canPickAttribution
      ? [{ key: 'attribution', label: 'Who did this?', icon: <Users size={14} />, onSelect: handleWhoDidThis } as MenuItem]
      : []),
    { key: 'edit', label: 'Edit', icon: <Edit2 size={14} />, onSelect: handleEdit },
    ...(isPaused
      ? [{ key: 'resume', label: 'Resume', icon: <Play size={14} />, onSelect: handleResume } as MenuItem]
      : []),
    { key: 'log', label: 'View Log', icon: <Calendar size={14} />, onSelect: handleViewLog },
    {
      key: 'archive',
      label: isArchived ? 'Unarchive' : 'Archive',
      icon: isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
      onSelect: handleArchiveToggle,
    },
    { key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onSelect: handleDelete },
  ];

  return (
    <>
      <ListRow
        className={containerClasses}
        leading={
          <>
            {/* Invisible clickable overlay for main card interaction — spans the
                whole row (ListRow is `relative`). The right rail sits above it
                (z-10), so grip/kebab taps never increment the habit. */}
            <button
              onClick={handleCardClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={clearLongPress}
              onPointerCancel={clearLongPress}
              onPointerLeave={clearLongPress}
              // A long-press on a button raises the platform callout menu on
              // touch; suppress it so the attribution picker owns the gesture.
              onContextMenu={(e) => { if (canPickAttribution) e.preventDefault(); }}
              className="main-overlay absolute inset-0 w-full h-full cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900 rounded-card"
              aria-label={`Toggle habit: ${habit.title}, current count: ${count}`}
              tabIndex={0}
              style={{ zIndex: 1 }}
            />

            {/* ACTION INDICATOR */}
            <div ref={toggleRef} className="shrink-0 relative group pointer-events-none" style={{ zIndex: 2 }}>
              <div className={buttonClasses}>
                {showPie ? (
                  <HabitPieCounter
                    segments={segments.map(s => ({ key: s.memberId, color: s.color, units: s.units }))}
                    count={count}
                  />
                ) : isThreshold && !isCompleted ? (
                  <span className="text-lg font-bold font-mono">{count}</span>
                ) : isActive ? (
                  <span className="text-xl font-bold font-mono">{count}</span>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-current opacity-40" />
                )}

                {/* Progress Ring for Threshold. In pie mode it is dropped once
                    the target is met — the full disc already says "done", and a
                    completed ring around it is noise. */}
                {isThreshold && !(showPie && isCompleted) && (
                  <ProgressRing
                    percent={(count / habit.targetCount) * 100}
                    strokeWidth={3}
                    trackClassName={showPie || (isActive && !isCompleted) ? 'text-brand-900/10 dark:text-white/10' : 'text-white/20'}
                    barClassName={isCompleted && !showPie ? 'text-white' : 'text-accent-600 dark:text-accent-300'}
                    className="absolute inset-0 w-full h-full p-0.5 pointer-events-none"
                  />
                )}
              </div>

              {/* Reset Button (X) — the visible circle stays w-6 h-6 and the
                  after: pseudo-element grows the hit area to 44px without
                  shifting the circle.

                  The OUTWARD OVERHANG IS LOAD-BEARING, not decoration: the
                  extender is centred on the circle, so every px the circle
                  moves inward is ~2px of the 56x56 indicator (the habit
                  toggle) that the reset silently annexes. A mis-tap here
                  DESTROYS progress, so this control must claim as little of
                  the toggle as possible while still clearing 44px.

                  Measured with elementFromPoint over the indicator
                  (375px viewport, two adjacent active rows):
                    flush  top-0/right-0 + -inset-3   → 1131px² (36.1%)
                    -1.5 overhang       + -inset-2.5  →  667px² (21.3%)
                    -2   overhang       + -inset-2.5  →  546px² (17.4%)  ← this
                  All three measure 44px; the -2 overhang reaches 3px above the
                  row's top edge and probes there still resolve to the reset,
                  so the neighbouring row does NOT clip it. */}
              {isActive && (
                <button
                  onClick={(e) => {
                     e.stopPropagation();
                     resetHabit(habit.id);
                  }}
                  className="absolute -top-2 -right-2 bg-white dark:bg-brand-700 border border-brand-200 dark:border-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 dark:text-brand-300 active:scale-90 hover:bg-money-bgNeg dark:hover:bg-money-neg/20 hover:text-money-neg dark:hover:text-money-negDark hover:border-money-neg/30 transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-1 focus:ring-money-neg/50 pointer-events-auto after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
                  aria-label="Reset habit progress"
                  style={{ zIndex: 20 }}
                >
                  <X size={12} strokeWidth={3} />
                </button>
              )}
            </div>
          </>
        }
        grip={onGripPointerDown ? { onPointerDownCapture: onGripPointerDown } : undefined}
        menu={{
          // Item-qualified so multiple habit kebabs are distinguishable in a
          // screen-reader rotor list.
          ariaLabel: `Options for ${habit.title}`,
          // What actually opens differs by breakpoint: desktop anchors the
          // dropdown Menu, mobile presents the options Drawer (a dialog).
          hasPopup: isDesktop ? 'menu' : 'dialog',
          expanded: isMenuOpen,
          onOpen: () => setIsMenuOpen(!isMenuOpen),
        }}
      >
        <h3 className={cn("font-semibold tracking-tight text-sm truncate", isActive ? "text-brand-900 dark:text-brand-50" : "text-brand-700 dark:text-brand-200")}>
          {habit.title}
        </h3>

        {/* Badges */}
        <div className="flex flex-wrap gap-2">
            {/* Points Potential */}
            <Badge variant={isPositive ? 'success' : 'danger'} size="sm">
              <CountUp value={signedPointsDisplay} suffix=" pts" />
            </Badge>

            {/* Per-member points (stage 2): the streak PILL is gone from this
                row. Streak now reads as flame-ring intensity around each
                credited member's avatar — per-member, not per-habit — and the
                exact number lives in the habit's log ("View Log" → Current
                Streak). The multiplier it earns is still visible: it is baked
                into the points badge above. */}
            {segments.length > 0 && (
              <HabitDoneByAvatars
                entries={segments}
                streakUnit={isWeekly ? 'week' : 'day'}
                // Positive habits only — a ring around a run of the thing you
                // are trying to STOP would be a celebration of it. The pill
                // this replaced carried the same gate.
                showStreakRings={isPositive}
              />
            )}

            {/* F-HABITS-01: planned break in effect */}
            {isPaused && (
              <Badge variant="default" size="sm" className="gap-1 text-habit-blue">
                <Pause size={10} /> Paused until {habit.pausedUntil}
              </Badge>
            )}

            {/* Plan 25: yesterday's miss was absorbed by an auto-applied freeze */}
            {isProtectedByFreeze && (
              <Badge variant="default" size="sm" className="gap-1 text-habit-blue">
                <Snowflake size={10} /> Protected
              </Badge>
            )}

            {/* Multiplier nudge: one period short of the next tier. Period-aware
                in both threshold and unit — daily fires at 2d (→1.5x) / 6d (→2x),
                weekly at 1w (→1.5x) / 3w (→2x), matching getMultiplier's ladders. */}
            {nextTierNudge && (
              <Badge variant="warning" size="sm">
                1 {nextTierNudge.unit} from {nextTierNudge.tier}!
              </Badge>
            )}

            {/* Linked Challenge Badge */}
            {isLinkedToChallenge && (
               <Badge variant="default" size="sm" className="gap-1">
                <Target size={10} /> Goal
              </Badge>
            )}
          </div>

        {/* Action menu (desktop dropdown; mobile uses the Drawer below).
            Popover anchors to the nearest positioned ancestor — the ListRow
            container (`relative`) — so the old top/right offsets still apply. */}
        <Menu
          isOpen={isMenuOpen && isDesktop}
          onClose={() => setIsMenuOpen(false)}
          items={menuItems}
          ariaLabel="Habit actions menu"
          position="top-10 right-2"
          className="min-w-[140px]"
          stopPropagation
        />

        {/* Attribution picker — anchored on the row (the nearest positioned
            ancestor is the ListRow container), left-aligned with the toggle it
            belongs to, exactly like the approved mock. */}
        {canPickAttribution && (
          <HabitAttributionPicker
            isOpen={isPickerOpen}
            onClose={() => {
              // Safety net for the touch path above: by the time the picker
              // closes, any click the long-press could have produced has long
              // since been handled.
              suppressClickRef.current = false;
              setIsPickerOpen(false);
            }}
            habitTitle={habit.title}
            members={pickerMembers}
            placement={pickerPlacement}
            onCredit={handleCreditMembers}
            onUncredit={handleUncreditMember}
          />
        )}
      </ListRow>

      {/* Mobile Drawer Actions */}
      <Drawer
        isOpen={isMenuOpen && !isDesktop}
        onClose={() => setIsMenuOpen(false)}
        title="Habit Options"
      >
        <div className="space-y-2">
          {/* Keyboard/screen-reader (and simply discoverable) equivalent of the
              toggle's long-press — see menuItems. */}
          {canPickAttribution && (
            <Button
              variant="ghost"
              className="w-full justify-start text-lg py-4"
              leftIcon={<Users className="text-brand-400" />}
              onClick={handleWhoDidThis}
            >
              Who did this?
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Edit2 className="text-brand-400" />}
            onClick={handleEdit}
          >
            Edit Habit
          </Button>
          {isPaused && (
            <Button
              variant="ghost"
              className="w-full justify-start text-lg py-4"
              leftIcon={<Play className="text-brand-400" />}
              onClick={handleResume}
            >
              Resume Habit
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Calendar className="text-brand-400" />}
            onClick={handleViewLog}
          >
            View History Log
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={isArchived ? <ArchiveRestore className="text-brand-400" /> : <Archive className="text-brand-400" />}
            onClick={handleArchiveToggle}
          >
            {isArchived ? 'Unarchive Habit' : 'Archive Habit'}
          </Button>
          <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />
          <Button
            variant="ghost-destructive"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Trash2 />}
            onClick={handleDelete}
          >
            Delete Habit
          </Button>
        </div>
      </Drawer>

      <HabitFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        editingHabit={habit}
      />
      <HabitSubmissionLogModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        habit={habit}
      />
    </>
  );
}, (prev, next) =>
  // Field-by-field comparison: the context provider rebuilds every habit
  // object on each Firestore snapshot, so a shallow prop compare would
  // re-render every card on any habit change. Challenge/freeze-bank state is
  // read from context (useGamification), not props, so those updates already
  // re-render this card through the context subscription regardless of memo.
  prev.onGripPointerDown === next.onGripPointerDown &&
  prev.habit.id === next.habit.id &&
  prev.habit.title === next.habit.title &&
  prev.habit.count === next.habit.count &&
  prev.habit.streakDays === next.habit.streakDays &&
  prev.habit.lastUpdated === next.habit.lastUpdated &&
  prev.habit.category === next.habit.category &&
  prev.habit.type === next.habit.type &&
  prev.habit.scoringType === next.habit.scoringType &&
  prev.habit.period === next.habit.period &&
  prev.habit.basePoints === next.habit.basePoints &&
  prev.habit.targetCount === next.habit.targetCount &&
  prev.habit.archivedAt === next.habit.archivedAt &&
  // Content compare (the provider rebuilds arrays each snapshot): drives the
  // "Protected" freeze badge.
  (prev.habit.frozenDates ?? []).join(',') === (next.habit.frozenDates ?? []).join(',') &&
  // Same, for the per-member freeze bridge (stage 6, `freezeMode: 'per_member'`)
  // that also drives the "Protected" badge for the viewer's own frozen dates.
  JSON.stringify(prev.habit.frozenDatesBy ?? {}) === JSON.stringify(next.habit.frozenDatesBy ?? {}) &&
  // Drives the "Paused" badge, disabled toggle, and Resume action (F-HABITS-01).
  prev.habit.pausedUntil === next.habit.pausedUntil &&
  // Per-member points (stage 2): drives whether the picker is offered at all.
  prev.habit.assignedTo === next.habit.assignedTo &&
  // CONTENT, not identity: the page memoizes this context on `members`, and
  // every toggle writes `members/{uid}.points`, which re-fires the members
  // listener with a fresh array — an identity check would therefore re-render
  // every card in the list on every toggle (see sameHabitRowMemberContext).
  sameHabitRowMemberContext(prev.attribution, next.attribution) &&
  // Attribution content, scoped to the CURRENT period (see
  // attributionFingerprint): a credit or un-credit by the other member arrives
  // as a habit-doc snapshot that may move nothing else on this row, so without
  // this the pie and the avatars would silently go stale.
  // The reference check is only a fast path for a genuinely unchanged object —
  // the provider rebuilds habits on every snapshot, so the fingerprint is what
  // normally decides. It stays cheap because it addresses the period by date
  // key (see memberUnitsForPeriod), never by scanning the habit's history.
  (prev.habit.completedBy === next.habit.completedBy ||
    attributionFingerprint(prev.habit, getLocalDateString()) ===
      attributionFingerprint(next.habit, getLocalDateString()))
);

HabitCard.displayName = 'HabitCard';

export default HabitCard;
