import React, { useState } from 'react';
import { Loader2, ArrowRight, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { MagicActionResponse } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';

interface CaptureMagicActionProps {
  householdId: string;
  dynamicCategories: string[];
  onSuccess: (result: MagicActionResponse) => void;
}

export const CaptureMagicAction: React.FC<CaptureMagicActionProps> = ({
  householdId,
  dynamicCategories,
  onSuccess
}) => {
  const [magicInput, setMagicInput] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);

  const handleMagicSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!magicInput.trim()) return;

    setMagicLoading(true);
    try {
      if (!householdId) throw new Error("Household ID not found");

      const context = {
        categories: dynamicCategories,
        groceryCategories: GROCERY_CATEGORIES,
        todayDate: getLocalDateString()
      };

      const { parseMagicAction } = await import('@/services/geminiService');
      const result = await parseMagicAction(householdId, magicInput, context);

      onSuccess(result);
      setMagicInput('');
    } catch (err) {
      console.error(err);
      toast.error("Magic action failed.");
    } finally {
      setMagicLoading(false);
    }
  };

  return (
    <div className="bg-linear-to-r from-violet-600 to-indigo-600 p-1 rounded-2xl shadow-lg mb-6">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-violet-600 dark:text-violet-300 animate-pulse" />
          <span className="text-xs font-bold text-violet-600 dark:text-violet-300 uppercase tracking-wider">Magic Action</span>
        </div>
        <form onSubmit={handleMagicSubmit} className="flex gap-2">
          <input
            type="text"
            aria-label="Magic action input"
            value={magicInput}
            onChange={(e) => setMagicInput(e.target.value)}
            placeholder="Spent $20 on Pizza..."
            className="flex-1 bg-violet-50 dark:bg-violet-500/15 border-none outline-hidden text-brand-800 dark:text-slate-100 placeholder:text-violet-300 font-medium rounded-lg px-2 py-1"
            disabled={magicLoading}
          />
          <button
            type="submit"
            aria-label="Submit magic action"
            disabled={!magicInput.trim() || magicLoading}
            className="p-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {magicLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
};
