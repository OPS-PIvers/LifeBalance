import React from 'react';
import { Meal } from '@/types/schema';
import { ChevronRight, Copy } from 'lucide-react';

interface PreviousMealsModalProps {
  isOpen: boolean;
  onClose: () => void;
  meals: Meal[];
  onSelectMeal: (meal: Meal) => void;
  onCloneMeal: (meal: Meal) => void;
}

export const PreviousMealsModal: React.FC<PreviousMealsModalProps> = ({
  isOpen,
  onClose,
  meals,
  onSelectMeal,
  onCloneMeal,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="previous-meals-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[80vh] flex flex-col shadow-xl animate-in zoom-in-95 duration-200">
        <h3 id="previous-meals-title" className="text-xl font-bold text-gray-900 mb-4">
          Your Cookbook
        </h3>
        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
          {[...meals]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((meal) => (
              <div key={meal.id} className="flex items-stretch gap-2">
                <button
                  onClick={() => onSelectMeal(meal)}
                  className="flex-1 text-left p-4 hover:bg-gray-50 rounded-xl border border-gray-100 flex justify-between items-center group transition-colors"
                >
                  <span className="font-semibold text-gray-700 group-hover:text-brand-700">
                    {meal.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-400" />
                </button>
                <button
                  onClick={() => onCloneMeal(meal)}
                  className="px-4 text-gray-400 hover:text-brand-600 hover:bg-brand-50 border border-gray-100 rounded-xl transition-colors"
                  title="Clone Meal"
                >
                  <Copy className="w-5 h-5" />
                </button>
              </div>
            ))}
          {meals.length === 0 && (
            <p className="text-gray-500 text-center py-8">No saved meals yet.</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
