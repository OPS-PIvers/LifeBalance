import React, { useState } from 'react';
import { Meal } from '@/types/schema';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { X, ChefHat, Sparkles, Plus, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import toast from 'react-hot-toast';

const COMMON_TAGS = ['Quick', 'Healthy', 'Vegetarian', 'Gluten-Free', 'High Protein', 'Family Favorite'];

interface AddMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDate: string | null;
  editingPlanItemId: string | null;
  editingMealId: string | null;
  currentMeal: Partial<Meal>;
  setCurrentMeal: React.Dispatch<React.SetStateAction<Partial<Meal>>>;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  setMealType: (type: 'breakfast' | 'lunch' | 'dinner' | 'snack') => void;
  onOpenCookbook: () => void;
  onOpenAI: () => void;
  onOpenImport?: () => void;
  onSave: (forceNew: boolean) => void;
}

export const AddMealModal: React.FC<AddMealModalProps> = ({
  isOpen,
  onClose,
  targetDate,
  editingPlanItemId,
  editingMealId,
  currentMeal,
  setCurrentMeal,
  mealType,
  setMealType,
  onOpenCookbook,
  onOpenAI,
  onOpenImport,
  onSave
}) => {
  const isMobile = useMediaQuery('(max-width: 639px)');

  // Tag management
  const [tagInput, setTagInput] = useState('');

  // Ingredient management
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientQty, setIngredientQty] = useState('');

  React.useEffect(() => {
    if (!isOpen) {
      setTagInput('');
      setIngredientName('');
      setIngredientQty('');
    }
  }, [isOpen]);

  const handleAddTag = () => {
    const trimmedInput = tagInput.trim();
    if (trimmedInput && !currentMeal.tags?.some(t => t.toLowerCase() === trimmedInput.toLowerCase())) {
      setCurrentMeal(prev => ({
        ...prev,
        tags: [...(prev.tags || []), trimmedInput]
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setCurrentMeal(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag)
    }));
  };

  const handleAddIngredient = () => {
    const nameTrimmed = ingredientName.trim();
    if (nameTrimmed) {
        // Check for duplicates case-insensitive
        const exists = currentMeal.ingredients?.some(ing => ing.name.toLowerCase() === nameTrimmed.toLowerCase());
        if (exists) {
            toast.error('Ingredient already added');
            return;
        }

        const newIng = { name: nameTrimmed, quantity: ingredientQty.trim() || '1' };
        setCurrentMeal(prev => ({
            ...prev,
            ingredients: [...(prev.ingredients || []), newIng]
        }));
        setIngredientName('');
        setIngredientQty('');
    }
  };

  const title = editingPlanItemId ? 'Edit Meal Plan' : targetDate ? `Plan for ${format(parseISO(targetDate), 'MMM d')}` : 'Add Meal';

  const content = (
    <div className="flex flex-col h-full max-h-[80vh] sm:max-h-[calc(100dvh-10rem)]">
        {!isMobile && (
            <div className="px-6 py-4 border-b border-slate-200/50 dark:border-slate-700 flex justify-between items-center shrink-0">
                <h3 id="modal-title" className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                    {title}
                </h3>
                <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700/50"
                    aria-label="Close modal"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>
        )}

        <div className="flex-1 scroll-contain-y p-6 space-y-6 overflow-y-auto overscroll-contain">
            {/* Top Actions */}
            <div className={`grid gap-2 ${onOpenImport ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <button
                    onClick={onOpenCookbook}
                    className="flex items-center justify-center gap-2 py-3 px-4 bg-indigo-50/80 text-indigo-700 rounded-xl hover:bg-indigo-100 font-bold text-sm transition-colors border border-indigo-100/50 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/20 dark:hover:bg-indigo-500/25"
                >
                    <ChefHat className="w-4.5 h-4.5" /> Cookbook
                </button>
                {onOpenImport && (
                    <button
                        onClick={onOpenImport}
                        className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-50/80 text-emerald-700 rounded-xl hover:bg-emerald-100 font-bold text-sm transition-colors border border-emerald-100/50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20 dark:hover:bg-emerald-500/25"
                    >
                        <FileText className="w-4.5 h-4.5" /> Import
                    </button>
                )}
                <button
                    onClick={onOpenAI}
                    className="flex items-center justify-center gap-2 py-3 px-4 bg-violet-50/80 text-violet-700 rounded-xl hover:bg-violet-100 font-bold text-sm transition-colors border border-violet-100/50 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/20 dark:hover:bg-violet-500/25"
                >
                    <Sparkles className="w-4.5 h-4.5" /> AI Suggest
                </button>
            </div>

            {/* Meal Details */}
            <div className="space-y-5">
                <div>
                    <label htmlFor="meal-name" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Meal Name</label>
                    <input
                        id="meal-name"
                        type="text"
                        value={currentMeal.name || ''}
                        onChange={e => setCurrentMeal({...currentMeal, name: e.target.value})}
                        className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none dark:bg-slate-700/50 dark:border-slate-600 dark:placeholder:text-slate-500 font-medium text-slate-900 dark:text-slate-100"
                        placeholder="e.g. Adobo Chicken & Rice"
                    />
                </div>

                <div role="radiogroup" aria-labelledby="meal-type-label">
                    <label id="meal-type-label" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Meal Type</label>
                    <div className="flex p-1 bg-slate-100/80 dark:bg-slate-700/50 rounded-xl">
                        {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                            <button
                                key={type}
                                role="radio"
                                aria-checked={mealType === type}
                                onClick={() => setMealType(type as 'breakfast' | 'lunch' | 'dinner' | 'snack')}
                                className={`flex-1 py-2 px-1 rounded-lg text-sm font-bold capitalize transition-all ${
                                    mealType === type
                                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label htmlFor="meal-description" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Description</label>
                    <textarea
                        id="meal-description"
                        value={currentMeal.description || ''}
                        onChange={e => setCurrentMeal({...currentMeal, description: e.target.value})}
                        className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none dark:bg-slate-700/50 dark:border-slate-600 dark:placeholder:text-slate-500 text-sm text-slate-700 dark:text-slate-200 leading-relaxed"
                        rows={2}
                        placeholder="Add notes about preparation..."
                    />
                </div>

                {/* Collapsible Sections could go here if content gets too long */}
                <div>
                    <label htmlFor="meal-instructions" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Instructions</label>
                    <textarea
                        id="meal-instructions"
                        value={currentMeal.instructions?.join('\n') || ''}
                        onChange={e =>
                            setCurrentMeal({
                                ...currentMeal,
                                instructions: e.target.value
                                    .split('\n')
                                    .map(line => line.trim())
                                    .filter(line => line.length > 0),
                            })
                        }
                        className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none dark:bg-slate-700/50 dark:border-slate-600 dark:placeholder:text-slate-500 text-sm font-mono text-slate-600 dark:text-slate-300"
                        rows={4}
                        placeholder="Step 1...&#10;Step 2..."
                    />
                </div>

                <div>
                    <label htmlFor="meal-url" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Recipe URL</label>
                    <input
                        id="meal-url"
                        type="url"
                        value={currentMeal.recipeUrl || ''}
                        onChange={e => setCurrentMeal({...currentMeal, recipeUrl: e.target.value})}
                        className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none dark:bg-slate-700/50 dark:border-slate-600 dark:placeholder:text-slate-500 text-sm text-blue-600 dark:text-blue-400"
                        placeholder="https://example.com/recipe"
                    />
                </div>

                {/* Tags Section */}
                <div>
                    <label id="tags-label" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Tags</label>

                    {/* Common Tags */}
                    <div className="flex flex-wrap gap-2 mb-4" role="group" aria-labelledby="tags-label">
                        {COMMON_TAGS.map(tag => {
                            const isSelected = currentMeal.tags?.some(t => t.toLowerCase() === tag.toLowerCase());
                            return (
                                <button
                                    key={tag}
                                    aria-pressed={isSelected}
                                    onClick={() => {
                                        const newTags = isSelected
                                            ? currentMeal.tags?.filter(t => t.toLowerCase() !== tag.toLowerCase())
                                            : [...(currentMeal.tags || []), tag];
                                        setCurrentMeal({...currentMeal, tags: newTags});
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                                        isSelected
                                            ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-700/40 dark:text-brand-200 dark:border-brand-500/40'
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600 dark:hover:bg-slate-700'
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
                        {currentMeal.tags?.filter(t => !COMMON_TAGS.some(ct => ct.toLowerCase() === t.toLowerCase())).map(tag => (
                            <span key={tag} className="bg-brand-50 text-brand-700 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 border border-brand-100 dark:bg-brand-700/40 dark:text-brand-200 dark:border-brand-500/40">
                                {tag}
                                <button onClick={() => handleRemoveTag(tag)} className="hover:text-brand-900 p-0.5 rounded-full hover:bg-brand-100 dark:hover:text-white dark:hover:bg-brand-700/60" aria-label={`Remove tag ${tag}`}>
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
                                className="w-full py-1.5 pl-3 pr-8 rounded-full bg-slate-50 border border-slate-200 text-xs focus:border-brand-500 focus:ring-brand-500 outline-none dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
                                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                            />
                            <button
                                onClick={handleAddTag}
                                disabled={!tagInput.trim()}
                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white shadow-sm rounded-full text-brand-600 disabled:opacity-50 hover:bg-slate-50 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-slate-700"
                                aria-label="Add custom tag"
                            >
                                <Plus className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                </div>

            {/* Ingredients Section */}
            <div>
                  <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Ingredients</label>

                  {/* Current Ingredients List */}
                  {currentMeal.ingredients && currentMeal.ingredients.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                          {currentMeal.ingredients.map((ing, idx) => (
                              <div key={`${ing.name}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm shadow-sm dark:bg-slate-800 dark:border-slate-700">
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">{ing.name}</span>
                                  <span className="text-slate-400 text-xs bg-slate-50 px-1.5 py-0.5 rounded dark:text-slate-400 dark:bg-slate-700/50">{ing.quantity}</span>
                                  <button
                                      onClick={() => {
                                          setCurrentMeal(prev => ({
                                              ...prev,
                                              ingredients: prev.ingredients?.filter((_, i) => i !== idx)
                                          }));
                                      }}
                                      className="text-slate-300 hover:text-red-500 ml-1 dark:text-slate-500 dark:hover:text-rose-400"
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
                      <div className="bg-white/60 p-4 rounded-xl border border-slate-200/60 shadow-sm dark:bg-slate-800/60 dark:border-slate-700">
                          <label htmlFor="ingredient-name" className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Add Ingredient</label>
                          <div className="flex gap-2">
                              <input
                                  id="ingredient-name"
                                  type="text"
                                  placeholder="Item name"
                                  className="flex-1 rounded-xl border-slate-200 bg-white text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
                                  value={ingredientName}
                                  onChange={(e) => setIngredientName(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                              />
                              <input
                                  aria-label="Ingredient quantity"
                                  type="text"
                                  placeholder="Qty"
                                  className="w-20 rounded-xl border-slate-200 bg-white text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5 dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
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
                          <p className="text-xxs text-slate-400 dark:text-slate-500 mt-2 pl-1">
                              Ingredients will be added to the shopping list when creating a new meal plan.
                          </p>
                      </div>
                  </div>
            </div>

            </div>
        </div>

        <div className="p-4 border-t border-slate-200/50 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col gap-2 shrink-0">
            {editingMealId && (
                <button
                    onClick={() => onSave(true)}
                    className="w-full py-2 text-brand-600 font-bold text-sm hover:underline dark:text-brand-300"
                >
                    Save as New Meal (Copy)
                </button>
            )}
            <div className="flex gap-3 w-full">
              <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                  Cancel
              </button>
              <button
                  onClick={() => onSave(false)}
                  className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg hover:bg-brand-900 transition-all active:scale-95 dark:bg-brand-600 dark:hover:bg-brand-500"
              >
                  {editingMealId ? 'Update & Save' : 'Save to Plan'}
              </button>
            </div>
        </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        noPadding
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-lg"
      className="p-0" // The content provides its own padding
      ariaLabelledBy="modal-title"
    >
      {content}
    </Modal>
  );
};
