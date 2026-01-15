/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { YearlyGoal } from '@/types/schema';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';

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
  const { createYearlyGoal, updateYearlyGoal } = useHousehold();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [requiredMonths, setRequiredMonths] = useState(10);

  useEffect(() => {
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 to-indigo-50 shrink-0">
          <h2 className="text-lg font-bold text-brand-800">
            {editingGoal ? 'Edit Yearly Goal' : 'New Yearly Goal'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-brand-400 hover:bg-brand-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-bold text-brand-400 uppercase">
              Goal Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Family Trip to Disney"
              className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:border-brand-400 outline-none transition-colors"
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
              placeholder="Add details about this goal..."
              className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl resize-none h-20 focus:border-brand-400 outline-none transition-colors"
            />
          </div>

          {/* Year and Required Months */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-brand-400 uppercase">
                Year
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                min={new Date().getFullYear()}
                max={new Date().getFullYear() + 5}
                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono focus:border-brand-400 outline-none transition-colors"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-brand-400 uppercase">
                Required Months *
              </label>
              <input
                type="number"
                value={requiredMonths}
                onChange={(e) => setRequiredMonths(parseInt(e.target.value))}
                min={1}
                max={12}
                className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono focus:border-brand-400 outline-none transition-colors"
              />
            </div>
          </div>

          <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
            <p className="text-xs text-brand-600">
              Complete <span className="font-bold">{requiredMonths}</span> out of 12 monthly
              challenges to achieve this yearly goal.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-brand-100 bg-brand-50">
          <button
            onClick={handleSave}
            disabled={!title || requiredMonths < 1 || requiredMonths > 12}
            className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingGoal ? 'Update Goal' : 'Create Goal'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default YearlyGoalFormModal;
