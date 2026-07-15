import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  increment,
  writeBatch,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import {
  Habit,
  HabitSubmission,
  HouseholdMember,
  Household,
  RewardItem
} from '@/types/schema';
import {
  processToggleHabit,
  calculateResetPoints,
  streakForHabit,
  streakEndingOnForHabit,
  isHabitStale,
  getMultiplier,
  normalizeHabitTitle,
  signedHabitPoints,
  pointsForHabitOnDate
} from '@/utils/habitLogic';
import { crossedMilestone, rewardMilestoneSatisfied } from '@/utils/habitMilestones';
import toast from 'react-hot-toast';
import { CalendarDays, RotateCcw, Star, TrendingDown, PartyPopper, Gift } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import { track } from '@/services/analytics';
import { shouldTrackFirstTime, FIRST_HABIT_FLAG } from '@/utils/firstTimeFlags';
import { appendActivityLog, composeSummary } from '@/utils/activityLog';
import { accumulate, ToastAccumulatorState } from '@/utils/toastAccumulator';
import { softDeleteDoc } from '@/contexts/household/mutations/trashMutations';

/**
 * Window for folding rapid same-habit toggles into a single cumulative toast
 * instead of stacking one per tap. Matches the toast's own `duration: 1500`
 * below so the accumulation window and the toast's visible lifetime agree.
 */
const POINTS_TOAST_WINDOW_MS = 1500;

/**
 * Plan 080c: the doc that receives a habit's points. An assigned (per-member /
 * kid chore) habit credits the assignee's own `members/{uid}.points`; an
 * unassigned/shared habit credits the shared household doc. Every points-writing
 * path (toggle, reset, submission add/edit/delete) routes through this so an
 * assigned chore's points never leak into the shared pool.
 */
const habitPointsTargetRef = (householdId: string, assignedTo: string | undefined) =>
  assignedTo
    ? doc(db, `households/${householdId}/members`, assignedTo)
    : doc(db, `households/${householdId}`);

