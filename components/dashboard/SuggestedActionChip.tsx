import React from 'react';
import { SuggestedAction } from '../../utils/predictiveEngine';
import { DollarSign, Repeat, ArrowRight } from 'lucide-react';

interface SuggestedActionChipProps {
  action: SuggestedAction;
  onAction: (action: SuggestedAction) => void;
}

export const SuggestedActionChip: React.FC<SuggestedActionChipProps> = ({ action, onAction }) => {
  return (
    <button
      onClick={() => onAction(action)}
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 hover:border-brand-300 transition-all active:scale-95 shadow-sm group"
      aria-label={`Predictive Action: ${action.title}`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        action.type === 'transaction' ? 'bg-money-bgPos text-money-pos' : 'bg-habit-bgGreen text-habit-green'
      }`}>
        {action.type === 'transaction' ? <DollarSign size={16} /> : <Repeat size={16} />}
      </div>

      <div className="text-left">
        <p className="text-xs font-bold text-brand-700 leading-tight">{action.title}</p>
        <p className="text-xxs text-brand-400 font-medium">{action.subtitle}</p>
      </div>

      <div className="w-5 h-5 rounded-full bg-brand-50 flex items-center justify-center text-brand-300 group-hover:text-brand-500 transition-colors opacity-0 group-hover:opacity-100 -ml-1">
        <ArrowRight size={12} />
      </div>
    </button>
  );
};
