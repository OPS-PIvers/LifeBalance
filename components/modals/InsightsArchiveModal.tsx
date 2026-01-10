import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, parseISO } from 'date-fns';

interface InsightsArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InsightsArchiveModal: React.FC<InsightsArchiveModalProps> = ({ isOpen, onClose }) => {
  const { insightsHistory } = useHousehold();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Insights Archive</h2>
              <p className="text-sm text-slate-500">History of AI-generated observations</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-4">
          {insightsHistory.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                <Sparkles size={32} />
              </div>
              <h3 className="text-slate-600 font-bold mb-1">No insights yet</h3>
              <p className="text-slate-400 text-sm">Generate your first insight from the dashboard!</p>
            </div>
          ) : (
            insightsHistory.map((insight) => (
              <div key={insight.id} className="bg-indigo-50/50 rounded-2xl p-5 border border-indigo-100/50">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-white px-2 py-1 rounded-lg border border-indigo-50">
                        {format(parseISO(insight.generatedAt), 'MMM d, yyyy • h:mm a')}
                    </span>
                </div>
                <p className="text-indigo-900 font-medium leading-relaxed">
                  "{insight.text}"
                </p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 active:scale-95 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default InsightsArchiveModal;
