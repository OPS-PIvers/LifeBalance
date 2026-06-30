
import React, { useState, useMemo } from 'react';
import { Habit } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { X, MoreVertical, Edit2, Trash2, Target, Calendar, Wrench } from 'lucide-react';
import { cn } from '@/utils/cn';
import HabitFormModal from '@/components/modals/HabitFormModal';
import HabitSubmissionLogModal from '@/components/modals/HabitSubmissionLogModal';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import ProgressRing from '@/components/ui/ProgressRing';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { subDays, format } from 'date-fns';
import { haptic } from '@/utils/haptics';
import { getMultiplier } from '@/utils/habitLogic';
import StreakFlame from './StreakFlame';
import CountUp from './CountUp';

interface HabitCardProps {
  habit: Habit;
  dragHandle?: React.ReactNode;
}

const HabitCard: React.FC<HabitCardProps> = React.memo(({ habit, dragHandle }) => {
  const { toggleHabit, deleteHabit, resetHabit, activeChallenge, freezeBank, useFreezeBankToken: consumeFreezeBankToken } = useGamification();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 640px)');

  // Logic helpers
  const isPositive = habit.type === 'positive';
  const isActive = habit.count > 0;
  const isThreshold = habit.scoringType === 'threshold';
  
  // Challenge Logic
  const isLinkedToChallenge = activeChallenge?.relatedHabitIds.includes(habit.id);
  
  // Completion Logic
  const isCompleted = habit.count >= habit.targetCount;
  
  // Multipliers — period-aware (daily uses a 3/7-day ladder, weekly a 2/4-week
  // ladder). `habit.streakDays` holds the streak in the habit's own cadence, so
  // we feed it straight into the shared getMultiplier with habit.period.
  const streakMultiplier = getMultiplier(habit.streakDays, isPositive, habit.period);
  const totalMultiplier = streakMultiplier;

  const pointsDisplay = Math.floor(habit.basePoints * totalMultiplier);
  const signedPointsDisplay = isPositive ? pointsDisplay : -pointsDisplay;

  // Period-aware streak unit for the streak badge label ("Day(s)" vs "Week(s)").
  const isWeekly = habit.period === 'weekly';
  const streakUnitLabel = isWeekly ? 'Week' : 'Day';

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

  // Streak Repair Eligibility
  // Memoized so this date string is computed once per mount rather than on
  // every render of every card (habits lists can be long).
  const yesterday = useMemo(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'), []);
  const isEligibleForRepair =
    isPositive &&
    habit.period === 'daily' &&
    habit.streakDays === 0 &&
    !habit.completedDates.includes(yesterday) &&
    (freezeBank?.tokens || 0) > 0;

  // Grouped-flat ROW: borderless and hairline-separated by the parent
  // SurfaceList (HabitCategoryList) — never a floating, individually-bordered
  // card. Hierarchy comes from spacing + a quiet active tint (money-pos /
  // money-neg), not from a per-card border/shadow.
  const containerClasses = cn(
    "relative flex items-center justify-between px-4 py-3.5 transition-[transform,background-color] duration-(--duration-base) ease-(--ease-standard) active:scale-[0.99] select-none group/card",
    !isActive && "bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/40",
    isActive && isPositive && "bg-money-bgPos dark:bg-money-pos/10",
    isActive && !isPositive && "bg-money-bgNeg dark:bg-money-neg/10"
  );

  const buttonClasses = cn(
    "relative flex items-center justify-center w-14 h-14 rounded-card transition-colors duration-(--duration-fast) ease-(--ease-standard) z-10",
    !isActive && "bg-brand-100 dark:bg-brand-700 border border-brand-200 dark:border-brand-600 text-brand-400 dark:text-brand-500 group-hover/card:border-brand-300 dark:group-hover/card:border-brand-500 group-hover/card:bg-brand-200/60 dark:group-hover/card:bg-brand-600",
    isActive && isPositive && "bg-money-pos text-white border-0",
    isActive && !isPositive && "bg-money-neg text-white border-0",
    // Threshold visual overrides — in-progress positive threshold uses an evergreen tint
    isActive && isThreshold && !isCompleted && isPositive && "bg-accent-100 dark:bg-accent-800/40 text-accent-700 dark:text-accent-200 border border-accent-200 dark:border-accent-700"
  );

  const handleCardClick = () => {
    // Fire tactile feedback based on whether this tap completes the habit.
    // Reaching (or staying at) the target counts as a "success"; otherwise it
    // is a light increment nudge. Negative habits always use the light pattern.
    const willComplete = isPositive && !isCompleted && habit.count + 1 >= habit.targetCount;
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

  // Shared action set for the desktop dropdown (Menu) and mobile Drawer.
  const menuItems: MenuItem[] = [
    { key: 'edit', label: 'Edit', icon: <Edit2 size={14} />, onSelect: handleEdit },
    { key: 'log', label: 'View Log', icon: <Calendar size={14} />, onSelect: handleViewLog },
    ...(isEligibleForRepair
      ? [
          {
            key: 'repair',
            label: `Repair Streak (${freezeBank?.tokens})`,
            icon: <Wrench size={14} />,
            tone: 'info' as const,
            onSelect: () => {
              consumeFreezeBankToken(habit.id, yesterday);
              setIsMenuOpen(false);
            },
          },
        ]
      : []),
    { key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onSelect: handleDelete },
  ];

  return (
    <>
      <div className={containerClasses}>
        
        {/* Invisible clickable overlay for main card interaction */}
        <button
          onClick={handleCardClick}
          className="absolute inset-0 w-full h-full cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900 rounded-card"
          aria-label={`Toggle habit: ${habit.title}, current count: ${habit.count}`}
          tabIndex={0}
          style={{ zIndex: 1 }}
        />
        
        {/* ACTION INDICATOR */}
        <div className="shrink-0 mr-4 relative group pointer-events-none" style={{ zIndex: 2 }}>
          <div className={buttonClasses}>
            {isThreshold && !isCompleted ? (
              <span className="text-lg font-bold font-mono">{habit.count}</span>
            ) : isActive ? (
              <span className="text-xl font-bold font-mono">{habit.count}</span>
            ) : (
              <div className="w-6 h-6 rounded-full border-2 border-current opacity-40" />
            )}
            
            {/* Progress Ring for Threshold */}
            {isThreshold && (
              <ProgressRing
                percent={(habit.count / habit.targetCount) * 100}
                strokeWidth={3}
                trackClassName={isActive && !isCompleted ? 'text-brand-900/10 dark:text-white/10' : 'text-white/20'}
                barClassName={isCompleted ? 'text-white' : 'text-accent-600 dark:text-accent-300'}
                className="absolute inset-0 w-full h-full p-0.5 pointer-events-none"
              />
            )}
          </div>
          
          {/* Reset Button (X) - p-2 -m-2 enlarges tappable area to ~44px */}
          {isActive && (
            <button
              onClick={(e) => {
                 e.stopPropagation();
                 resetHabit(habit.id);
              }}
              className="absolute -top-2 -right-2 p-2 -m-2 bg-white dark:bg-brand-700 border border-brand-200 dark:border-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 dark:text-brand-300 active:scale-90 hover:bg-money-bgNeg dark:hover:bg-money-neg/20 hover:text-money-neg hover:border-money-neg/30 transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-1 focus:ring-money-neg/50 pointer-events-auto"
              aria-label="Reset habit progress"
              style={{ zIndex: 20 }}
            >
              <X size={12} strokeWidth={3} />
            </button>
          )}
        </div>

        {/* CONTENT */}
        <div className="flex-1 min-w-0 pointer-events-none" style={{ zIndex: 2 }}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className={cn("font-semibold tracking-tight text-sm truncate", isActive ? "text-brand-900 dark:text-brand-50" : "text-brand-700 dark:text-brand-200")}>
                {habit.title}
              </h3>
            </div>
            
            {/* Context Menu Trigger & Drag Handle */}
            <div className="flex items-center gap-1 -mr-2 relative" style={{ zIndex: 3 }}>
              {dragHandle && (
                <div className="text-brand-300 dark:text-brand-500 hover:text-brand-500 dark:hover:text-brand-300 cursor-grab active:cursor-grabbing p-1 pointer-events-auto">
                  {dragHandle}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(!isMenuOpen);
                }}
                className="p-2 -m-1 text-brand-300 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300 rounded-full hover:bg-brand-100 dark:hover:bg-brand-700/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 pointer-events-auto"
                aria-label="Habit options menu"
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical size={16} />
              </button>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {/* Points Potential */}
            <Badge variant={isPositive ? 'success' : 'danger'} size="sm">
              <CountUp value={signedPointsDisplay} suffix=" pts" />
            </Badge>

            {/* Streak (Positive Only) - Show only if streak is at least 2 days (Approaching) */}
            {isPositive && habit.streakDays >= 2 && (
              // "Hot" tier color once the bonus multiplier (>=1.5x) is actually
              // earned — period-aware via streakMultiplier rather than a fixed
              // 3-day threshold (weekly hits 1.5x at 2 weeks, not 3).
              <Badge
                variant={streakMultiplier >= 1.5 ? 'warning' : 'neutral'}
                size="sm"
                className="gap-1 transition-colors"
              >
                <StreakFlame streakDays={habit.streakDays} period={habit.period} size={10} className="text-habit-streak" />
                {habit.streakDays} {streakUnitLabel}{habit.streakDays !== 1 ? 's' : ''}
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
        </div>

        {/* Action menu (desktop dropdown; mobile uses the Drawer below) */}
        <Menu
          isOpen={isMenuOpen && isDesktop}
          onClose={() => setIsMenuOpen(false)}
          items={menuItems}
          ariaLabel="Habit actions menu"
          position="top-10 right-2"
          className="min-w-[140px]"
          stopPropagation
        />
      </div>

      {/* Mobile Drawer Actions */}
      <Drawer
        isOpen={isMenuOpen && !isDesktop}
        onClose={() => setIsMenuOpen(false)}
        title="Habit Options"
      >
        <div className="space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Edit2 className="text-brand-400" />}
            onClick={handleEdit}
          >
            Edit Habit
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Calendar className="text-brand-400" />}
            onClick={handleViewLog}
          >
            View History Log
          </Button>
          {isEligibleForRepair && (
            <Button
              variant="ghost"
              className="w-full justify-start text-lg py-4 text-habit-blue dark:text-habit-blue hover:text-habit-blue dark:hover:text-habit-blue hover:bg-habit-blue/10 dark:hover:bg-habit-blue/15"
              leftIcon={<Wrench className="text-habit-blue" />}
              onClick={() => {
                consumeFreezeBankToken(habit.id, yesterday);
                setIsMenuOpen(false);
              }}
            >
              Repair Streak ({freezeBank?.tokens})
            </Button>
          )}
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
  prev.dragHandle === next.dragHandle &&
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
  prev.habit.targetCount === next.habit.targetCount
);

HabitCard.displayName = 'HabitCard';

export default HabitCard;
