import React, { useState, useMemo, useCallback, useId } from 'react';
import { X, Plus, ChevronRight } from 'lucide-react';
import { Habit, EffortLevel } from '@/types/schema';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import {
  PresetHabit,
  EFFORT_POINTS,
  getPresetHabitsByCategory
} from '@/data/presetHabits';
import toast from 'react-hot-toast';
import CustomHabitForm, { CustomHabitFormData } from '@/components/habits/CustomHabitForm';
import CustomHabitList from '@/components/habits/CustomHabitList';
import PresetHabitList from '@/components/habits/PresetHabitList';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// UUID generator with fallback for non-secure contexts
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Helper to calculate basePoints based on type and effort level
const calculateBasePoints = (type: 'positive' | 'negative', effortLevel: EffortLevel): number => {
  const points = EFFORT_POINTS[effortLevel];
  return type === 'negative' ? -points : points;
};

// Validate and parse target count
const parseTargetCount = (value: string): number => {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
};

interface HabitCreatorWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type WizardView = 'main' | 'create-custom' | 'edit-custom';

// Header titles for each view
const VIEW_TITLES: Record<WizardView, string> = {
  'main': 'Manage Habits',
  'create-custom': 'Create Custom Habit',
  'edit-custom': 'Edit Habit',
};

// Default form state
const DEFAULT_FORM_DATA: CustomHabitFormData = {
  title: '',
  category: 'Health',
  type: 'positive',
  effortLevel: 'medium',
  scoringType: 'threshold',
  period: 'daily',
  targetCount: '1',
};

const HabitCreatorWizard: React.FC<HabitCreatorWizardProps> = ({ isOpen, onClose }) => {
  const { habits, addHabit, updateHabit, deleteHabit } = useGamification();
  const titleId = useId();

  // View state
  const [view, setView] = useState<WizardView>('main');
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Health');
  const [deleteConfirmHabit, setDeleteConfirmHabit] = useState<Habit | null>(null);

  // Form state
  const [formData, setFormData] = useState<CustomHabitFormData>(DEFAULT_FORM_DATA);

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
          basePoints: calculateBasePoints(preset.type, preset.effortLevel),
          scoringType: preset.scoringType,
          period: preset.period,
          targetCount: preset.targetCount,
          count: 0,
          totalCount: 0,
          completedDates: [],
          streakDays: 0,
          lastUpdated: new Date().toISOString(),
          weatherSensitive: preset.weatherSensitive,
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

  // Reset form
  const resetForm = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA);
    setEditingHabit(null);
  }, []);

  // Open create custom view
  const openCreateCustom = () => {
    resetForm();
    setView('create-custom');
  };

  // Open edit custom view
  const openEditCustom = (habit: Habit) => {
    setEditingHabit(habit);
    setFormData({
      title: habit.title,
      category: habit.category,
      type: habit.type,
      effortLevel: habit.effortLevel || 'medium',
      scoringType: habit.scoringType,
      period: habit.period,
      targetCount: habit.targetCount.toString(),
    });
    setView('edit-custom');
  };

  // Handle form changes
  const handleFormChange = (data: Partial<CustomHabitFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  // Save custom habit (create or update)
  const handleSaveCustom = async () => {
    if (!formData.title.trim()) {
      toast.error('Please enter a habit name');
      return;
    }

    const targetCount = parseTargetCount(formData.targetCount);

    // Build base habit data
    const habitData: Habit = {
      id: editingHabit ? editingHabit.id : generateId(),
      title: formData.title.trim(),
      category: formData.category,
      type: formData.type,
      basePoints: calculateBasePoints(formData.type, formData.effortLevel),
      scoringType: formData.scoringType,
      period: formData.period,
      targetCount,
      count: editingHabit ? editingHabit.count : 0,
      totalCount: editingHabit ? editingHabit.totalCount : 0,
      completedDates: editingHabit ? editingHabit.completedDates : [],
      streakDays: editingHabit ? editingHabit.streakDays : 0,
      lastUpdated: new Date().toISOString(),
      weatherSensitive: editingHabit?.weatherSensitive ?? false,
      isCustom: true,
      effortLevel: formData.effortLevel,
      // Only include ownership fields when editing (avoid undefined for new habits)
      ...(editingHabit && {
        isShared: editingHabit.isShared,
        ownerId: editingHabit.ownerId,
        telegramAlias: editingHabit.telegramAlias,
      }),
      // Custom habits should not have presetId (contradicts isCustom: true)
    };

    try {
      if (editingHabit) {
        await updateHabit(habitData);
        toast.success('Habit updated!');
      } else {
        await addHabit(habitData);
        toast.success('Custom habit created!');
      }

      setView('main');
      resetForm();
    } catch (error) {
      console.error('[HabitCreatorWizard] Save failed:', error);
      toast.error('Failed to save habit. Please try again.');
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
      toast.success(`Deleted "${deleteConfirmHabit.title}"`);

      if (editingHabit?.id === deleteConfirmHabit.id) {
        setView('main');
        resetForm();
      }
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

  // Handle modal close - reset state to main view
  const handleClose = useCallback(() => {
    setView('main');
    resetForm();
    setDeleteConfirmHabit(null);
    onClose();
  }, [onClose, resetForm]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-lg"
      ariaLabelledBy={titleId}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-brand-200 dark:border-brand-700 shrink-0">
        <div className="flex items-center gap-3">
            {view !== 'main' && (
              <button
                onClick={() => setView('main')}
                className="p-1 text-brand-400 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 -ml-1"
                aria-label="Back to main view"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
            )}
            <h2 id={titleId} className="text-lg font-bold text-brand-800 dark:text-brand-100">
              {VIEW_TITLES[view]}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-brand-400 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-full"
            aria-label="Close habit manager"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 scroll-contain-y">

          {/* Main View */}
          {view === 'main' && (
            <div className="p-4 space-y-6">

              {/* Create Custom Button */}
              <button
                onClick={openCreateCustom}
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
                onEdit={openEditCustom}
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
          )}

          {/* Create/Edit Custom View */}
          {(view === 'create-custom' || view === 'edit-custom') && (
            <CustomHabitForm
              formData={formData}
              onFormChange={handleFormChange}
              editingHabit={editingHabit}
              onDelete={confirmDelete}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 shrink-0">
          {view === 'main' ? (
            <button
              onClick={handleClose}
              className="w-full py-3 bg-warm-500 text-white font-semibold rounded-btn shadow-btn-primary hover:bg-warm-600 active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleSaveCustom}
              className="w-full py-3 bg-warm-500 text-white font-semibold rounded-btn shadow-btn-primary hover:bg-warm-600 active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
            >
              {view === 'edit-custom' ? 'Save Changes' : 'Create Habit'}
            </button>
          )}
        </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmHabit}
        onClose={cancelDelete}
        onConfirm={handleDeleteConfirmed}
        title="Delete Habit?"
        message={deleteConfirmHabit ? `Are you sure you want to delete "${deleteConfirmHabit.title}"? This action cannot be undone.` : ''}
        confirmLabel="Delete"
        confirmVariant="destructive"
      />
    </Modal>
  );
};

export default HabitCreatorWizard;
