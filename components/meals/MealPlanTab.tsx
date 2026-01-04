import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem } from '@/types/schema';
import { Plus, Trash2, Edit2, Sparkles, ChefHat, ChevronRight, ChevronLeft, ShoppingCart, Loader2 } from 'lucide-react';
import { suggestMeal } from '@/services/geminiService';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays } from 'date-fns';

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

  const handleAddTag = () => {
    if (tagInput.trim() && !currentMeal.tags?.includes(tagInput.trim())) {
      setCurrentMeal(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const handleAddIngredient = () => {
    if (ingredientName.trim()) {
        const newIng = { name: ingredientName.trim(), quantity: ingredientQty.trim() || '1' };
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
    setCurrentMeal({ tags: [], ingredients: [] });
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
               tags: currentMeal.tags || [],
               ...(existingMeal ? { rating: existingMeal.rating } : {})
           } as Meal);
      } else {
          // Create new meal in library
          try {
            mealId = await addMeal({
                name: currentMeal.name!,
                description: currentMeal.description,
                ingredients: currentMeal.ingredients || [],
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

      handleCancel();
  };

  const handleCancel = () => {
      setIsAddModalOpen(false);
      setTargetDate(null);
      setEditingMealId(null);
      setEditingPlanItemId(null);
      setMealType('dinner');
      setCurrentMeal({ tags: [], ingredients: [] });
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
            tags: suggestion.tags
        });
        setIsAIModalOpen(false); // Close AI options modal
        setIsAddModalOpen(true); // Ensure Add Meal modal is open
    } catch (e) {
        toast.error("Failed to generate meal");
        setIsAIModalOpen(false);
    } finally {
        setIsGeneratingAI(false);
    }
  };

  const addIngredientsToShoppingList = async (mealIngredients: { name: string; quantity: string }[]) => {
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
          toast.success('All ingredients already available!');
          return;
      }

      const results = await Promise.allSettled(ingredientsToAdd.map(ing =>
          addShoppingItem({
              name: ing.name,
              category: 'Uncategorized',
              quantity: ing.quantity,
              isPurchased: false
          })
      ));

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      if (successCount > 0) {
          toast.success(`Added ${successCount} items to shopping list`);
      } else {
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
                            {planItems.length > 0 ? planItems.map((planItem: MealPlanItem) => {
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
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) handleCancel();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
              <div className="bg-white rounded-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                  <h3 id="modal-title" className="text-lg font-bold mb-4">
                      {editingPlanItemId ? 'Edit Meal Plan' : `Plan Meal for ${targetDate}`}
                  </h3>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                      <button
                          onClick={() => setIsPreviousMealsModalOpen(true)}
                          className="flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium"
                      >
                          <ChefHat className="w-5 h-5" /> Previous Meals
                      </button>
                      <button
                          onClick={() => setIsAIModalOpen(true)}
                          className="flex items-center justify-center gap-2 p-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium"
                      >
                          <Sparkles className="w-5 h-5" /> AI Suggestion
                      </button>
                  </div>

                  <div className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Meal Name</label>
                          <input
                              type="text"
                              value={currentMeal.name}
                              onChange={e => setCurrentMeal({...currentMeal, name: e.target.value})}
                              className="w-full rounded-lg border-gray-300"
                              placeholder="e.g. Spaghetti Bolognese"
                          />
                      </div>

                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Meal Type</label>
                          <select
                              value={mealType}
                              onChange={e => setMealType(e.target.value as any)}
                              className="w-full rounded-lg border-gray-300"
                          >
                              <option value="breakfast">Breakfast</option>
                              <option value="lunch">Lunch</option>
                              <option value="dinner">Dinner</option>
                              <option value="snack">Snack</option>
                          </select>
                      </div>

                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                          <textarea
                              value={currentMeal.description}
                              onChange={e => setCurrentMeal({...currentMeal, description: e.target.value})}
                              className="w-full rounded-lg border-gray-300"
                              rows={2}
                          />
                      </div>

                      {/* Tags Section */}
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                          <div className="flex flex-wrap gap-2 mb-2">
                              {currentMeal.tags?.map(tag => (
                                  <span key={tag} className="bg-brand-100 text-brand-700 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                                      {tag}
                                      <button onClick={() => handleRemoveTag(tag)} className="hover:text-brand-900" aria-label={`Remove tag ${tag}`}>&times;</button>
                                  </span>
                              ))}
                          </div>
                          <div className="flex gap-2">
                              <input
                                  type="text"
                                  value={tagInput}
                                  onChange={e => setTagInput(e.target.value)}
                                  placeholder="Add tag (e.g. Quick, Healthy)"
                                  className="flex-1 rounded-lg border-gray-300 text-sm"
                                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                              />
                              <button onClick={handleAddTag} className="p-2 bg-gray-100 rounded-lg text-gray-600" aria-label="Add tag">
                                  <Plus className="w-4 h-4" />
                              </button>
                          </div>
                      </div>

                      {/* Ingredients Section */}
                      <div>
                           <label className="block text-sm font-medium text-gray-700 mb-1">Ingredients</label>
                           <div className="bg-gray-50 p-3 rounded-lg space-y-2 mb-2">
                               {currentMeal.ingredients?.length === 0 && (
                                   <p className="text-xs text-gray-400 italic text-center">No ingredients added yet.</p>
                               )}
                               {currentMeal.ingredients?.map((ing, idx) => (
                                   <div key={idx} className="flex justify-between items-center text-sm bg-white p-2 rounded border border-gray-100 shadow-sm">
                                       <div>
                                           <span className="font-medium">{ing.name}</span>
                                           <span className="text-gray-500 ml-2 text-xs">{ing.quantity}</span>
                                       </div>
                                       <button
                                           onClick={() => {
                                               const newIngredients = [...(currentMeal.ingredients || [])];
                                               newIngredients.splice(idx, 1);
                                               setCurrentMeal({...currentMeal, ingredients: newIngredients});
                                           }}
                                           className="text-red-400 hover:text-red-600"
                                           aria-label={`Remove ingredient ${ing.name}`}
                                       >
                                           <Trash2 className="w-3 h-3" />
                                       </button>
                                   </div>
                               ))}
                           </div>

                           {/* Add Ingredient Form */}
                           <div className="flex gap-2 items-end">
                               <div className="flex-1">
                                   <input
                                       list="pantry-items"
                                       type="text"
                                       placeholder="Add ingredient..."
                                       className="w-full rounded-lg border-gray-300 text-sm"
                                       value={ingredientName}
                                       onChange={(e) => setIngredientName(e.target.value)}
                                       onKeyDown={(e) => {
                                           if (e.key === 'Enter') {
                                               e.preventDefault();
                                               handleAddIngredient();
                                           }
                                       }}
                                   />
                                   <datalist id="pantry-items">
                                       {pantry.map(item => (
                                           <option key={item.id} value={item.name}>{item.quantity} available</option>
                                       ))}
                                   </datalist>
                               </div>
                               <div className="w-20">
                                   <input
                                       type="text"
                                       placeholder="Qty"
                                       className="w-full rounded-lg border-gray-300 text-sm"
                                       value={ingredientQty}
                                       onChange={(e) => setIngredientQty(e.target.value)}
                                       onKeyDown={(e) => {
                                           if (e.key === 'Enter') {
                                               e.preventDefault();
                                               handleAddIngredient();
                                           }
                                       }}
                                   />
                               </div>
                               <button
                                   onClick={handleAddIngredient}
                                   className="p-2 bg-brand-100 text-brand-600 rounded-lg hover:bg-brand-200"
                                   aria-label="Add ingredient"
                               >
                                   <Plus className="w-5 h-5" />
                               </button>
                           </div>
                      </div>

                      <div className="flex gap-3 pt-4">
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
