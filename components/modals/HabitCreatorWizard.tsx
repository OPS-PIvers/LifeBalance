import React, { useState, useMemo } from 'react';
import { X, Plus, Edit2, Trash2, Check, ChevronRight, Sparkles, Settings } from 'lucide-react';
import { Habit, EffortLevel } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import {
  PresetHabit,
  EFFORT_POINTS,
  EFFORT_LABELS,
  EFFORT_COLORS,
  HABIT_CATEGORIES,
  getPresetHabitsByCategory
} from '@/data/presetHabits';
import toast from 'react-hot-toast';

interface HabitCreatorWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type WizardView = 'main' | 'create-custom' | 'edit-custom';

// Categories for custom habit creation (subset of main categories)
const CUSTOM_CATEGORIES = ['Health', 'Meal Planning', 'Household', 'Financial Planning', 'Self-Discipline', 'Negative / Avoidance'];

const HabitCreatorWizard: React.FC<HabitCreatorWizardProps> = ({ isOpen, onClose }) => {
  const { habits, addHabit, updateHabit, deleteHabit } = useHousehold();

  // View state
  const [view, setView] = useState<WizardView>('main');
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Health');

  // Create/Edit form state
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('Health');
  const [formType, setFormType] = useState<'positive' | 'negative'>('positive');
  const [formEffortLevel, setFormEffortLevel] = useState<EffortLevel>('medium');
  const [formScoringType, setFormScoringType] = useState<'incremental' | 'threshold'>('threshold');
  const [formPeriod, setFormPeriod] = useState<'daily' | 'weekly'>('daily');
  const [formTargetCount, setFormTargetCount] = useState('1');

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
      // Remove the habit
      await deleteHabit(existingHabit.id);
      toast.success(`Removed "${preset.title}"`);
    } else {
      // Add the habit from preset
      const newHabit: Habit = {
        id: crypto.randomUUID(),
        title: preset.title,
        category: preset.category,
        type: preset.type,
        basePoints: EFFORT_POINTS[preset.effortLevel],
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

  // Reset form for new custom habit
  const resetForm = () => {
    setFormTitle('');
    setFormCategory('Health');
    setFormType('positive');
    setFormEffortLevel('medium');
    setFormScoringType('threshold');
    setFormPeriod('daily');
    setFormTargetCount('1');
  };

  // Open create custom view
  const openCreateCustom = () => {
    resetForm();
    setEditingHabit(null);
    setView('create-custom');
  };

  // Open edit custom view
  const openEditCustom = (habit: Habit) => {
    setEditingHabit(habit);
    setFormTitle(habit.title);
    setFormCategory(habit.category);
    setFormType(habit.type);
    setFormEffortLevel(habit.effortLevel || 'medium');
    setFormScoringType(habit.scoringType);
    setFormPeriod(habit.period);
    setFormTargetCount(habit.targetCount.toString());
    setView('edit-custom');
  };

  // Save custom habit (create or update)
  const handleSaveCustom = async () => {
    if (!formTitle.trim()) {
      toast.error('Please enter a habit name');
      return;
    }

    const habitData: Habit = {
      id: editingHabit ? editingHabit.id : crypto.randomUUID(),
      title: formTitle.trim(),
      category: formCategory,
      type: formType,
      basePoints: EFFORT_POINTS[formEffortLevel],
      scoringType: formScoringType,
      period: formPeriod,
      targetCount: parseInt(formTargetCount) || 1,
      count: editingHabit ? editingHabit.count : 0,
      totalCount: editingHabit ? editingHabit.totalCount : 0,
      completedDates: editingHabit ? editingHabit.completedDates : [],
      streakDays: editingHabit ? editingHabit.streakDays : 0,
      lastUpdated: new Date().toISOString(),
      weatherSensitive: false,
      isCustom: true,
      effortLevel: formEffortLevel,
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

  // Delete custom habit
  const handleDeleteCustom = async (habit: Habit) => {
    await deleteHabit(habit.id);
    toast.success(`Deleted "${habit.title}"`);
    if (editingHabit?.id === habit.id) {
      setView('main');
      resetForm();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 sm:slide-in-from-bottom-0 duration-200 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'main' && (
              <button
                onClick={() => setView('main')}
                className="p-1 text-brand-400 hover:text-brand-600 -ml-1"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
            )}
            <h2 className="text-lg font-bold text-brand-800">
              {view === 'main' && 'Manage Habits'}
              {view === 'create-custom' && 'Create Custom Habit'}
              {view === 'edit-custom' && 'Edit Habit'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-50 rounded-full">
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

              {/* Custom Habits Section */}
              {customHabits.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Settings size={14} className="text-brand-400" />
                    <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider">
                      Your Custom Habits
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {customHabits.map(habit => (
                      <div
                        key={habit.id}
                        className="flex items-center justify-between p-3 bg-white border border-brand-100 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-8 rounded-full ${habit.type === 'positive' ? 'bg-money-pos' : 'bg-money-neg'}`} />
                          <div>
                            <p className="font-semibold text-brand-800 text-sm">{habit.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-brand-400">{habit.category}</span>
                              {habit.effortLevel && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${EFFORT_COLORS[habit.effortLevel].bg} ${EFFORT_COLORS[habit.effortLevel].text}`}>
                                  {EFFORT_LABELS[habit.effortLevel]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditCustom(habit)}
                            className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteCustom(habit)}
                            className="p-2 text-brand-400 hover:text-money-neg hover:bg-rose-50 rounded-lg"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preset Habits Section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={14} className="text-brand-400" />
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider">
                    Preset Habits
                  </h3>
                </div>

                {/* Category Accordion */}
                <div className="space-y-2">
                  {HABIT_CATEGORIES.map(category => {
                    const categoryPresets = presetsByCategory[category] || [];
                    if (categoryPresets.length === 0) return null;

                    const enabledCount = categoryPresets.filter(p => enabledPresetIds.has(p.id)).length;
                    const isExpanded = expandedCategory === category;
                    const isNegativeCategory = category === 'Negative / Avoidance';

                    return (
                      <div key={category} className={`border rounded-xl overflow-hidden ${isNegativeCategory ? 'border-rose-200' : 'border-brand-100'}`}>
                        {/* Category Header */}
                        <button
                          onClick={() => setExpandedCategory(isExpanded ? null : category)}
                          className={`w-full flex items-center justify-between p-3 transition-colors ${isNegativeCategory ? 'bg-rose-50 hover:bg-rose-100' : 'bg-brand-50 hover:bg-brand-100'}`}
                        >
                          <span className={`font-semibold text-sm ${isNegativeCategory ? 'text-rose-700' : 'text-brand-700'}`}>{category}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${isNegativeCategory ? 'text-rose-400' : 'text-brand-400'}`}>
                              {enabledCount} / {categoryPresets.length} active
                            </span>
                            <ChevronRight
                              size={16}
                              className={`transition-transform ${isNegativeCategory ? 'text-rose-400' : 'text-brand-400'} ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </div>
                        </button>

                        {/* Category Presets */}
                        {isExpanded && (
                          <div className="divide-y divide-brand-50">
                            {categoryPresets.map(preset => {
                              const isEnabled = enabledPresetIds.has(preset.id);
                              const pointsDisplay = preset.type === 'negative'
                                ? `-${EFFORT_POINTS[preset.effortLevel]}`
                                : `+${EFFORT_POINTS[preset.effortLevel]}`;

                              return (
                                <button
                                  key={preset.id}
                                  onClick={() => handleTogglePreset(preset)}
                                  className="w-full flex items-center justify-between p-3 hover:bg-brand-50 transition-colors text-left"
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                                      isEnabled
                                        ? preset.type === 'negative'
                                          ? 'bg-money-neg border-money-neg text-white'
                                          : 'bg-money-pos border-money-pos text-white'
                                        : 'border-brand-200 text-transparent'
                                    }`}>
                                      <Check size={12} strokeWidth={3} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className={`font-medium text-sm truncate ${isEnabled ? 'text-brand-800' : 'text-brand-600'}`}>
                                        {preset.title}
                                      </p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                          preset.type === 'negative'
                                            ? 'bg-rose-100 text-rose-700'
                                            : `${EFFORT_COLORS[preset.effortLevel].bg} ${EFFORT_COLORS[preset.effortLevel].text}`
                                        }`}>
                                          {pointsDisplay} pts
                                        </span>
                                        <span className="text-[10px] text-brand-400">
                                          {preset.period}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Create/Edit Custom View */}
          {(view === 'create-custom' || view === 'edit-custom') && (
            <div className="p-6 space-y-5">

              {/* Title */}
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase">Habit Name</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="e.g., Practice guitar"
                  className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-300 focus:border-brand-300 outline-none"
                />
              </div>

              {/* Category & Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">Category</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
                  >
                    {CUSTOM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">Type</label>
                  <div className="flex bg-brand-50 p-1 rounded-xl mt-1 border border-brand-200">
                    <button
                      onClick={() => setFormType('positive')}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                        formType === 'positive' ? 'bg-white shadow-sm text-money-pos' : 'text-brand-400'
                      }`}
                    >
                      Good
                    </button>
                    <button
                      onClick={() => setFormType('negative')}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                        formType === 'negative' ? 'bg-white shadow-sm text-money-neg' : 'text-brand-400'
                      }`}
                    >
                      Bad
                    </button>
                  </div>
                </div>
              </div>

              {/* Effort Level */}
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                  Effort Level <span className="font-normal text-brand-300">(determines points)</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['easy', 'medium', 'hard', 'very_hard'] as EffortLevel[]).map(level => (
                    <button
                      key={level}
                      onClick={() => setFormEffortLevel(level)}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        formEffortLevel === level
                          ? `${EFFORT_COLORS[level].bg} ${EFFORT_COLORS[level].text} border-current ring-1 ring-current`
                          : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50'
                      }`}
                    >
                      <span className="block text-xs font-bold">{EFFORT_LABELS[level]}</span>
                      <span className="block text-[10px] mt-0.5 opacity-75">
                        {formType === 'positive' ? '+' : '-'}{EFFORT_POINTS[level]} pts
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Scoring Type */}
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">Scoring Strategy</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setFormScoringType('threshold')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      formScoringType === 'threshold'
                        ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200'
                        : 'bg-brand-50 border-transparent hover:bg-white'
                    }`}
                  >
                    <span className="block font-bold text-sm text-brand-800">Threshold</span>
                    <span className="block text-[10px] text-brand-400 mt-0.5">Points when target is met</span>
                  </button>
                  <button
                    onClick={() => setFormScoringType('incremental')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      formScoringType === 'incremental'
                        ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200'
                        : 'bg-brand-50 border-transparent hover:bg-white'
                    }`}
                  >
                    <span className="block font-bold text-sm text-brand-800">Incremental</span>
                    <span className="block text-[10px] text-brand-400 mt-0.5">Points for every tap</span>
                  </button>
                </div>
              </div>

              {/* Target & Period */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">Target Count</label>
                  <input
                    type="number"
                    min="1"
                    value={formTargetCount}
                    onChange={e => setFormTargetCount(e.target.value)}
                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl text-center font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">Period</label>
                  <div className="flex bg-brand-50 p-1 rounded-xl mt-1 border border-brand-200">
                    <button
                      onClick={() => setFormPeriod('daily')}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                        formPeriod === 'daily' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'
                      }`}
                    >
                      Daily
                    </button>
                    <button
                      onClick={() => setFormPeriod('weekly')}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                        formPeriod === 'weekly' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'
                      }`}
                    >
                      Weekly
                    </button>
                  </div>
                </div>
              </div>

              {/* Delete Button (Edit mode only) */}
              {view === 'edit-custom' && editingHabit && (
                <button
                  onClick={() => handleDeleteCustom(editingHabit)}
                  className="w-full py-3 text-money-neg font-semibold rounded-xl border border-rose-200 hover:bg-rose-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={16} />
                  Delete This Habit
                </button>
              )}

            </div>
          )}
        </div>

        {/* Footer Actions */}
        {(view === 'create-custom' || view === 'edit-custom') && (
          <div className="p-4 border-t border-brand-100 flex-shrink-0">
            <button
              onClick={handleSaveCustom}
              className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
            >
              {view === 'edit-custom' ? 'Save Changes' : 'Create Habit'}
            </button>
          </div>
        )}

        {/* Done button for main view */}
        {view === 'main' && (
          <div className="p-4 border-t border-brand-100 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
            >
              Done
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default HabitCreatorWizard;
