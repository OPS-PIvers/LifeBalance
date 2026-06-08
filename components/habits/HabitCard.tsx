
import React, { useState, useRef, useEffect } from 'react';
import { Habit } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { X, MoreVertical, Edit2, Trash2, Target, Calendar, Wrench } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import HabitFormModal from '@/components/modals/HabitFormModal';
import HabitSubmissionLogModal from '@/components/modals/HabitSubmissionLogModal';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { subDays, format } from 'date-fns';
import { haptic } from '@/utils/haptics';
import StreakFlame from './StreakFlame';
import CountUp from './CountUp';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HabitCardProps {
  habit: Habit;
  dragHandle?: React.ReactNode;
}

const HabitCard: React.FC<HabitCardProps> = React.memo(({ habit, dragHandle }) => {
  const { toggleHabit, deleteHabit, resetHabit, activeChallenge, freezeBank, useFreezeBankToken: consumeFreezeBankToken } = useGamification();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [focusedMenuIndex, setFocusedMenuIndex] = useState(0);
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);

  // Move focus to the first menu item when the desktop menu opens
  useEffect(() => {
    if (isMenuOpen && isDesktop && firstMenuItemRef.current) {
      firstMenuItemRef.current.focus();
    }
  }, [isMenuOpen, isDesktop]);
  
  // Logic helpers
  const isPositive = habit.type === 'positive';
  const isActive = habit.count > 0;
  const isThreshold = habit.scoringType === 'threshold';
  
  // Challenge Logic
  const isLinkedToChallenge = activeChallenge?.relatedHabitIds.includes(habit.id);
  
  // Completion Logic
  const isCompleted = habit.count >= habit.targetCount;
  
  // Multipliers
  const streakMultiplier = habit.streakDays >= 7 ? 2.0 : habit.streakDays >= 3 ? 1.5 : 1.0;
  const totalMultiplier = streakMultiplier;

  const pointsDisplay = Math.floor(habit.basePoints * totalMultiplier);
  const signedPointsDisplay = isPositive ? pointsDisplay : -pointsDisplay;

  // Streak Repair Eligibility
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const isEligibleForRepair =
    isPositive &&
    habit.period === 'daily' &&
    habit.streakDays === 0 &&
    !habit.completedDates.includes(yesterday) &&
    (freezeBank?.tokens || 0) > 0;

  const containerClasses = cn(
    "relative flex items-center justify-between p-5 rounded-2xl transition-all duration-300 select-none group/card shadow-glass",
    !isActive && "bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/5",
    isActive && isPositive && "bg-emerald-50/50 dark:bg-emerald-500/10 ring-1 ring-emerald-500/20",
    isActive && !isPositive && "bg-rose-50/50 dark:bg-rose-500/10 ring-1 ring-rose-500/20"
  );

  const buttonClasses = cn(
    "relative flex items-center justify-center w-14 h-14 rounded-2xl shadow-sm transition-all duration-200 z-10",
    !isActive && "bg-slate-50 dark:bg-slate-700 ring-1 ring-slate-200 dark:ring-slate-600 text-slate-300 dark:text-slate-500 group-hover/card:ring-slate-300 dark:group-hover/card:ring-slate-500 group-hover/card:bg-slate-100 dark:group-hover/card:bg-slate-600",
    isActive && isPositive && "bg-money-pos text-white shadow-emerald-200/50 ring-0",
    isActive && !isPositive && "bg-money-neg text-white shadow-rose-200/50 ring-0",
    // Threshold visual overrides
    isActive && isThreshold && !isCompleted && isPositive && "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30"
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

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const menuItems = isEligibleForRepair ? 4 : 3; // Edit, View Log, (Repair), Delete
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedMenuIndex((prev) => (prev + 1) % menuItems);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedMenuIndex((prev) => (prev - 1 + menuItems) % menuItems);
        break;
      case 'Escape':
        e.preventDefault();
        setIsMenuOpen(false);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        // Trigger the focused menu item
        if (focusedMenuIndex === 0) {
          handleEdit();
        } else if (focusedMenuIndex === 1) {
          handleViewLog();
        } else if (isEligibleForRepair && focusedMenuIndex === 2) {
          consumeFreezeBankToken(habit.id, yesterday);
          setIsMenuOpen(false);
        } else if ((isEligibleForRepair && focusedMenuIndex === 3) || (!isEligibleForRepair && focusedMenuIndex === 2)) {
          handleDelete();
        }
        break;
    }
  };

  return (
    <>
      <div className={containerClasses}>
        
        {/* Invisible clickable overlay for main card interaction */}
        <button
          onClick={handleCardClick}
          className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 rounded-card"
          aria-label={`Toggle habit: ${habit.title}, current count: ${habit.count}`}
          tabIndex={0}
          style={{ zIndex: 1 }}
        />
        
        {/* ACTION INDICATOR */}
        <div className="flex-shrink-0 mr-4 relative group pointer-events-none" style={{ zIndex: 2 }}>
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
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none p-0.5" viewBox="0 0 36 36" aria-hidden="true">
                 {/* Background Track */}
                 <path
                   className={isActive && !isCompleted ? "text-brand-800/10 dark:text-white/10" : "text-white/20"}
                   d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="3"
                 />
                 {/* Progress Path */}
                 <path
                   className={isCompleted ? "text-white" : "text-emerald-500"}
                   strokeDasharray={`${Math.min(100, (habit.count / habit.targetCount) * 100)}, 100`}
                   d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                   fill="none"
                   stroke="currentColor"
                   strokeWidth="3"
                   strokeLinecap="round"
                 />
              </svg>
            )}
          </div>
          
          {/* Reset Button (X) - p-2 -m-2 enlarges tappable area to ~44px */}
          {isActive && (
            <button
              onClick={(e) => {
                 e.stopPropagation();
                 resetHabit(habit.id);
              }}
              className="absolute -top-2 -right-2 p-2 -m-2 bg-white dark:bg-slate-700 ring-1 ring-slate-200 dark:ring-slate-600 rounded-full w-6 h-6 flex items-center justify-center text-slate-400 dark:text-slate-300 shadow-sm active:scale-90 hover:bg-rose-50 dark:hover:bg-rose-500/20 hover:text-money-neg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-400 pointer-events-auto"
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
              <h3 className={cn("font-semibold tracking-tight text-sm truncate", isActive ? "text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-300")}>
                {habit.title}
              </h3>
            </div>
            
            {/* Context Menu Trigger & Drag Handle */}
            <div className="flex items-center gap-1 -mr-2 relative" style={{ zIndex: 3 }}>
              {dragHandle && (
                <div className="text-slate-300 dark:text-slate-500 hover:text-slate-500 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing p-1 pointer-events-auto">
                  {dragHandle}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen(!isMenuOpen);
                  setFocusedMenuIndex(0); // Reset focus to first item
                }}
                className="p-1 text-slate-300 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-black/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-slate-400 pointer-events-auto"
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
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-xxs font-bold tracking-wide",
              isPositive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
            )}>
              <CountUp value={signedPointsDisplay} suffix=" pts" />
            </span>

            {/* Streak (Positive Only) - Show only if streak is at least 2 days (Approaching) */}
            {isPositive && habit.streakDays >= 2 && (
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xxs font-bold transition-colors",
                habit.streakDays >= 3
                  ? "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300"
                  : "bg-gray-100 text-gray-500 dark:bg-slate-700/50 dark:text-slate-400"
              )}>
                <StreakFlame streakDays={habit.streakDays} size={10} />
                {habit.streakDays} Day{habit.streakDays !== 1 ? 's' : ''}
              </span>
            )}

            {/* Multiplier nudge: one day short of the next tier (3-day=1.5x, 7-day=2x) */}
            {isPositive && (habit.streakDays === 2 || habit.streakDays === 6) && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xxs font-bold bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                1 day from {habit.streakDays === 6 ? '2x' : '1.5x'}!
              </span>
            )}

            {/* Linked Challenge Badge */}
            {isLinkedToChallenge && (
               <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xxs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                <Target size={10} /> Goal
              </span>
            )}
          </div>
        </div>

        {/* Menu Dropdown (Desktop Only) */}
        {isMenuOpen && isDesktop && (
          <>
            <div 
              className="fixed inset-0"
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
              }} 
              aria-hidden="true"
              style={{ zIndex: 10 }}
            />
            <div
              className="absolute top-10 right-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-brand-100 dark:border-slate-700 py-1 min-w-[120px] animate-in fade-in zoom-in-95 duration-100"
              role="menu"
              aria-orientation="vertical"
              aria-label="Habit actions menu"
              onKeyDown={handleMenuKeyDown}
              style={{ zIndex: 20 }}
            >
              <button
                ref={firstMenuItemRef}
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit();
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-brand-600 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-slate-700/50 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
                  focusedMenuIndex === 0 && "bg-brand-50 dark:bg-slate-700/50"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Edit2 size={14} /> Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewLog();
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-brand-600 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-slate-700/50 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
                  focusedMenuIndex === 1 && "bg-brand-50 dark:bg-slate-700/50"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Calendar size={14} /> View Log
              </button>
              {isEligibleForRepair && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    consumeFreezeBankToken(habit.id, yesterday);
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2 text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
                    focusedMenuIndex === 2 && "bg-indigo-50 dark:bg-indigo-500/15"
                  )}
                  role="menuitem"
                  tabIndex={-1}
                >
                  <Wrench size={14} /> Repair Streak ({freezeBank?.tokens})
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-money-neg hover:bg-rose-50 dark:hover:bg-rose-500/15 flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
                  focusedMenuIndex === (isEligibleForRepair ? 3 : 2) && "bg-rose-50 dark:bg-rose-500/15"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </>
        )}
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
            leftIcon={<Edit2 className="text-brand-500" />}
            onClick={handleEdit}
          >
            Edit Habit
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-lg py-4"
            leftIcon={<Calendar className="text-brand-500" />}
            onClick={handleViewLog}
          >
            View History Log
          </Button>
          {isEligibleForRepair && (
            <Button
              variant="ghost"
              className="w-full justify-start text-lg py-4 text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
              leftIcon={<Wrench className="text-indigo-500" />}
              onClick={() => {
                consumeFreezeBankToken(habit.id, yesterday);
                setIsMenuOpen(false);
              }}
            >
              Repair Streak ({freezeBank?.tokens})
            </Button>
          )}
          <div className="h-px bg-gray-100 dark:bg-slate-700 my-2" />
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
