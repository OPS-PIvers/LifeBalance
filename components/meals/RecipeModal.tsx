import React, { useMemo, useState } from 'react';
import { Meal, MealIngredient, MealPlanItem } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SurfaceList } from '@/components/ui/Section';
import { Check, ExternalLink, ChefHat, Utensils, CheckCircle2, Minus, Plus, ShoppingCart } from 'lucide-react';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { scaleQuantity } from '@/utils/scaleQuantity';
import { FIELD_BASE } from '@/components/ui/fieldStyles';
import { cn } from '@/utils/cn';
import clsx from 'clsx';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 50;

interface RecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  meal: Meal;
  planItem?: MealPlanItem;
  onMarkCooked?: () => void;
  onShopIngredients?: (mealName: string, ingredients: MealIngredient[], mealId?: string) => void;
}

export const RecipeModal: React.FC<RecipeModalProps> = ({
  isOpen,
  onClose,
  meal,
  planItem,
  onMarkCooked,
  onShopIngredients
}) => {
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  const [checkedInstructions, setCheckedInstructions] = useState<Set<number>>(new Set());

  // Base servings this recipe's stored quantities are written for; the
  // stepper's initial value. Purely a view-time/transient scale factor —
  // `meal.ingredients` is never mutated by adjusting it.
  const baseServings = meal.servings && meal.servings > 0 ? meal.servings : 1;
  const [servings, setServings] = useState(baseServings);

  const scaleFactor = servings / baseServings;
  const isScaled = scaleFactor !== 1;

  const scaledIngredients = useMemo(
    () =>
      meal.ingredients?.map(ing => ({
        ...ing,
        quantity: scaleQuantity(ing.quantity, scaleFactor)
      })) ?? [],
    [meal.ingredients, scaleFactor]
  );

  // Haptics come from the HapticCheck rows themselves (native iOS tick +
  // Android vibrate), so the toggles are pure state updates.
  const toggleIngredient = (index: number) => {
    const newSet = new Set(checkedIngredients);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setCheckedIngredients(newSet);
  };

  const toggleInstruction = (index: number) => {
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
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h4 className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100 uppercase tracking-wider">
                  <Utensils size={16} className="text-brand-600 dark:text-brand-300" /> Ingredients
                </h4>

                {/* Servings stepper — scales the displayed/shopped quantities only;
                    the stored recipe (meal.ingredients) is never mutated. */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">
                    Servings
                  </span>
                  <div
                    className={cn(
                      FIELD_BASE,
                      "flex items-stretch p-0 overflow-hidden w-auto"
                    )}
                  >
                    <button
                      type="button"
                      aria-label="Decrease servings"
                      onClick={() => setServings(s => Math.max(MIN_SERVINGS, s - 1))}
                      disabled={servings <= MIN_SERVINGS}
                      className="px-2 self-stretch text-brand-500 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-700/50 transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="self-center font-bold min-w-[1.5rem] text-center tabular-nums px-1 text-brand-900 dark:text-brand-100">
                      {servings}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase servings"
                      onClick={() => setServings(s => Math.min(MAX_SERVINGS, s + 1))}
                      disabled={servings >= MAX_SERVINGS}
                      className="px-2 self-stretch text-brand-500 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-700/50 transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <SurfaceList>
                {scaledIngredients.map((ing, idx) => {
                  const isChecked = checkedIngredients.has(idx);
                  return (
                    <HapticCheck
                      key={ing.name}
                      checked={isChecked}
                      onCheckedChange={() => toggleIngredient(idx)}
                      className={clsx(
                        "flex items-center gap-3 px-4 py-3 hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) w-full text-left hover:bg-brand-50 dark:hover:bg-brand-700/40",
                        isChecked && "opacity-60"
                      )}
                    >
                      <div className={clsx(
                        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                        isChecked ? "bg-brand-300 border-brand-300 text-white dark:bg-brand-600 dark:border-brand-600" : "border-brand-300 bg-white dark:border-brand-600 dark:bg-brand-700"
                      )}>
                        {isChecked && <Check size={14} strokeWidth={3} />}
                      </div>
                      <div className={clsx("text-sm min-w-0", isChecked && "line-through text-brand-400 dark:text-brand-450")}>
                        <span className="font-bold text-brand-700 dark:text-brand-200">{ing.name}</span>
                        {ing.quantity && <span className="text-brand-500 dark:text-brand-400 ml-1">({ing.quantity})</span>}
                      </div>
                    </HapticCheck>
                  );
                })}
              </SurfaceList>
            </section>
          )}

          {/* Instructions */}
          {meal.instructions && meal.instructions.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100 uppercase tracking-wider mb-4">
                <ChefHat size={16} className="text-brand-600 dark:text-brand-300" /> Instructions
              </h4>
              <SurfaceList>
                {meal.instructions.map((step, idx) => {
                  const isChecked = checkedInstructions.has(idx);
                  return (
                    <HapticCheck
                      key={step}
                      checked={isChecked}
                      onCheckedChange={() => toggleInstruction(idx)}
                      className={clsx(
                        "flex gap-4 px-4 py-3 hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) w-full text-left hover:bg-brand-50 dark:hover:bg-brand-700/40",
                        isChecked && "opacity-60"
                      )}
                    >
                      <div className={clsx(
                        "w-6 h-6 rounded-full border flex items-center justify-center shrink-0 font-bold text-xs transition-colors mt-0.5",
                        isChecked
                          ? "bg-brand-300 border-brand-300 text-white dark:bg-brand-600 dark:border-brand-600"
                          : "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-700/40 dark:text-brand-300 dark:border-brand-500/40"
                      )}>
                        {isChecked ? <Check size={14} strokeWidth={3} /> : idx + 1}
                      </div>
                      <p className={clsx("text-sm leading-relaxed min-w-0", isChecked ? "line-through text-brand-400 dark:text-brand-450" : "text-brand-700 dark:text-brand-200")}>
                        {step}
                      </p>
                    </HapticCheck>
                  );
                })}
              </SurfaceList>
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
          {onShopIngredients && meal.ingredients && meal.ingredients.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => onShopIngredients(meal.name, scaledIngredients, meal.id)}
              className="flex-2"
              leftIcon={<ShoppingCart size={18} />}
            >
              {isScaled ? `Shop for ${servings} servings` : 'Shop ingredients'}
            </Button>
          )}
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
