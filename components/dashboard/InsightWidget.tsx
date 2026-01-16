import React from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Sparkles, History, Wand2 } from 'lucide-react';

interface InsightWidgetProps {
  onOpenArchive: () => void;
}

export const InsightWidget: React.FC<InsightWidgetProps> = ({ onOpenArchive }) => {
  const { insight, refreshInsight, isGeneratingInsight } = useHousehold();

  return (
    <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-white rounded-xl shadow-sm text-indigo-500">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">AI Insight</h3>
            <div className="flex gap-2">
              <button
                onClick={onOpenArchive}
                className="flex items-center gap-1.5 px-3 py-1 bg-white text-indigo-600 rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-50"
              >
                <History size={12} />
                History
              </button>
              <button
                onClick={refreshInsight}
                disabled={isGeneratingInsight}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Wand2 size={12} />
                {isGeneratingInsight ? 'Generating...' : 'Get Insight'}
              </button>
            </div>
          </div>
          <p className="text-indigo-900 font-medium leading-relaxed">
            &quot;{insight}&quot;
          </p>
        </div>
      </div>
    </div>
  );
};
