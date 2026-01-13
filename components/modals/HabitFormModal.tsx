
import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Habit } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';

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

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title || !basePoints || !targetCount || isSaving) return;

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
      // Preserve ownership fields when editing
      isShared: editingHabit?.isShared,
      ownerId: editingHabit?.ownerId,
      telegramAlias: editingHabit?.telegramAlias,
    };

    console.log('[HabitFormModal] Saving habit with scoringType:', scoringType, 'habitData:', habitData);
    setIsSaving(true);
    try {
      if (editingHabit) {
        await updateHabit(habitData);
      } else {
        await addHabit(habitData);
      }
      onClose();
    } catch (error) {
      console.error('[HabitFormModal] Save failed:', error);
      // Error toast is handled by updateHabit/addHabit
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      disableBackdropClose={isSaving}
      ariaLabelledBy="habit-form-title"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 flex-shrink-0">
        <h2 id="habit-form-title" className="text-lg font-bold text-brand-800">
          {editingHabit ? 'Edit Habit' : 'New Habit'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="p-2 text-brand-400 hover:bg-brand-50 rounded-full disabled:opacity-50"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* Title */}
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase" htmlFor="habit-title">Title</label>
          <input
            id="habit-title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Drink Water"
            className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
            disabled={isSaving}
          />
        </div>

        {/* Type & Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase" htmlFor="habit-category">Category</label>
            <select
              id="habit-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
              disabled={isSaving}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase">Type</label>
            <div className="flex bg-brand-50 p-1 rounded-xl mt-1">
               <button
                 onClick={() => setType('positive')}
                 disabled={isSaving}
                 type="button"
                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${type === 'positive' ? 'bg-white shadow-sm text-money-pos' : 'text-brand-400'}`}
               >Good</button>
               <button
                 onClick={() => setType('negative')}
                 disabled={isSaving}
                 type="button"
                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${type === 'negative' ? 'bg-white shadow-sm text-money-neg' : 'text-brand-400'}`}
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
              disabled={isSaving}
              type="button"
              className={`p-3 rounded-xl border text-left text-xs transition-all disabled:opacity-50 ${scoringType === 'incremental' ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200' : 'border-transparent hover:bg-white/50'}`}
            >
              <span className="block font-bold mb-1">Incremental</span>
              <span className="text-brand-400">Points for every tap.</span>
            </button>
            <button
              onClick={() => setScoringType('threshold')}
              disabled={isSaving}
              type="button"
              className={`p-3 rounded-xl border text-left text-xs transition-all disabled:opacity-50 ${scoringType === 'threshold' ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200' : 'border-transparent hover:bg-white/50'}`}
            >
              <span className="block font-bold mb-1">Threshold</span>
              <span className="text-brand-400">Points only when target met.</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase" htmlFor="habit-points">Points</label>
              <input
                id="habit-points"
                type="number"
                value={basePoints}
                onChange={e => setBasePoints(e.target.value)}
                className="w-full mt-1 p-2 bg-white border border-brand-200 rounded-lg text-center font-mono font-bold"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase" htmlFor="habit-target">Target ({period})</label>
              <div className="flex items-center gap-2 mt-1">
                 <input
                  id="habit-target"
                  type="number"
                  value={targetCount}
                  onChange={e => setTargetCount(e.target.value)}
                  className="w-20 p-2 bg-white border border-brand-200 rounded-lg text-center font-mono font-bold"
                  disabled={isSaving}
                />
                <button
                  onClick={() => setPeriod(period === 'daily' ? 'weekly' : 'daily')}
                  disabled={isSaving}
                  type="button"
                  className="text-[10px] font-bold uppercase bg-white border border-brand-200 px-2 py-2.5 rounded-lg min-w-[60px] disabled:opacity-50"
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
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all ${isSaving ? 'opacity-70 cursor-not-allowed' : 'active:scale-95'}`}
        >
          {isSaving ? 'Saving...' : (editingHabit ? 'Save Changes' : 'Create Habit')}
        </button>
      </div>
    </Modal>
  );
};

export default HabitFormModal;
