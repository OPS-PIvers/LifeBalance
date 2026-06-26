import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Loader2 } from 'lucide-react';
import { format, addDays, startOfToday } from 'date-fns';
import toast from 'react-hot-toast';

interface BatchRescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: string) => Promise<void>;
  count: number;
}

const BatchRescheduleModal: React.FC<BatchRescheduleModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  count,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const handleConfirm = async () => {
    if (!selectedDate) {
      toast.error('Please select a date');
      return;
    }

    setIsSaving(true);
    try {
      await onConfirm(selectedDate);
      onClose();
      setSelectedDate('');
    } catch (error) {
      console.error('Batch reschedule failed:', error);
      toast.error('Failed to reschedule tasks');
    } finally {
      setIsSaving(false);
    }
  };

  const setTomorrow = () => {
    const tomorrow = addDays(startOfToday(), 1);
    setSelectedDate(format(tomorrow, 'yyyy-MM-dd'));
  };

  const setNextWeek = () => {
    const nextWeek = addDays(startOfToday(), 7);
    setSelectedDate(format(nextWeek, 'yyyy-MM-dd'));
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Reschedule Tasks"
      disableClose={isSaving}
      noPadding={true}
    >
      <div className="p-4 space-y-4">
        <p className="text-brand-600 dark:text-brand-300">
          Select a new due date for the <strong>{count}</strong> selected tasks.
        </p>

        <div className="grid grid-cols-2 gap-3">
            <button
                onClick={setTomorrow}
                className="py-2 px-3 bg-brand-50 dark:bg-brand-700/50 hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-700 dark:text-brand-200 font-medium rounded-xl transition-colors text-sm border border-brand-200 dark:border-brand-700"
            >
                Tomorrow
            </button>
            <button
                onClick={setNextWeek}
                className="py-2 px-3 bg-brand-50 dark:bg-brand-700/50 hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-700 dark:text-brand-200 font-medium rounded-xl transition-colors text-sm border border-brand-200 dark:border-brand-700"
            >
                Next Week (+7 days)
            </button>
        </div>

        <div>
          <label htmlFor="batch-date" className="block text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-1">
            New Due Date
          </label>
          <input
            type="date"
            id="batch-date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            disabled={isSaving}
            className="w-full p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-colors disabled:opacity-70"
          />
        </div>
      </div>

      <div className="sticky bottom-0 p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 flex gap-3">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="flex-1 py-3 bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 font-semibold rounded-btn hover:bg-brand-200 dark:hover:bg-brand-700 transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSaving || !selectedDate}
          className="flex-1 py-3 bg-accent-600 dark:bg-accent-500 text-white font-semibold rounded-btn hover:bg-accent-700 dark:hover:bg-accent-400 transition-colors duration-(--duration-fast) ease-(--ease-standard) flex items-center justify-center gap-2 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          {isSaving ? <Loader2 className="animate-spin w-5 h-5" /> : 'Confirm'}
        </button>
      </div>
    </Drawer>
  );
};

export default BatchRescheduleModal;
