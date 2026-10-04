import React, { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { MealPlanItem } from '@/types/schema';
import { ingredientStatus, newShoppingItem, recipeFor } from '@/utils/wall/wallLists';
import { longDateText } from '@/utils/wall/wallCalendar';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from './useWallListActions';

interface WallRecipePanelProps {
  entry: MealPlanItem;
  today: string;
  onClose: () => void;
}

/** Read-only recipe with "Add N missing to Shopping" (plan §3 "Meals"). No planning on the wall. */
const WallRecipePanel: React.FC<WallRecipePanelProps> = ({ entry, today, onClose }) => {
  const { meals, shoppingList, groceryCatalog } = useWallData();
  const act = useWallListActions();
  const meal = recipeFor(entry, meals);
  const status = useMemo(() => (meal ? ingredientStatus(meal, shoppingList) : []), [meal, shoppingList]);
  const missing = status.filter(s => !s.onList);
  const when = entry.date === today ? 'Tonight' : `${longDateText(entry.date).split(',')[0]} dinner`;

  return (
    <aside className="recipe" aria-label={`${entry.mealName} recipe`}>
      <button type="button" className="close" aria-label="Close recipe" onClick={onClose}>
        <X className="wi" size="1em" aria-hidden="true" />
      </button>
      <div className="when">{when}</div>
      <h3>{entry.mealName}</h3>
      {!meal || meal.ingredients.length === 0 ? (
        <div className="none">No recipe saved for this meal</div>
      ) : (
        <>
          {status.map(({ ingredient, onList }) => (
            <div className="ing" key={ingredient.name}>
              <span>
                {ingredient.name}
                {ingredient.quantity && <small> {ingredient.quantity}</small>}
              </span>
              <span>{onList ? 'On the list' : ''}</span>
            </div>
          ))}
          {missing.length > 0 && (
            <button
              type="button"
              className="btn pri"
              onClick={() =>
                act.addShopping(
                  missing.map(({ ingredient }) =>
                    newShoppingItem(ingredient.name, groceryCatalog, null, {
                      addedFromMealId: meal.id,
                      ...(ingredient.quantity ? { quantity: ingredient.quantity } : {}),
                    })
                  ),
                  `Added ${missing.length} ${missing.length === 1 ? 'item' : 'items'} to Shopping`
                )
              }
            >
              <Plus className="wi" size="1em" aria-hidden="true" />
              Add {missing.length} missing to Shopping
            </button>
          )}
        </>
      )}
      {meal?.instructions && meal.instructions.length > 0 && (
        <ol>
          {meal.instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </aside>
  );
};

export default WallRecipePanel;
