import React, { useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Pencil } from 'lucide-react';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { getEffectiveTargetValue } from '@/utils/migrations/challengeMigration';
import { getLocalDateString } from '@/utils/dateHelpers';

interface ChallengeWidgetProps {
  onOpenModal: () => void;
}

export const ChallengeWidget: React.FC<ChallengeWidgetProps> = React.memo(({ onOpenModal }) => {
  const { activeChallenge, habits, primaryYearlyGoal } = useGamification();

  const linkedHabits = useMemo(
    () => (activeChallenge ? habits.filter(h => activeChallenge.relatedHabitIds.includes(h.id)) : []),
    [activeChallenge, habits]
  );

  const challengeProgressData = useMemo(
    () => (activeChallenge ? calculateChallengeProgress(activeChallenge, linkedHabits) : null),
    [activeChallenge, linkedHabits]
  );

  // Compute today's day-of-month once (stable within a render pass; avoids
  // creating a new Date on every JSX evaluation).
  const todayDayOfMonth = useMemo(() => {
    const today = getLocalDateString();
    return parseInt(today.slice(8, 10), 10);
  }, []);

  if (!activeChallenge || !challengeProgressData) return null;

  const challengeTarget = getEffectiveTargetValue(activeChallenge);
  const challengeProgress = challengeProgressData.progress;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenModal();
    }
  };

  return (
    <button
      type="button"
      aria-label="Open Challenge Hub"
      onClick={onOpenModal}
      onKeyDown={handleKeyDown}
      className="w-full text-left bg-gradient-to-br from-brand-800 to-indigo-900 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10"></div>

      <div className="relative z-10">
        {/* Header with Day Indicator */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-lg">{activeChallenge.title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-white/10 px-2 py-1 rounded-lg font-medium">
              Day {todayDayOfMonth} of 30
            </span>
            <Pencil size={14} className="text-brand-300 opacity-70" />
          </div>
        </div>

        {/* Description (if exists) */}
        {activeChallenge.description && (
          <p className="text-xs text-brand-200 mb-2">{activeChallenge.description}</p>
        )}

        {/* Reward Label */}
        <p className="text-xs text-brand-300 mb-3">
          Complete to unlock {activeChallenge.yearlyRewardLabel}
        </p>

        {/* Progress Bar */}
        <div
          className="h-2 w-full bg-brand-900 rounded-full overflow-hidden mb-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(challengeProgress)}
          aria-label={`Challenge progress: ${Math.round(challengeProgress)}% complete`}
        >
          <div
            className="h-full bg-gradient-to-r from-habit-gold to-orange-400 rounded-full transition-all duration-1000"
            style={{ width: `${challengeProgress}%` }}
          />
        </div>

        {/* Progress Stats */}
        <div className="flex justify-between text-xxs font-medium text-brand-300 mb-3">
          <span>
            {challengeProgressData.currentValue} / {challengeTarget}{' '}
            {activeChallenge.targetType === 'percentage' ? '%' : ''}
          </span>
          <span>{challengeProgress.toFixed(0)}% Complete</span>
        </div>

        {/* Yearly Goal Status (if exists) */}
        {primaryYearlyGoal && (
          <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-brand-300">Yearly Goal:</span>
                <span className="text-xs font-bold">{primaryYearlyGoal.title}</span>
              </div>
              <div
                className={`text-xs font-bold px-2 py-1 rounded-lg ${
                  primaryYearlyGoal.successfulMonths.length >=
                  primaryYearlyGoal.requiredMonths - 2
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-orange-500/20 text-orange-300'
                }`}
              >
                {primaryYearlyGoal.successfulMonths.length >=
                primaryYearlyGoal.requiredMonths - 2
                  ? 'On Track'
                  : 'Needs Attention'}
              </div>
            </div>
          </div>
        )}
      </div>
    </button>
  );
});

ChallengeWidget.displayName = 'ChallengeWidget';
