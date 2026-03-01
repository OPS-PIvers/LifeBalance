import React, { useMemo, useState } from 'react';
import { Award, Edit2, Minus, Plus } from 'lucide-react';
import { Habit } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { calculateStreak, getMultiplier } from '@/utils/habitLogic';
import { format, startOfWeek, eachDayOfInterval } from 'date-fns';
import toast from 'react-hot-toast';
import { doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';

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
  const { toggleHabit, updateHabit, householdId } = useHousehold();
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  // Derived state for the list
  const contributions = useMemo(() => {
    // Only calculate these once per render logic, but inside useMemo they are re-calculated on dep change.
    // Copilot suggested moving them out, but they depend on "current time" effectively.
    // For consistency, we keep them here.
    const today = format(new Date(), 'yyyy-MM-dd');
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');

    // Filter and map habits based on view
    return habits
      .map(habit => {
        let points = 0;
        let details = '';
        let relevantCount = 0;
        let relevantDates: string[] = [];

        const currentStreak = calculateStreak(habit.completedDates);
        const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

        if (view === 'daily') {
          if (!habit.completedDates.includes(today)) return null;
          if (habit.count === 0) return null; // Should have count if completed today

          if (habit.scoringType === 'incremental') {
            points = habit.count * Math.floor(habit.basePoints * multiplier);
            details = `${habit.count} times`;
            relevantCount = habit.count;
          } else {
            // Threshold
            if (habit.count >= habit.targetCount) {
              points = Math.floor(habit.basePoints * multiplier);
              details = 'Completed';
              relevantCount = 1;
            } else {
              return null; // Not completed yet
            }
          }
        } else if (view === 'weekly') {
          // Find completions this week
          relevantDates = habit.completedDates.filter(d => d >= weekStartStr && d <= today);
          if (relevantDates.length === 0) return null;

          if (habit.scoringType === 'incremental') {
             // Approximation for legacy; use actual count for today when available,
             // and assume 1 unit for each prior active day in the week.
             // This is used for display purposes.
             let totalUnits = 0;
             for (const dateStr of relevantDates) {
                if (dateStr === today) {
                    totalUnits += habit.count ?? 0;
                } else {
                    // We don't store historical per-day counts; assume at least 1 unit.
                    totalUnits += 1;
                }
             }
             points = totalUnits * Math.floor(habit.basePoints * multiplier);
             details = `${totalUnits} units over ${relevantDates.length} days`;
          } else {
             points = relevantDates.length * Math.floor(habit.basePoints * multiplier);
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
          points = habit.totalCount * Math.floor(habit.basePoints);
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
  }, [habits, view]);

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

    // Recalculate streak based on NEW dates to get correct multiplier
    const newStreak = calculateStreak(newCompletedDates);
    const multiplier = getMultiplier(newStreak, habit.type === 'positive');
    const pointsPerCompletion = Math.floor(habit.basePoints * multiplier);

    // Determine points change
    let pointsChange = 0;
    if (habit.scoringType === 'threshold') {
        // For threshold-scoring habits, we cannot accurately know if points were earned/lost
        // by toggling a past date without knowing the count for that day.
        // To be safe and avoid "free points" exploits or negative dips, we skip points adjustment here.
        pointsChange = 0;

        // Notify user if they are adding/removing a date but points won't change
        toast('Date updated. Points unchanged for threshold habit as daily count history is not tracked.', { icon: 'ℹ️' });
    } else {
        pointsChange = isCompleted ? -pointsPerCompletion : pointsPerCompletion;
    }

    try {
        // Update habit
        await updateDoc(doc(db, `households/${householdId}/habits`, habit.id), {
            completedDates: newCompletedDates,
            streakDays: newStreak,
            lastUpdated: serverTimestamp()
        });

        // Update household points
        if (pointsChange !== 0) {
            const updates: Record<string, unknown> = {
                'points.total': increment(pointsChange)
            };

            // If modified date is today
            const today = format(new Date(), 'yyyy-MM-dd');
            if (dateStr === today) {
                updates['points.daily'] = increment(pointsChange);
            }

            // If modified date is this week
            const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
            if (dateStr >= weekStart && dateStr <= today) {
                updates['points.weekly'] = increment(pointsChange);
            }

            await updateDoc(doc(db, `households/${householdId}`), updates);
        }

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
            <div className="mt-3 p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                <span className="text-sm text-slate-600">Adjust Count:</span>
                <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="icon-sm"
                        onClick={() => handleToggleHabit(item.id, 'down')}
                        aria-label="Decrease daily count"
                    >
                        <Minus size={16} />
                    </Button>
                    <span className="font-bold w-6 text-center">{item.count}</span>
                    <Button
                        variant="secondary"
                        size="icon-sm"
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
            <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-2">Toggle days to adjust history:</p>
                <div className="flex justify-between">
                    {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const isCompleted = item.completedDates.includes(dateStr);
                        const dayLabel = format(day, 'EEE');

                        return (
                            <button
                                key={dateStr}
                                onClick={() => toggleDate(item, dateStr)}
                                className={`flex flex-col items-center gap-1 p-2 rounded transition-colors ${
                                    isCompleted
                                        ? 'bg-brand-100 text-brand-700'
                                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                }`}
                            >
                                <span className="text-xs font-bold">{dayLabel}</span>
                                <div className={`w-3 h-3 rounded-full ${isCompleted ? 'bg-brand-500' : 'bg-slate-300'}`} />
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (view === 'total') {
        return (
             <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                 <p className="text-sm text-slate-600 mb-2">Total Count Correction:</p>
                 <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="icon-sm"
                        onClick={() => handleUpdateTotalCount(item, item.totalCount - 1)}
                        aria-label="Decrease total count"
                    >
                        <Minus size={16} />
                    </Button>
                    <span className="font-bold min-w-[3rem] text-center">{item.totalCount}</span>
                    <Button
                        variant="secondary"
                        size="icon-sm"
                        onClick={() => handleUpdateTotalCount(item, item.totalCount + 1)}
                        aria-label="Increase total count"
                    >
                        <Plus size={16} />
                    </Button>
                </div>
                <p className="text-xs text-slate-400 mt-2">Adjusting this only affects lifetime stats, not points.</p>

                <p className="text-sm text-slate-600 mb-2 mt-4">Total Lifetime Completions:</p>
                <div className="flex items-center gap-3">
                   <span className="font-bold min-w-[3rem] text-center">
                   {item.totalCount}
                   </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
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
      <div className="p-4 space-y-3">
          {contributions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Award className="w-8 h-8 text-slate-300" />
                </div>
                <p>No points recorded for this period.</p>
            </div>
          ) : (
            contributions.map((item) => (
              <div
                key={item.id}
                className={`border rounded-xl p-3 transition-all ${
                    editingHabitId === item.id ? 'ring-2 ring-brand-200 border-brand-300 bg-brand-50/30' : 'border-slate-100 hover:border-brand-200'
                }`}
              >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-xl">
                            {/* Simple emoji placeholder if no icon system */}
                            {item.title.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-800">{item.title}</h3>
                            <p className="text-xs text-slate-500">{item.details}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <span className="block font-bold text-brand-700">+{item.calculatedPoints}</span>
                            <span className="text-xxs text-slate-400">points</span>
                        </div>
                        <button
                            onClick={() => handleEdit(item.id)}
                            className={`p-2 rounded-full transition-colors ${
                                editingHabitId === item.id
                                    ? 'bg-brand-100 text-brand-600'
                                    : 'text-slate-400 hover:bg-slate-100'
                            }`}
                            aria-label={`Edit ${item.title}`}
                        >
                            <Edit2 size={16} />
                        </button>
                    </div>
                </div>

                {editingHabitId === item.id && renderEditControls(item)}
              </div>
            ))
          )}
      </div>

      <div className="sticky bottom-0 p-4 border-t border-slate-100 bg-slate-50 text-center text-xs text-slate-400">
        {view === 'total' && "Total points are estimated from lifetime counts."}
        {view === 'weekly' && "Points are calculated based on completed days this week."}
        {view === 'daily' && "Points earned today."}
      </div>
    </Drawer>
  );
};

export default PointsBreakdownModal;
