import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, ChevronRight, ChevronLeft, ShoppingCart, Copy, CheckCircle2 } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { IngredientSelectorModal } from './IngredientSelectorModal';
import { CookbookModal } from './CookbookModal';
import { RecipeModal } from './RecipeModal';
import { AddMealModal } from './AddMealModal';
import { AISuggestModal } from './AISuggestModal';
import clsx from 'clsx';

const MealPlanTab: React.FC = () => {
  const {
    meals,
    addMeal,
    updateMeal,
    addShoppingItem,
    addShoppingItems,
    shoppingList,
    groceryCatalog,
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
  const [isIngredientSelectorOpen, setIsIngredientSelectorOpen] = useState(false);
  const [ingredientSelectorData, setIngredientSelectorData] = useState<{mealId?: string, name: string, ingredients: MealIngredient[]} | null>(null);

  // Recipe Viewer State
  const [viewingMeal, setViewingMeal] = useState<{meal: Meal, planItem: MealPlanItem} | null>(null);

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

  const handleOpenIngredientSelector = (name: string, ingredients: MealIngredient[], mealId?: string) => {
      setIngredientSelectorData({ name, ingredients, mealId });
      setIsIngredientSelectorOpen(true);
  };

  const handleConfirmIngredients = async (selectedIngredients: MealIngredient[]) => {
      if (selectedIngredients.length === 0) return;

      // 1. Create a Map of grocery catalog for O(1) lookups
      const catalogMap = new Map(groceryCatalog.map(item => [normalizeToKey(item.name), item]));

      // 2. Filter out items that are already in the unpurchased shopping list
      // This prevents duplicates if the user manually re-selected "In List" items
      const unpurchasedSet = new Set(
          shoppingList
            .filter(item => !item.isPurchased)
            .map(item => normalizeToKey(item.name))
      );

      const itemsToAdd = selectedIngredients
        .filter(ing => !unpurchasedSet.has(normalizeToKey(ing.name)))
        .map((ing, index) => {
            const normalizedName = normalizeToKey(ing.name);
            const historyItem = catalogMap.get(normalizedName);

            return {
                name: ing.name,
                quantity: ing.quantity || '',
                category: historyItem?.category || 'Uncategorized',
                isPurchased: false,
                addedFromMealId: ingredientSelectorData?.mealId,
                // Increment order for each new item to maintain sequence
                order: shoppingList.length + index
            };
        });

      if (itemsToAdd.length === 0) {
          toast('All selected items are already in your list.', { icon: 'ℹ️' });
          setIngredientSelectorData(null);
          return;
      }

      try {
        await addShoppingItems(itemsToAdd);
        toast.success(`Added ${itemsToAdd.length} items to shopping list`);
      } catch (error) {
        console.error('Failed to add items:', error);
        toast.error('Failed to add items');
      } finally {
        setIngredientSelectorData(null);
      }
  };

  // AI Options
  const [aiOptions, setAiOptions] = useState({
    cheap: false,
    quick: false,
    new: false,
  });
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
                // Note: We don't sum quantities because they are strings (e.g. "1 box", "2 cups")
                // Adding the item once is enough to get it on the list for review.
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
        // Calculate day offset from source week start to preserve relative day
        // Since we copy "last week" to "this week", it's always +7 days
        const itemDate = parseISO(item.date);
        const newDate = addDays(itemDate, 7);
        const newDateStr = format(newDate, 'yyyy-MM-dd');

        // Check if item already exists at target (optional, but good for hygiene)
        // For now, we allow duplicates or let the user manage them

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

  const handleDuplicatePlanItem = async (planItem: MealPlanItem) => {
      try {
          const { id: _id, isCooked: _isCooked, ...itemToDuplicate } = planItem;
          await addMealPlanItem({
              ...itemToDuplicate,
              isCooked: false
          });
          toast.success('Meal duplicated');
      } catch (error) {
          console.error('Duplicate plan item failed:', error);
          toast.error('Failed to duplicate meal');
      }
  };

  const handleMoveToTomorrow = async (planItem: MealPlanItem) => {
      try {
          const tomorrowStr = format(addDays(parseISO(planItem.date), 1), 'yyyy-MM-dd');
          await updateMealPlanItem(planItem.id, { date: tomorrowStr });
          toast.success('Moved to tomorrow');
      } catch (error) {
          console.error('Move plan item failed:', error);
          toast.error('Failed to move meal');
      }
  };

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

  const handleMarkCooked = async () => {
    if (!viewingMeal) return;

    const { meal, planItem } = viewingMeal;

    try {
      // 1. Update Plan Item
      await updateMealPlanItem(planItem.id, { isCooked: true });

      // 2. Update Meal History (Last Cooked)
      // Only if we have a linked meal ID and the meal exists in our library
      if (meal.id) {
        await updateMeal({
            ...meal,
            lastCooked: new Date().toISOString()
        });
      }

      setViewingMeal(null);
      toast.success('Bon Appétit! Marked as cooked.');
    } catch (error) {
      console.error('Failed to mark cooked:', error);
      toast.error('Failed to update status');
    }
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
          } catch (_error) {
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

  const mealToFormState = (meal: Meal, isClone: boolean = false): Partial<Meal> => ({
      name: isClone ? `${meal.name} (Copy)` : meal.name,
      description: meal.description || '',
      ingredients: meal.ingredients || [],
      instructions: meal.instructions || [],
      recipeUrl: meal.recipeUrl || '',
      tags: meal.tags || []
  });

  const handleCloneMeal = (meal: Meal) => {
      // 1. Populate form with meal data (copy)
      setCurrentMeal(mealToFormState(meal, true));

      // 2. Ensure it's treated as a NEW meal
      setEditingMealId(null);

      // 3. Switch modals
      setIsPreviousMealsModalOpen(false);
      setIsAddModalOpen(true);
      toast.success('Cloned! You are editing a new copy.');
  };

  const handleSelectMeal = (meal: Meal) => {
      setCurrentMeal(mealToFormState(meal));
      setEditingMealId(meal.id);
      setIsPreviousMealsModalOpen(false);
  };

  const handleCancel = () => {
      setIsAddModalOpen(false);
      setTargetDate(null);
      setEditingMealId(null);
      setEditingPlanItemId(null);
      setMealType('dinner');
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
  };

  const handleAIRequest = async () => {
    if (!householdId) {
        toast.error("Household ID not found");
        return;
    }
    setIsGeneratingAI(true);
    try {
        const { suggestMeal } = await import('@/services/geminiService');
        const suggestion = await suggestMeal(householdId, {
            cheap: aiOptions.cheap,
            quick: aiOptions.quick,
            new: aiOptions.new,
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
    } catch (_e) {
        toast.error("Failed to generate meal");
    } finally {
        setIsGeneratingAI(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Calendar Header */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-glass ring-1 ring-black/5 p-6 flex flex-col items-center gap-6">
        <div className="flex items-center justify-between w-full">
            <button
                onClick={() => setSelectedDate(d => addDays(d, -7))}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                aria-label="Previous week"
            >
                <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="text-center">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
                </h2>
                <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">Weekly Plan</div>
            </div>
            <button
                onClick={() => setSelectedDate(d => addDays(d, 7))}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                aria-label="Next week"
            >
                <ChevronRight className="w-6 h-6" />
            </button>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
            <button
                onClick={handleCopyLastWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-white/50 border border-slate-200/60 text-slate-600 rounded-full text-xs font-bold uppercase tracking-wide hover:bg-white hover:border-slate-300 hover:text-slate-900 transition-all shadow-sm"
            >
                <Copy className="w-3.5 h-3.5" />
                Copy Last Week
            </button>
            <button
                onClick={handleShopForWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-50/50 text-brand-700 border border-brand-200/60 rounded-full text-xs font-bold uppercase tracking-wide hover:bg-brand-50 hover:border-brand-200 transition-all shadow-sm"
            >
                <ShoppingCart className="w-3.5 h-3.5" />
                Shop This Week
            </button>
        </div>
      </div>

      {/* Days Grid */}
      <div className="flex flex-row overflow-x-auto snap-x snap-mandatory gap-4 pb-4 px-1 md:flex-col md:overflow-visible md:pb-0 md:px-0 md:space-y-4 no-scrollbar">
        {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const planItems = mealPlan ? mealPlan.filter((i: MealPlanItem) => i.date === dateStr) : [];
            const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

            return (
                <div
                    key={dateStr}
                    className={`min-w-[85vw] snap-center md:min-w-0 md:snap-align-none bg-white/80 backdrop-blur-xl rounded-2xl shadow-glass p-6 ring-1 transition-all ${isToday ? 'ring-brand-200 bg-brand-50/30' : 'ring-black/5'}`}
                >
                    <div className="flex flex-col sm:flex-row gap-6">
                        {/* Date Column */}
                        <div className="min-w-[80px] shrink-0 flex sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                            <div>
                                <div className="text-3xl font-bold text-slate-900 leading-none tracking-tight">{format(day, 'd')}</div>
                                <div className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">{format(day, 'EEEE')}</div>
                            </div>
                            <button
                                onClick={() => handleAddMealToDate(day)}
                                className="sm:mt-4 flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors border border-brand-100/50"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Meal
                            </button>
                        </div>

                        {/* Meals Column */}
                        <div className="flex-1 space-y-3 pt-2 sm:pt-0">
                            {planItems.length > 0 ? planItems.map((planItem) => {
                                const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : null;
                                const mealName = planItem.mealName || linkedMeal?.name;
                                const isCooked = planItem.isCooked;

                                return (
                                    <div
                                        key={planItem.id}
                                        onClick={() => {
                                            // Only open view modal if there's enough data
                                            if (linkedMeal) {
                                                setViewingMeal({ meal: linkedMeal, planItem });
                                            }
                                        }}
                                        className={clsx(
                                            "group border rounded-xl p-4 shadow-sm hover:shadow-md transition-all flex justify-between items-start gap-4 cursor-pointer relative overflow-hidden",
                                            isCooked
                                                ? "bg-green-50/50 border-green-200 hover:bg-green-50"
                                                : "bg-white/60 border-slate-200/60 hover:bg-white"
                                        )}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold uppercase tracking-wider bg-brand-50 text-brand-600 border border-brand-100">
                                                    {planItem.type || 'dinner'}
                                                </span>
                                                {isCooked && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xxs font-bold border border-green-200">
                                                        <CheckCircle2 size={10} /> Cooked
                                                    </span>
                                                )}
                                            </div>
                                            <div className={clsx("font-semibold truncate pr-2 tracking-tight", isCooked ? "text-green-900" : "text-slate-900")}>{mealName}</div>

                                            {linkedMeal?.description && (
                                                <div className="text-xs text-slate-500 mt-1 line-clamp-1 leading-relaxed">{linkedMeal.description}</div>
                                            )}

                                            {linkedMeal?.ingredients && linkedMeal.ingredients.length > 0 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenIngredientSelector(
                                                            mealName || 'Meal',
                                                            linkedMeal.ingredients,
                                                            linkedMeal.id
                                                        );
                                                    }}
                                                    className="mt-2 text-xxs font-medium text-brand-600 flex items-center gap-1 hover:text-brand-800 transition-colors"
                                                >
                                                    <ShoppingCart className="w-3 h-3" /> Shop Ingredients
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex flex-row sm:flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleMoveToTomorrow(planItem); }}
                                                className="p-3 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Move ${mealName} to tomorrow`}
                                                title="Move to tomorrow"
                                            >
                                                <ChevronRight className="w-5 h-5 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDuplicatePlanItem(planItem); }}
                                                className="p-3 sm:p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Duplicate ${mealName}`}
                                                title="Duplicate meal"
                                            >
                                                <Copy className="w-5 h-5 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEditMealPlanItem(planItem, linkedMeal ?? undefined);
                                                }}
                                                className="p-3 sm:p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Edit ${mealName}`}
                                                title="Edit meal"
                                            >
                                                <Edit2 className="w-5 h-5 sm:w-4 sm:h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteMealPlanItem(planItem.id);
                                                }}
                                                className="p-3 sm:p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors active:scale-95"
                                                aria-label={`Delete ${mealName}`}
                                                title="Delete meal"
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

      {/* Add Meal Modal */}
      <AddMealModal
        isOpen={isAddModalOpen}
        onClose={handleCancel}
        targetDate={targetDate}
        editingPlanItemId={editingPlanItemId}
        editingMealId={editingMealId}
        currentMeal={currentMeal}
        setCurrentMeal={setCurrentMeal}
        mealType={mealType}
        setMealType={setMealType}
        onOpenCookbook={() => setIsPreviousMealsModalOpen(true)}
        onOpenAI={() => setIsAIModalOpen(true)}
        onSave={saveMeal}
      />

      {/* Previous Meals Modal (Smart Cookbook) */}
      <CookbookModal
        isOpen={isPreviousMealsModalOpen}
        onClose={() => setIsPreviousMealsModalOpen(false)}
        meals={meals}
        onSelect={handleSelectMeal}
        onClone={handleCloneMeal}
      />

      {/* Recipe Viewer Modal */}
      {viewingMeal && (
        <RecipeModal
            isOpen={!!viewingMeal}
            onClose={() => setViewingMeal(null)}
            meal={viewingMeal.meal}
            planItem={viewingMeal.planItem}
            onMarkCooked={handleMarkCooked}
        />
      )}

      {/* AI Modal */}
      <AISuggestModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        aiOptions={aiOptions}
        setAiOptions={setAiOptions}
        isGeneratingAI={isGeneratingAI}
        onSuggest={handleAIRequest}
      />

      {/* Ingredient Selector Modal */}
      {isIngredientSelectorOpen && ingredientSelectorData && (
          <IngredientSelectorModal
              isOpen={isIngredientSelectorOpen}
              onClose={() => setIsIngredientSelectorOpen(false)}
              mealName={ingredientSelectorData.name}
              ingredients={ingredientSelectorData.ingredients}
              shoppingList={shoppingList}
              onConfirm={handleConfirmIngredients}
          />
      )}

    </div>
  );
};

export default MealPlanTab;
