import React, { useState } from 'react';
import { Meal, MealPlanItem } from '@/types/schema';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Check, ExternalLink, ChefHat, Utensils, CheckCircle2 } from 'lucide-react';
import { haptic } from '@/utils/haptics';
import clsx from 'clsx';

interface RecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  meal: Meal;
  planItem?: MealPlanItem;
  onMarkCooked?: () => void;
}

export const RecipeModal: React.FC<RecipeModalProps> = ({
  isOpen,
  onClose,
  meal,
  planItem,
  onMarkCooked
}) => {
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [checkedInstructions, setCheckedInstructions] = useState<Set<number>>(new Set());

  const toggleIngredient = (index: number) => {
    haptic('light');
    const newSet = new Set(checkedIngredients);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setCheckedIngredients(newSet);
  };

  const toggleInstruction = (index: number) => {
    haptic('light');
    const newSet = new Set(checkedInstructions);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setCheckedInstructions(newSet);
  };

  const isCooked = planItem?.isCooked;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl" ariaLabelledBy="recipe-modal-title">
      <div className="flex flex-col h-full max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 z-10 flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {isCooked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-bold border border-green-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20">
                  <CheckCircle2 size={12} /> Cooked
                </span>
              )}
              {meal.tags?.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium border border-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600">
                  {tag}
                </span>
              ))}
            </div>
            <h3 id="recipe-modal-title" className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-snug">
              {meal.name}
            </h3>
            {meal.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{meal.description}</p>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 scroll-contain-y p-6 space-y-8 bg-slate-50/30 dark:bg-slate-900/30">

          {/* Ingredients */}
          {meal.ingredients && meal.ingredients.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-4">
                <Utensils size={16} className="text-brand-600 dark:text-brand-300" /> Ingredients
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {meal.ingredients.map((ing, idx) => {
                  const isChecked = checkedIngredients.has(idx);
                  return (
                    <button
                      key={ing.name}
                      onClick={() => toggleIngredient(idx)}
                      className={clsx(
                        "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all w-full text-left",
                        isChecked
                          ? "bg-slate-50 border-slate-200 opacity-60 dark:bg-slate-800/50 dark:border-slate-700"
                          : "bg-white border-slate-200 hover:border-brand-300 hover:shadow-xs dark:bg-slate-800 dark:border-slate-700 dark:hover:border-brand-500/50"
                      )}
                    >
                      <div className={clsx(
                        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                        isChecked ? "bg-slate-300 border-slate-300 text-white dark:bg-slate-600 dark:border-slate-600" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-700"
                      )}>
                        {isChecked && <Check size={14} strokeWidth={3} />}
                      </div>
                      <div className={clsx("text-sm", isChecked && "line-through text-slate-400 dark:text-slate-500")}>
                        <span className="font-bold text-slate-700 dark:text-slate-200">{ing.name}</span>
                        {ing.quantity && <span className="text-slate-500 dark:text-slate-400 ml-1">({ing.quantity})</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Instructions */}
          {meal.instructions && meal.instructions.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-4">
                <ChefHat size={16} className="text-brand-600 dark:text-brand-300" /> Instructions
              </h4>
              <div className="space-y-4">
                {meal.instructions.map((step, idx) => {
                  const isChecked = checkedInstructions.has(idx);
                  return (
                    <button
                      key={step}
                      onClick={() => toggleInstruction(idx)}
                      className={clsx(
                        "flex gap-4 p-4 rounded-xl border cursor-pointer transition-all w-full text-left",
                        isChecked
                          ? "bg-slate-50 border-slate-200 opacity-60 dark:bg-slate-800/50 dark:border-slate-700"
                          : "bg-white border-slate-200 hover:border-brand-300 hover:shadow-xs dark:bg-slate-800 dark:border-slate-700 dark:hover:border-brand-500/50"
                      )}
                    >
                      <div className={clsx(
                        "w-6 h-6 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs transition-colors",
                        isChecked
                          ? "bg-slate-300 border-slate-300 text-white dark:bg-slate-600 dark:border-slate-600"
                          : "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-700/40 dark:text-brand-300 dark:border-brand-500/40"
                      )}>
                        {isChecked ? <Check size={14} strokeWidth={3} /> : idx + 1}
                      </div>
                      <p className={clsx("text-sm leading-relaxed", isChecked ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200")}>
                        {step}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* External Link */}
          {meal.recipeUrl && (
            <div className="flex justify-center mt-6">
              <a
                href={meal.recipeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:text-brand-800 hover:underline px-4 py-2 rounded-lg hover:bg-brand-50 transition-colors dark:text-brand-300 dark:hover:text-brand-200 dark:hover:bg-brand-700/30"
              >
                <ExternalLink size={16} /> View Original Recipe
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Close
          </Button>
          {planItem && onMarkCooked && !isCooked && (
            <Button
              variant="primary"
              onClick={onMarkCooked}
              className="flex-2 shadow-lg shadow-brand-200"
              leftIcon={<ChefHat size={18} />}
            >
              Mark as Cooked
            </Button>
          )}
          {isCooked && (
             <div className="flex-2 flex items-center justify-center gap-2 bg-green-50 text-green-700 font-bold rounded-xl border border-green-200 opacity-80 cursor-default dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20">
                <CheckCircle2 size={18} /> Bon Appétit!
             </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
