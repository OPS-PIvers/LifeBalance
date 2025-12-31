
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Challenge } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

interface ChallengeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChallengeFormModal: React.FC<ChallengeFormModalProps> = ({ isOpen, onClose }) => {
  const { activeChallenge, habits, updateChallenge } = useHousehold();

  // Form State
  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [yearlyRewardLabel, setYearlyRewardLabel] = useState('');
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);

  useEffect(() => {
    if (activeChallenge) {
      setTitle(activeChallenge.title);
      setTargetCount(activeChallenge.targetTotalCount.toString());
      setYearlyRewardLabel(activeChallenge.yearlyRewardLabel);
      setSelectedHabitIds(activeChallenge.relatedHabitIds);
    }
  }, [activeChallenge, isOpen]);

  const toggleHabitSelection = (habitId: string) => {
    setSelectedHabitIds(prev => 
      prev.includes(habitId) 
        ? prev.filter(id => id !== habitId) 
        : [...prev, habitId]
    );
  };

  const handleSave = () => {
    if (!title || !targetCount || !activeChallenge) return;

    const updatedChallenge: Challenge = {
      ...activeChallenge,
      title,
      targetTotalCount: parseInt(targetCount),
      yearlyRewardLabel,
      relatedHabitIds: selectedHabitIds
    };

    updateChallenge(updatedChallenge);
    onClose();
  };

  if (!isOpen) return null;

  // Show all habits so users can link multiple positive/negative habits if desired
  const availableHabits = habits;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 bg-brand-50">
          <h2 className="text-lg font-bold text-brand-800">Edit Monthly Goal</h2>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          
          {/* Title */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase">Goal Title</label>
            <input 
              type="text" 
              value={title} 
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. No Spend November"
              className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:border-brand-400 outline-none transition-colors"
            />
          </div>

          {/* Stats Config */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase">Target Count</label>
              <input 
                type="number" 
                value={targetCount} 
                onChange={e => setTargetCount(e.target.value)}
                placeholder="100"
                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono focus:border-brand-400 outline-none transition-colors"
              />
            </div>
             <div>
              <label className="text-xs font-bold text-brand-400 uppercase">Reward Label</label>
              <input 
                type="text" 
                value={yearlyRewardLabel} 
                onChange={e => setYearlyRewardLabel(e.target.value)}
                placeholder="Bonus"
                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:border-brand-400 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Habit Linking */}
          <div className="bg-brand-50 p-4 rounded-xl border border-brand-100">
            <h3 className="text-sm font-bold text-brand-700 mb-2">Linked Habits</h3>
            <p className="text-xs text-brand-400 mb-3">
              Completing these habits will advance the goal progress. Select all that apply.
            </p>
            
            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
              {availableHabits.length === 0 ? (
                <p className="text-xs text-brand-400 italic">No habits created yet.</p>
              ) : (
                availableHabits.map(habit => {
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
                        <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                           isSelected ? 'bg-brand-800 border-brand-800 text-white' : 'border border-brand-300 bg-white'
                        }`}>
                          {isSelected && <Check size={14} strokeWidth={3} />}
                        </div>
                        <span className={`text-sm font-medium ${isSelected ? 'text-brand-800' : 'text-brand-500'}`}>
                          {habit.title}
                        </span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                         habit.type === 'positive' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                         {habit.type === 'positive' ? 'Good' : 'Bad'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        <div className="p-4 border-t border-brand-100 bg-brand-50">
          <button 
            onClick={handleSave}
            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Save Goal
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChallengeFormModal;
