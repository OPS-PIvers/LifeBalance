import React, { useState } from 'react';
import { Loader2, ArrowRight, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { MagicActionResponse } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';

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
  // The user's own grocery categories (custom set) so the AI matches against
  // them, not just the static seed. Falls back to the seed when none exist.
  // `stores` lets the AI prefer an existing store name over inventing one.
  const { groceryCategories, stores } = useShopping();

  const handleMagicSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!magicInput.trim()) return;

    setMagicLoading(true);
    try {
      if (!householdId) throw new Error("Household ID not found");

      const context = {
        categories: dynamicCategories,
        groceryCategories: groceryCategories?.length ? groceryCategories : GROCERY_CATEGORIES,
        stores: stores.map(s => s.name),
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
    <div className="surface-section bg-warm-50 dark:bg-warm-900/20 border-warm-200 dark:border-warm-800/60 p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} className="text-warm-600 dark:text-warm-300" />
        <span className="text-xs font-bold text-warm-700 dark:text-warm-300 uppercase tracking-wider">Magic Action</span>
      </div>
      <form onSubmit={handleMagicSubmit} className="flex gap-2">
        <input
          type="text"
          aria-label="Magic action input"
          value={magicInput}
          onChange={(e) => setMagicInput(e.target.value)}
          placeholder="Spent $20 on Pizza..."
          className="flex-1 bg-white dark:bg-brand-800 border border-warm-200 dark:border-warm-800/60 outline-hidden text-brand-800 dark:text-brand-100 placeholder:text-brand-400 dark:placeholder:text-brand-500 font-medium rounded-btn px-3 py-2 focus:border-warm-500 focus:ring-2 focus:ring-warm-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard)"
          disabled={magicLoading}
        />
        <button
          type="submit"
          aria-label="Submit magic action"
          disabled={!magicInput.trim() || magicLoading}
          className="p-2 bg-warm-500 text-white rounded-btn hover:bg-warm-600 disabled:opacity-50 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
        >
          {magicLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        </button>
      </form>
    </div>
  );
};
