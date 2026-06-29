import React, { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { format, parseISO, isValid } from 'date-fns';
import { Drawer } from '@/components/ui/Drawer';
import EmptyState from '@/components/ui/EmptyState';

interface InsightsArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InsightsArchiveModal: React.FC<InsightsArchiveModalProps> = ({ isOpen, onClose }) => {
  const { insightsHistory, loadAllInsights } = useHouseholdCore();

  // The live listener only keeps the most recent insights; this is the archive,
  // so pull the full history when it opens.
  useEffect(() => {
    if (isOpen) {
      loadAllInsights();
    }
  }, [isOpen, loadAllInsights]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Insights Archive">
      <div className="space-y-4">
        {insightsHistory.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={32} />}
            title="No insights yet"
            description="Generate your first insight from the dashboard!"
          />
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
              <div key={insight.id} className="bg-warm-50 dark:bg-warm-900/20 rounded-2xl p-5 border border-warm-200 dark:border-warm-800/60">
                <div className="flex justify-between items-start mb-2">
                    <span className="text-xxs font-bold uppercase tracking-wider text-warm-600 dark:text-warm-300 bg-white dark:bg-brand-800 px-2 py-1 rounded-btn border border-warm-200 dark:border-warm-800/60">
                        {formattedDate}
                    </span>
                </div>
                <p className="text-brand-800 dark:text-brand-100 font-medium leading-relaxed">
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
