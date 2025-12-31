
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Habit } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

interface HabitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingHabit?: Habit;
}

const CATEGORIES = ['Health', 'Finance', 'Personal', 'Home', 'Work'];

const HabitFormModal: React.FC<HabitFormModalProps> = ({ isOpen, onClose, editingHabit }) => {
  const { addHabit, updateHabit } = useHousehold();

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [type, setType] = useState<'positive' | 'negative'>('positive');
  const [scoringType, setScoringType] = useState<'incremental' | 'threshold'>('threshold');
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');
  const [basePoints, setBasePoints] = useState('10');
  const [targetCount, setTargetCount] = useState('1');

  useEffect(() => {
    if (editingHabit) {
      setTitle(editingHabit.title);
      setCategory(editingHabit.category);
      setType(editingHabit.type);
      setScoringType(editingHabit.scoringType || 'threshold');
      setPeriod(editingHabit.period);
      setBasePoints(editingHabit.basePoints.toString());
      setTargetCount(editingHabit.targetCount.toString());
    } else {
      // Reset defaults
      setTitle('');
      setCategory(CATEGORIES[0]);
      setType('positive');
      setScoringType('threshold');
      setPeriod('daily');
      setBasePoints('10');
      setTargetCount('1');
    }
  }, [editingHabit, isOpen]);

  const handleSave = () => {
    if (!title || !basePoints || !targetCount) return;

    const habitData: Habit = {
      id: editingHabit ? editingHabit.id : crypto.randomUUID(),
      title,
      category,
      type,
      scoringType,
      period,
      basePoints: parseInt(basePoints),
      targetCount: parseInt(targetCount),
      // Preserve or Init State
      count: editingHabit ? editingHabit.count : 0,
      totalCount: editingHabit ? editingHabit.totalCount : 0,
      completedDates: editingHabit ? editingHabit.completedDates : [],
      streakDays: editingHabit ? editingHabit.streakDays : 0,
      lastUpdated: new Date().toISOString(),
      weatherSensitive: editingHabit ? editingHabit.weatherSensitive : false,
    };

    if (editingHabit) {
      updateHabit(habitData);
    } else {
      addHabit(habitData);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-24 sm:pb-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[calc(100vh-8rem)] sm:max-h-[85vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-brand-800">
            {editingHabit ? 'Edit Habit' : 'New Habit'}
          </h2>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-50 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* Title */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Drink Water"
              className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
            />
          </div>

          {/* Type & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase">Type</label>
              <div className="flex bg-brand-50 p-1 rounded-xl mt-1">
                 <button
                   onClick={() => setType('positive')}
                   className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${type === 'positive' ? 'bg-white shadow-sm text-money-pos' : 'text-brand-400'}`}
                 >Good</button>
                 <button
                   onClick={() => setType('negative')}
                   className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${type === 'negative' ? 'bg-white shadow-sm text-money-neg' : 'text-brand-400'}`}
                 >Bad</button>
               </div>
            </div>
          </div>

          {/* Scoring Logic */}
          <div className="bg-brand-50 p-4 rounded-xl border border-brand-100">
            <h3 className="text-sm font-bold text-brand-700 mb-3">Scoring Strategy</h3>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setScoringType('incremental')}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${scoringType === 'incremental' ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200' : 'border-transparent hover:bg-white/50'}`}
              >
                <span className="block font-bold mb-1">Incremental</span>
                <span className="text-brand-400">Points for every tap.</span>
              </button>
              <button
                onClick={() => setScoringType('threshold')}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${scoringType === 'threshold' ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200' : 'border-transparent hover:bg-white/50'}`}
              >
                <span className="block font-bold mb-1">Threshold</span>
                <span className="text-brand-400">Points only when target met.</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase">Points</label>
                <input
                  type="number"
                  value={basePoints}
                  onChange={e => setBasePoints(e.target.value)}
                  className="w-full mt-1 p-2 bg-white border border-brand-200 rounded-lg text-center font-mono font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-brand-400 uppercase">Target ({period})</label>
                <div className="flex items-center gap-2 mt-1">
                   <input
                    type="number"
                    value={targetCount}
                    onChange={e => setTargetCount(e.target.value)}
                    className="w-20 p-2 bg-white border border-brand-200 rounded-lg text-center font-mono font-bold"
                  />
                  <button
                    onClick={() => setPeriod(period === 'daily' ? 'weekly' : 'daily')}
                    className="text-[10px] font-bold uppercase bg-white border border-brand-200 px-2 py-2.5 rounded-lg min-w-[60px]"
                  >
                    {period}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div className="p-4 border-t border-brand-100 flex-shrink-0">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            {editingHabit ? 'Save Changes' : 'Create Habit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HabitFormModal;
