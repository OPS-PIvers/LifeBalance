import React, { useMemo, useState } from 'react';
import { X, Award, Edit2, Minus, Plus } from 'lucide-react';
import { Habit } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { calculateStreak, getMultiplier } from '@/utils/habitLogic';
import { format, startOfWeek, eachDayOfInterval } from 'date-fns';
import toast from 'react-hot-toast';
import { doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase.config';

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

  if (!isOpen) return null;

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
            const updates: any = {
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
            <div className="mt-3 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                <span className="text-sm text-gray-600">Adjust Count:</span>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleToggleHabit(item.id, 'down')}
                        className="p-1 bg-white border border-gray-200 rounded shadow-sm hover:bg-gray-100"
                        aria-label="Decrease daily count"
                    >
                        <Minus size={16} />
                    </button>
                    <span className="font-bold w-6 text-center">{item.count}</span>
                    <button
                         onClick={() => handleToggleHabit(item.id, 'up')}
                         className="p-1 bg-white border border-gray-200 rounded shadow-sm hover:bg-gray-100"
                         aria-label="Increase daily count"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>
        );
    }

    if (view === 'weekly') {
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const days = eachDayOfInterval({ start: weekStart, end: new Date() });

        return (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-2">Toggle days to adjust history:</p>
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
                                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                }`}
                            >
                                <span className="text-xs font-bold">{dayLabel}</span>
                                <div className={`w-3 h-3 rounded-full ${isCompleted ? 'bg-brand-500' : 'bg-gray-300'}`} />
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (view === 'total') {
        return (
             <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                 <p className="text-sm text-gray-600 mb-2">Total Count Correction:</p>
                 <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleUpdateTotalCount(item, item.totalCount - 1)}
                        className="p-1 bg-white border border-gray-200 rounded shadow-sm hover:bg-gray-100"
                        aria-label="Decrease total count"
                    >
                        <Minus size={16} />
                    </button>
                    <span className="font-bold min-w-[3rem] text-center">{item.totalCount}</span>
                    <button
                         onClick={() => handleUpdateTotalCount(item, item.totalCount + 1)}
                         className="p-1 bg-white border border-gray-200 rounded shadow-sm hover:bg-gray-100"
                         aria-label="Increase total count"
                    >
                        <Plus size={16} />
                    </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">Adjusting this only affects lifetime stats, not points.</p>

                <p className="text-sm text-gray-600 mb-2 mt-4">Total Lifetime Completions:</p>
                <div className="flex items-center gap-3">
                   <span className="font-bold min-w-[3rem] text-center">
                   {item.totalCount}
                   </span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                   This shows lifetime completion count. Points displayed above are estimates based on base value.
                </p>
             </div>
        );
    }

    return null;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 shrink-0">
          <h2 className="text-lg font-bold text-gray-800">{getTitle()}</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {contributions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Award className="w-8 h-8 text-gray-300" />
                </div>
                <p>No points recorded for this period.</p>
            </div>
          ) : (
            contributions.map((item) => (
              <div
                key={item.id}
                className={`border rounded-xl p-3 transition-all ${
                    editingHabitId === item.id ? 'ring-2 ring-brand-200 border-brand-300 bg-brand-50/30' : 'border-gray-100 hover:border-brand-200'
                }`}
              >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-xl">
                            {/* Simple emoji placeholder if no icon system */}
                            {item.title.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-800">{item.title}</h3>
                            <p className="text-xs text-gray-500">{item.details}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <span className="block font-bold text-brand-700">+{item.calculatedPoints}</span>
                            <span className="text-[10px] text-gray-400">points</span>
                        </div>
                        <button
                            onClick={() => handleEdit(item.id)}
                            className={`p-2 rounded-full transition-colors ${
                                editingHabitId === item.id
                                    ? 'bg-brand-100 text-brand-600'
                                    : 'text-gray-400 hover:bg-gray-100'
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

        <div className="p-4 border-t border-gray-100 bg-gray-50 text-center text-xs text-gray-400">
            {view === 'total' && "Total points are estimated from lifetime counts."}
            {view === 'weekly' && "Points are calculated based on completed days this week."}
            {view === 'daily' && "Points earned today."}
        </div>
      </div>
    </div>
  );
};

export default PointsBreakdownModal;
