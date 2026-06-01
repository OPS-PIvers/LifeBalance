import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, ChevronRight, ChevronLeft, ShoppingCart, Copy, CheckCircle2, MoreVertical, CalendarDays, Eye, Utensils } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { IngredientSelectorModal } from './IngredientSelectorModal';
import { CookbookModal } from './CookbookModal';
import { RecipeModal } from './RecipeModal';
import { AddMealModal } from './AddMealModal';
import { AISuggestModal } from './AISuggestModal';
import { RecipeImportModal } from './RecipeImportModal';
import { Drawer } from '@/components/ui/Drawer';
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

  // Calendar State — `selectedDate` is the focused day; the visible week is derived from it.
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Per-meal action sheet (replaces the cluttered inline icon buttons)
  const [actionSheetItem, setActionSheetItem] = useState<MealPlanItem | null>(null);

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPreviousMealsModalOpen, setIsPreviousMealsModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
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

  const handleRecipeImport = (meal: Partial<Meal>) => {
      setCurrentMeal(prev => ({
          ...prev,
          name: meal.name ?? prev.name,
          description: meal.description ?? prev.description,
          ingredients: meal.ingredients ?? prev.ingredients ?? [],
          instructions: meal.instructions ?? prev.instructions ?? [],
          recipeUrl: meal.recipeUrl ?? prev.recipeUrl ?? '',
          tags: meal.tags ?? prev.tags ?? []
      }));
  };

  // --- Derived view data ---------------------------------------------------
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');
  const isCurrentWeek = weekStartStr === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  // Count meals per day this week (for the day-strip indicators)
  const countByDate = new Map<string, number>();
  let weekMealCount = 0;
  for (const item of mealPlan || []) {
    if (item.date >= weekStartStr && item.date <= weekEndStr) {
      countByDate.set(item.date, (countByDate.get(item.date) || 0) + 1);
      weekMealCount++;
    }
  }

  const MEAL_TYPE_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  const MEAL_TYPE_META: Record<string, { dot: string; badge: string }> = {
    breakfast: { dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-100' },
    lunch: { dot: 'bg-sky-400', badge: 'bg-sky-50 text-sky-700 border-sky-100' },
    dinner: { dot: 'bg-brand-500', badge: 'bg-brand-50 text-brand-700 border-brand-100' },
    snack: { dot: 'bg-violet-400', badge: 'bg-violet-50 text-violet-700 border-violet-100' },
  };

  const dayMeals = (mealPlan ? mealPlan.filter((i: MealPlanItem) => i.date === selectedDateStr) : [])
    .slice()
    .sort((a, b) => (MEAL_TYPE_ORDER[a.type] ?? 99) - (MEAL_TYPE_ORDER[b.type] ?? 99));

  // Action-sheet wrappers: run the existing handler, then close the sheet.
  const sheetView = (planItem: MealPlanItem) => {
    const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : null;
    if (linkedMeal) setViewingMeal({ meal: linkedMeal, planItem });
    setActionSheetItem(null);
  };
  const sheetMoveTomorrow = (planItem: MealPlanItem) => { handleMoveToTomorrow(planItem); setActionSheetItem(null); };
  const sheetDuplicate = (planItem: MealPlanItem) => { handleDuplicatePlanItem(planItem); setActionSheetItem(null); };
  const sheetEdit = (planItem: MealPlanItem) => {
    const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : undefined;
    handleEditMealPlanItem(planItem, linkedMeal);
    setActionSheetItem(null);
  };
  const sheetDelete = (planItem: MealPlanItem) => { deleteMealPlanItem(planItem.id); setActionSheetItem(null); };

  return (
    <div className="space-y-5 pb-20">
      {/* Calendar Header */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-glass ring-1 ring-black/5 p-4 sm:p-5 space-y-4">
        {/* Week navigation */}
        <div className="flex items-center justify-between gap-2">
            <button
                onClick={() => setSelectedDate(d => addDays(d, -7))}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors active:scale-95"
                aria-label="Previous week"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-none">
                    {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
                </h2>
                <div className="text-xxs text-slate-400 font-bold uppercase tracking-wider mt-1.5">
                    {weekMealCount > 0 ? `${weekMealCount} meal${weekMealCount === 1 ? '' : 's'} planned` : 'Weekly plan'}
                </div>
            </div>
            <button
                onClick={() => setSelectedDate(d => addDays(d, 7))}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors active:scale-95"
                aria-label="Next week"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
        </div>

        {/* Day strip — whole week at a glance */}
        <div className="flex gap-1 sm:gap-1.5">
            {weekDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const count = countByDate.get(dateStr) || 0;
                const isSelected = dateStr === selectedDateStr;
                const isToday = dateStr === todayStr;

                return (
                    <button
                        key={dateStr}
                        onClick={() => setSelectedDate(day)}
                        aria-label={`${format(day, 'EEEE, MMMM d')}${count > 0 ? `, ${count} meals planned` : ''}`}
                        aria-pressed={isSelected}
                        className={clsx(
                            "flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all active:scale-95",
                            isSelected
                                ? "bg-brand-600 shadow-md shadow-brand-200"
                                : "hover:bg-slate-100"
                        )}
                    >
                        <span className={clsx(
                            "text-xxs font-bold uppercase tracking-wide",
                            isSelected ? "text-white/80" : "text-slate-400"
                        )}>
                            {format(day, 'EEEEE')}
                        </span>
                        <span className={clsx(
                            "w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold tabular-nums transition-colors",
                            isSelected
                                ? "text-white"
                                : isToday
                                    ? "bg-brand-100 text-brand-700 ring-1 ring-brand-300"
                                    : "text-slate-700"
                        )}>
                            {format(day, 'd')}
                        </span>
                        <span className="flex items-center justify-center gap-0.5 h-1.5">
                            {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                                <span
                                    key={i}
                                    className={clsx(
                                        "w-1 h-1 rounded-full",
                                        isSelected ? "bg-white/80" : "bg-brand-400"
                                    )}
                                />
                            ))}
                        </span>
                    </button>
                );
            })}
        </div>

        {/* Week actions */}
        <div className="flex gap-2">
            {!isCurrentWeek && (
                <button
                    onClick={() => setSelectedDate(new Date())}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200/60 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                    <CalendarDays className="w-3.5 h-3.5" /> Today
                </button>
            )}
            <button
                onClick={handleCopyLastWeek}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200/60 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-100 hover:text-slate-900 transition-all active:scale-95"
            >
                <Copy className="w-3.5 h-3.5" /> Copy Last Week
            </button>
            <button
                onClick={handleShopForWeek}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-50 text-brand-700 border border-brand-200/60 rounded-xl text-xs font-bold hover:bg-brand-100 transition-all active:scale-95"
            >
                <ShoppingCart className="w-3.5 h-3.5" /> Shop Week
            </button>
        </div>
      </div>

      {/* Selected day agenda */}
      <div className="space-y-3">
        <div className="flex items-end justify-between px-1">
            <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight leading-none">
                    {format(selectedDate, 'EEEE')}
                </h3>
                <p className="text-sm text-slate-500 font-medium mt-1">
                    {format(selectedDate, 'MMMM d')}
                    {selectedDateStr === todayStr && <span className="text-brand-600 font-bold"> · Today</span>}
                </p>
            </div>
            <button
                onClick={() => handleAddMealToDate(selectedDate)}
                className="flex items-center gap-1.5 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-full transition-colors shadow-sm shadow-brand-200 active:scale-95"
            >
                <Plus className="w-4 h-4" /> Add Meal
            </button>
        </div>

        {dayMeals.length > 0 ? (
            <div className="space-y-2.5">
                {dayMeals.map((planItem) => {
                    const linkedMeal = planItem.mealId ? meals.find(m => m.id === planItem.mealId) : null;
                    const mealName = planItem.mealName || linkedMeal?.name || 'Untitled meal';
                    const isCooked = planItem.isCooked;
                    const typeMeta = MEAL_TYPE_META[planItem.type] || MEAL_TYPE_META.dinner;

                    return (
                        <div
                            key={planItem.id}
                            onClick={() => { if (linkedMeal) setViewingMeal({ meal: linkedMeal, planItem }); }}
                            className={clsx(
                                "group flex items-stretch gap-3 rounded-2xl border p-3.5 shadow-sm transition-all relative",
                                linkedMeal && "cursor-pointer hover:shadow-md hover:border-slate-300",
                                isCooked
                                    ? "bg-green-50/40 border-green-200"
                                    : "bg-white border-slate-200/70"
                            )}
                        >
                            {/* Meal-type accent bar */}
                            <span className={clsx("w-1 rounded-full shrink-0", isCooked ? "bg-green-400" : typeMeta.dot)} aria-hidden="true" />

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className={clsx(
                                        "inline-flex items-center px-2 py-0.5 rounded-md text-xxs font-bold uppercase tracking-wider border capitalize",
                                        typeMeta.badge
                                    )}>
                                        {planItem.type || 'dinner'}
                                    </span>
                                    {isCooked && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xxs font-bold border border-green-200">
                                            <CheckCircle2 size={10} /> Cooked
                                        </span>
                                    )}
                                </div>
                                <div className={clsx("font-semibold tracking-tight leading-snug line-clamp-2", isCooked ? "text-green-900" : "text-slate-900")}>
                                    {mealName}
                                </div>

                                {linkedMeal?.description && (
                                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1 leading-relaxed">{linkedMeal.description}</div>
                                )}

                                {linkedMeal?.ingredients && linkedMeal.ingredients.length > 0 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenIngredientSelector(mealName, linkedMeal.ingredients, linkedMeal.id);
                                        }}
                                        className="mt-2 text-xxs font-bold text-brand-600 inline-flex items-center gap-1 hover:text-brand-800 transition-colors"
                                    >
                                        <ShoppingCart className="w-3 h-3" /> Shop ingredients
                                    </button>
                                )}
                            </div>

                            {/* Single overflow action button (replaces 4 inline buttons) */}
                            <button
                                onClick={(e) => { e.stopPropagation(); setActionSheetItem(planItem); }}
                                className="self-start -mr-1 -mt-0.5 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors active:scale-95 shrink-0"
                                aria-label={`Actions for ${mealName}`}
                            >
                                <MoreVertical className="w-5 h-5" />
                            </button>
                        </div>
                    );
                })}
            </div>
        ) : (
            <button
                onClick={() => handleAddMealToDate(selectedDate)}
                className="w-full border-2 border-dashed border-slate-200 rounded-2xl py-10 px-4 flex flex-col items-center gap-2 text-center hover:border-brand-300 hover:bg-brand-50/40 transition-all group"
            >
                <span className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-brand-100 flex items-center justify-center transition-colors">
                    <Utensils className="w-5 h-5 text-slate-400 group-hover:text-brand-500 transition-colors" />
                </span>
                <span className="text-sm font-semibold text-slate-500 group-hover:text-brand-600">No meals planned</span>
                <span className="text-xs text-slate-400">Tap to add a meal for this day</span>
            </button>
        )}
      </div>

      {/* Per-meal action sheet */}
      {actionSheetItem && (() => {
        const item = actionSheetItem;
        const hasRecipe = !!(item.mealId && meals.find(m => m.id === item.mealId));
        const actionClass = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left font-semibold transition-colors";
        return (
          <Drawer
            isOpen={!!actionSheetItem}
            onClose={() => setActionSheetItem(null)}
            title={item.mealName || 'Meal'}
          >
            <div className="space-y-1 pb-2">
              {hasRecipe && (
                <button onClick={() => sheetView(item)} className={clsx(actionClass, "text-slate-700 hover:bg-slate-100")}>
                  <Eye className="w-5 h-5 text-slate-400" /> View recipe
                </button>
              )}
              <button onClick={() => sheetMoveTomorrow(item)} className={clsx(actionClass, "text-slate-700 hover:bg-slate-100")}>
                <ChevronRight className="w-5 h-5 text-slate-400" /> Move to tomorrow
              </button>
              <button onClick={() => sheetDuplicate(item)} className={clsx(actionClass, "text-slate-700 hover:bg-slate-100")}>
                <Copy className="w-5 h-5 text-slate-400" /> Duplicate
              </button>
              <button onClick={() => sheetEdit(item)} className={clsx(actionClass, "text-slate-700 hover:bg-slate-100")}>
                <Edit2 className="w-5 h-5 text-slate-400" /> Edit
              </button>
              <button onClick={() => sheetDelete(item)} className={clsx(actionClass, "text-rose-600 hover:bg-rose-50")}>
                <Trash2 className="w-5 h-5" /> Delete
              </button>
            </div>
          </Drawer>
        );
      })()}

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
        onOpenImport={() => setIsImportModalOpen(true)}
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

      {/* Recipe Import Modal */}
      <RecipeImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        householdId={householdId || ''}
        onConfirm={handleRecipeImport}
      />

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
