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
      className="bg-white rounded-2xl p-5 shadow-sm border border-brand-100 cursor-pointer active:scale-[0.98] transition-transform hover:border-brand-200 group"
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-lg text-brand-800">Set Monthly Challenge</h2>
        <div className="flex items-center gap-2">
           <div className="p-1.5 bg-brand-50 rounded-lg text-brand-400 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors">
              <Plus size={16} />
           </div>
        </div>
      </div>

      <p className="text-sm text-brand-500 mb-4">
        Challenge yourself to build better habits this month.
      </p>

      {/* Yearly Goal Status (if exists) */}
      {primaryYearlyGoal ? (
        <div className="pt-3 border-t border-brand-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-brand-400">Yearly Goal:</span>
              <span className="text-xs font-bold text-brand-700">{primaryYearlyGoal.title}</span>
            </div>
            <div
              className={`text-xs font-bold px-2 py-1 rounded-lg ${
                primaryYearlyGoal.successfulMonths.length >=
                primaryYearlyGoal.requiredMonths - 2
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-orange-50 text-orange-600'
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
         <div className="flex items-center gap-2 text-xs text-brand-400 pt-3 border-t border-brand-100">
           <Sparkles size={12} />
           <span>Consistent habits lead to big results!</span>
         </div>
      )}
    </div>
  );
};
