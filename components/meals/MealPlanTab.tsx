import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useMealPlan, useShopping, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
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
import { WeeklyPlanModal } from './WeeklyPlanModal';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Sparkles } from 'lucide-react';
import { haptic } from '@/utils/haptics';
import clsx from 'clsx';

// Static lookup tables — defined at module scope so they are never re-created.
const MEAL_TYPE_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const MEAL_TYPE_META: Record<string, { dot: string; badge: string }> = {
  breakfast: { dot: 'bg-warm-400', badge: 'bg-warm-50 text-warm-700 border-warm-200 dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/25' },
  lunch: { dot: 'bg-habit-blue', badge: 'bg-habit-blue/10 text-habit-blue border-habit-blue/20 dark:bg-habit-blue/15 dark:text-habit-blue dark:border-habit-blue/25' },
  dinner: { dot: 'bg-accent-500', badge: 'bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-900/30 dark:text-accent-200 dark:border-accent-700' },
  snack: { dot: 'bg-warm-300', badge: 'bg-warm-100 text-warm-700 border-warm-200 dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/25' },
};

// Pure helper — maps a saved Meal into the editable form shape. Defined at module
// scope (no component state) so it's a stable reference and keeps the handlers that
// use it free of an extra dependency.
const mealToFormState = (meal: Meal, isClone: boolean = false): Partial<Meal> => ({
  name: isClone ? `${meal.name} (Copy)` : meal.name,
  description: meal.description || '',
  ingredients: meal.ingredients || [],
  instructions: meal.instructions || [],
  recipeUrl: meal.recipeUrl || '',
  tags: meal.tags || []
});

