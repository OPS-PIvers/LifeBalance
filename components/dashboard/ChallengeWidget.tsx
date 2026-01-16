import React from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Pencil } from 'lucide-react';
import { calculateChallengeProgress } from '../../utils/challengeCalculator';
import { getEffectiveTargetValue } from '../../utils/migrations/challengeMigration';

interface ChallengeWidgetProps {
  onOpenModal: () => void;
}

export const ChallengeWidget: React.FC<ChallengeWidgetProps> = ({ onOpenModal }) => {
  const { activeChallenge, habits, primaryYearlyGoal } = useHousehold();

  if (!activeChallenge) return null;

  const linkedHabits = habits.filter(h => activeChallenge.relatedHabitIds.includes(h.id));
  const challengeProgressData = calculateChallengeProgress(activeChallenge, linkedHabits);
  const challengeTarget = getEffectiveTargetValue(activeChallenge);
  const challengeProgress = challengeProgressData.progress;

  return (
    <div
      onClick={onOpenModal}
      className="bg-gradient-to-br from-brand-800 to-indigo-900 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10"></div>

      <div className="relative z-10">
        {/* Header with Day Indicator */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-lg">{activeChallenge.title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-white/10 px-2 py-1 rounded-lg font-medium">
              Day {new Date().getDate()} of 30
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
        <div className="h-2 w-full bg-brand-900 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-habit-gold to-orange-400 rounded-full transition-all duration-1000"
            style={{ width: `${challengeProgress}%` }}
          />
        </div>

        {/* Progress Stats */}
        <div className="flex justify-between text-[10px] font-medium text-brand-300 mb-3">
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
    </div>
  );
};
