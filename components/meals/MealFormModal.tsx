import React, { useState } from 'react';
import { Meal } from '@/types/schema';
import { X, ChefHat, Sparkles, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

const COMMON_TAGS = ['Quick', 'Healthy', 'Vegetarian', 'Gluten-Free', 'High Protein', 'Family Favorite'];

interface MealFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  meal: Partial<Meal>;
  onMealChange: (meal: Partial<Meal>) => void;
  onSave: (forceNew?: boolean) => void;
  isEditing: boolean;
  title: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  setMealType: (type: 'breakfast' | 'lunch' | 'dinner' | 'snack') => void;
  onOpenCookbook: () => void;
  onOpenAI: () => void;
}

export const MealFormModal: React.FC<MealFormModalProps> = ({
  isOpen,
  onClose,
  meal,
  onMealChange,
  onSave,
  isEditing,
  title,
  mealType,
  setMealType,
  onOpenCookbook,
  onOpenAI,
}) => {
  const [tagInput, setTagInput] = useState('');
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientQty, setIngredientQty] = useState('');

  if (!isOpen) return null;

  const handleAddTag = () => {
    const trimmedInput = tagInput.trim();
    if (trimmedInput && !meal.tags?.some(t => t.toLowerCase() === trimmedInput.toLowerCase())) {
      onMealChange({
        ...meal,
        tags: [...(meal.tags || []), trimmedInput]
      });
      setTagInput('');
    }
  };

  const handleAddIngredient = () => {
    const nameTrimmed = ingredientName.trim();
    if (nameTrimmed) {
        // Check for duplicates case-insensitive
        const exists = meal.ingredients?.some(ing => ing.name.toLowerCase() === nameTrimmed.toLowerCase());
        if (exists) {
            toast.error('Ingredient already added');
            return;
        }

        const newIng = { name: nameTrimmed, quantity: ingredientQty.trim() || '1' };
        onMealChange({
            ...meal,
            ingredients: [...(meal.ingredients || []), newIng]
        });
        setIngredientName('');
        setIngredientQty('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    onMealChange({
      ...meal,
      tags: meal.tags?.filter(t => t !== tag)
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] flex flex-col overflow-hidden shadow-xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
          <h3 id="modal-title" className="text-lg font-bold text-gray-900">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Actions */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={onOpenCookbook}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 font-bold text-sm transition-colors border border-blue-100"
            >
              <ChefHat className="w-4.5 h-4.5" /> Cookbook
            </button>
            <button
              onClick={onOpenAI}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 font-bold text-sm transition-colors border border-purple-100"
            >
              <Sparkles className="w-4.5 h-4.5" /> AI Suggest
            </button>
          </div>

          {/* Meal Details */}
          <div className="space-y-5">
            <div>
              <label htmlFor="meal-name" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Meal Name</label>
              <input
                id="meal-name"
                type="text"
                value={meal.name}
                onChange={e => onMealChange({...meal, name: e.target.value})}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none font-medium"
                placeholder="e.g. Adobo Chicken & Rice"
              />
            </div>

            <div role="radiogroup" aria-labelledby="meal-type-label">
              <label id="meal-type-label" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Meal Type</label>
              <div className="flex p-1 bg-gray-100 rounded-xl">
                {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                  <button
                    key={type}
                    role="radio"
                    aria-checked={mealType === type}
                    onClick={() => setMealType(type as 'breakfast' | 'lunch' | 'dinner' | 'snack')}
                    className={`flex-1 py-2 px-1 rounded-lg text-sm font-bold capitalize transition-all ${
                      mealType === type
                        ? 'bg-white text-brand-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="meal-description" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Description</label>
              <textarea
                id="meal-description"
                value={meal.description}
                onChange={e => onMealChange({...meal, description: e.target.value})}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none text-sm"
                rows={2}
                placeholder="Add notes about preparation..."
              />
            </div>

            {/* Collapsible Sections could go here if content gets too long */}
            <div>
              <label htmlFor="meal-instructions" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Instructions</label>
              <textarea
                id="meal-instructions"
                value={meal.instructions?.join('\n') || ''}
                onChange={e =>
                  onMealChange({
                    ...meal,
                    instructions: e.target.value
                      .split('\n')
                      .map(line => line.trim())
                      .filter(line => line.length > 0),
                  })
                }
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none text-sm font-mono"
                rows={4}
                placeholder="Step 1...&#10;Step 2..."
              />
            </div>

            <div>
              <label htmlFor="meal-url" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Recipe URL</label>
              <input
                id="meal-url"
                type="url"
                value={meal.recipeUrl || ''}
                onChange={e => onMealChange({...meal, recipeUrl: e.target.value})}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none text-sm text-blue-600"
                placeholder="https://example.com/recipe"
              />
            </div>

            {/* Tags Section */}
            <div>
              <label id="tags-label" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tags</label>

              {/* Common Tags */}
              <div className="flex flex-wrap gap-2 mb-4" role="group" aria-labelledby="tags-label">
                {COMMON_TAGS.map(tag => {
                  const isSelected = meal.tags?.some(t => t.toLowerCase() === tag.toLowerCase());
                  return (
                    <button
                      key={tag}
                      aria-pressed={isSelected}
                      onClick={() => {
                        const newTags = isSelected
                          ? meal.tags?.filter(t => t.toLowerCase() !== tag.toLowerCase())
                          : [...(meal.tags || []), tag];
                        onMealChange({...meal, tags: newTags});
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                        isSelected
                          ? 'bg-brand-100 text-brand-700 border-brand-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {isSelected ? <span className="mr-1">✓</span> : <span className="mr-1">+</span>}
                      {tag}
                    </button>
                  );
                })}
              </div>

              {/* Selected Custom Tags & Input */}
              <div className="flex flex-wrap gap-2">
                {meal.tags?.filter(t => !COMMON_TAGS.some(ct => ct.toLowerCase() === t.toLowerCase())).map(tag => (
                  <span key={tag} className="bg-brand-50 text-brand-700 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 border border-brand-100">
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)} className="hover:text-brand-900 p-0.5 rounded-full hover:bg-brand-100" aria-label={`Remove tag ${tag}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                <div className="relative flex-1 min-w-[140px]">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    placeholder="Add custom tag..."
                    aria-label="Add custom tag"
                    className="w-full py-1.5 pl-3 pr-8 rounded-full bg-gray-50 border border-gray-200 text-xs focus:border-brand-500 focus:ring-brand-500 outline-none"
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white shadow-sm rounded-full text-brand-600 disabled:opacity-50 hover:bg-gray-50"
                    aria-label="Add custom tag"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Ingredients Section */}
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Ingredients</label>

              {/* Current Ingredients List */}
              {meal.ingredients && meal.ingredients.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {meal.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm shadow-sm">
                      <span className="font-semibold text-gray-700">{ing.name}</span>
                      <span className="text-gray-400 text-xs bg-gray-50 px-1.5 py-0.5 rounded">{ing.quantity}</span>
                      <button
                        onClick={() => {
                          onMealChange({
                            ...meal,
                            ingredients: meal.ingredients?.filter((_, i) => i !== idx)
                          });
                        }}
                        className="text-gray-300 hover:text-red-500 ml-1"
                        aria-label={`Remove ${ing.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                {/* Ingredient Entry */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                  <label htmlFor="ingredient-name" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Add Ingredient</label>
                  <div className="flex gap-2">
                    <input
                      id="ingredient-name"
                      type="text"
                      placeholder="Item name"
                      className="flex-1 rounded-xl border-gray-200 bg-gray-50 text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5"
                      value={ingredientName}
                      onChange={(e) => setIngredientName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                    />
                    <input
                      aria-label="Ingredient quantity"
                      type="text"
                      placeholder="Qty"
                      className="w-20 rounded-xl border-gray-200 bg-gray-50 text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5"
                      value={ingredientQty}
                      onChange={(e) => setIngredientQty(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                    />
                    <button
                      onClick={handleAddIngredient}
                      disabled={!ingredientName.trim()}
                      className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600 transition-colors shadow-sm"
                      aria-label="Add ingredient"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-xxs text-gray-400 mt-2 pl-1">
                    Ingredients will be added to the shopping list when creating a new meal plan.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-white flex flex-col gap-2 shrink-0">
          {isEditing && (
            <button
              onClick={() => onSave(true)}
              className="w-full py-2 text-brand-600 font-bold text-sm hover:underline"
            >
              Save as New Meal (Copy)
            </button>
          )}
          <div className="flex gap-3 w-full">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(false)}
              className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg hover:bg-brand-900 transition-all active:scale-95"
            >
              {isEditing ? 'Update & Save' : 'Save to Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
