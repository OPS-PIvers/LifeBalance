
import React, { useState } from 'react';
import { Habit } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { X, Flame, MoreVertical, Edit2, Trash2, Target, Calendar, Copy } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import HabitFormModal from '../modals/HabitFormModal';
import HabitSubmissionLogModal from '../modals/HabitSubmissionLogModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HabitCardProps {
  habit: Habit;
}

const HabitCard: React.FC<HabitCardProps> = ({ habit }) => {
  const { toggleHabit, deleteHabit, resetHabit, addHabit, activeChallenge } = useHousehold();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [focusedMenuIndex, setFocusedMenuIndex] = useState(0);
  
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

  const containerClasses = cn(
    "relative flex items-center justify-between p-4 rounded-card border shadow-soft transition-all duration-300 select-none group/card",
    !isActive && "bg-white border-brand-100",
    isActive && isPositive && "bg-emerald-50 border-emerald-200",
    isActive && !isPositive && "bg-rose-50 border-rose-200"
  );

  const buttonClasses = cn(
    "relative flex items-center justify-center w-14 h-14 rounded-2xl shadow-sm transition-all duration-200 z-10",
    !isActive && "bg-brand-50 border-2 border-brand-200 text-brand-300 group-hover/card:border-brand-300 group-hover/card:bg-brand-100",
    isActive && isPositive && "bg-money-pos text-white shadow-emerald-200 border-transparent",
    isActive && !isPositive && "bg-money-neg text-white shadow-rose-200 border-transparent",
    // Threshold visual overrides
    isActive && isThreshold && !isCompleted && isPositive && "bg-emerald-100 text-emerald-600 border-emerald-200"
  );

  const handleCardClick = () => {
    toggleHabit(habit.id, 'up');
  };

  const handleDuplicate = async () => {
    // Create a copy and reset tracking fields
    const newHabit = { ...habit };
    newHabit.title = `${newHabit.title} (Copy)`;
    newHabit.count = 0;
    newHabit.totalCount = 0;
    newHabit.completedDates = [];
    newHabit.streakDays = 0;

    // Remove ID and submission tracking so new ones are generated/reset
    delete (newHabit as any).id;
    delete (newHabit as any).hasSubmissionTracking;

    try {
      await addHabit(newHabit);
      setIsMenuOpen(false);
    } catch (error) {
      console.error('Failed to duplicate habit:', error);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const menuItems = 4; // Edit, Duplicate, View Log, Delete
    
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
          setIsEditModalOpen(true);
          setIsMenuOpen(false);
        } else if (focusedMenuIndex === 1) {
          handleDuplicate();
        } else if (focusedMenuIndex === 2) {
          setIsLogModalOpen(true);
          setIsMenuOpen(false);
        } else if (focusedMenuIndex === 3) {
          deleteHabit(habit.id);
          setIsMenuOpen(false);
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
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none p-0.5" viewBox="0 0 36 36">
                 {/* Background Track */}
                 <path
                   className={isActive && !isCompleted ? "text-brand-800/10" : "text-white/20"}
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
          
          {/* Reset Button (X) */}
          {isActive && (
            <button
              onClick={(e) => {
                 e.stopPropagation();
                 resetHabit(habit.id);
              }}
              className="absolute -top-2 -right-2 bg-white border border-brand-200 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 shadow-sm active:scale-90 hover:bg-rose-50 hover:text-money-neg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-rose-400 pointer-events-auto"
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
              <h3 className={cn("font-bold text-sm truncate", isActive ? "text-brand-800" : "text-brand-700")}>
                {habit.title}
              </h3>
            </div>
            
            {/* Context Menu Trigger */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
                setFocusedMenuIndex(0); // Reset focus to first item
              }}
              className="p-1 text-brand-300 hover:text-brand-600 -mr-2 rounded-full hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-brand-400 pointer-events-auto"
              aria-label="Habit options menu"
              aria-haspopup="true"
              aria-expanded={isMenuOpen}
              style={{ zIndex: 3, position: 'relative' }}
            >
              <MoreVertical size={16} />
            </button>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {/* Points Potential */}
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide",
              isPositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            )}>
              {pointsDisplay > 0 ? '+' : ''}{pointsDisplay} pts
            </span>

            {/* Streak (Positive Only) - Show only if streak is at least 2 days (Approaching) */}
            {isPositive && habit.streakDays >= 2 && (
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors",
                habit.streakDays >= 3 ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"
              )}>
                <Flame size={10} fill={habit.streakDays >= 3 ? "currentColor" : "none"} />
                {habit.streakDays} Day{habit.streakDays !== 1 ? 's' : ''}
              </span>
            )}

            {/* Linked Challenge Badge */}
            {isLinkedToChallenge && (
               <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                <Target size={10} /> Goal
              </span>
            )}
          </div>
        </div>

        {/* Menu Dropdown */}
        {isMenuOpen && (
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
              className="absolute top-10 right-2 bg-white rounded-xl shadow-xl border border-brand-100 py-1 min-w-[120px] animate-in fade-in zoom-in-95 duration-100"
              role="menu"
              aria-orientation="vertical"
              aria-label="Habit actions menu"
              onKeyDown={handleMenuKeyDown}
              style={{ zIndex: 20 }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditModalOpen(true);
                  setIsMenuOpen(false);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50 flex items-center gap-2 focus:outline-none",
                  focusedMenuIndex === 0 && "bg-brand-50"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Edit2 size={14} /> Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDuplicate();
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50 flex items-center gap-2 focus:outline-none",
                  focusedMenuIndex === 1 && "bg-brand-50"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Copy size={14} /> Duplicate
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLogModalOpen(true);
                  setIsMenuOpen(false);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50 flex items-center gap-2 focus:outline-none",
                  focusedMenuIndex === 2 && "bg-brand-50"
                )}
                role="menuitem"
                tabIndex={-1}
              >
                <Calendar size={14} /> View Log
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteHabit(habit.id);
                  setIsMenuOpen(false);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold text-money-neg hover:bg-rose-50 flex items-center gap-2 focus:outline-none",
                  focusedMenuIndex === 3 && "bg-rose-50"
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
};

export default HabitCard;
