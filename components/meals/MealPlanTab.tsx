/* eslint-disable */
import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, ChevronRight, ChevronLeft, ShoppingCart, Copy } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { MealFormModal } from './MealFormModal';
import { PreviousMealsModal } from './PreviousMealsModal';
import { AIMealModal, AIOptions } from './AIMealModal';

const MealPlanTab: React.FC = () => {
  const {
    meals,
    addMeal,
    updateMeal,
    addShoppingItem,
    shoppingList,
    mealPlan,
    addMealPlanItem,
    updateMealPlanItem,
    deleteMealPlanItem,
    householdId
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

  // AI State
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Calendar Logic
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 }); // Monday start
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const addIngredientsToShoppingList = async (mealIngredients: MealIngredient[]) => {
      const ingredientsToAdd = mealIngredients.filter(ing => {
          const ingName = normalizeToKey(ing.name);
          // Check if already in shopping list
          const inList = shoppingList.some(s => normalizeToKey(s.name) === ingName && !s.isPurchased);

          return !inList;
      });

      if (ingredientsToAdd.length === 0) {
          toast.success('All ingredients already in shopping list!');
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

  const handleShopForWeek = async () => {
    // 1. Get all meals for this week
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');

    const weekPlanItems = mealPlan.filter(item =>
        item.date >= weekStartStr && item.date <= weekEndStr
    );

    if (weekPlanItems.length === 0) {
        toast('No meals planned for this week', { icon: '📅' });
        return;
    }

    // 2. Collect and deduplicate ingredients
    const ingredientMap = new Map<string, MealIngredient>();
    let mealCount = 0;

    weekPlanItems.forEach(item => {
        if (!item.mealId) return;
        const meal = meals.find(m => m.id === item.mealId);
        if (meal && meal.ingredients && meal.ingredients.length > 0) {
            meal.ingredients.forEach(ing => {
                // Deduplicate by normalized name
                const key = normalizeToKey(ing.name);
                if (!ingredientMap.has(key)) {
                    ingredientMap.set(key, ing);
                }
            });
            mealCount++;
        }
    });

    const uniqueIngredients = Array.from(ingredientMap.values());

    if (uniqueIngredients.length === 0) {
        toast('No ingredients found in planned meals', { icon: '🤷' });
        return;
    }

    if (!window.confirm(`Add ingredients for ${mealCount} meals to shopping list?`)) {
        return;
    }

    // 3. Add to list
    await addIngredientsToShoppingList(uniqueIngredients);
  };

  const handleCopyLastWeek = async () => {
    // 1. Identify source dates (last week)
    const lastWeekStart = addDays(weekStart, -7);
    const lastWeekEnd = addDays(lastWeekStart, 6);
    const lastWeekStartStr = format(lastWeekStart, 'yyyy-MM-dd');
    const lastWeekEndStr = format(lastWeekEnd, 'yyyy-MM-dd');

    // 2. Filter items from last week
    const sourceItems = mealPlan.filter(item =>
      item.date >= lastWeekStartStr && item.date <= lastWeekEndStr
    );

    if (sourceItems.length === 0) {
      toast.error('No meals found in last week to copy');
      return;
    }

    if (!window.confirm(`Copy ${sourceItems.length} meals from last week to this week?`)) {
      return;
    }

    try {
      // 3. Map to new items
      const promises = sourceItems.map(item => {
        const itemDate = parseISO(item.date);
        const newDate = addDays(itemDate, 7);
        const newDateStr = format(newDate, 'yyyy-MM-dd');

        return addMealPlanItem(
          {
            date: newDateStr,
            mealName: item.mealName,
            mealId: item.mealId,
            type: item.type,
            isCooked: false
          },
          { suppressToast: true, throwOnError: true }
        );
      });

      const results = await Promise.allSettled(promises);
      const successCount = results.filter(result => result.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (successCount > 0) {
        toast.success(`Copied ${successCount} meal${successCount === 1 ? '' : 's'} to this week`);
      }

      if (failureCount > 0) {
        toast.error(`Failed to copy ${failureCount} meal${failureCount === 1 ? '' : 's'}`);
      }
    } catch (error) {
      console.error('Failed to copy meals:', error);
      toast.error('Failed to copy meals');
    }
  };

  const handleAddMealToDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
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

  const handleCancel = () => {
      setIsAddModalOpen(false);
      setTargetDate(null);
      setEditingMealId(null);
      setEditingPlanItemId(null);
      setMealType('dinner');
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
  };

  const saveMeal = async (forceNew = false) => {
      if (!currentMeal.name) return;

      let mealId = forceNew ? null : editingMealId;

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

  const handleCloneMeal = (meal: Meal) => {
      // 1. Populate form with meal data (copy)
      setCurrentMeal({
          name: `${meal.name} (Copy)`,
          description: meal.description,
          ingredients: meal.ingredients || [],
          instructions: meal.instructions || [],
          recipeUrl: meal.recipeUrl || '',
          tags: meal.tags || []
      });

      // 2. Ensure it's treated as a NEW meal
      setEditingMealId(null);

      // 3. Switch modals
      setIsPreviousMealsModalOpen(false);
      setIsAddModalOpen(true);
      toast.success('Cloned! You are editing a new copy.');
  };

  const handleAIRequest = async (options: AIOptions) => {
    if (!householdId) {
        toast.error("Household ID not found");
        return;
    }
    setIsGeneratingAI(true);
    try {
        const { suggestMeal } = await import('@/services/geminiService');
        const suggestion = await suggestMeal(householdId, {
            cheap: options.cheap,
            quick: options.quick,
            new: options.new,
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

  return (
    <div className="space-y-6 pb-20">
      {/* Calendar Header */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col items-center gap-4">
        <div className="flex items-center justify-between w-full">
            <button
                onClick={() => setSelectedDate(d => addDays(d, -7))}
                className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors"
                aria-label="Previous week"
            >
                <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="text-center">
                <h2 className="text-xl font-bold text-brand-900">
                    {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
                </h2>
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-1">Weekly Plan</div>
            </div>
            <button
                onClick={() => setSelectedDate(d => addDays(d, 7))}
                className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors"
                aria-label="Next week"
            >
                <ChevronRight className="w-6 h-6" />
            </button>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
            <button
                onClick={handleCopyLastWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-full text-xs font-bold uppercase tracking-wide hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
                <Copy className="w-3.5 h-3.5" />
                Copy Last Week
            </button>
            <button
                onClick={handleShopForWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-brand-100 text-brand-700 border border-brand-200 rounded-full text-xs font-bold uppercase tracking-wide hover:bg-brand-200 transition-all shadow-sm"
            >
                <ShoppingCart className="w-3.5 h-3.5" />
                Shop This Week
            </button>
        </div>
      </div>

      {/* Days Grid */}
      <div className="space-y-4">
        {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const planItems = mealPlan ? mealPlan.filter((i: any) => i.date === dateStr) : [];
            const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

            return (
                <div
                    key={dateStr}
                    className={`bg-white rounded-2xl shadow-sm p-5 ring-1 ring-black/5 ${isToday ? 'ring-brand-200 bg-brand-50/30' : ''}`}
                >
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Date Column */}
                        <div className="min-w-[80px] shrink-0 flex sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                            <div>
                                <div className="text-2xl font-bold text-brand-900 leading-none">{format(day, 'd')}</div>
                                <div className="text-sm font-medium text-gray-500 uppercase tracking-wide mt-1">{format(day, 'EEEE')}</div>
                            </div>
                            <button
                                onClick={() => handleAddMealToDate(day)}
                                className="sm:mt-3 flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Meal
                            </button>
                        </div>

                        {/* Meals Column */}
                        <div className="flex-1 space-y-3 pt-2 sm:pt-0">
                            {planItems.length > 0 ? planItems.map((planItem) => {
                                const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : null;
                                const mealName = planItem.mealName || linkedMeal?.name;

                                return (
                                    <div key={planItem.id} className="group bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md transition-all flex justify-between items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold uppercase tracking-wider bg-brand-50 text-brand-600 border border-brand-100">
                                                    {planItem.type || 'dinner'}
                                                </span>
                                            </div>
                                            <div className="font-semibold text-gray-900 truncate pr-2">{mealName}</div>

                                            {linkedMeal?.description && (
                                                <div className="text-xs text-gray-500 mt-1 line-clamp-1">{linkedMeal.description}</div>
                                            )}

                                            {linkedMeal?.ingredients && linkedMeal.ingredients.length > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        addIngredientsToShoppingList(linkedMeal.ingredients);
                                                    }}
                                                    className="mt-2 text-xxs font-medium text-brand-600 flex items-center gap-1 hover:text-brand-800 transition-colors"
                                                >
                                                    <ShoppingCart className="w-3 h-3" /> Shop Ingredients
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex flex-row sm:flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleEditMealPlanItem(planItem, linkedMeal ?? undefined)}
                                                className="p-3 sm:p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Edit ${mealName}`}
                                            >
                                                <Edit2 className="w-5 h-5 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                                onClick={() => deleteMealPlanItem(planItem.id)}
                                                className="p-3 sm:p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Delete ${mealName}`}
                                            >
                                                <Trash2 className="w-5 h-5 sm:w-4 sm:h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div
                                    onClick={() => handleAddMealToDate(day)}
                                    className="border-2 border-dashed border-gray-100 rounded-xl p-4 text-center cursor-pointer hover:border-brand-200 hover:bg-brand-50/50 transition-all group"
                                >
                                    <p className="text-sm text-gray-400 group-hover:text-brand-500 font-medium">No meals planned</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        })}
      </div>

      {isAddModalOpen && (
        <MealFormModal
          isOpen={isAddModalOpen}
          onClose={handleCancel}
          meal={currentMeal}
          onMealChange={setCurrentMeal}
          onSave={saveMeal}
          isEditing={!!editingMealId}
          title={editingPlanItemId ? 'Edit Meal Plan' : targetDate ? `Plan for ${format(parseISO(targetDate), 'MMM d')}` : 'Add Meal'}
          mealType={mealType}
          setMealType={setMealType}
          onOpenCookbook={() => setIsPreviousMealsModalOpen(true)}
          onOpenAI={() => setIsAIModalOpen(true)}
        />
      )}

      {isPreviousMealsModalOpen && (
        <PreviousMealsModal
          isOpen={isPreviousMealsModalOpen}
          onClose={() => setIsPreviousMealsModalOpen(false)}
          meals={meals}
          onSelectMeal={(meal) => {
            setCurrentMeal(meal);
            setEditingMealId(meal.id);
            setIsPreviousMealsModalOpen(false);
          }}
          onCloneMeal={handleCloneMeal}
        />
      )}

      {isAIModalOpen && (
        <AIMealModal
          isOpen={isAIModalOpen}
          onClose={() => setIsAIModalOpen(false)}
          onSuggest={handleAIRequest}
          isGenerating={isGeneratingAI}
        />
      )}
    </div>
  );
};

export default MealPlanTab;
