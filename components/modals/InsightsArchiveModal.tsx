import React from 'react';
import { Sparkles } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, parseISO, isValid } from 'date-fns';
import { Drawer } from '../ui/Drawer';

interface InsightsArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InsightsArchiveModal: React.FC<InsightsArchiveModalProps> = ({ isOpen, onClose }) => {
  const { insightsHistory } = useHousehold();

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Insights Archive">
      <div className="space-y-4">
        {insightsHistory.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
              <Sparkles size={32} />
            </div>
            <h3 className="text-slate-600 font-bold mb-1">No insights yet</h3>
            <p className="text-slate-400 text-sm">Generate your first insight from the dashboard!</p>
          </div>
        ) : (
          insightsHistory.map((insight) => {
            // Parse date with error handling to prevent crashes
            let formattedDate = 'Invalid date';
            try {
              const parsedDate = parseISO(insight.generatedAt);
              if (isValid(parsedDate)) {
                formattedDate = format(parsedDate, 'MMM d, yyyy • h:mm a');
              }
            } catch (error) {
              console.error('Error parsing insight date:', error);
            }

            return (
              <div key={insight.id} className="bg-indigo-50/50 rounded-2xl p-5 border border-indigo-100/50">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-xxs font-bold uppercase tracking-wider text-indigo-400 bg-white px-2 py-1 rounded-lg border border-indigo-50">
                        {formattedDate}
                    </span>
                </div>
                <p className="text-indigo-900 font-medium leading-relaxed">
                  &quot;{insight.text}&quot;
                </p>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
};

export default InsightsArchiveModal;
