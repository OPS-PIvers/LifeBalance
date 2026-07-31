import React, { useMemo, useState } from 'react';
import { Award, Edit2, Minus, Plus } from 'lucide-react';
import { Habit } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { signedHabitPoints } from '@/utils/habitLogic';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';
import { HabitsModelPrimerLink } from '@/components/habits/HabitsModelPrimer';

interface PointsBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  habits: Habit[];
}

/**
 * Lifetime points contribution per habit, with a stepper to correct a habit's
 * `totalCount`.
 *
 * This drawer used to carry two further views — a `daily` count stepper and a
 * `weekly` day-toggle grid that edited `completedDates` and household points
 * directly. Both went unreachable in PR #819 (`74069195`, 2026-07-05), which
 * collapsed Settings' three points rows into the single "Points breakdown"
 * link, and were deleted rather than repaired: the weekly editor's threshold
 * branch skipped the points adjustment while still writing `completedDates`,
 * so removing a day inflated the household pool permanently
 * (`computeHouseholdPointsSync` only ever RAISES `points.total`). Live totals
 * are shown persistently by `TopToolbar`, and per-day history is edited on the
 * Habits page (`resetHabitDay` / `DayHabitEditor`), which reverses attribution
 * properly.
 */
const PointsBreakdownModal: React.FC<PointsBreakdownModalProps> = ({
  isOpen,
  onClose,
  habits,
}) => {
  const { updateHabit } = useGamification();
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);

  // Derived state for the list
  const contributions = useMemo(() => {
    return habits
      .map(habit => {
        // Use totalCount or completedDates length
        if (habit.totalCount === 0 && habit.completedDates.length === 0) return null;

        // Rough estimation for total points if not stored.
        // We don't store per-habit total points, only household total.
        // So we display totalCount (lifetime completions/units) and calculate base points earned.
        // Note: Actual points earned historically may differ due to streaks/multipliers.
        return {
          ...habit,
          calculatedPoints: habit.totalCount * signedHabitPoints(habit),
          details: `${habit.totalCount} total`,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => b.calculatedPoints - a.calculatedPoints);
  }, [habits]);

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

  // Render Edit Controls
  const renderEditControls = (item: typeof contributions[0]) => (
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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Total Points Contribution"
      noPadding={true}
      footer={
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-700 text-center text-xs text-brand-400 dark:text-brand-450">
          Total points are estimated from lifetime counts.
          {/* Primer entry point: the drawer portals to document.body after this
              one, so it stacks on top; same quiet-link idiom as the Track tab. */}
          <HabitsModelPrimerLink className="mt-1.5 flex justify-center" />
        </div>
      }
    >
      <div className="p-4">
          {contributions.length === 0 ? (
            <EmptyState
                icon={<Award className="w-8 h-8" />}
                title="No lifetime points recorded yet."
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
    </Drawer>
  );
};

export default PointsBreakdownModal;