const MealPlanTab: React.FC = () => {
  const {
    meals,
    addMeal,
    updateMeal,
    mealPlan,
    addMealPlanItem,
    updateMealPlanItem,
    deleteMealPlanItem,
    ensureMealPlanWeek,
  } = useMealPlan();
  const {
    addShoppingItem,
    addShoppingItems,
    shoppingList,
    groceryCatalog,
  } = useShopping();
  const { householdId } = useHouseholdCore();

  // Calendar State — `selectedDate` is the focused day; the visible week is derived from it.
  const [selectedDate, setSelectedDate] = useState(new Date());

  // The meal-plan listener only keeps the current week ± 1 live; fetch any other
  // week the user navigates to on demand.
  useEffect(() => {
    ensureMealPlanWeek(selectedDate);
  }, [selectedDate, ensureMealPlanWeek]);

  // Per-meal action sheet (replaces the cluttered inline icon buttons)
  const [actionSheetItem, setActionSheetItem] = useState<MealPlanItem | null>(null);

  // "Plan my week" (AI generate / import weekly-meals plan)
  const [isWeeklyPlanOpen, setIsWeeklyPlanOpen] = useState(false);

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

  // ConfirmDialog state for the two window.confirm replacements
  const [shopWeekConfirm, setShopWeekConfirm] = useState<{ mealCount: number; ingredients: MealIngredient[] } | null>(null);
  const [copyWeekConfirm, setCopyWeekConfirm] = useState<{ items: MealPlanItem[] } | null>(null);

  // O(1) meal lookup — avoids repeated O(n) meals.find() calls during render
  const mealsById = useMemo(() => new Map(meals.map(m => [m.id, m])), [meals]);

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

  // Calendar Logic — memoized so re-renders caused by unrelated state (modals, etc.)
  // don't recompute the week grid on every keystroke.
  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

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

  const handleShopForWeek = () => {
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
        const meal = mealsById.get(item.mealId);
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

    // Open confirm dialog with collected data
    setShopWeekConfirm({ mealCount, ingredients: uniqueIngredients });
  };

  const handleShopForWeekConfirmed = async () => {
    if (!shopWeekConfirm) return;
    const { ingredients } = shopWeekConfirm;
    setShopWeekConfirm(null);
    // 3. Add to list
    await addIngredientsToShoppingList(ingredients);
  };

  const handleCopyLastWeek = () => {
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

    // Capture the resolved source items at open time. The dialog is non-blocking,
    // so the viewed week can change before confirm — use the captured items rather
    // than recomputing from the (possibly changed) current weekStart.
    setCopyWeekConfirm({ items: sourceItems });
  };

  const handleCopyLastWeekConfirmed = async () => {
    if (!copyWeekConfirm) return;
    const sourceItems = copyWeekConfirm.items;
    setCopyWeekConfirm(null);

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

  const handleAddMealToDate = useCallback((date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    // Set up the modal to add to this date
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
    setTargetDate(dateStr);
    setMealType('dinner'); // Default
    setIsAddModalOpen(true);
  }, []);

  const handleEditMealPlanItem = useCallback((planItem: MealPlanItem, linkedMeal: Meal | undefined) => {
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
      setEditingMealId(planItem.mealId ?? null); // If it exists
      setEditingPlanItemId(planItem.id); // Track the plan item being edited
      setMealType(planItem.type || 'dinner');
      setIsAddModalOpen(true);
  }, []);

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

      haptic('success');
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
           const existingMeal = mealsById.get(mealId);
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
              haptic('success');
          }
      }

      // 3. Auto-add ingredients to shopping list
      // Only when creating a NEW plan item, and we have a target date
      if (!editingPlanItemId && targetDate && currentMeal.ingredients && currentMeal.ingredients.length > 0) {
          await addIngredientsToShoppingList(currentMeal.ingredients);
      }

      handleCancel();
  };

  const handleCloneMeal = useCallback((meal: Meal) => {
      // 1. Populate form with meal data (copy)
      setCurrentMeal(mealToFormState(meal, true));

      // 2. Ensure it's treated as a NEW meal
      setEditingMealId(null);

      // 3. Switch modals
      setIsPreviousMealsModalOpen(false);
      setIsAddModalOpen(true);
      toast.success('Cloned! You are editing a new copy.');
  }, []);

  const handleSelectMeal = useCallback((meal: Meal) => {
      setCurrentMeal(mealToFormState(meal));
      setEditingMealId(meal.id);
      setIsPreviousMealsModalOpen(false);
      // Ensure the Add Meal modal is showing so the selected recipe is visible
      // and can be saved to the plan (mirrors handleCloneMeal / handleAIRequest).
      setIsAddModalOpen(true);
  }, []);

  const handleCancel = useCallback(() => {
      setIsAddModalOpen(false);
      setTargetDate(null);
      setEditingMealId(null);
      setEditingPlanItemId(null);
      setMealType('dinner');
      setCurrentMeal({ tags: [], ingredients: [], instructions: [], recipeUrl: '' });
  }, []);

  // Stable modal-open handlers passed to AddMealModal so they don't recreate each
  // render (keeps the prop identity stable for child memoization).
  const handleOpenCookbook = useCallback(() => setIsPreviousMealsModalOpen(true), []);
  const handleOpenAI = useCallback(() => setIsAIModalOpen(true), []);
  const handleOpenImport = useCallback(() => setIsImportModalOpen(true), []);

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

  const handleRecipeImport = useCallback((meal: Partial<Meal>) => {
      setCurrentMeal(prev => ({
          ...prev,
          name: meal.name ?? prev.name,
          description: meal.description ?? prev.description,
          ingredients: meal.ingredients ?? prev.ingredients ?? [],
          instructions: meal.instructions ?? prev.instructions ?? [],
          recipeUrl: meal.recipeUrl ?? prev.recipeUrl ?? '',
          tags: meal.tags ?? prev.tags ?? []
      }));
  }, []);

  // --- Derived view data ---------------------------------------------------
  // Compute "now" once so all derived strings use the same instant.
  const { todayStr, selectedDateStr, weekStartStr, weekEndStr, isCurrentWeek } = useMemo(() => {
    const now = new Date();
    const wStartStr = format(weekStart, 'yyyy-MM-dd');
    return {
      todayStr: format(now, 'yyyy-MM-dd'),
      selectedDateStr: format(selectedDate, 'yyyy-MM-dd'),
      weekStartStr: wStartStr,
      weekEndStr: format(addDays(weekStart, 6), 'yyyy-MM-dd'),
      isCurrentWeek: wStartStr === format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    };
  }, [selectedDate, weekStart]);

  // Count meals per day this week (for the day-strip indicators) — O(N) scan.
  const { countByDate, weekMealCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const item of mealPlan || []) {
      if (item.date >= weekStartStr && item.date <= weekEndStr) {
        counts.set(item.date, (counts.get(item.date) || 0) + 1);
        total++;
      }
    }
    return { countByDate: counts, weekMealCount: total };
  }, [mealPlan, weekStartStr, weekEndStr]);

  // Filtered + sorted meals for the selected day.
  const dayMeals = useMemo(
    () =>
      (mealPlan ? mealPlan.filter((i: MealPlanItem) => i.date === selectedDateStr) : [])
        .slice()
        .sort((a, b) => (MEAL_TYPE_ORDER[a.type] ?? 99) - (MEAL_TYPE_ORDER[b.type] ?? 99)),
    [mealPlan, selectedDateStr]
  );

  // Action-sheet wrappers: run the existing handler, then close the sheet.
  const sheetView = (planItem: MealPlanItem) => {
    const linkedMeal = planItem.mealId ? mealsById.get(planItem.mealId) : null;
    if (linkedMeal) setViewingMeal({ meal: linkedMeal, planItem });
    setActionSheetItem(null);
  };
  const sheetMoveTomorrow = (planItem: MealPlanItem) => { handleMoveToTomorrow(planItem); setActionSheetItem(null); };
  const sheetDuplicate = (planItem: MealPlanItem) => { handleDuplicatePlanItem(planItem); setActionSheetItem(null); };
  const sheetEdit = (planItem: MealPlanItem) => {
    const linkedMeal = planItem.mealId ? mealsById.get(planItem.mealId) : undefined;
    handleEditMealPlanItem(planItem, linkedMeal);
    setActionSheetItem(null);
  };
  const sheetDelete = (planItem: MealPlanItem) => { haptic('medium'); deleteMealPlanItem(planItem.id); setActionSheetItem(null); };

  return (
    <div className="space-y-5 pb-20">
      {/* Calendar Header */}
      <div className="surface-section p-4 sm:p-5 space-y-4">
        {/* Week navigation */}
        <div className="flex items-center justify-between gap-2">
            <button
                onClick={() => setSelectedDate(d => addDays(d, -7))}
                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-full transition-colors active:scale-95 dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
                aria-label="Previous week"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center">
                <h2 className="font-display text-base sm:text-lg font-semibold text-brand-900 dark:text-brand-50 tracking-tight leading-none">
                    {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
                </h2>
                <div className="text-xxs text-brand-400 dark:text-brand-500 font-bold uppercase tracking-wider mt-1.5">
                    {weekMealCount > 0 ? `${weekMealCount} meal${weekMealCount === 1 ? '' : 's'} planned` : 'Weekly plan'}
                </div>
            </div>
            <button
                onClick={() => setSelectedDate(d => addDays(d, 7))}
                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-full transition-colors active:scale-95 dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
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
                            "flex-1 flex flex-col items-center gap-1 py-2 rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95",
                            isSelected
                                ? "bg-accent-600"
                                : "hover:bg-brand-100 dark:hover:bg-brand-700/50"
                        )}
                    >
                        <span className={clsx(
                            "text-xxs font-bold uppercase tracking-wide",
                            isSelected ? "text-white/80" : "text-brand-400 dark:text-brand-500"
                        )}>
                            {format(day, 'EEEEE')}
                        </span>
                        <span className={clsx(
                            "w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold tabular-nums transition-colors",
                            isSelected
                                ? "text-white"
                                : isToday
                                    ? "bg-accent-100 text-accent-700 ring-1 ring-accent-300 dark:bg-accent-900/40 dark:text-accent-200 dark:ring-accent-700"
                                    : "text-brand-700 dark:text-brand-300"
                        )}>
                            {format(day, 'd')}
                        </span>
                        <span className="flex items-center justify-center gap-0.5 h-1.5">
                            {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                                <span
                                    key={i}
                                    className={clsx(
                                        "w-1 h-1 rounded-full",
                                        isSelected ? "bg-white/80" : "bg-accent-400"
                                    )}
                                />
                            ))}
                        </span>
                    </button>
                );
            })}
        </div>

        {/* Plan my week (AI generate / import) */}
        <button
            onClick={() => setIsWeeklyPlanOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-accent-600 text-white rounded-btn text-sm font-bold hover:bg-accent-700 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95"
        >
            <Sparkles className="w-4 h-4" /> Plan my week
        </button>

        {/* Week actions */}
        <div className="flex gap-2">
            {!isCurrentWeek && (
                <button
                    onClick={() => setSelectedDate(new Date())}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-50 border border-brand-200 text-brand-600 rounded-btn text-xs font-bold hover:bg-brand-100 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-700"
                >
                    <CalendarDays className="w-3.5 h-3.5" /> Today
                </button>
            )}
            <button
                onClick={handleCopyLastWeek}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-50 border border-brand-200 text-brand-600 rounded-btn text-xs font-bold hover:bg-brand-100 hover:text-brand-900 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-700 dark:hover:text-brand-50"
            >
                <Copy className="w-3.5 h-3.5" /> Copy last week
            </button>
            <button
                onClick={handleShopForWeek}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent-50 text-accent-700 border border-accent-200 rounded-btn text-xs font-bold hover:bg-accent-100 transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95 dark:bg-accent-900/30 dark:text-accent-200 dark:border-accent-700 dark:hover:bg-accent-900/50"
            >
                <ShoppingCart className="w-3.5 h-3.5" /> Shop week
            </button>
        </div>
      </div>

      {/* Selected day agenda */}
      <div className="space-y-3">
        <div className="flex items-end justify-between px-1">
            <div>
                <h3 className="font-display text-xl font-semibold text-brand-900 dark:text-brand-50 tracking-tight leading-none">
                    {format(selectedDate, 'EEEE')}
                </h3>
                <p className="text-sm text-brand-500 dark:text-brand-400 font-medium mt-1">
                    {format(selectedDate, 'MMMM d')}
                    {selectedDateStr === todayStr && <span className="text-accent-600 dark:text-accent-300 font-bold"> · Today</span>}
                </p>
            </div>
            <button
                onClick={() => handleAddMealToDate(selectedDate)}
                className="flex items-center gap-1.5 text-sm font-bold text-white bg-accent-600 hover:bg-accent-700 px-4 py-2 rounded-full transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95"
            >
                <Plus className="w-4 h-4" /> Add meal
            </button>
        </div>

        {dayMeals.length > 0 ? (
            <div className="space-y-2.5">
                {dayMeals.map((planItem) => {
                    const linkedMeal = planItem.mealId ? mealsById.get(planItem.mealId) : null;
                    const mealName = planItem.mealName || linkedMeal?.name || 'Untitled meal';
                    const isCooked = planItem.isCooked;
                    const typeMeta = MEAL_TYPE_META[planItem.type] ?? MEAL_TYPE_META['dinner']!; // 'dinner' is a known key

                    return (
                        <div
                            key={planItem.id}
                            onClick={() => { if (linkedMeal) setViewingMeal({ meal: linkedMeal, planItem }); }}
                            className={clsx(
                                "group flex items-stretch gap-3 rounded-card border p-3.5 transition-colors duration-(--duration-fast) ease-(--ease-standard) relative",
                                linkedMeal && "cursor-pointer hover:border-brand-300 dark:hover:border-brand-600",
                                isCooked
                                    ? "bg-money-bgPos border-money-pos/30 dark:bg-money-pos/10 dark:border-money-pos/20"
                                    : "bg-white border-brand-200 dark:bg-brand-800 dark:border-brand-700"
                            )}
                        >
                            {/* Meal-type accent bar */}
                            <span className={clsx("w-1 rounded-full shrink-0", isCooked ? "bg-money-pos" : typeMeta.dot)} aria-hidden="true" />

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className={clsx(
                                        "inline-flex items-center px-2 py-0.5 rounded-md text-xxs font-bold uppercase tracking-wider border capitalize",
                                        typeMeta.badge
                                    )}>
                                        {planItem.type || 'dinner'}
                                    </span>
                                    {isCooked && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-money-bgPos text-money-pos text-xxs font-bold border border-money-pos/30 dark:bg-money-pos/15 dark:text-money-pos dark:border-money-pos/25">
                                            <CheckCircle2 size={10} /> Cooked
                                        </span>
                                    )}
                                </div>
                                <div className={clsx("font-semibold tracking-tight leading-snug line-clamp-2", isCooked ? "text-money-pos dark:text-money-pos" : "text-brand-900 dark:text-brand-50")}>
                                    {mealName}
                                </div>

                                {linkedMeal?.description && (
                                    <div className="text-xs text-brand-500 dark:text-brand-400 mt-0.5 line-clamp-1 leading-relaxed">{linkedMeal.description}</div>
                                )}

                                {linkedMeal?.ingredients && linkedMeal.ingredients.length > 0 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenIngredientSelector(mealName, linkedMeal.ingredients, linkedMeal.id);
                                        }}
                                        className="mt-2 text-xxs font-bold text-accent-600 inline-flex items-center gap-1 hover:text-accent-700 transition-colors dark:text-accent-300 dark:hover:text-accent-200"
                                    >
                                        <ShoppingCart className="w-3 h-3" /> Shop ingredients
                                    </button>
                                )}
                            </div>

                            {/* Single overflow action button (replaces 4 inline buttons) */}
                            <button
                                onClick={(e) => { e.stopPropagation(); setActionSheetItem(planItem); }}
                                className="self-start -mr-1 -mt-0.5 p-2 text-brand-400 hover:text-brand-700 hover:bg-brand-100 rounded-btn transition-colors active:scale-95 shrink-0 dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
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
                className="w-full border-2 border-dashed border-brand-200 rounded-card py-10 px-4 flex flex-col items-center gap-2 text-center hover:border-accent-300 hover:bg-accent-50 transition-colors duration-(--duration-fast) ease-(--ease-standard) group dark:border-brand-700 dark:hover:border-accent-700 dark:hover:bg-accent-900/20"
            >
                <span className="w-12 h-12 rounded-full bg-brand-100 group-hover:bg-accent-100 flex items-center justify-center transition-colors dark:bg-brand-700 dark:group-hover:bg-accent-900/40">
                    <Utensils className="w-5 h-5 text-brand-400 group-hover:text-accent-600 transition-colors dark:text-brand-400 dark:group-hover:text-accent-300" />
                </span>
                <span className="text-sm font-semibold text-brand-500 group-hover:text-accent-600 dark:text-brand-400 dark:group-hover:text-accent-300">No meals planned</span>
                <span className="text-xs text-brand-400 dark:text-brand-500">Tap to add a meal for this day</span>
            </button>
        )}
      </div>

      {/* Per-meal action sheet */}
      {actionSheetItem && (() => {
        const item = actionSheetItem;
        const hasRecipe = !!(item.mealId && mealsById.get(item.mealId));
        const actionClass = "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left font-semibold transition-colors";
        return (
          <Drawer
            isOpen={!!actionSheetItem}
            onClose={() => setActionSheetItem(null)}
            title={item.mealName || 'Meal'}
          >
            <div className="space-y-1 pb-2">
              {hasRecipe && (
                <button onClick={() => sheetView(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                  <Eye className="w-5 h-5 text-brand-400 dark:text-brand-500" /> View recipe
                </button>
              )}
              <button onClick={() => sheetMoveTomorrow(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <ChevronRight className="w-5 h-5 text-brand-400 dark:text-brand-500" /> Move to tomorrow
              </button>
              <button onClick={() => sheetDuplicate(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <Copy className="w-5 h-5 text-brand-400 dark:text-brand-500" /> Duplicate
              </button>
              <button onClick={() => sheetEdit(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <Edit2 className="w-5 h-5 text-brand-400 dark:text-brand-500" /> Edit
              </button>
              <button onClick={() => sheetDelete(item)} className={clsx(actionClass, "text-money-neg hover:bg-money-bgNeg dark:text-money-neg dark:hover:bg-money-neg/15")}>
                <Trash2 className="w-5 h-5" /> Delete
              </button>
            </div>
          </Drawer>
        );
      })()}

      {/* Weekly Plan Modal (AI generate / import weekly-meals) */}
      <WeeklyPlanModal
        isOpen={isWeeklyPlanOpen}
        onClose={() => setIsWeeklyPlanOpen(false)}
        weekStart={weekStartStr}
      />

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
        onOpenCookbook={handleOpenCookbook}
        onOpenAI={handleOpenAI}
        onOpenImport={handleOpenImport}
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

      {/* Shop Week Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!shopWeekConfirm}
        onClose={() => setShopWeekConfirm(null)}
        onConfirm={handleShopForWeekConfirmed}
        title="Shop for the Week"
        message={`Add ingredients for ${shopWeekConfirm?.mealCount ?? 0} meals to shopping list?`}
        confirmLabel="Add Ingredients"
        confirmVariant="primary"
      />

      {/* Copy Last Week Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!copyWeekConfirm}
        onClose={() => setCopyWeekConfirm(null)}
        onConfirm={handleCopyLastWeekConfirmed}
        title="Copy Last Week"
        message={`Copy ${copyWeekConfirm?.items.length ?? 0} meals from last week to this week?`}
        confirmLabel="Copy Meals"
        confirmVariant="primary"
      />

    </div>
  );
};

export default MealPlanTab;
