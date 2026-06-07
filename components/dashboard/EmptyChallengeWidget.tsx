import React from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Plus, Sparkles } from 'lucide-react';

interface EmptyChallengeWidgetProps {
  onOpenModal: () => void;
}

export const EmptyChallengeWidget: React.FC<EmptyChallengeWidgetProps> = ({ onOpenModal }) => {
  const { primaryYearlyGoal } = useHousehold();

  return (
    <div
      onClick={onOpenModal}
      className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 cursor-pointer active:scale-[0.98] transition-all hover:bg-white dark:hover:bg-slate-800 group"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg text-slate-900 dark:text-slate-100">Set Monthly Challenge</h2>
        <div className="flex items-center gap-2">
           <div className="p-2 bg-slate-100 rounded-xl text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-900 dark:bg-slate-700/50 dark:text-slate-400 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100 transition-colors">
              <Plus size={16} />
           </div>
        </div>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 font-medium">
        Challenge yourself to build better habits this month.
      </p>

      {/* Yearly Goal Status (if exists) */}
      {primaryYearlyGoal ? (
        <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Yearly Goal:</span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{primaryYearlyGoal.title}</span>
            </div>
            <div
              className={`text-xs font-bold px-2 py-1 rounded-lg ${
                primaryYearlyGoal.successfulMonths.length >=
                primaryYearlyGoal.requiredMonths - 2
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300'
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
         <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 pt-4 border-t border-slate-100 dark:border-slate-700 font-medium">
           <Sparkles size={12} />
           <span>Consistent habits lead to big results!</span>
         </div>
      )}
    </div>
  );
};
