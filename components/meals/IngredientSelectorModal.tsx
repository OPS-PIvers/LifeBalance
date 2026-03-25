import React, { useState, useMemo } from 'react';
import { MealIngredient, ShoppingItem } from '@/types/schema';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ShoppingCart, Check, X, AlertCircle } from 'lucide-react';
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
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col h-full max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Add Ingredients</h3>
            <p className="text-xs text-slate-500 font-medium">{mealName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 scroll-contain-y p-4 space-y-2">
            {ingredients.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
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
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                                isSelected
                                    ? 'bg-brand-50 border-brand-200 shadow-sm'
                                    : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                isSelected
                                    ? 'bg-brand-600 border-brand-600 text-white'
                                    : 'bg-white border-slate-300'
                            }`}>
                                {isSelected && <Check size={14} strokeWidth={3} />}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className={`font-medium truncate ${isSelected ? 'text-brand-900' : 'text-slate-700'}`}>
                                    {ing.name}
                                </div>
                                {ing.quantity && (
                                    <div className="text-xs text-slate-500 mt-0.5">
                                        Qty: {ing.quantity}
                                    </div>
                                )}
                            </div>

                            {inList && (
                                <span className="text-xxs font-bold px-2 py-1 bg-amber-50 text-amber-600 rounded-md border border-amber-100 whitespace-nowrap">
                                    In List
                                </span>
                            )}
                        </div>
                    );
                })
            )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col gap-3">
            <div className="flex justify-between items-center px-1">
                {ingredients.length > 0 && (
                    <button
                        onClick={handleSelectAll}
                        className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:underline"
                    >
                        {selectedIndices.size === ingredients.length ? 'Deselect All' : 'Select All'}
                    </button>
                )}
                <span className="text-xs text-slate-500 font-medium">
                    {selectedIndices.size} selected
                </span>
            </div>

            <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    className="flex-1 shadow-lg shadow-brand-200"
                    onClick={handleConfirm}
                    disabled={selectedIndices.size === 0}
                    leftIcon={<ShoppingCart size={18} />}
                >
                    Add Items
                </Button>
            </div>
        </div>
      </div>
    </Modal>
  );
};