export const useHabitActions = (
  householdId: string | null,
  currentUser: HouseholdMember | null,
  habits: Habit[],
  householdSettings: Household | null,
  rewardsInventory: RewardItem[] = []
) => {
  // Keep mutable refs so callbacks can read the latest habits/settings without
  // including them in dep arrays.  This prevents every habit write from
  // recreating all callbacks and cascading re-renders to all consumers.
  const habitsRef = useRef<Habit[]>(habits);
  useEffect(() => { habitsRef.current = habits; }, [habits]);

  const householdSettingsRef = useRef<Household | null>(householdSettings);
  useEffect(() => { householdSettingsRef.current = householdSettings; }, [householdSettings]);

  const rewardsInventoryRef = useRef<RewardItem[]>(rewardsInventory);
  useEffect(() => { rewardsInventoryRef.current = rewardsInventory; }, [rewardsInventory]);

  // Per-habit running total for the points toast (keyed by habit id). Lives
  // in a ref (not module scope, which would leak across tests/users, and not
  // component state, which would re-render on every toggle) — see
  // toastAccumulator.ts for the pure math this drives.
  const pointsToastAccumulatorRef = useRef<ToastAccumulatorState>(new Map());

  const addHabit = useCallback(async (habit: Habit): Promise<string> => {
    if (!householdId || !currentUser) throw new Error("Not authenticated");
    try {
      // Use currentUser.uid as creator since that's what we have available here
      // The original code used `user.uid` from useAuth() but currentUser.uid should match
      const docRef = await addDoc(collection(db, `households/${householdId}/habits`), {
        ...habit,
        titleLower: normalizeHabitTitle(habit.title),
        createdBy: currentUser.uid,
        isShared: habit.isShared ?? true,
        ownerId: habit.isShared ? null : currentUser.uid,
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit created');
      return docRef.id;
    } catch (error) {
      console.error('[addHabit] Failed to create habit:', error);
      toast.error('Failed to create habit. Please try again.');
      throw error;
    }
  }, [householdId, currentUser]);

  const updateHabit = useCallback(async (habit: Habit) => {
    if (!householdId) return;
    try {
      // Build update object, filtering out undefined values (Firestore rejects undefined)
      const updateData = Object.fromEntries(
        Object.entries({
          title: habit.title,
          titleLower: normalizeHabitTitle(habit.title),
          category: habit.category,
          type: habit.type,
          basePoints: habit.basePoints,
          scoringType: habit.scoringType,
          period: habit.period,
          targetCount: habit.targetCount,
          totalCount: habit.totalCount,
          isShared: habit.isShared,
          ownerId: habit.ownerId,
          isCustom: habit.isCustom,
          effortLevel: habit.effortLevel,
          presetId: habit.presetId,
          // Plan 080c: persist the chore assignee so a re-assignment sticks. The
          // .filter below drops it when undefined, so an unassigned habit (every
          // existing one) writes nothing new here — this stays dormant.
          assignedTo: habit.assignedTo,
        }).filter(([, value]) => value !== undefined)
      );

      await updateDoc(doc(db, `households/${householdId}/habits`, habit.id), {
        ...updateData,
        lastUpdated: serverTimestamp(),
      });
    } catch (error) {
      console.error('[updateHabit] Failed to update habit:', error);
      throw error;
    }
  }, [householdId]);

  const deleteHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      // F-XCUT-03: soft-delete into the unified trash (recoverable for 30 days).
      // Points already credited are NOT reversed on delete, so restoring the
      // habit doc verbatim never double-counts.
      await softDeleteDoc({ db, householdId, deletedBy: currentUser?.uid ?? null }, 'habit', id);
    } catch (error) {
      console.error('[deleteHabit] Failed to delete habit:', error);
      throw error;
    }
  }, [householdId, currentUser]);

  const archiveHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        archivedAt: getLocalDateString(),
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit archived');
    } catch (error) {
      console.error('[archiveHabit] Failed to archive habit:', error);
      toast.error('Failed to archive habit. Please try again.');
      throw error;
    }
  }, [householdId]);

  const unarchiveHabit = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        archivedAt: null,
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit restored');
    } catch (error) {
      console.error('[unarchiveHabit] Failed to unarchive habit:', error);
      toast.error('Failed to restore habit. Please try again.');
      throw error;
    }
  }, [householdId]);

  const reorderHabits = useCallback(async (updates: { id: string; order: number; category?: string }[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      updates.forEach(({ id, order, category }) => {
        const habitRef = doc(db, `households/${householdId}/habits`, id);
        const updateData: { order: number; category?: string } = { order };

        // Ensure category is a valid non-empty string if present
        if (category && typeof category === 'string' && category.trim().length > 0) {
          updateData.category = category.trim();
        }

        batch.update(habitRef, updateData);
      });
      await batch.commit();
      toast.success('Habits reordered');
    } catch (error) {
      console.error('[reorderHabits] Failed:', error);
      toast.error('Failed to reorder habits');
      throw error;
    }
  }, [householdId]);

  const toggleHabit = useCallback(async (id: string, direction: 'up' | 'down') => {
    if (!householdId || !currentUser || !householdSettingsRef.current) return;

    const habit = habitsRef.current.find(h => h.id === id);
    if (!habit) return;

    // LAZY RESET CHECK
    const isStale = isHabitStale(habit);
    let effectiveHabit = habit;

    if (isStale) {
      // If toggling down on a stale habit, just perform a reset (0 points)
      if (direction === 'down') {
        await updateDoc(doc(db, `households/${householdId}/habits`, id), {
          count: 0,
          lastUpdated: serverTimestamp(),
        });

        toast("Habit reset to 0 for today. Previous points preserved.", { icon: toastIcon(CalendarDays) });
        return;
      }

      // If toggling up, proceed as if count was 0.
      effectiveHabit = {
        ...habit,
        count: 0,
        // Use current time string for local logic consistency
        lastUpdated: new Date().toISOString(),
      };
    }

    // Use extracted business logic
    const result = processToggleHabit(effectiveHabit, direction);
    if (!result) return;

    // Atomically commit habit state + points in a single batch so both writes
    // succeed together or neither does (prevents points/habit desync on crash).
    const batch = writeBatch(db);

    // completedDates is written as a server-side arrayUnion/arrayRemove delta,
    // NEVER as the locally-computed array processToggleHabit returns — a device
    // with a stale offline cache would otherwise wholesale-overwrite (wipe) the
    // habit's completion history (2026-07-15 incident). Diff old vs new at the
    // write site: a toggle changes at most one date. Scalars (count/streak)
    // are self-correcting, so local computation stays safe.
    const prevDates = effectiveHabit.completedDates;
    const nextDates = result.updatedHabit.completedDates ?? prevDates;
    const addedDate = nextDates.find(d => !prevDates.includes(d));
    const removedDate = prevDates.find(d => !nextDates.includes(d));

    batch.update(doc(db, `households/${householdId}/habits`, id), {
      count: result.updatedHabit.count,
      totalCount: result.updatedHabit.totalCount,
      ...(addedDate !== undefined ? { completedDates: arrayUnion(addedDate) } : {}),
      ...(removedDate !== undefined ? { completedDates: arrayRemove(removedDate) } : {}),
      streakDays: result.updatedHabit.streakDays,
      lastUpdated: serverTimestamp(),
    });

    // Include points update in the same batch (only when points actually change).
    // Plan 080c: an assigned (per-member/kid chore) habit credits the assignee's OWN
    // member.points — their personal balance for rewards/allowance — instead of the
    // shared household pool. Unassigned/shared habits keep crediting the household,
    // and only those feed the household-points recompute (see habitLogic.ts).
    if (result.pointsChange !== 0) {
      batch.update(habitPointsTargetRef(householdId, habit.assignedTo), {
        'points.daily': increment(result.pointsChange),
        'points.weekly': increment(result.pointsChange),
        'points.total': increment(result.pointsChange),
      });
    }

    // F-HABITS-02 (streak milestone celebrations): a 'down' toggle can't cross
    // a milestone (streak only grows on 'up'), so this only fires forward.
    // Presentation-only per the feature spec — no bonus points are awarded
    // here, just a distinct toast plus (optionally) unlocking gated rewards.
    const nextStreakDays = result.updatedHabit.streakDays ?? effectiveHabit.streakDays;
    const milestone = direction === 'up'
      ? crossedMilestone(effectiveHabit.streakDays, nextStreakDays)
      : null;

    const newlyUnlockedRewards: RewardItem[] = [];
    if (milestone !== null) {
      const alreadyUnlocked = householdSettingsRef.current?.unlockedRewardIds ?? [];
      newlyUnlockedRewards.push(
        ...rewardsInventoryRef.current.filter(
          (reward) =>
            !alreadyUnlocked.includes(reward.id) &&
            reward.unlockRequirement &&
            rewardMilestoneSatisfied(reward, id, nextStreakDays)
        )
      );
      if (newlyUnlockedRewards.length > 0) {
        batch.update(doc(db, `households/${householdId}`), {
          unlockedRewardIds: arrayUnion(...newlyUnlockedRewards.map((r) => r.id)),
        });
      }
    }

    // Read BEFORE the commit so latency-compensated listeners can't already
    // reflect this write when we derive "was this the first completion ever".
    const wasFirstCompletion = direction === 'up' && !habitsRef.current.some(h => h.totalCount > 0);

    // F-XCUT-01: append a cross-domain activity-log entry INSIDE the same batch
    // so it co-commits atomically with the habit/points writes. Only an 'up'
    // toggle (a completion) is logged — a 'down' correction would clutter the
    // feed. AI/quota events are deliberately excluded from the log.
    if (direction === 'up') {
      appendActivityLog(batch, db, householdId, { uid: currentUser.uid, name: currentUser.displayName }, {
        domain: 'habit',
        action: 'habit_completed',
        summary: composeSummary(currentUser.displayName, 'completed', habit.title),
      });
    }

    await batch.commit();

    if (milestone !== null) {
      track('habit_milestone_reached', { habitId: id, milestone });
      toast(
        <div className="flex items-center gap-2">
          <span className="font-bold">{milestone}-day streak!</span>
          <span className="text-sm opacity-80">{habit.title}</span>
        </div>,
        {
          duration: 3500,
          icon: toastIcon(PartyPopper, 'text-habit-streak dark:text-habit-streak'),
          className: 'bg-habit-streak/10 text-habit-streak border border-habit-streak/25 font-medium rounded-btn shadow-raised',
        }
      );
      newlyUnlockedRewards.forEach((reward) => {
        track('habit_milestone_reward_unlocked', { habitId: id, milestone, rewardId: reward.id });
        toast(
          <div className="flex items-center gap-2">
            <span className="font-bold">Reward unlocked!</span>
            <span className="text-sm opacity-80">{reward.title}</span>
          </div>,
          {
            duration: 3500,
            icon: toastIcon(Gift, 'text-warm-600 dark:text-warm-300'),
            className: 'bg-warm-100 text-warm-700 border border-warm-300/50 dark:bg-warm-900/30 dark:text-warm-200 dark:border-warm-700/40 font-medium rounded-btn shadow-raised',
          }
        );
      });
    }

    track('habit_toggled', { positive: habit.type === 'positive', direction });
    if (shouldTrackFirstTime(FIRST_HABIT_FLAG, wasFirstCompletion)) track('first_habit_completed');

    // Toast feedback after the batch commits successfully. Rapid toggles of
    // the SAME habit fold into one running total (accumulate()) so the toast
    // updates in place — via the stable `habit-points-${id}` id, react-hot-toast
    // upserts rather than stacks — instead of piling up a toast per tap.
    if (result.pointsChange !== 0) {
      const { net, count } = accumulate(
        pointsToastAccumulatorRef.current,
        id,
        result.pointsChange,
        Date.now(),
        POINTS_TOAST_WINDOW_MS
      );
      const toastId = `habit-points-${id}`;

      if (net === 0) {
        // Up-then-down (or vice versa) within the window cancelled out —
        // nothing left to show, so drop the in-flight toast entirely. Also
        // clear the accumulator entry so the next toggle starts a fresh
        // story ("+10 pts (1.5x)") instead of inheriting the cancelled
        // sequence's count ("(3 changes)").
        toast.dismiss(toastId);
        pointsToastAccumulatorRef.current.delete(id);
      } else {
        const sign = net > 0 ? '+' : '';
        toast(
          <div className="flex items-center gap-2">
            <span className="font-bold">{sign}{net} pts</span>
            <span className="text-sm opacity-80">
              {count === 1 ? `(${result.multiplier}x)` : `(${count} changes)`}
            </span>
          </div>,
          {
            id: toastId,
            duration: POINTS_TOAST_WINDOW_MS,
            icon: net > 0
              ? toastIcon(Star, 'text-money-pos dark:text-money-posDark')
              : toastIcon(TrendingDown, 'text-money-neg dark:text-money-negDark'),
            // Per-toast className replaces the global Toaster one (dark
            // brand-800 surface), so restate shape/shadow alongside the
            // money-token surface. A className (not inline style) is used
            // so the .dark variants actually apply.
            className: net > 0
              ? 'bg-money-bgPos text-money-pos border border-money-pos/25 dark:bg-money-posDark/15 dark:text-money-posDark dark:border-money-posDark/30 font-medium rounded-btn shadow-raised'
              : 'bg-money-bgNeg text-money-neg border border-money-neg/25 dark:bg-money-negDark/15 dark:text-money-negDark dark:border-money-negDark/30 font-medium rounded-btn shadow-raised',
          }
        );
      }
    }
  }, [householdId, currentUser]);

  const resetHabit = useCallback(async (id: string) => {
    if (!householdId || !householdSettingsRef.current) return;

    const habit = habitsRef.current.find(h => h.id === id);
    if (!habit) return;

    // Check if habit is stale (from yesterday)
    const isStale = isHabitStale(habit);

    // Optimization: If habit count is 0 and it's not stale, there's nothing to reset.
    if (habit.count === 0 && !isStale) return;

    // If it's stale, we shouldn't subtract points because we didn't earn them today
    const pointsToRemove = isStale ? 0 : calculateResetPoints(habit);

    // If it's stale and already 0, we just need to update the timestamp to prevent further "stale" checks today
    if (isStale && habit.count === 0) {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        lastUpdated: serverTimestamp(),
      });
      toast('Reset', { icon: toastIcon(RotateCcw) });
      return;
    }

    // Which completion dates does this reset undo? Daily: only today. Weekly:
    // the live counter accumulates across the WHOLE current ISO week and every
    // completion day entered completedDates, so removing only today would leave
    // earlier-in-week dates behind for calculatePointsForDateRange (which scores
    // weekly habits once per ISO week from completedDates) to re-credit points
    // this reset just reversed — desyncing daily vs weekly/total on the next
    // corrective recompute. calculateResetPoints already reverses the whole
    // week's credit (it deducts from the full live counter), so dates-removed
    // and points-reversed agree.
    const today = getLocalDateString();
    const weekStartOf = (d: string): string =>
      format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const currentWeekStart = weekStartOf(today);
    const datesToRemove = habit.period === 'weekly'
      ? habit.completedDates.filter(d => weekStartOf(d) === currentWeekStart)
      : habit.completedDates.filter(d => d === today);
    const removeSet = new Set(datesToRemove);
    const newCompletedDates = habit.completedDates.filter(d => !removeSet.has(d));

    // Atomically commit habit state + points in a single batch so both writes
    // succeed together or neither does (prevents points/habit desync on crash).
    const resetBatch = writeBatch(db);

    resetBatch.update(doc(db, `households/${householdId}/habits`, id), {
      count: 0,
      // Server-side delta: remove ONLY this period's dates. Writing the
      // locally-computed array here lets a device with a stale offline cache
      // wholesale-overwrite (wipe) the habit's completion history. streakDays
      // is a self-correcting scalar, so local computation is safe. Only
      // included when there is actually something to remove (arrayRemove
      // requires at least one value).
      ...(datesToRemove.length > 0 ? { completedDates: arrayRemove(...datesToRemove) } : {}),
      streakDays: streakForHabit({ period: habit.period, completedDates: newCompletedDates, frozenDates: habit.frozenDates }),
      lastUpdated: serverTimestamp(),
    });

    if (pointsToRemove !== 0) {
      resetBatch.update(habitPointsTargetRef(householdId, habit.assignedTo), {
        'points.daily': increment(-pointsToRemove),
        'points.weekly': increment(-pointsToRemove),
        'points.total': increment(-pointsToRemove),
      });
    }

    await resetBatch.commit();

    toast('Reset', { icon: toastIcon(RotateCcw) });
  }, [householdId]);

  const addHabitSubmission = useCallback(async (
    habitId: string,
    count: number,
    timestamp?: string,
    note?: string,
    mood?: HabitSubmission['mood']
  ) => {
    if (!householdId || !currentUser) return;

    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) {
      toast.error('Habit not found');
      return;
    }

    // Use provided timestamp or current time
    const submissionTimestamp = timestamp || new Date().toISOString();
    const submissionDate = format(parseISO(submissionTimestamp), 'yyyy-MM-dd');

    try {
      const today = getLocalDateString();

      // The submission's own period: the day itself for daily habits, the
      // Monday-anchored week for weekly ones. A back-dated submission must only
      // affect ITS period — never today's / this week's live counter.
      const periodStartOf = (date: string): string =>
        habit.period === 'weekly'
          ? format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          : date;
      const isCurrentPeriod = periodStartOf(submissionDate) === periodStartOf(today);

      // Lazy-reset parity with toggleHabit: a stale habit's count belongs to a
      // previous period, so its live period counter is effectively 0.
      const liveCount = isHabitStale(habit) ? 0 : habit.count;

      // Count already recorded for the submission's own period. Current period:
      // the live counter. Past period: the sum of that period's stored
      // submissions — today's counter says nothing about a past day/week. Only
      // threshold habits need this (incremental scoring is per-action).
      let priorPeriodCount = liveCount;
      if (!isCurrentPeriod && habit.scoringType !== 'incremental') {
        const periodStart = periodStartOf(submissionDate);
        const periodEnd = habit.period === 'weekly'
          ? format(addDays(parseISO(periodStart), 6), 'yyyy-MM-dd')
          : submissionDate;
        const priorSnap = await getDocs(query(
          collection(db, `households/${householdId}/habits/${habitId}/submissions`),
          where('date', '>=', periodStart),
          where('date', '<=', periodEnd),
        ));
        priorPeriodCount = priorSnap.docs.reduce(
          (sum, d) => sum + (d.data() as HabitSubmission).count,
          0
        );
      }
      const newPeriodCount = priorPeriodCount + count;

      // Threshold habits only mark the date complete once the submission's own
      // period reaches the target — the rest of the subsystem (streaks, point
      // recomputes) relies on the invariant "date in completedDates ⟹ target
      // met that day". Incremental habits complete on any action (toggle parity).
      const marksDateComplete =
        habit.scoringType === 'incremental' || newPeriodCount >= habit.targetCount;

      // Build the post-submission completion history so the multiplier can be
      // driven by the PROSPECTIVE streak (the streak that exists once this day is
      // counted), matching client toggle semantics rather than the pre-submission
      // streak. For "today" this equals streakForHabit(updatedCompletedDates); for
      // a back-dated submission it's the streak ending on that day.
      const updatedCompletedDates = [...habit.completedDates];
      const dateNewlyCompleted = marksDateComplete && !updatedCompletedDates.includes(submissionDate);
      if (dateNewlyCompleted) {
        updatedCompletedDates.push(submissionDate);
        updatedCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      }

      const prospectiveStreak = streakEndingOnForHabit(
        { period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates },
        submissionDate
      );
      const multiplier = getMultiplier(prospectiveStreak, habit.type === 'positive', habit.period);

      // A period completed via the toggle path (whose counter has since been
      // reset) leaves no submissions behind — the completedDates check stops a
      // back-dated submission from awarding that period a second time.
      const alreadyCompletedInPeriod = habit.completedDates.some(
        d => periodStartOf(d) === periodStartOf(submissionDate)
      );

      // Signed via habit.type (see signedHabitPoints): a negative habit's
      // submission must DEBIT points. Reading basePoints raw awarded positive
      // points for every negative habit stored with a positive magnitude.
      let pointsEarned = 0;
      if (habit.scoringType === 'incremental') {
        pointsEarned = count * signedHabitPoints(habit, multiplier);
      } else if (
        newPeriodCount >= habit.targetCount &&
        priorPeriodCount < habit.targetCount &&
        !alreadyCompletedInPeriod
      ) {
        // Threshold: this submission pushes its OWN period over the target.
        pointsEarned = signedHabitPoints(habit, multiplier);
      }

      // Create submission document. note/mood are only included when provided
      // — Firestore rejects an explicit `undefined` field value on addDoc.
      const submission: Omit<HabitSubmission, 'id'> = {
        habitId,
        habitTitle: habit.title,
        timestamp: submissionTimestamp,
        date: submissionDate,
        count,
        pointsEarned,
        streakDaysAtTime: prospectiveStreak,
        multiplierApplied: multiplier,
        createdBy: currentUser.uid,
        createdAt: new Date().toISOString(),
        ...(note && note.trim() ? { note: note.trim().slice(0, 280) } : {}),
        ...(mood ? { mood } : {}),
      };

      // Atomically commit the submission doc, habit state, and points in a single
      // batch so all three writes succeed together or none do (prevents
      // points/habit desync on crash).
      const addBatch = writeBatch(db);

      const submissionRef = doc(collection(db, `households/${householdId}/habits/${habitId}/submissions`));
      addBatch.set(submissionRef, submission);

      addBatch.update(doc(db, `households/${householdId}/habits`, habitId), {
        // Only a current-period submission bumps the live counter (a stale
        // counter is lazily reset first); totalCount is lifetime so it always
        // absorbs the count.
        count: isCurrentPeriod ? liveCount + count : liveCount,
        totalCount: habit.totalCount + count,
        // Server-side arrayUnion delta, only when this submission newly
        // completes the date — never the locally-computed array (a stale
        // offline cache would wholesale-overwrite the habit's completion
        // history; 2026-07-15 incident).
        ...(dateNewlyCompleted ? { completedDates: arrayUnion(submissionDate) } : {}),
        streakDays: streakForHabit({ period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates }),
        hasSubmissionTracking: true,
        lastUpdated: serverTimestamp(),
      });

      // Gate the period counters by the submission's date so a PAST-dated
      // submission doesn't inflate today's daily / this week's weekly totals —
      // mirroring deleteHabitSubmission / updateHabitSubmission. Total is always
      // adjusted (lifetime).
      if (pointsEarned !== 0) {
        const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

        const pointUpdates: Record<string, unknown> = {
          'points.total': increment(pointsEarned),
        };
        if (submissionDate === today) {
          pointUpdates['points.daily'] = increment(pointsEarned);
        }
        if (submissionDate >= weekStart && submissionDate <= today) {
          pointUpdates['points.weekly'] = increment(pointsEarned);
        }

        addBatch.update(habitPointsTargetRef(householdId, habit.assignedTo), pointUpdates);
      }

      await addBatch.commit();

      // A count of 0 means this call only attached a note/mood (the one-tap
      // reflection drawer) rather than logging a new completion — say so.
      toast.success(count > 0 ? `Logged +${count} submission(s)` : 'Reflection saved');
    } catch (error) {
      console.error('[addHabitSubmission] Failed:', error);
      toast.error('Failed to add submission');
    }
  }, [householdId, currentUser]);

  const getHabitSubmissions = useCallback(async (
    habitId: string,
    startDate?: string,
    endDate?: string
  ): Promise<HabitSubmission[]> => {
    if (!householdId) return [];

    try {
      let submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        orderBy('timestamp', 'desc')
      );

      // Add date range filters if provided
      if (startDate) {
        submissionsQuery = query(submissionsQuery, where('date', '>=', startDate));
      }
      if (endDate) {
        submissionsQuery = query(submissionsQuery, where('date', '<=', endDate));
      }

      const snapshot = await getDocs(submissionsQuery);
      return snapshot.docs.map(d => ({
        ...d.data(),
        id: d.id,
      } as HabitSubmission));
    } catch (error) {
      console.error('[getHabitSubmissions] Failed:', error);
      return [];
    }
  }, [householdId]);

  const deleteHabitSubmission = useCallback(async (habitId: string, submissionId: string) => {
    if (!householdId) return;

    try {
      // Step 1: Get submission to calculate point reversal
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const submission = submissionSnap.data() as HabitSubmission;
      const habit = habitsRef.current.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Check if this is the last submission for this date
      const submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '==', submission.date)
      );
      const submissionsSnap = await getDocs(submissionsQuery);
      const isLastForDate = submissionsSnap.size === 1;

      // Steps 3–5: Build a single batch so the submission delete, habit update,
      // and points reversal all commit atomically.  A runTransaction cannot be
      // used here because the isLastForDate check requires a collection query,
      // and Firestore transactions only accept DocumentReference reads — not
      // arbitrary queries.  Using a writeBatch still gives us atomicity for the
      // writes; the query-then-batch pattern is the standard Firestore approach
      // when the condition relies on an aggregation query.
      const deleteBatch = writeBatch(db);

      // Habit aggregate update (step 3)
      const updatedCompletedDates = isLastForDate
        ? habit.completedDates.filter(d => d !== submission.date)
        : habit.completedDates;

      const habitUpdates: Record<string, unknown> = {
        count: Math.max(0, habit.count - submission.count),
        totalCount: Math.max(0, habit.totalCount - submission.count),
        lastUpdated: serverTimestamp(),
      };

      if (isLastForDate) {
        // Server-side delta (never the locally-computed array — a stale local
        // cache would wholesale-overwrite the habit's completion history).
        habitUpdates['completedDates'] = arrayRemove(submission.date);
        habitUpdates['streakDays'] = streakForHabit({ period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates });
      }

      deleteBatch.update(doc(db, `households/${householdId}/habits`, habitId), habitUpdates);

      // Submission delete (step 4)
      deleteBatch.delete(submissionRef);

      // Points reversal (step 5)
      const today = getLocalDateString();
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

      const pointUpdates: Record<string, unknown> = {
        'points.total': increment(-submission.pointsEarned),
      };

      if (submission.date === today) {
        pointUpdates['points.daily'] = increment(-submission.pointsEarned);
      }

      if (submission.date >= weekStart && submission.date <= today) {
        pointUpdates['points.weekly'] = increment(-submission.pointsEarned);
      }

      deleteBatch.update(habitPointsTargetRef(householdId, habit.assignedTo), pointUpdates);

      await deleteBatch.commit();

      toast.success('Submission deleted');
    } catch (error) {
      console.error('[deleteHabitSubmission] Failed:', error);
      toast.error('Failed to delete submission');
    }
  }, [householdId]);

  /**
   * Reset a habit's log for ONE calendar day back to zero — the day-editor
   * twin of `resetHabit` (which only understands the live period). Used by the
   * habit calendars' × control.
   *
   * Deletes every submission stored for that date, reversing EXACTLY the
   * points each one earned (the stored `pointsEarned`, so a reversal always
   * undoes what was actually credited — even entries written before the
   * negative-habit sign fix). Days completed via the toggle path leave no
   * submission docs; for those the reversal is derived with the same per-date
   * attribution the corrective recompute uses (`pointsForHabitOnDate`), or —
   * for today — the tested `calculateResetPoints` math. Submission deletes,
   * habit state, and points reversal commit in a single atomic batch.
   */
  const resetHabitDay = useCallback(async (habitId: string, date: string) => {
    if (!householdId) return;

    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) return;

    try {
      const today = getLocalDateString();

      const subsSnap = await getDocs(query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '==', date),
      ));

      const wasCompleted = habit.completedDates.includes(date);
      if (subsSnap.empty && !wasCompleted) return; // nothing logged that day

      let pointsToReverse = 0;
      let unitsRemoved = 0;
      const batch = writeBatch(db);

      subsSnap.docs.forEach(d => {
        const s = d.data() as HabitSubmission;
        pointsToReverse += s.pointsEarned;
        unitsRemoved += s.count;
        batch.delete(d.ref);
      });

      if (subsSnap.empty) {
        if (date === today && !isHabitStale(habit)) {
          // Live completion (toggle path): reuse the tested reset math,
          // including the pre/post-threshold multiplier split for incrementals.
          pointsToReverse = calculateResetPoints(habit);
          unitsRemoved = habit.count;
        } else {
          // Historical toggle-path day: reverse the same per-date attribution
          // calculatePointsForDate assigns it (past incremental days = 1).
          pointsToReverse = pointsForHabitOnDate(habit, date, today);
          unitsRemoved = habit.scoringType === 'threshold' ? Math.max(1, habit.targetCount) : 1;
        }
      }

      // Does the cleared date fall in the habit's LIVE period? Only then does
      // the live counter shrink (a stale counter belongs to an older period).
      const periodStartOf = (d: string): string =>
        habit.period === 'weekly'
          ? format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          : d;
      const inLivePeriod =
        periodStartOf(date) === periodStartOf(today) && !isHabitStale(habit);

      const updatedCompletedDates = habit.completedDates.filter(d => d !== date);
      const habitUpdates: Record<string, unknown> = {
        // Server-side delta (never the locally-computed array — a stale local
        // cache would wholesale-overwrite the habit's completion history).
        completedDates: arrayRemove(date),
        streakDays: streakForHabit({ period: habit.period, completedDates: updatedCompletedDates, frozenDates: habit.frozenDates }),
        totalCount: Math.max(0, habit.totalCount - unitsRemoved),
        lastUpdated: serverTimestamp(),
      };
      if (inLivePeriod) {
        habitUpdates['count'] = Math.max(0, habit.count - unitsRemoved);
      }
      batch.update(doc(db, `households/${householdId}/habits`, habitId), habitUpdates);

      // Reverse points with the same period gating as deleteHabitSubmission:
      // total always, daily only for today, weekly only inside the current week.
      if (pointsToReverse !== 0) {
        const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
        const pointUpdates: Record<string, unknown> = {
          'points.total': increment(-pointsToReverse),
        };
        if (date === today) {
          pointUpdates['points.daily'] = increment(-pointsToReverse);
        }
        if (date >= weekStart && date <= today) {
          pointUpdates['points.weekly'] = increment(-pointsToReverse);
        }
        batch.update(habitPointsTargetRef(householdId, habit.assignedTo), pointUpdates);
      }

      await batch.commit();

      toast('Day cleared', { icon: toastIcon(RotateCcw) });
    } catch (error) {
      console.error('[resetHabitDay] Failed:', error);
      toast.error('Failed to clear day');
    }
  }, [householdId]);

  const updateHabitSubmission = useCallback(async (
    habitId: string,
    submissionId: string,
    updates: Partial<HabitSubmission>
  ) => {
    if (!householdId) return;

    try {
      // Step 1: Get original submission to calculate point difference
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const originalSubmission = submissionSnap.data() as HabitSubmission;
      const habit = habitsRef.current.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Calculate new points if count changed
      let pointsDelta = 0;
      if (updates.count !== undefined && updates.count !== originalSubmission.count) {
        const countDelta = updates.count - originalSubmission.count;

        if (habit.scoringType === 'incremental') {
          // Signed via habit.type — mirrors addHabitSubmission.
          pointsDelta = countDelta * signedHabitPoints(habit, originalSubmission.multiplierApplied);
        } else {
          // For threshold, disallow count edits (too complex to recalculate)
          toast.error('Cannot edit count for threshold habits. Delete and re-add instead.');
          return;
        }
      }

      // Steps 3–5: Atomically commit the submission update, habit aggregate
      // update, and points adjustment in a single batch so all writes succeed
      // together or none do (prevents points/habit desync on crash).
      const updateBatch = writeBatch(db);

      // Step 3: Update submission document
      updateBatch.update(submissionRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });

      // Step 4: Update habit aggregate counts
      if (updates.count !== undefined) {
        const countDelta = updates.count - originalSubmission.count;
        updateBatch.update(doc(db, `households/${householdId}/habits`, habitId), {
          count: habit.count + countDelta,
          totalCount: habit.totalCount + countDelta,
          lastUpdated: serverTimestamp(),
        });
      }

      // Step 5: Update household points
      if (pointsDelta !== 0) {
        const submissionDate = updates.date || originalSubmission.date;
        const today = getLocalDateString();
        const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

        const pointUpdates: Record<string, unknown> = {
          'points.total': increment(pointsDelta),
        };

        // Only update daily if edited submission is from today
        if (submissionDate === today) {
          pointUpdates['points.daily'] = increment(pointsDelta);
        }

        // Only update weekly if edited submission is from this week
        if (submissionDate >= weekStart && submissionDate <= today) {
          pointUpdates['points.weekly'] = increment(pointsDelta);
        }

        updateBatch.update(habitPointsTargetRef(householdId, habit.assignedTo), pointUpdates);
      }

      await updateBatch.commit();

      toast.success('Submission updated');
    } catch (error) {
      console.error('[updateHabitSubmission] Failed:', error);
      toast.error('Failed to update submission');
    }
  }, [householdId]);

  // F-HABITS-01: set or clear a habit's planned-break end date. Passing a date
  // pauses the habit until that day (inclusive); passing null resumes it (the
  // field is removed via deleteField so isHabitPaused reads false immediately).
  const setHabitPause = useCallback(async (id: string, pausedUntil: string | null) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        pausedUntil: pausedUntil ?? deleteField(),
        lastUpdated: serverTimestamp(),
      });
      toast.success(pausedUntil ? 'Habit paused' : 'Habit resumed');
    } catch (error) {
      console.error('[setHabitPause] Failed to update pause:', error);
      toast.error('Failed to update pause');
      throw error;
    }
  }, [householdId]);

  return useMemo(() => ({
    addHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    unarchiveHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    setHabitPause,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions,
    resetHabitDay
  }), [
    addHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    unarchiveHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    setHabitPause,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions,
    resetHabitDay
  ]);
};
