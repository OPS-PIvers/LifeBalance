
import React, { useState, useEffect } from 'react';
import { YearlyGoal } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';

interface YearlyGoalFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingGoal?: YearlyGoal | null;
}

const YearlyGoalFormModal: React.FC<YearlyGoalFormModalProps> = ({
  isOpen,
  onClose,
  editingGoal,
}) => {
  const { createYearlyGoal, updateYearlyGoal } = useGamification();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [requiredMonths, setRequiredMonths] = useState(10);

  useEffect(() => {
    if (isOpen) {
      // Use setTimeout to avoid synchronous state update warning
      const timer = setTimeout(() => {
        if (editingGoal) {
          setTitle(editingGoal.title);
          setDescription(editingGoal.description || '');
          setYear(editingGoal.year);
          setRequiredMonths(editingGoal.requiredMonths);
        } else {
          // Reset form for new goal
          setTitle('');
          setDescription('');
          setYear(new Date().getFullYear());
          setRequiredMonths(10);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [editingGoal, isOpen]);

  const handleSave = async () => {
    if (!title || requiredMonths < 1 || requiredMonths > 12) {
      return;
    }

    if (editingGoal) {
      await updateYearlyGoal(editingGoal.id, {
        title,
        description,
        year,
        requiredMonths,
      });
    } else {
      await createYearlyGoal({
        title,
        description,
        year,
        requiredMonths,
        successfulMonths: [],
        status: 'in_progress',
        createdBy: '', // Will be set in context
        createdAt: '', // Will be set in context
      });
    }

    onClose();
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={editingGoal ? 'Edit Yearly Goal' : 'New Yearly Goal'}
      noPadding={true}
    >
      <div className="p-4 space-y-4">
        {/* Title */}
        <div>
          <label htmlFor="goal-title" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
            Goal Title *
          </label>
          <input
            id="goal-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Family Trip to Disney"
            className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-hidden transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="goal-description" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
            Description (Optional)
          </label>
          <textarea
            id="goal-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details about this goal..."
            className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl resize-none h-20 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-hidden transition-colors"
          />
        </div>

        {/* Year and Required Months */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="goal-year" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
              Year
            </label>
            <input
              id="goal-year"
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              min={new Date().getFullYear()}
              max={new Date().getFullYear() + 5}
              className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl font-mono focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-hidden transition-colors"
            />
          </div>

          <div>
            <label htmlFor="goal-required-months" className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">
              Required Months *
            </label>
            <input
              id="goal-required-months"
              type="number"
              value={requiredMonths}
              onChange={(e) => setRequiredMonths(parseInt(e.target.value))}
              min={1}
              max={12}
              className="w-full mt-1 p-3 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-xl font-mono focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-hidden transition-colors"
            />
          </div>
        </div>

        <div className="bg-warm-50 dark:bg-warm-900/20 p-3 rounded-xl border border-warm-200 dark:border-warm-800/60">
          <p className="text-xs text-brand-600 dark:text-brand-300">
            Complete <span className="font-bold">{requiredMonths}</span> out of 12 monthly
            challenges to achieve this yearly goal.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
        <button
          onClick={handleSave}
          disabled={!title || requiredMonths < 1 || requiredMonths > 12}
          className="w-full py-3 bg-warm-500 dark:bg-warm-500 text-white font-semibold rounded-btn shadow-btn-primary active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) hover:bg-warm-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
        >
          {editingGoal ? 'Update Goal' : 'Create Goal'}
        </button>
      </div>
    </Drawer>
  );
};

export default YearlyGoalFormModal;
