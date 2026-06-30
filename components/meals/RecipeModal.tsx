import React, { useState } from 'react';
import { Meal, MealPlanItem } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      ariaLabelledBy="recipe-modal-title"
      header={
        <div className="px-6 py-4 border-b border-brand-200 dark:border-brand-700">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isCooked && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 size={12} /> Cooked
              </Badge>
            )}
            {meal.tags?.map(tag => (
              <Badge key={tag} variant="neutral">
                {tag}
              </Badge>
            ))}
          </div>
          <h3 id="recipe-modal-title" className="font-display text-xl font-semibold text-brand-900 dark:text-brand-100 tracking-tight leading-snug">
            {meal.name}
          </h3>
          {meal.description && (
            <p className="text-sm text-brand-500 dark:text-brand-400 mt-1 leading-relaxed">{meal.description}</p>
          )}
        </div>
      }
    >
        {/* Content (single Drawer scroll container) */}
        <div className="p-6 space-y-8 bg-brand-50 dark:bg-brand-900/30">

          {/* Ingredients */}
          {meal.ingredients && meal.ingredients.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100 uppercase tracking-wider mb-4">
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
                        "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors duration-(--duration-fast) ease-(--ease-standard) w-full text-left",
                        isChecked
                          ? "bg-brand-50 border-brand-200 opacity-60 dark:bg-brand-800/50 dark:border-brand-700"
                          : "bg-white border-brand-200 hover:border-brand-300 dark:bg-brand-800 dark:border-brand-700 dark:hover:border-brand-500/50"
                      )}
                    >
                      <div className={clsx(
                        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                        isChecked ? "bg-brand-300 border-brand-300 text-white dark:bg-brand-600 dark:border-brand-600" : "border-brand-300 bg-white dark:border-brand-600 dark:bg-brand-700"
                      )}>
                        {isChecked && <Check size={14} strokeWidth={3} />}
                      </div>
                      <div className={clsx("text-sm", isChecked && "line-through text-brand-400 dark:text-brand-500")}>
                        <span className="font-bold text-brand-700 dark:text-brand-200">{ing.name}</span>
                        {ing.quantity && <span className="text-brand-500 dark:text-brand-400 ml-1">({ing.quantity})</span>}
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
              <h4 className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100 uppercase tracking-wider mb-4">
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
                        "flex gap-4 p-4 rounded-xl border cursor-pointer transition-colors duration-(--duration-fast) ease-(--ease-standard) w-full text-left",
                        isChecked
                          ? "bg-brand-50 border-brand-200 opacity-60 dark:bg-brand-800/50 dark:border-brand-700"
                          : "bg-white border-brand-200 hover:border-brand-300 dark:bg-brand-800 dark:border-brand-700 dark:hover:border-brand-500/50"
                      )}
                    >
                      <div className={clsx(
                        "w-6 h-6 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs transition-colors",
                        isChecked
                          ? "bg-brand-300 border-brand-300 text-white dark:bg-brand-600 dark:border-brand-600"
                          : "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-700/40 dark:text-brand-300 dark:border-brand-500/40"
                      )}>
                        {isChecked ? <Check size={14} strokeWidth={3} /> : idx + 1}
                      </div>
                      <p className={clsx("text-sm leading-relaxed", isChecked ? "line-through text-brand-400 dark:text-brand-500" : "text-brand-700 dark:text-brand-200")}>
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

        {/* Footer (flows after content) */}
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Close
          </Button>
          {planItem && onMarkCooked && !isCooked && (
            <Button
              variant="primary"
              onClick={onMarkCooked}
              className="flex-2"
              leftIcon={<ChefHat size={18} />}
            >
              Mark as Cooked
            </Button>
          )}
          {isCooked && (
             <div className="flex-2 flex items-center justify-center gap-2 bg-money-bgPos text-money-pos font-bold rounded-xl border border-money-pos/20 opacity-80 cursor-default dark:bg-money-pos/15 dark:text-money-posDark dark:border-money-pos/25">
                <CheckCircle2 size={18} /> Bon Appétit!
             </div>
          )}
        </div>
    </Drawer>
  );
};
