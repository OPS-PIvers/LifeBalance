
import React, { useState } from 'react';
import { Habit } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { X, Flame, MoreVertical, Edit2, Trash2, Target } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import HabitFormModal from '../modals/HabitFormModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HabitCardProps {
  habit: Habit;
}

const HabitCard: React.FC<HabitCardProps> = ({ habit }) => {
  const { toggleHabit, deleteHabit, resetHabit, activeChallenge } = useHousehold();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
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
    "relative flex items-center justify-between p-4 rounded-card border shadow-soft transition-all duration-300 select-none cursor-pointer group/card",
    !isActive && "bg-white border-brand-100 hover:border-brand-300",
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

  return (
    <>
      <div className={containerClasses} onClick={handleCardClick}>
        
        {/* ACTION INDICATOR */}
        <div className="flex-shrink-0 mr-4 relative group">
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
              className="absolute -top-2 -right-2 bg-white border border-brand-200 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 shadow-sm z-20 active:scale-90 hover:bg-rose-50 hover:text-money-neg transition-colors"
            >
              <X size={12} strokeWidth={3} />
            </button>
          )}
        </div>

        {/* CONTENT */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <div>
              <h3 className={cn("font-bold text-sm truncate mb-1", isActive ? "text-brand-800" : "text-brand-700")}>
                {habit.title}
              </h3>
              <p className="text-[10px] text-brand-400 font-medium mb-2">
                {habit.scoringType === 'threshold' 
                  ? `Goal: ${habit.targetCount} / ${habit.period}` 
                  : `+${habit.basePoints} pts each`}
              </p>
            </div>
            
            {/* Context Menu Trigger */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
              }}
              className="p-1 text-brand-300 hover:text-brand-600 -mr-2 rounded-full hover:bg-black/5"
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

            {/* Streak (Positive Only) */}
            {isPositive && habit.streakDays > 0 && (
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
              className="fixed inset-0 z-10" 
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen(false);
              }} 
            />
            <div className="absolute top-10 right-2 z-20 bg-white rounded-xl shadow-xl border border-brand-100 py-1 min-w-[120px] animate-in fade-in zoom-in-95 duration-100">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditModalOpen(true); 
                  setIsMenuOpen(false); 
                }}
                className="w-full text-left px-4 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50 flex items-center gap-2"
              >
                <Edit2 size={14} /> Edit
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  deleteHabit(habit.id); 
                  setIsMenuOpen(false); 
                }}
                className="w-full text-left px-4 py-2 text-xs font-bold text-money-neg hover:bg-rose-50 flex items-center gap-2"
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
    </>
  );
};

export default HabitCard;
