import React from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Plus, Sparkles } from 'lucide-react';

interface EmptyChallengeWidgetProps {
  onOpenModal: () => void;
}

export const EmptyChallengeWidget: React.FC<EmptyChallengeWidgetProps> = ({ onOpenModal }) => {
  const { primaryYearlyGoal } = useGamification();

  return (
    <button
      type="button"
      onClick={onOpenModal}
      className="w-full text-left surface-section p-5 cursor-pointer active:scale-[0.98] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/30 group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
      aria-label="Set Monthly Challenge"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display font-semibold text-lg text-brand-900 dark:text-brand-100">Set a monthly challenge</h2>
        <div className="p-2 bg-warm-100 rounded-card text-warm-600 group-hover:bg-warm-200 dark:bg-warm-900/30 dark:text-warm-300 dark:group-hover:bg-warm-900/50 transition-colors">
          <Plus size={16} />
        </div>
      </div>

      <p className="text-sm text-brand-500 dark:text-brand-400 mb-5 font-medium">
        Challenge yourself to build better habits this month.
      </p>

      {/* Yearly Goal Status (if exists) */}
      {primaryYearlyGoal ? (
        <div className="pt-4 border-t border-brand-200 dark:border-brand-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-brand-400 dark:text-brand-500 font-medium">Yearly goal:</span>
              <span className="text-xs font-bold text-brand-700 dark:text-brand-200">{primaryYearlyGoal.title}</span>
            </div>
            <div
              className={`text-xs font-bold px-2 py-1 rounded-btn ${
                primaryYearlyGoal.successfulMonths.length >=
                primaryYearlyGoal.requiredMonths - 2
                  ? 'bg-money-bgPos text-money-pos dark:bg-money-pos/15 dark:text-money-pos'
                  : 'bg-warm-50 text-warm-600 dark:bg-warm-900/30 dark:text-warm-300'
              }`}
            >
              {primaryYearlyGoal.successfulMonths.length >=
              primaryYearlyGoal.requiredMonths - 2
                ? 'On Track'
                : 'Needs Attention'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-brand-400 dark:text-brand-500 pt-4 border-t border-brand-200 dark:border-brand-700 font-medium">
          <Sparkles size={12} className="text-warm-500" />
          <span>Consistent habits lead to big results.</span>
        </div>
      )}
    </button>
  );
};
