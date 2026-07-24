
import React, { useState, useEffect } from 'react';
import { YearlyGoal } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';

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
  const [isSaving, setIsSaving] = useState(false);

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
    if (!title || requiredMonths < 1 || requiredMonths > 12 || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isSaving}
      title={editingGoal ? 'Edit Yearly Goal' : 'New Yearly Goal'}
      noPadding={true}
      footer={
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
          <Button
            variant="warning"
            size="lg"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={!title || requiredMonths < 1 || requiredMonths > 12}
            className="w-full"
          >
            {editingGoal ? 'Update Goal' : 'Create Goal'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Title */}
        <Input
          label="Goal Title"
          required
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Family Trip to Disney"
        />

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
        <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
          <Input
            label="Year"
            type="number"
            inputMode="numeric"
            value={year || ''}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setYear(isNaN(val) ? new Date().getFullYear() : val);
            }}
            min={new Date().getFullYear()}
            max={new Date().getFullYear() + 5}
            className="font-mono"
          />

          <Input
            label="Required Months"
            required
            type="number"
            inputMode="numeric"
            value={requiredMonths || ''}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setRequiredMonths(isNaN(val) ? 0 : val);
            }}
            min={1}
            max={12}
            className="font-mono"
          />
        </div>

        <div className="bg-warm-50 dark:bg-warm-900/20 p-3 rounded-xl border border-warm-200 dark:border-warm-800/60">
          <p className="text-xs text-brand-600 dark:text-brand-300">
            Complete <span className="font-bold">{requiredMonths}</span> out of 12 monthly
            challenges to achieve this yearly goal.
          </p>
        </div>
      </div>
    </Drawer>
  );
};

export default YearlyGoalFormModal;
