import React, { useState, useEffect, useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, Sparkles, ChefHat, ChevronRight, ChevronLeft, ShoppingCart, Loader2, X } from 'lucide-react';
import { suggestMeal } from '@/services/geminiService';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays } from 'date-fns';

const COMMON_TAGS = ['Quick', 'Healthy', 'Vegetarian', 'Gluten-Free', 'High Protein', 'Family Favorite'];

const MealPlanTab: React.FC = () => {
  const {
    meals,
    addMeal,
    updateMeal,
    pantry,
    addShoppingItem,
    shoppingList,
    mealPlan,
    addMealPlanItem,
    updateMealPlanItem,
    deleteMealPlanItem
  } = useHousehold();

  // Calendar State
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPreviousMealsModalOpen, setIsPreviousMealsModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  // Edit/Add Form State
  const [currentMeal, setCurrentMeal] = useState<Partial<Meal>>({
    name: '',
    description: '',
    ingredients: [],
    instructions: [],
    recipeUrl: '',
    tags: []
  });
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
  const [editingPlanItemId, setEditingPlanItemId] = useState<string | null>(null);
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('dinner');
  const [targetDate, setTargetDate] = useState<string | null>(null);

  // Tag management
  const [tagInput, setTagInput] = useState('');

  // Ingredient management
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientQty, setIngredientQty] = useState('');
  const [pantrySearch, setPantrySearch] = useState('');

  // Reset pantry search when modal closes
  useEffect(() => {
    if (!isAddModalOpen) {
      setPantrySearch('');
    }
  }, [isAddModalOpen]);

  // Optimize: Memoize sorted pantry items once
  const sortedPantry = useMemo(() => {
      return [...pantry].sort((a, b) => a.name.localeCompare(b.name));
  }, [pantry]);

  // Memoize filtered pantry items
  const filteredPantryItems = useMemo(() => {
    const searchLower = pantrySearch.toLowerCase().trim();
    return sortedPantry.filter(item => item.name.toLowerCase().includes(searchLower));
  }, [sortedPantry, pantrySearch]);

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

  const handleRemoveTag = (tag: string) => {
    setCurrentMeal(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag)
    }));
  };

  // AI Options
  const [aiOptions, setAiOptions] = useState({
    usePantry: true,
    cheap: false,
    quick: false,
    new: false,
  });
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Calendar Logic
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 }); // Sunday start
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const handleAddMealToDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    // Set up the modal to add to this date
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
    setTargetDate(dateStr);
    setMealType('dinner'); // Default
    setIsAddModalOpen(true);
  };

  const handleEditMealPlanItem = (planItem: MealPlanItem, linkedMeal: Meal | undefined) => {
      // If linkedMeal exists, populate from it. Otherwise use snapshot name.
      setCurrentMeal({
          name: linkedMeal?.name || planItem.mealName,
          description: linkedMeal?.description || '',
          ingredients: linkedMeal?.ingredients || [],
          instructions: linkedMeal?.instructions || [],
          recipeUrl: linkedMeal?.recipeUrl || '',
          tags: linkedMeal?.tags || []
      });

      setTargetDate(planItem.date);
      setEditingMealId(planItem.mealId); // If it exists
      setEditingPlanItemId(planItem.id); // Track the plan item being edited
      setMealType(planItem.type || 'dinner');
      setIsAddModalOpen(true);
  };

  const saveMeal = async () => {
      if (!currentMeal.name) return;

      let mealId = editingMealId;

      // 1. Handle Meal Library (Create or Update)
      if (mealId) {
          // Update existing meal definition
           const existingMeal = meals.find(m => m.id === mealId);
           await updateMeal({
               id: mealId,
               name: currentMeal.name!,
               description: currentMeal.description,
               ingredients: currentMeal.ingredients || [],
               instructions: currentMeal.instructions || [],
               recipeUrl: currentMeal.recipeUrl || '',
               tags: currentMeal.tags || [],
               rating: existingMeal?.rating ?? 0
           } as Meal);
      } else {
          // Create new meal in library
          try {
            mealId = await addMeal({
                name: currentMeal.name!,
                description: currentMeal.description,
                ingredients: currentMeal.ingredients || [],
                instructions: currentMeal.instructions || [],
                recipeUrl: currentMeal.recipeUrl || '',
                tags: currentMeal.tags || [],
                rating: 0
            });
          } catch (error) {
            toast.error('Failed to save meal');
            return;
          }
      }

      // 2. Handle Plan Item (Create or Update)
      if (targetDate && mealId) {
          if (editingPlanItemId) {
              await updateMealPlanItem(editingPlanItemId, {
                  date: targetDate,
                  mealName: currentMeal.name!,
                  mealId: mealId,
                  type: mealType
              });
          } else {
              await addMealPlanItem({
                  date: targetDate,
                  mealName: currentMeal.name!,
                  mealId: mealId,
                  type: mealType,
                  isCooked: false
              });
          }
      }

      // 3. Auto-add ingredients to shopping list
      // Only when creating a NEW plan item, and we have a target date
      if (!editingPlanItemId && targetDate && currentMeal.ingredients && currentMeal.ingredients.length > 0) {
          await addIngredientsToShoppingList(currentMeal.ingredients);
      }

      handleCancel();
  };

  const handleCancel = () => {
      setIsAddModalOpen(false);
      setTargetDate(null);
      setEditingMealId(null);
      setEditingPlanItemId(null);
      setMealType('dinner');
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
      setIngredientName('');
      setIngredientQty('');
      setTagInput('');
  };

  const handleAIRequest = async () => {
    setIsGeneratingAI(true);
    try {
        const suggestion = await suggestMeal({
            usePantry: aiOptions.usePantry,
            cheap: aiOptions.cheap,
            quick: aiOptions.quick,
            new: aiOptions.new,
            pantryItems: pantry,
            previousMeals: meals
        });

        setCurrentMeal({
            name: suggestion.name,
            description: suggestion.description,
            ingredients: suggestion.ingredients,
            instructions: suggestion.instructions,
            recipeUrl: suggestion.recipeUrl,
            tags: suggestion.tags
        });
        setIsAIModalOpen(false); // Close AI options modal
        setIsAddModalOpen(true); // Ensure Add Meal modal is open
    } catch (e) {
        toast.error("Failed to generate meal");
    } finally {
        setIsGeneratingAI(false);
    }
  };

  const addIngredientsToShoppingList = async (mealIngredients: MealIngredient[]) => {
      const normalize = (s: string) => s.trim().toLowerCase();

      const ingredientsToAdd = mealIngredients.filter(ing => {
          const ingName = normalize(ing.name);
          // Check if we have it in pantry (exact match normalized)
          const inPantry = pantry.some(p => normalize(p.name) === ingName);
          // Check if already in shopping list
          const inList = shoppingList.some(s => normalize(s.name) === ingName && !s.isPurchased);

          return !inPantry && !inList;
      });

      if (ingredientsToAdd.length === 0) {
          toast.success('No new ingredients needed - check your pantry and list!');
          return;
      }

      const results = await Promise.allSettled(ingredientsToAdd.map(ing =>
          addShoppingItem({
              name: ing.name,
              category: 'Uncategorized',
              quantity: ing.quantity || '',
              isPurchased: false
          })
      ));

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failedResults = results.filter(r => r.status === 'rejected');

      if (failedResults.length > 0) {
          console.error('Failed to add ingredients:', failedResults);
      }

      if (successCount > 0) {
          toast.success(`Added ${successCount} items to shopping list`);
      } else if (failedResults.length > 0) {
          toast.error('Failed to add ingredients');
      }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Calendar Header */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm">
        <button
            onClick={() => setSelectedDate(d => addDays(d, -7))}
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Previous week"
        >
            <ChevronLeft />
        </button>
        <div className="text-center">
            <h2 className="text-lg font-bold text-brand-900">
                {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
            </h2>
            <div className="text-sm text-gray-500">Weekly Plan</div>
        </div>
        <button
            onClick={() => setSelectedDate(d => addDays(d, 7))}
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Next week"
        >
            <ChevronRight />
        </button>
      </div>

      {/* Days Grid */}
      <div className="space-y-4">
        {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            // Filter all meals for this day
            const planItems = mealPlan ? mealPlan.filter((i: any) => i.date === dateStr) : [];

            return (
                <div key={dateStr} className="bg-white rounded-xl shadow-sm overflow-hidden border-l-4 border-brand-500">
                    <div className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="min-w-[80px] shrink-0">
                            <div className="font-bold text-gray-900">{format(day, 'EEEE')}</div>
                            <div className="text-sm text-gray-500">{format(day, 'MMM d')}</div>
                            <button
                                onClick={() => handleAddMealToDate(day)}
                                className="mt-2 text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium"
                            >
                                <Plus className="w-3 h-3" /> Add Meal
                            </button>
                        </div>

                        <div className="flex-1 space-y-3">
                            {planItems.length > 0 ? planItems.map((planItem) => {
                                const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : null;
                                const mealName = planItem.mealName || linkedMeal?.name;

                                return (
                                    <div key={planItem.id} className="bg-brand-50 p-3 rounded-lg flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold uppercase text-brand-400 bg-white px-1 rounded">{planItem.type || 'dinner'}</span>
                                                <div className="font-semibold text-brand-900">{mealName}</div>
                                            </div>
                                            {linkedMeal?.description && <div className="text-xs text-brand-700 mt-1">{linkedMeal.description}</div>}
                                            <div className="flex gap-2 mt-2">
                                                {linkedMeal?.ingredients?.length > 0 && (
                                                    <button
                                                        onClick={() => addIngredientsToShoppingList(linkedMeal.ingredients)}
                                                        className="text-xs flex items-center gap-1 text-brand-600 bg-white px-2 py-1 rounded border border-brand-200 hover:bg-brand-50"
                                                    >
                                                        <ShoppingCart className="w-3 h-3" /> Shop Ingredients
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => handleEditMealPlanItem(planItem, linkedMeal)}
                                                className="text-gray-400 hover:text-brand-500"
                                                aria-label={`Edit ${mealName}`}
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => deleteMealPlanItem(planItem.id)}
                                                className="text-gray-400 hover:text-red-500"
                                                aria-label={`Delete ${mealName}`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div className="text-sm text-gray-400 italic py-2">No meals planned</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        })}
      </div>

      {/* Add Meal Modal */}
      {isAddModalOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) handleCancel();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
              <div className="bg-white rounded-xl w-full max-w-lg max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center shrink-0">
                      <h3 id="modal-title" className="text-lg font-bold">
                          {editingPlanItemId ? 'Edit Meal Plan' : targetDate ? `Plan Meal for ${targetDate}` : 'Add Meal'}
                      </h3>
                      <button
                          onClick={handleCancel}
                          className="text-gray-400 hover:text-gray-600"
                          aria-label="Close modal"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {/* Top Actions */}
                      <div className="grid grid-cols-2 gap-3">
                          <button
                              onClick={() => setIsPreviousMealsModalOpen(true)}
                              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium text-sm transition-colors"
                          >
                              <ChefHat className="w-4 h-4" /> Previous Meals
                          </button>
                          <button
                              onClick={() => setIsAIModalOpen(true)}
                              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium text-sm transition-colors"
                          >
                              <Sparkles className="w-4 h-4" /> AI Suggestion
                          </button>
                      </div>

                      {/* Meal Details */}
                      <div className="space-y-4">
                          <div>
                              <label htmlFor="meal-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Meal Name</label>
                              <input
                                  id="meal-name"
                                  type="text"
                                  value={currentMeal.name}
                                  onChange={e => setCurrentMeal({...currentMeal, name: e.target.value})}
                                  className="w-full rounded-xl border-gray-200 focus:border-brand-500 focus:ring-brand-500 transition-colors"
                                  placeholder="e.g. Spaghetti Bolognese"
                              />
                          </div>

                          <div role="radiogroup" aria-labelledby="meal-type-label">
                              <label id="meal-type-label" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Meal Type</label>
                              <div className="flex p-1 bg-gray-100 rounded-xl">
                                  {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                                      <button
                                          key={type}
                                          role="radio"
                                          aria-checked={mealType === type}
                                          onClick={() => setMealType(type as any)}
                                          className={`flex-1 py-2 px-1 rounded-lg text-sm font-medium capitalize transition-all ${
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
                              <label htmlFor="meal-description" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                              <textarea
                                  id="meal-description"
                                  value={currentMeal.description}
                                  onChange={e => setCurrentMeal({...currentMeal, description: e.target.value})}
                                  className="w-full rounded-xl border-gray-200 focus:border-brand-500 focus:ring-brand-500 transition-colors"
                                  rows={2}
                                  placeholder="Add notes about preparation..."
                              />
                          </div>

                          <div>
                              <label htmlFor="meal-instructions" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Instructions</label>
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
                                  className="w-full rounded-xl border-gray-200 focus:border-brand-500 focus:ring-brand-500 transition-colors"
                                  rows={4}
                                  placeholder="Step 1...&#10;Step 2..."
                              />
                          </div>

                          <div>
                              <label htmlFor="meal-url" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Recipe URL</label>
                              <input
                                  id="meal-url"
                                  type="url"
                                  value={currentMeal.recipeUrl || ''}
                                  onChange={e => setCurrentMeal({...currentMeal, recipeUrl: e.target.value})}
                                  className="w-full rounded-xl border-gray-200 focus:border-brand-500 focus:ring-brand-500 transition-colors"
                                  placeholder="https://example.com/recipe"
                              />
                          </div>

                          {/* Tags Section */}
                          <div>
                              <label id="tags-label" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Tags</label>

                              {/* Common Tags */}
                              <div className="flex flex-wrap gap-2 mb-3" role="group" aria-labelledby="tags-label">
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
                                              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                                                  isSelected
                                                      ? 'bg-brand-100 text-brand-700 border-brand-200'
                                                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
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
                                      <span key={tag} className="bg-brand-50 text-brand-700 pl-3 pr-2 py-1.5 rounded-full text-xs flex items-center gap-1 border border-brand-100">
                                          {tag}
                                          <button onClick={() => handleRemoveTag(tag)} className="hover:text-brand-900 p-0.5 rounded-full hover:bg-brand-100" aria-label={`Remove tag ${tag}`}>
                                              <X className="w-3 h-3" />
                                          </button>
                                      </span>
                                  ))}

                                  <div className="relative flex-1 min-w-[120px]">
                                      <input
                                          type="text"
                                          value={tagInput}
                                          onChange={e => setTagInput(e.target.value)}
                                          placeholder="Add custom tag..."
                                          aria-label="Add custom tag"
                                          className="w-full py-1.5 pl-3 pr-8 rounded-full border-gray-200 text-xs focus:border-brand-500 focus:ring-brand-500"
                                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                                      />
                                      <button
                                          onClick={handleAddTag}
                                          disabled={!tagInput.trim()}
                                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-gray-100 rounded-full text-gray-600 disabled:opacity-50 hover:bg-gray-200"
                                          aria-label="Add custom tag"
                                      >
                                          <Plus className="w-3 h-3" />
                                      </button>
                                  </div>
                              </div>
                          </div>

                      {/* Ingredients Section */}
                      <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Ingredients</label>

                           {/* Current Ingredients List */}
                           {currentMeal.ingredients && currentMeal.ingredients.length > 0 && (
                               <div className="mb-4 flex flex-wrap gap-2">
                                   {currentMeal.ingredients.map((ing, idx) => (
                                       <div key={idx} className="flex items-center gap-2 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                                           <span className="font-medium text-gray-700">{ing.name}</span>
                                           <span className="text-gray-400 text-xs">{ing.quantity}</span>
                                           <button
                                               onClick={() => {
                                                   setCurrentMeal(prev => ({
                                                       ...prev,
                                                       ingredients: prev.ingredients?.filter((_, i) => i !== idx)
                                                   }));
                                               }}
                                               className="text-gray-400 hover:text-red-500"
                                               aria-label={`Remove ${ing.name}`}
                                           >
                                               <X className="w-3 h-3" />
                                           </button>
                                       </div>
                                   ))}
                               </div>
                           )}

                           <div className="space-y-4">
                               {/* Section 1: From Pantry */}
                               <div className="border border-gray-200 rounded-xl overflow-hidden">
                                   <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex justify-between items-center">
                                       <span className="text-xs font-bold text-gray-500 uppercase">From Pantry</span>
                                       <span className="text-xs text-gray-400">{pantry.length} items</span>
                                   </div>

                                   <div className="p-2 border-b border-gray-200">
                                        <input
                                           type="text"
                                           placeholder="Search pantry..."
                                           aria-label="Search pantry items"
                                           value={pantrySearch}
                                           onChange={(e) => setPantrySearch(e.target.value)}
                                           className="w-full text-xs py-1.5 px-3 rounded-lg border-gray-200 bg-gray-50 focus:bg-white transition-colors"
                                        />
                                   </div>

                                   <div className="max-h-[150px] overflow-y-auto p-2 space-y-1">
                                       {filteredPantryItems.map(item => {
                                               const isSelected = currentMeal.ingredients?.some(ing => ing.name.toLowerCase() === item.name.toLowerCase());
                                               return (
                                                   <label key={item.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer group">
                                                       <input
                                                           type="checkbox"
                                                           checked={isSelected}
                                                           onChange={(e) => {
                                                               if (e.target.checked) {
                                                                   // Add to ingredients
                                                                   setCurrentMeal(prev => ({
                                                                       ...prev,
                                                                       ingredients: [...(prev.ingredients || []), { name: item.name, quantity: item.quantity || '1' }]
                                                                   }));
                                                               } else {
                                                                   // Remove from ingredients
                                                                   setCurrentMeal(prev => ({
                                                                       ...prev,
                                                                       ingredients: prev.ingredients?.filter(ing => ing.name.toLowerCase() !== item.name.toLowerCase())
                                                                   }));
                                                               }
                                                           }}
                                                           className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                                                           aria-label={`Select ${item.name}`}
                                                       />
                                                       <div className="flex-1">
                                                           <div className="text-sm font-medium text-gray-700">{item.name}</div>
                                                           <div className="text-xs text-gray-400">{item.quantity} in stock</div>
                                                       </div>
                                                       {isSelected && <span className="text-xs text-brand-600 font-bold">Added</span>}
                                                   </label>
                                               );
                                           })
                                       }
                                       {pantry.length === 0 && <div className="p-4 text-center text-xs text-gray-400">Pantry is empty</div>}
                                       {pantry.length > 0 && filteredPantryItems.length === 0 && (
                                           <div className="p-4 text-center text-xs text-gray-400">No items match your search</div>
                                       )}
                                   </div>
                               </div>

                               {/* Section 2: Manual Entry */}
                               <div>
                                    <label htmlFor="ingredient-name" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Add Missing Item</label>
                                    <div className="flex gap-2">
                                        <input
                                            id="ingredient-name"
                                            type="text"
                                            placeholder="Item name"
                                            className="flex-1 rounded-xl border-gray-200 text-sm focus:border-brand-500 focus:ring-brand-500"
                                            value={ingredientName}
                                            onChange={(e) => setIngredientName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                                        />
                                        <input
                                            aria-label="Ingredient quantity"
                                            type="text"
                                            placeholder="Qty"
                                            className="w-20 rounded-xl border-gray-200 text-sm focus:border-brand-500 focus:ring-brand-500"
                                            value={ingredientQty}
                                            onChange={(e) => setIngredientQty(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                                        />
                                        <button
                                            onClick={handleAddIngredient}
                                            disabled={!ingredientName.trim()}
                                            className="p-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600"
                                            aria-label="Add ingredient"
                                        >
                                            <Plus className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1 pl-1">
                                        Items not in your pantry will be added to the shopping list when creating a new meal plan.
                                    </p>
                               </div>
                           </div>
                      </div>

                      </div>
                  </div>

                  <div className="p-4 border-t border-gray-100 bg-white flex gap-3 shrink-0">
                      <button
                          onClick={handleCancel}
                          className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg"
                      >
                          Cancel
                      </button>
                      <button
                          onClick={saveMeal}
                          className="flex-1 py-2 bg-brand-600 text-white rounded-lg"
                      >
                          Save to Plan
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Previous Meals Modal */}
      {isPreviousMealsModalOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) setIsPreviousMealsModalOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="previous-meals-title"
          >
               <div className="bg-white rounded-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
                   <h3 id="previous-meals-title" className="text-lg font-bold mb-4">Your Cookbook</h3>
                   <div className="flex-1 overflow-y-auto space-y-2">
                       {meals.sort((a,b) => a.name.localeCompare(b.name)).map(meal => (
                           <button
                                key={meal.id}
                                onClick={() => {
                                    setCurrentMeal(meal);
                                    setEditingMealId(meal.id);
                                    setIsPreviousMealsModalOpen(false);
                                }}
                                className="w-full text-left p-3 hover:bg-gray-50 rounded-lg border border-gray-100 flex justify-between items-center"
                           >
                               <span className="font-medium">{meal.name}</span>
                               <ChevronRight className="w-4 h-4 text-gray-400" />
                           </button>
                       ))}
                       {meals.length === 0 && <p className="text-gray-500 text-center py-4">No saved meals yet.</p>}
                   </div>
                   <button
                        onClick={() => setIsPreviousMealsModalOpen(false)}
                        className="mt-4 w-full py-2 bg-gray-100 rounded-lg"
                   >
                       Close
                   </button>
               </div>
          </div>
      )}

      {/* AI Modal */}
      {isAIModalOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) setIsAIModalOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-modal-title"
          >
              <div className="bg-white rounded-xl w-full max-w-sm p-6">
                  <h3 id="ai-modal-title" className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Sparkles className="text-purple-600" /> Chef AI
                  </h3>

                  <div className="space-y-3 mb-6">
                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                              type="checkbox"
                              checked={aiOptions.usePantry}
                              onChange={e => setAiOptions({...aiOptions, usePantry: e.target.checked})}
                              className="rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-medium">Use Pantry Items</div>
                              <div className="text-xs text-gray-500">Prioritize ingredients you have</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                              type="checkbox"
                              checked={aiOptions.cheap}
                              onChange={e => setAiOptions({...aiOptions, cheap: e.target.checked})}
                              className="rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-medium">Budget Friendly</div>
                              <div className="text-xs text-gray-500">Low cost ingredients</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                              type="checkbox"
                              checked={aiOptions.quick}
                              onChange={e => setAiOptions({...aiOptions, quick: e.target.checked})}
                              className="rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-medium">Quick & Easy</div>
                              <div className="text-xs text-gray-500">Under 30 minutes</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                              type="checkbox"
                              checked={aiOptions.new}
                              onChange={e => setAiOptions({...aiOptions, new: e.target.checked})}
                              className="rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-medium">Try Something New</div>
                              <div className="text-xs text-gray-500">Avoid recent meals</div>
                          </div>
                      </label>
                  </div>

                  <button
                      onClick={handleAIRequest}
                      disabled={isGeneratingAI}
                      className="w-full py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                      {isGeneratingAI ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {isGeneratingAI ? 'Consulting Chef...' : 'Suggest Meal'}
                  </button>

                  <button
                      onClick={() => setIsAIModalOpen(false)}
                      disabled={isGeneratingAI}
                      className="mt-3 w-full py-2 text-gray-500 hover:bg-gray-50 rounded-lg"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default MealPlanTab;
