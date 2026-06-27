import React, { useState, useMemo } from 'react';
import { MealIngredient, ShoppingItem } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ShoppingCart, Check, AlertCircle } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';

interface IngredientSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mealName: string;
  ingredients: MealIngredient[];
  shoppingList: ShoppingItem[];
  onConfirm: (selectedIngredients: MealIngredient[]) => void;
}

export const IngredientSelectorModal: React.FC<IngredientSelectorModalProps> = ({
  isOpen,
  onClose,
  mealName,
  ingredients,
  shoppingList,
  onConfirm
}) => {
  // Memoize the set of unpurchased shopping list items for O(1) lookups
  // This avoids O(N*M) complexity in the render loop
  const unpurchasedItemNames = useMemo(() =>
    new Set(
      shoppingList
        .filter(item => !item.isPurchased)
        .map(item => normalizeToKey(item.name))
    ),
  [shoppingList]);

  // Initialize state lazily to calculate default selection only once on mount (or re-mount)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const newSelected = new Set<number>();
    ingredients.forEach((ing, index) => {
      const normalizedName = normalizeToKey(ing.name);

      // Default to selected ONLY if not already in unpurchased shopping list
      if (!unpurchasedItemNames.has(normalizedName)) {
        newSelected.add(index);
      }
    });
    return newSelected;
  });

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIndices);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIndices(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedIndices.size === ingredients.length) {
      setSelectedIndices(new Set());
    } else {
      const allIndices = new Set(ingredients.map((_, i) => i));
      setSelectedIndices(allIndices);
    }
  };

  const handleConfirm = () => {
    const selected = ingredients.filter((_, index) => selectedIndices.has(index));
    onConfirm(selected);
    onClose();
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Add Ingredients">
      {/* Single scroll container is the Drawer body — no nested scrollers. */}
      <p className="text-xs font-medium text-brand-500 dark:text-brand-400 truncate -mt-1 mb-3">{mealName}</p>

      <div className="space-y-2">
            {ingredients.length === 0 ? (
                <div className="text-center py-8 text-brand-500 dark:text-brand-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-brand-300 dark:text-brand-600" />
                    <p>No ingredients found for this meal.</p>
                </div>
            ) : (
                ingredients.map((ing, index) => {
                    const isSelected = selectedIndices.has(index);
                    const normalizedName = normalizeToKey(ing.name);
                    const inList = unpurchasedItemNames.has(normalizedName);

                    return (
                        <div
                            key={`${ing.name}-${index}`}
                            onClick={() => toggleSelection(index)}
                            onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    toggleSelection(index);
                                }
                            }}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 ${
                                isSelected
                                    ? 'bg-brand-50 border-brand-200 dark:bg-brand-700/30 dark:border-brand-500/40'
                                    : 'bg-white border-brand-100 hover:border-brand-200 hover:bg-brand-50 dark:bg-brand-800 dark:border-brand-700 dark:hover:border-brand-600 dark:hover:bg-brand-700/50'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                isSelected
                                    ? 'bg-accent-600 border-accent-600 text-white'
                                    : 'bg-white border-brand-300 dark:bg-brand-700 dark:border-brand-600'
                            }`}>
                                {isSelected && <Check size={14} strokeWidth={3} />}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className={`font-medium truncate ${isSelected ? 'text-brand-900 dark:text-brand-200' : 'text-brand-700 dark:text-brand-200'}`}>
                                    {ing.name}
                                </div>
                                {ing.quantity && (
                                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
                                        Qty: {ing.quantity}
                                    </div>
                                )}
                            </div>

                            {inList && (
                                <span className="text-xxs font-bold px-2 py-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 whitespace-nowrap dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20">
                                    In List
                                </span>
                            )}
                        </div>
                    );
                })
            )}
      </div>

      {/* Footer (flows after the list) */}
      <div className="mt-4 pt-3 border-t border-brand-200 dark:border-brand-700 flex flex-col gap-3">
          <div className="flex justify-between items-center px-1">
              {ingredients.length > 0 && (
                  <button
                      onClick={handleSelectAll}
                      className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
                  >
                      {selectedIndices.size === ingredients.length ? 'Deselect All' : 'Select All'}
                  </button>
              )}
              <span className="text-xs text-brand-500 dark:text-brand-400 font-medium">
                  {selectedIndices.size} selected
              </span>
          </div>

          <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                  Cancel
              </Button>
              <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleConfirm}
                  disabled={selectedIndices.size === 0}
                  leftIcon={<ShoppingCart size={18} />}
              >
                  Add Items
              </Button>
          </div>
      </div>
    </Drawer>
  );
};
