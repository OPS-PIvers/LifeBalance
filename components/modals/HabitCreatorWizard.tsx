import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Plus, ChevronRight, AlertTriangle } from 'lucide-react';
import { Habit, EffortLevel } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import {
  PresetHabit,
  EFFORT_POINTS,
  getPresetHabitsByCategory
} from '@/data/presetHabits';
import toast from 'react-hot-toast';
import CustomHabitForm, { CustomHabitFormData } from '@/components/habits/CustomHabitForm';
import CustomHabitList from '@/components/habits/CustomHabitList';
import PresetHabitList from '@/components/habits/PresetHabitList';

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
  const { habits, addHabit, updateHabit, deleteHabit } = useHousehold();

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
      weatherSensitive: false,
      isCustom: true,
      effortLevel: formData.effortLevel,
    };

    if (editingHabit) {
      await updateHabit(habitData);
      toast.success('Habit updated!');
    } else {
      await addHabit(habitData);
      toast.success('Custom habit created!');
    }

    setView('main');
    resetForm();
  };

  // Show delete confirmation
  const confirmDelete = (habit: Habit) => {
    setDeleteConfirmHabit(habit);
  };

  // Delete habit after confirmation
  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmHabit) return;

    await deleteHabit(deleteConfirmHabit.id);
    toast.success(`Deleted "${deleteConfirmHabit.title}"`);

    if (editingHabit?.id === deleteConfirmHabit.id) {
      setView('main');
      resetForm();
    }
    setDeleteConfirmHabit(null);
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

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteConfirmHabit) {
          cancelDelete();
        } else {
          handleClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, deleteConfirmHabit, handleClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 sm:slide-in-from-bottom-0 duration-200 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'main' && (
              <button
                onClick={() => setView('main')}
                className="p-1 text-brand-400 hover:text-brand-600 -ml-1"
                aria-label="Back to main view"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
            )}
            <h2 className="text-lg font-bold text-brand-800">
              {VIEW_TITLES[view]}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-brand-400 hover:bg-brand-50 rounded-full"
            aria-label="Close habit manager"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* Main View */}
          {view === 'main' && (
            <div className="p-4 space-y-6">

              {/* Create Custom Button */}
              <button
                onClick={openCreateCustom}
                className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-brand-50 to-indigo-50 border-2 border-dashed border-brand-200 rounded-xl hover:border-brand-400 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600 group-hover:bg-brand-200 transition-colors">
                    <Plus size={20} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-brand-800">Create Custom Habit</p>
                    <p className="text-xs text-brand-400">Define your own habit with custom settings</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-brand-400" />
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
        <div className="p-4 border-t border-brand-100 flex-shrink-0">
          {view === 'main' ? (
            <button
              onClick={handleClose}
              className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleSaveCustom}
              className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
            >
              {view === 'edit-custom' ? 'Save Changes' : 'Create Habit'}
            </button>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirmHabit && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={cancelDelete} />
            <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center text-money-neg">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-brand-800">Delete Habit?</h3>
                  <p className="text-sm text-brand-400">This action cannot be undone.</p>
                </div>
              </div>
              <p className="text-sm text-brand-600 mb-6">
                Are you sure you want to delete <span className="font-semibold">"{deleteConfirmHabit.title}"</span>?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={cancelDelete}
                  className="flex-1 py-2.5 bg-brand-100 text-brand-700 font-semibold rounded-xl hover:bg-brand-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirmed}
                  className="flex-1 py-2.5 bg-money-neg text-white font-semibold rounded-xl hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default HabitCreatorWizard;
