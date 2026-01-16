/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { X, Check, Plus, Calendar } from 'lucide-react';
import { Challenge, Habit } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { format, parseISO, subDays } from 'date-fns';
import YearlyGoalFormModal from './YearlyGoalFormModal';
import { getMissedHabitDates } from '@/utils/freezeBankValidator';

interface ChallengeHubModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'challenge' | 'yearly' | 'freeze';

const ChallengeHubModal: React.FC<ChallengeHubModalProps> = ({ isOpen, onClose }) => {
  const {
    activeChallenge,
    habits,
    updateChallenge,
    yearlyGoals,
    activeYearlyGoals,
    freezeBank,
    useFreezeBankToken,
  } = useHousehold();

  const [activeTab, setActiveTab] = useState<TabType>('challenge');
  const [isYearlyGoalFormOpen, setIsYearlyGoalFormOpen] = useState(false);

  // Challenge Tab State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<'count' | 'percentage'>('count');
  const [targetValue, setTargetValue] = useState(100);
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [selectedYearlyGoalId, setSelectedYearlyGoalId] = useState<string>('');

  // Freeze Bank Tab State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHabitForFreeze, setSelectedHabitForFreeze] = useState<string | null>(null);

  useEffect(() => {
    if (activeChallenge) {
      setTitle(activeChallenge.title);
      setDescription(activeChallenge.description || '');
      setTargetType(activeChallenge.targetType || 'count');
      setTargetValue(activeChallenge.targetValue || activeChallenge.targetTotalCount || 100);
      setSelectedHabitIds(activeChallenge.relatedHabitIds || []);
      setSelectedYearlyGoalId(activeChallenge.yearlyGoalId || '');
    }
  }, [activeChallenge, isOpen]);

  const toggleHabitSelection = (habitId: string) => {
    setSelectedHabitIds((prev) =>
      prev.includes(habitId) ? prev.filter((id) => id !== habitId) : [...prev, habitId]
    );
  };

  const handleSaveChallenge = async () => {
    if (!title) return;

    const updatedChallenge: Challenge = activeChallenge
      ? {
          ...activeChallenge,
          title,
          description,
          targetType,
          targetValue,
          relatedHabitIds: selectedHabitIds,
          yearlyGoalId: selectedYearlyGoalId || undefined,
        }
      : {
          id: 'new', // Placeholder ID, ignored by addDoc
          month: format(new Date(), 'yyyy-MM'),
          status: 'active',
          title,
          description,
          targetType,
          targetValue,
          relatedHabitIds: selectedHabitIds,
          yearlyGoalId: selectedYearlyGoalId || undefined,
          yearlyRewardLabel: 'Badge', // Default reward
        };

    await updateChallenge(updatedChallenge);
    onClose();
  };

  const handleUseFreeze = async () => {
    if (!selectedDate || !selectedHabitForFreeze) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    await useFreezeBankToken(selectedHabitForFreeze, dateStr);

    // Reset selections
    setSelectedDate(null);
    setSelectedHabitForFreeze(null);
  };

  if (!isOpen) return null;

  const selectedYearlyGoal = yearlyGoals.find((g) => g.id === selectedYearlyGoalId);
  const displayYearlyGoal = selectedYearlyGoal || activeYearlyGoals[0] || null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 pb-24">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative w-full max-w-2xl max-h-full bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-brand-800">Challenge Hub</h2>
              <button
                onClick={onClose}
                className="p-2 text-brand-400 hover:bg-white rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex p-2 bg-brand-50 mx-4 mt-4 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('challenge')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                activeTab === 'challenge'
                  ? 'bg-white shadow-sm text-brand-800'
                  : 'text-brand-400 hover:text-brand-600'
              }`}
            >
              Challenge
            </button>
            <button
              onClick={() => setActiveTab('yearly')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                activeTab === 'yearly'
                  ? 'bg-white shadow-sm text-brand-800'
                  : 'text-brand-400 hover:text-brand-600'
              }`}
            >
              Yearly Goal
            </button>
            <button
              onClick={() => setActiveTab('freeze')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                activeTab === 'freeze'
                  ? 'bg-white shadow-sm text-brand-800'
                  : 'text-brand-400 hover:text-brand-600'
              }`}
            >
              Freeze Bank
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Challenge Tab */}
            {activeTab === 'challenge' && (
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">
                    Challenge Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., No Spend November"
                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:border-brand-400 outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase">
                    Description (Optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add details about this challenge..."
                    className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl resize-none h-20 focus:border-brand-400 outline-none"
                  />
                </div>

                {/* Target Type */}
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                    Target Type
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setTargetType('count')}
                      className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                        targetType === 'count'
                          ? 'border-brand-400 bg-brand-50 shadow-sm'
                          : 'border-brand-100 hover:border-brand-200'
                      }`}
                    >
                      <span className="block font-bold text-brand-800">Count</span>
                      <span className="text-xs text-brand-400">Total completions</span>
                    </button>
                    <button
                      onClick={() => setTargetType('percentage')}
                      className={`flex-1 p-4 rounded-xl border-2 transition-all ${
                        targetType === 'percentage'
                          ? 'border-brand-400 bg-brand-50 shadow-sm'
                          : 'border-brand-100 hover:border-brand-200'
                      }`}
                    >
                      <span className="block font-bold text-brand-800">Percentage</span>
                      <span className="text-xs text-brand-400">% of days completed</span>
                    </button>
                  </div>
                </div>

                {/* Target Slider */}
                <div>
                  <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                    Target: {targetValue}
                    {targetType === 'percentage' ? '%' : ''}
                  </label>
                  <input
                    type="range"
                    min={targetType === 'percentage' ? 0 : 1}
                    max={targetType === 'percentage' ? 100 : 500}
                    value={targetValue}
                    onChange={(e) => setTargetValue(parseInt(e.target.value))}
                    className="w-full h-2 bg-brand-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
                  />
                  <div className="flex justify-between text-xs text-brand-400 mt-1">
                    <span>{targetType === 'percentage' ? '0%' : '1'}</span>
                    <span>{targetType === 'percentage' ? '100%' : '500'}</span>
                  </div>
                </div>

                {/* Yearly Goal Selector */}
                {yearlyGoals.length > 0 && (
                  <div>
                    <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                      Link to Yearly Goal (Optional)
                    </label>
                    <select
                      value={selectedYearlyGoalId}
                      onChange={(e) => setSelectedYearlyGoalId(e.target.value)}
                      className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl focus:border-brand-400 outline-none"
                    >
                      <option value="">No yearly goal</option>
                      {yearlyGoals.map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.title} ({goal.year})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Habit Selector */}
                <div className="bg-brand-50 p-4 rounded-xl border border-brand-100">
                  <h3 className="text-sm font-bold text-brand-700 mb-3">Linked Habits</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {habits.map((habit) => {
                      const isSelected = selectedHabitIds.includes(habit.id);
                      return (
                        <div
                          key={habit.id}
                          onClick={() => toggleHabitSelection(habit.id)}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-white border-brand-400 shadow-sm'
                              : 'bg-transparent border-transparent hover:bg-white/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded flex items-center justify-center ${
                                isSelected
                                  ? 'bg-brand-800 text-white'
                                  : 'border border-brand-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check size={14} strokeWidth={3} />}
                            </div>
                            <span className="text-sm font-medium text-brand-700">
                              {habit.title}
                            </span>
                          </div>
                          <div
                            className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                              habit.type === 'positive'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {habit.type === 'positive' ? 'Good' : 'Bad'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Yearly Goal Tab */}
            {activeTab === 'yearly' && (
              <div className="space-y-6">
                {displayYearlyGoal ? (
                  <>
                    {/* Goal Info */}
                    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-5 rounded-2xl border border-indigo-100">
                      <h3 className="text-lg font-bold text-brand-800 mb-1">
                        {displayYearlyGoal.title}
                      </h3>
                      {displayYearlyGoal.description && (
                        <p className="text-sm text-brand-600 mb-2">
                          {displayYearlyGoal.description}
                        </p>
                      )}
                      <p className="text-sm text-brand-500">
                        Complete {displayYearlyGoal.requiredMonths} out of 12 months
                      </p>
                    </div>

                    {/* 12-Circle Chain Progress */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-xs font-bold text-brand-400 uppercase">
                          Monthly Progress
                        </h4>
                        <span className="text-sm font-bold text-brand-800">
                          {displayYearlyGoal.successfulMonths.length} /{' '}
                          {displayYearlyGoal.requiredMonths}
                        </span>
                      </div>

                      {/* Circle Chain (2 rows of 6) */}
                      <div className="grid grid-cols-6 gap-3">
                        {Array.from({ length: 12 }, (_, i) => {
                          const monthIndex = i + 1;
                          const monthKey = `${displayYearlyGoal.year}-${String(
                            monthIndex
                          ).padStart(2, '0')}`;
                          const isCompleted =
                            displayYearlyGoal.successfulMonths.includes(monthKey);
                          const isCurrentMonth =
                            monthKey === format(new Date(), 'yyyy-MM');

                          return (
                            <div key={monthKey} className="flex flex-col items-center">
                              <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                                  isCompleted
                                    ? 'bg-emerald-500 text-white shadow-lg scale-105'
                                    : isCurrentMonth
                                    ? 'bg-brand-200 text-brand-600 ring-2 ring-brand-400'
                                    : 'bg-brand-100 text-brand-400'
                                }`}
                              >
                                {isCompleted ? (
                                  <Check size={18} strokeWidth={3} />
                                ) : (
                                  monthIndex
                                )}
                              </div>
                              <span className="text-[10px] text-brand-400 mt-1 font-medium">
                                {format(parseISO(`${monthKey}-01`), 'MMM')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Status Message */}
                    <div
                      className={`p-4 rounded-xl border ${
                        displayYearlyGoal.successfulMonths.length >=
                        displayYearlyGoal.requiredMonths
                          ? 'bg-emerald-50 border-emerald-200'
                          : displayYearlyGoal.successfulMonths.length >=
                            displayYearlyGoal.requiredMonths - 2
                          ? 'bg-orange-50 border-orange-200'
                          : 'bg-brand-50 border-brand-200'
                      }`}
                    >
                      <p className="text-sm font-medium text-brand-700 text-center">
                        {displayYearlyGoal.successfulMonths.length >=
                        displayYearlyGoal.requiredMonths
                          ? '🎉 Yearly goal achieved!'
                          : `${
                              displayYearlyGoal.requiredMonths -
                              displayYearlyGoal.successfulMonths.length
                            } months remaining`}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-brand-400 mb-4">No yearly goal set</p>
                    <button
                      onClick={() => setIsYearlyGoalFormOpen(true)}
                      className="px-6 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center gap-2 mx-auto"
                    >
                      <Plus size={18} />
                      Create Yearly Goal
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Freeze Bank Tab */}
            {activeTab === 'freeze' && (
              <div className="space-y-6">
                {/* Token Display */}
                <div className="bg-gradient-to-br from-cyan-50 to-blue-50 p-6 rounded-2xl border border-cyan-100">
                  <h3 className="text-sm font-bold text-brand-400 uppercase mb-3">
                    Available Tokens
                  </h3>
                  <div className="flex items-center justify-center gap-3 mb-4">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div
                        key={i}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                          i < (freezeBank?.tokens || 0)
                            ? 'bg-gradient-to-br from-cyan-400 to-blue-500 text-white shadow-lg scale-110'
                            : 'bg-brand-100 text-brand-300'
                        }`}
                      >
                        <span className="text-2xl">❄️</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-sm text-brand-600">
                    {freezeBank?.tokens || 0} / 3 tokens available
                  </p>
                </div>

                {/* Use Token Flow */}
                {(freezeBank?.tokens || 0) > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-brand-700">Use a Freeze Token</h3>

                    {/* Date Picker */}
                    <div>
                      <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                        Select Missed Date
                      </label>
                      <div className="grid grid-cols-7 gap-2">
                        {Array.from({ length: 7 }, (_, i) => {
                          const date = subDays(new Date(), 6 - i);
                          const dateStr = format(date, 'yyyy-MM-dd');
                          const isSelected =
                            selectedDate && format(selectedDate, 'yyyy-MM-dd') === dateStr;

                          return (
                            <button
                              key={dateStr}
                              onClick={() => setSelectedDate(date)}
                              className={`p-3 rounded-xl border-2 transition-all ${
                                isSelected
                                  ? 'border-cyan-400 bg-cyan-50'
                                  : 'border-brand-100 hover:border-brand-200'
                              }`}
                            >
                              <div className="text-[10px] text-brand-400 font-medium">
                                {format(date, 'EEE')}
                              </div>
                              <div className="text-sm font-bold text-brand-800">
                                {format(date, 'd')}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Habit Picker */}
                    {selectedDate && (
                      <div>
                        <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
                          Select Habit to Patch
                        </label>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {habits
                            .filter((h) => h.type === 'positive')
                            .map((habit) => {
                              const dateStr = format(selectedDate, 'yyyy-MM-dd');
                              const alreadyCompleted = habit.completedDates.includes(dateStr);

                              return (
                                <button
                                  key={habit.id}
                                  onClick={() => setSelectedHabitForFreeze(habit.id)}
                                  disabled={alreadyCompleted}
                                  className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                                    selectedHabitForFreeze === habit.id
                                      ? 'border-cyan-400 bg-cyan-50'
                                      : alreadyCompleted
                                      ? 'border-brand-100 bg-brand-50 opacity-50 cursor-not-allowed'
                                      : 'border-brand-100 hover:border-brand-200'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-brand-700">
                                      {habit.title}
                                    </span>
                                    {alreadyCompleted && (
                                      <span className="text-xs text-emerald-600 font-medium">
                                        Already completed
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* Use Token Button */}
                    {selectedDate && selectedHabitForFreeze && (
                      <button
                        onClick={handleUseFreeze}
                        className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
                      >
                        Use Freeze Token ❄️
                      </button>
                    )}
                  </div>
                )}

                {/* History Log */}
                <div>
                  <h3 className="text-xs font-bold text-brand-400 uppercase mb-3">
                    Recent History
                  </h3>
                  <div className="space-y-2">
                    {(freezeBank?.history || [])
                      .slice(-5)
                      .reverse()
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between p-3 bg-brand-50 rounded-xl border border-brand-100"
                        >
                          <div>
                            <p className="text-sm font-medium text-brand-700">
                              {entry.type === 'used' ? '❄️ Token Used' : '📥 Rollover'}
                            </p>
                            <p className="text-xs text-brand-400">{entry.notes}</p>
                          </div>
                          <span
                            className={`text-sm font-bold ${
                              entry.amount > 0 ? 'text-emerald-600' : 'text-brand-600'
                            }`}
                          >
                            {entry.amount > 0 ? '+' : ''}
                            {entry.amount}
                          </span>
                        </div>
                      ))}
                    {(!freezeBank?.history || freezeBank.history.length === 0) && (
                      <p className="text-sm text-brand-400 text-center py-4">No history yet</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-brand-100 bg-brand-50">
            {activeTab === 'challenge' && (
              <button
                onClick={handleSaveChallenge}
                disabled={!title}
                className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Challenge
              </button>
            )}
            {activeTab === 'yearly' && displayYearlyGoal && (
              <div className="text-center">
                <p className="text-xs text-brand-400">
                  Monthly challenges automatically update yearly progress
                </p>
              </div>
            )}
            {activeTab === 'freeze' && (
              <button
                onClick={onClose}
                className="w-full py-3 bg-brand-100 text-brand-700 font-bold rounded-xl active:scale-95 transition-transform"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Yearly Goal Form Modal */}
      <YearlyGoalFormModal
        isOpen={isYearlyGoalFormOpen}
        onClose={() => setIsYearlyGoalFormOpen(false)}
      />
    </>
  );
};

export default ChallengeHubModal;
