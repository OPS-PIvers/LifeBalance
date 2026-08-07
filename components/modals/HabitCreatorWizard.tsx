import React, { useState, useMemo, useCallback, useId } from 'react';
import { X, Plus, ChevronRight } from 'lucide-react';
import { Habit } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import {
  PresetHabit,
  EFFORT_POINTS,
  getPresetHabitsByCategory
} from '@/data/presetHabits';
import toast from 'react-hot-toast';
import CustomHabitList from '@/components/habits/CustomHabitList';
import PresetHabitList from '@/components/habits/PresetHabitList';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { generateId } from '@/utils/id';
import { TRASH_RETENTION_DAYS } from '@/utils/trash';

interface HabitCreatorWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Open the shared habit form in CREATE mode. This wizard used to carry its
   * own second habit form (CustomHabitForm), which drifted out of sync with
   * the everyday edit form on HabitFormModal — different categories, no credit
   * mode, no reminder, no pause. There is now ONE form: the owner (pages/Habits)
   * mounts `HabitFormModal` as a SIBLING of this Drawer rather than nesting it,
   * because nested Drawers fight over the Tab focus trap.
   */
  onCreateCustom: () => void;
  /** Open the shared habit form in EDIT mode for `habit`. See `onCreateCustom`. */
  onEditCustom: (habit: Habit) => void;
}

const HabitCreatorWizard: React.FC<HabitCreatorWizardProps> = ({
  isOpen,
  onClose,
  onCreateCustom,
  onEditCustom,
}) => {
  const { habits, addHabit, deleteHabit } = useGamification();
  const titleId = useId();

  const [expandedCategory, setExpandedCategory] = useState<string | null>('Health');
  const [deleteConfirmHabit, setDeleteConfirmHabit] = useState<Habit | null>(null);

  // Get enabled preset IDs from current habits
  const enabledPresetIds = useMemo(() => {
    return new Set(habits.filter(h => h.presetId).map(h => h.presetId));
  }, [habits]);

  // Get custom habits (user-created)
  const customHabits = useMemo(() => {
    return habits.filter(h => h.isCustom);
  }, [habits]);

  // Preset habits grouped by category
  const presetsByCategory = useMemo(() => getPresetHabitsByCategory(), []);

  // Handle toggling a preset habit on/off
  const handleTogglePreset = async (preset: PresetHabit) => {
    const existingHabit = habits.find(h => h.presetId === preset.id);

    try {
      if (existingHabit) {
        await deleteHabit(existingHabit.id);
        toast.success(`Removed "${preset.title}"`);
      } else {
        const newHabit: Habit = {
          id: generateId(),
          title: preset.title,
          category: preset.category,
          type: preset.type,
          // basePoints is always a positive magnitude — the sign is conveyed
          // entirely by `type` (see habitSign/signedHabitPoints in
          // utils/habitLogic.ts). This wizard used to negate the magnitude for
          // `type: 'negative'` habits, storing a "double negative" alongside
          // HabitFormModal's convention (positive basePoints + type
          // 'negative'). Both conventions score identically today —
          // habitSign/Math.abs canonicalize either shape — but only ONE
          // should be creatable going forward.
          basePoints: EFFORT_POINTS[preset.effortLevel],
          scoringType: preset.scoringType,
          period: preset.period,
          targetCount: preset.targetCount,
          count: 0,
          totalCount: 0,
          completedDates: [],
          streakDays: 0,
          lastUpdated: new Date().toISOString(),
          presetId: preset.id,
          isCustom: false,
          effortLevel: preset.effortLevel,
        };
        await addHabit(newHabit);
        toast.success(`Added "${preset.title}"`);
      }
    } catch (error) {
      console.error('[HabitCreatorWizard] Toggle preset failed:', error);
      toast.error('Failed to update habit. Please try again.');
    }
  };

  // Show delete confirmation
  const confirmDelete = (habit: Habit) => {
    setDeleteConfirmHabit(habit);
  };

  // Delete habit after confirmation
  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmHabit) return;

    try {
      await deleteHabit(deleteConfirmHabit.id);
      // Says where it went, not that it's gone — the confirmation the user just
      // accepted promised it was restorable, and "Deleted …" would contradict
      // that one tap later. Matches HabitFormModal's wording.
      toast.success('Habit moved to Recently deleted');
      setDeleteConfirmHabit(null);
    } catch (error) {
      console.error('[HabitCreatorWizard] Delete failed:', error);
      toast.error('Failed to delete habit. Please try again.');
    }
  };

  // Cancel delete
  const cancelDelete = () => {
    setDeleteConfirmHabit(null);
  };

  // Handle modal close
  const handleClose = useCallback(() => {
    setDeleteConfirmHabit(null);
    onClose();
  }, [onClose]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      height="tall"
      noPadding
      ariaLabelledBy={titleId}
      header={
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-200 dark:border-brand-700">
          <h2 id={titleId} className="text-lg font-bold text-brand-800 dark:text-brand-100">
            Manage Habits
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-brand-400 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-full"
            aria-label="Close habit manager"
          >
            <X size={20} />
          </button>
        </div>
      }
      footer={
        <div className="p-4 border-t border-brand-200 dark:border-brand-700">
          <button
            onClick={handleClose}
            className="w-full py-3 bg-warm-500 text-white font-semibold rounded-btn shadow-btn-primary hover:bg-warm-600 active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            Done
          </button>
        </div>
      }
    >
      {/* Content — single Drawer scroll container */}
      <div className="p-4 space-y-6">

        {/* Create Custom Button */}
        <button
          onClick={onCreateCustom}
          className="w-full flex items-center justify-between p-4 bg-warm-50 dark:bg-warm-900/20 border border-dashed border-warm-300 dark:border-warm-800/60 rounded-xl hover:border-warm-400 dark:hover:border-warm-700 hover:bg-warm-100 dark:hover:bg-warm-900/30 transition-colors duration-(--duration-fast) ease-(--ease-standard) group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-warm-100 dark:bg-warm-900/40 rounded-xl flex items-center justify-center text-warm-700 dark:text-warm-300 transition-colors">
              <Plus size={20} />
            </div>
            <div className="text-left">
              <p className="font-bold text-brand-800 dark:text-brand-100">Create Custom Habit</p>
              <p className="text-xs text-brand-400 dark:text-brand-400">Define your own habit with custom settings</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-brand-400 dark:text-brand-400" />
        </button>

        {/* Custom Habits List */}
        <CustomHabitList
          habits={customHabits}
          onEdit={onEditCustom}
          onDelete={confirmDelete}
        />

        {/* Preset Habits List */}
        <PresetHabitList
          presetsByCategory={presetsByCategory}
          enabledPresetIds={enabledPresetIds}
          expandedCategory={expandedCategory}
          onToggleCategory={setExpandedCategory}
          onTogglePreset={handleTogglePreset}
        />
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmHabit}
        onClose={cancelDelete}
        onConfirm={handleDeleteConfirmed}
        title="Delete habit?"
        message={
          deleteConfirmHabit
            ? `"${deleteConfirmHabit.title}" moves to Recently deleted, where you can restore it for ${TRASH_RETENTION_DAYS} days. Its history goes with it.`
            : ''
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
      />
    </Drawer>
  );
};

export default HabitCreatorWizard;
