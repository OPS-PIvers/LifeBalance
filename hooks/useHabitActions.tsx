import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  increment,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import {
  Habit,
  HabitSubmission,
  HouseholdMember,
  Household
} from '@/types/schema';
import {
  processToggleHabit,
  calculateResetPoints,
  calculateStreak,
  isHabitStale,
  getMultiplier
} from '@/utils/habitLogic';
import toast from 'react-hot-toast';
import { format, parseISO, startOfWeek } from 'date-fns';

export const useHabitActions = (
  householdId: string | null,
  currentUser: HouseholdMember | null,
  habits: Habit[],
  householdSettings: Household | null
) => {
  // Keep mutable refs so callbacks can read the latest habits/settings without
  // including them in dep arrays.  This prevents every habit write from
  // recreating all callbacks and cascading re-renders to all consumers.
  const habitsRef = useRef<Habit[]>(habits);
  useEffect(() => { habitsRef.current = habits; }, [habits]);

  const householdSettingsRef = useRef<Household | null>(householdSettings);
  useEffect(() => { householdSettingsRef.current = householdSettings; }, [householdSettings]);

  const addHabit = useCallback(async (habit: Habit): Promise<string> => {
    if (!householdId || !currentUser) throw new Error("Not authenticated");
    try {
      // Use currentUser.uid as creator since that's what we have available here
      // The original code used `user.uid` from useAuth() but currentUser.uid should match
      const docRef = await addDoc(collection(db, `households/${householdId}/habits`), {
        ...habit,
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
          category: habit.category,
          type: habit.type,
          basePoints: habit.basePoints,
          scoringType: habit.scoringType,
          period: habit.period,
          targetCount: habit.targetCount,
          totalCount: habit.totalCount,
          weatherSensitive: habit.weatherSensitive ?? false,
          telegramAlias: habit.telegramAlias,
          isShared: habit.isShared,
          ownerId: habit.ownerId,
          isCustom: habit.isCustom,
          effortLevel: habit.effortLevel,
          presetId: habit.presetId,
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
      await deleteDoc(doc(db, `households/${householdId}/habits`, id));
    } catch (error) {
      console.error('[deleteHabit] Failed to delete habit:', error);
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

        toast("Habit reset to 0 for today. Previous points preserved.", { icon: '📅' });
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

    batch.update(doc(db, `households/${householdId}/habits`, id), {
      count: result.updatedHabit.count,
      totalCount: result.updatedHabit.totalCount,
      completedDates: result.updatedHabit.completedDates,
      streakDays: result.updatedHabit.streakDays,
      lastUpdated: serverTimestamp(),
    });

    // Include points update in the same batch (only when points actually change)
    if (result.pointsChange !== 0) {
      batch.update(doc(db, `households/${householdId}`), {
        'points.daily': increment(result.pointsChange),
        'points.weekly': increment(result.pointsChange),
        'points.total': increment(result.pointsChange),
      });
    }

    await batch.commit();

    // Toast feedback after the batch commits successfully
    if (result.pointsChange !== 0) {
      const sign = result.pointsChange > 0 ? '+' : '';
      toast(
        <div className="flex items-center gap-2">
          <span className="font-bold">{sign}{result.pointsChange} pts</span>
          <span className="text-sm opacity-80">({result.multiplier}x)</span>
        </div>,
        {
          duration: 1500,
          icon: result.pointsChange > 0 ? '🌟' : '📉',
          style: {
            background: result.pointsChange > 0 ? '#ECFDF5' : '#FFF1F2',
            color: result.pointsChange > 0 ? '#065F46' : '#9F1239',
            border: result.pointsChange > 0 ? '1px solid #A7F3D0' : '1px solid #FECDD3',
          },
        }
      );
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
      toast('Reset', { icon: '↺' });
      return;
    }

    // Filter out today's date if present (handling both stale and non-stale cases)
    const today = format(new Date(), 'yyyy-MM-dd');
    const newCompletedDates = habit.completedDates.filter(d => d !== today);

    // Atomically commit habit state + points in a single batch so both writes
    // succeed together or neither does (prevents points/habit desync on crash).
    const resetBatch = writeBatch(db);

    resetBatch.update(doc(db, `households/${householdId}/habits`, id), {
      count: 0,
      completedDates: newCompletedDates,
      streakDays: calculateStreak(newCompletedDates),
      lastUpdated: serverTimestamp(),
    });

    if (pointsToRemove !== 0) {
      resetBatch.update(doc(db, `households/${householdId}`), {
        'points.daily': increment(-pointsToRemove),
        'points.weekly': increment(-pointsToRemove),
        'points.total': increment(-pointsToRemove),
      });
    }

    await resetBatch.commit();

    toast('Reset', { icon: '↺' });
  }, [householdId]);

  const addHabitSubmission = useCallback(async (habitId: string, count: number, timestamp?: string) => {
    if (!householdId || !currentUser) return;

    const habit = habitsRef.current.find(h => h.id === habitId);
    if (!habit) {
      toast.error('Habit not found');
      return;
    }

    // Use provided timestamp or current time
    const submissionTimestamp = timestamp || new Date().toISOString();
    const submissionDate = format(parseISO(submissionTimestamp), 'yyyy-MM-dd');

    // Calculate points based on current state
    const currentStreak = calculateStreak(habit.completedDates);
    const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

    let pointsEarned = 0;
    if (habit.scoringType === 'incremental') {
      pointsEarned = count * Math.floor(habit.basePoints * multiplier);
    } else {
      // Threshold: check if this submission hits target
      const newCount = habit.count + count;
      if (newCount >= habit.targetCount && habit.count < habit.targetCount) {
        pointsEarned = Math.floor(habit.basePoints * multiplier);
      }
    }

    try {
      // Create submission document
      const submission: Omit<HabitSubmission, 'id'> = {
        habitId,
        habitTitle: habit.title,
        timestamp: submissionTimestamp,
        date: submissionDate,
        count,
        pointsEarned,
        streakDaysAtTime: currentStreak,
        multiplierApplied: multiplier,
        createdBy: currentUser.uid,
        createdAt: new Date().toISOString(),
      };

      // Update habit's completedDates and count (maintain backwards compatibility)
      const updatedCompletedDates = [...habit.completedDates];
      if (!updatedCompletedDates.includes(submissionDate)) {
        updatedCompletedDates.push(submissionDate);
        updatedCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      }

      // Atomically commit the submission doc, habit state, and points in a single
      // batch so all three writes succeed together or none do (prevents
      // points/habit desync on crash).
      const addBatch = writeBatch(db);

      const submissionRef = doc(collection(db, `households/${householdId}/habits/${habitId}/submissions`));
      addBatch.set(submissionRef, submission);

      addBatch.update(doc(db, `households/${householdId}/habits`, habitId), {
        count: habit.count + count,
        totalCount: habit.totalCount + count,
        completedDates: updatedCompletedDates,
        streakDays: calculateStreak(updatedCompletedDates),
        hasSubmissionTracking: true,
        lastUpdated: serverTimestamp(),
      });

      if (pointsEarned !== 0) {
        addBatch.update(doc(db, `households/${householdId}`), {
          'points.daily': increment(pointsEarned),
          'points.weekly': increment(pointsEarned),
          'points.total': increment(pointsEarned),
        });
      }

      await addBatch.commit();

      toast.success(`Logged +${count} submission(s)`);
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
        habitUpdates['completedDates'] = updatedCompletedDates;
        habitUpdates['streakDays'] = calculateStreak(updatedCompletedDates);
      }

      deleteBatch.update(doc(db, `households/${householdId}/habits`, habitId), habitUpdates);

      // Submission delete (step 4)
      deleteBatch.delete(submissionRef);

      // Points reversal (step 5)
      const today = format(new Date(), 'yyyy-MM-dd');
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

      deleteBatch.update(doc(db, `households/${householdId}`), pointUpdates);

      await deleteBatch.commit();

      toast.success('Submission deleted');
    } catch (error) {
      console.error('[deleteHabitSubmission] Failed:', error);
      toast.error('Failed to delete submission');
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
          pointsDelta = countDelta * Math.floor(habit.basePoints * originalSubmission.multiplierApplied);
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
        const today = format(new Date(), 'yyyy-MM-dd');
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

        updateBatch.update(doc(db, `households/${householdId}`), pointUpdates);
      }

      await updateBatch.commit();

      toast.success('Submission updated');
    } catch (error) {
      console.error('[updateHabitSubmission] Failed:', error);
      toast.error('Failed to update submission');
    }
  }, [householdId]);

  return useMemo(() => ({
    addHabit,
    updateHabit,
    deleteHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions
  }), [
    addHabit,
    updateHabit,
    deleteHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    addHabitSubmission,
    updateHabitSubmission,
    deleteHabitSubmission,
    getHabitSubmissions
  ]);
};
