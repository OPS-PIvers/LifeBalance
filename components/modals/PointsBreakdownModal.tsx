import React, { useMemo, useState } from 'react';
import { Award, Edit2, Info, Minus, Plus } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { Habit } from '@/types/schema';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { streakForHabit, streakEndingOnForHabit, getMultiplier, signedHabitPoints } from '@/utils/habitLogic';
import { format, startOfWeek, eachDayOfInterval } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';
import toast from 'react-hot-toast';
import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';

interface PointsBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  view: 'daily' | 'weekly' | 'total';
  habits: Habit[];
}

const PointsBreakdownModal: React.FC<PointsBreakdownModalProps> = ({
  isOpen,
  onClose,
  view,
  habits,
}) => {
  const { toggleHabit, updateHabit } = useGamification();
  const { householdId } = useHouseholdCore();
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  // Stable date strings derived once per render cycle — avoids repeated new Date()/format
  // calls inside the per-habit loop and the O(N) includes() scan on completedDates.
  const todayStr = useMemo(() => getLocalDateString(), []);
  const weekStartStr = useMemo(() => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), []);

  // Derived state for the list
  const contributions = useMemo(() => {
    // Filter and map habits based on view
    return habits
      .map(habit => {
        let points = 0;
        let details = '';
        let relevantCount = 0;
        let relevantDates: string[] = [];

        // O(1) membership lookup per date — avoids O(N) Array.includes() per habit
        const completedSet = new Set(habit.completedDates);

        const currentStreak = streakForHabit(habit);
        const multiplier = getMultiplier(currentStreak, habit.type === 'positive', habit.period);

        if (view === 'daily') {
          if (!completedSet.has(todayStr)) return null;
          if (habit.count === 0) return null; // Should have count if completed today

          if (habit.scoringType === 'incremental') {
            points = habit.count * signedHabitPoints(habit, multiplier);
            details = `${habit.count} times`;
            relevantCount = habit.count;
          } else {
            // Threshold
            if (habit.count >= habit.targetCount) {
              points = signedHabitPoints(habit, multiplier);
              details = 'Completed';
              relevantCount = 1;
            } else {
              return null; // Not completed yet
            }
          }
        } else if (view === 'weekly') {
          // Find completions this week
          relevantDates = habit.completedDates.filter(d => d >= weekStartStr && d <= todayStr);
          if (relevantDates.length === 0) return null;

          if (habit.scoringType === 'incremental') {
             // Approximation for legacy; use actual count for today when available,
             // and assume 1 unit for each prior active day in the week.
             // This is used for display purposes.
             let totalUnits = 0;
             for (const dateStr of relevantDates) {
                if (dateStr === todayStr) {
                    totalUnits += habit.count ?? 0;
                } else {
                    // We don't store historical per-day counts; assume at least 1 unit.
                    totalUnits += 1;
                }
             }
             points = totalUnits * signedHabitPoints(habit, multiplier);
             details = `${totalUnits} units over ${relevantDates.length} days`;
          } else {
             points = relevantDates.length * signedHabitPoints(habit, multiplier);
             details = `${relevantDates.length} days completed`;
          }
        } else {
          // Total
          // Use totalCount or completedDates length
          if (habit.totalCount === 0 && habit.completedDates.length === 0) return null;

          // Rough estimation for total points if not stored
          // We don't store per-habit total points, only household total.
          // So we display totalCount (lifetime completions/units) and calculate base points earned.
          // Note: Actual points earned historically may differ due to streaks/multipliers.
          points = habit.totalCount * signedHabitPoints(habit);
          details = `${habit.totalCount} total`;
        }

        return {
          ...habit,
          calculatedPoints: points,
          details,
          relevantCount,
          relevantDates
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => b.calculatedPoints - a.calculatedPoints);
  }, [habits, view, todayStr, weekStartStr]);

  const getTitle = () => {
    switch (view) {
      case 'daily': return "Today's Points";
      case 'weekly': return "This Week's Points";
      case 'total': return "Total Points Contribution";
    }
  };

  const handleEdit = (habitId: string) => {
    setEditingHabitId(habitId === editingHabitId ? null : habitId);
  };

  const handleUpdateTotalCount = async (item: Habit, newCount: number) => {
    try {
        await updateHabit({ ...item, totalCount: Math.max(0, newCount) } as Habit);
    } catch (error) {
        console.error('Failed to update total count:', error);
        toast.error('Failed to update count');
    }
  };

  const handleToggleHabit = async (id: string, direction: 'up' | 'down') => {
      try {
          await toggleHabit(id, direction);
      } catch (error) {
          console.error('Failed to toggle habit:', error);
          toast.error('Failed to update habit');
      }
  };

  // Logic to toggle a specific date for a habit (Weekly View)
  const toggleDate = async (habit: Habit, dateStr: string) => {
    if (!householdId) return;

    const isCompleted = habit.completedDates.includes(dateStr);
    let newCompletedDates = [...habit.completedDates];

    if (isCompleted) {
        // Remove date
        newCompletedDates = newCompletedDates.filter(d => d !== dateStr);
    } else {
        // Add date (restore)
        newCompletedDates.push(dateStr);
        // Keep completedDates in ascending chronological order (oldest first)
        newCompletedDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    }

    // Recompute the habit's CURRENT streak from the new dates so streakDays stays
    // accurate after the edit (period-aware). This is for the persisted streakDays
    // field only — NOT for the edited day's points multiplier (see below).
    const newStreak = streakForHabit({ period: habit.period, completedDates: newCompletedDates });

    // Points multiplier for the EDITED day must be DATE-ANCHORED, mirroring
    // calculatePointsForDateRange (utils/habitLogic.ts): each day earns the
    // multiplier its OWN streak (ending on that day) warranted, not the habit's
    // current streak. Using the current streak here can credit/debit more than the
    // corrective recompute later assigns, and computeHouseholdPointsSync only
    // clamps points.total upward — so the over-credit drifts permanently.
    //
    // The streak for the edited day must be computed against the set that INCLUDES
    // dateStr in BOTH branches:
    //   - add/restore: newCompletedDates already includes dateStr.
    //   - remove: the original credit was earned with dateStr present, so reverse
    //     it symmetrically against the PRE-removal set (habit.completedDates, which
    //     still includes dateStr) — not the post-removal set, which would use a
    //     different streak and leave residual drift.
    const datesForMultiplier = isCompleted ? habit.completedDates : newCompletedDates;
    const dayStreak = streakEndingOnForHabit(
        { period: habit.period, completedDates: datesForMultiplier },
        dateStr,
    );
    const multiplier = getMultiplier(dayStreak, habit.type === 'positive', habit.period);
    // Signed: restoring a negative habit's date must DEBIT points (and removing
    // one must credit them back) — raw basePoints credited them instead.
    const pointsPerCompletion = signedHabitPoints(habit, multiplier);

    // Determine points change
    let pointsChange = 0;
    if (habit.scoringType === 'threshold') {
        // For threshold-scoring habits, we cannot accurately know if points were earned/lost
        // by toggling a past date without knowing the count for that day.
        // To be safe and avoid "free points" exploits or negative dips, we skip points adjustment here.
        pointsChange = 0;

        // Notify user if they are adding/removing a date but points won't change
        toast('Date updated. Points unchanged for threshold habit as daily count history is not tracked.', { icon: toastIcon(Info) });
    } else {
        pointsChange = isCompleted ? -pointsPerCompletion : pointsPerCompletion;
    }

    try {
        // Commit the habit date change and the household points adjustment in a
        // SINGLE writeBatch so they can never partially apply (e.g. the date moves
        // but points don't, leaving the displayed total out of sync). This matches
        // the atomicity guarantee the context's habit mutations already provide.
        const batch = writeBatch(db);

        // Update habit
        batch.update(doc(db, `households/${householdId}/habits`, habit.id), {
            completedDates: newCompletedDates,
            streakDays: newStreak, // already computed from streakForHabit above
            lastUpdated: serverTimestamp()
        });

        // Update household points
        if (pointsChange !== 0) {
            const updates: Record<string, unknown> = {
                'points.total': increment(pointsChange)
            };

            // If modified date is today
            const today = getLocalDateString();
            if (dateStr === today) {
                updates['points.daily'] = increment(pointsChange);
            }

            // If modified date is this week
            const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
            if (dateStr >= weekStart && dateStr <= today) {
                updates['points.weekly'] = increment(pointsChange);
            }

            batch.update(doc(db, `households/${householdId}`), updates);
        }

        await batch.commit();

        toast.success(isCompleted ? 'Removed date' : 'Restored date');
    } catch (error) {
        console.error('Failed to update habit date or points:', error);
        toast.error('Failed to update points. Please try again.');
    }
  };

  // Render Edit Controls
  const renderEditControls = (item: typeof contributions[0]) => {
    if (view === 'daily') {
        return (
            <div className="flex items-center justify-between">
                <span className="text-sm text-brand-600 dark:text-brand-300">Adjust Count:</span>
                <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleToggleHabit(item.id, 'down')}
                        aria-label="Decrease daily count"
                    >
                        <Minus size={16} />
                    </Button>
                    <span className="font-bold w-6 text-center">{item.count}</span>
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleToggleHabit(item.id, 'up')}
                        aria-label="Increase daily count"
                    >
                        <Plus size={16} />
                    </Button>
                </div>
            </div>
        );
    }

    if (view === 'weekly') {
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const days = eachDayOfInterval({ start: weekStart, end: new Date() });

        return (
            <div>
                <p className="text-xs text-brand-500 dark:text-brand-400 mb-2">Toggle days to adjust history:</p>
                <div className="flex justify-between">
                    {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const isCompleted = item.completedDates.includes(dateStr);
                        const dayLabel = format(day, 'EEE');

                        return (
                            <button
                                key={dateStr}
                                onClick={() => toggleDate(item, dateStr)}
                                className={`flex flex-col items-center gap-1 p-2 rounded transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                                    isCompleted
                                        ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark'
                                        : 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-450 hover:bg-brand-200 dark:hover:bg-brand-700'
                                }`}
                            >
                                <span className="text-xs font-bold">{dayLabel}</span>
                                <div className={`w-3 h-3 rounded-full ${isCompleted ? 'bg-money-pos' : 'bg-brand-300 dark:bg-brand-600'}`} />
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (view === 'total') {
        return (
             <div>
                 <p className="text-sm text-brand-600 dark:text-brand-300 mb-2">Total Count Correction:</p>
                 <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleUpdateTotalCount(item, item.totalCount - 1)}
                        aria-label="Decrease total count"
                    >
                        <Minus size={16} />
                    </Button>
                    <span className="font-bold min-w-12 text-center">{item.totalCount}</span>
                    <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => handleUpdateTotalCount(item, item.totalCount + 1)}
                        aria-label="Increase total count"
                    >
                        <Plus size={16} />
                    </Button>
                </div>
                <p className="text-xs text-brand-400 dark:text-brand-450 mt-2">Adjusting this only affects lifetime stats, not points.</p>

                <p className="text-sm text-brand-600 dark:text-brand-300 mb-2 mt-4">Total Lifetime Completions:</p>
                <div className="flex items-center gap-3">
                   <span className="font-bold min-w-12 text-center">
                   {item.totalCount}
                   </span>
                </div>
                <p className="text-xs text-brand-400 dark:text-brand-450 mt-2">
                   This shows lifetime completion count. Points displayed above are estimates based on base value.
                </p>
             </div>
        );
    }

    return null;
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={getTitle()}
      noPadding={true}
    >
      <div className="p-4">
          {contributions.length === 0 ? (
            <EmptyState
                icon={<Award className="w-8 h-8" />}
                title="No points recorded for this period."
            />
          ) : (
            <SurfaceList>
              {contributions.map((item) => {
                const isEditing = editingHabitId === item.id;
                return (
                  <React.Fragment key={item.id}>
                    <Row className={isEditing ? 'bg-brand-50 dark:bg-brand-700/40' : undefined}>
                        <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-700/50 flex items-center justify-center text-xl shrink-0">
                            {/* Simple emoji placeholder if no icon system */}
                            {item.title.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-brand-800 dark:text-brand-100 text-sm truncate">{item.title}</h3>
                            <p className="text-xs text-brand-500 dark:text-brand-400 truncate">{item.details}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                                <span className="block font-mono font-bold tabular-nums text-warm-600 dark:text-warm-300">+{item.calculatedPoints}</span>
                                <span className="text-xxs text-brand-400 dark:text-brand-450">points</span>
                            </div>
                            <button
                                onClick={() => handleEdit(item.id)}
                                className={`p-2 rounded-full transition-colors ${
                                    isEditing
                                        ? 'bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300'
                                        : 'text-brand-400 dark:text-brand-450 hover:bg-brand-100 dark:hover:bg-brand-700/50'
                                }`}
                                aria-label={`Edit ${item.title}`}
                            >
                                <Edit2 size={16} />
                            </button>
                        </div>
                    </Row>

                    {isEditing && (
                      <div className="px-4 pb-4 pt-1">
                        {renderEditControls(item)}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </SurfaceList>
          )}
      </div>

      <div className="sticky bottom-0 p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/50 text-center text-xs text-brand-400 dark:text-brand-450">
        {view === 'total' && "Total points are estimated from lifetime counts."}
        {view === 'weekly' && "Points are calculated based on completed days this week."}
        {view === 'daily' && "Points earned today."}
      </div>
    </Drawer>
  );
};

export default PointsBreakdownModal;
