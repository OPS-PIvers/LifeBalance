import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useMealPlan, useShopping, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, ChevronRight, ShoppingCart, Copy, CheckCircle2, MoreVertical, MoreHorizontal, CalendarDays, Eye, Utensils } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { normalizeMealName, mergeFormIntoMeal } from '@/utils/migrations/mealDedupMigration';
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
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Sparkles } from 'lucide-react';
import { haptic } from '@/utils/haptics';
import clsx from 'clsx';

// Scrollable date-strip range, in weeks either side of the current week. The
// strip is one continuous run of days (not week pages), so navigation is a
// free horizontal scroll; these bounds just cap how far it extends.
const STRIP_WEEKS_BACK = 8;
const STRIP_WEEKS_FORWARD = 12;

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
    addShoppingItems,
    shoppingList,
    groceryCatalog,
  } = useShopping();
  const { householdId, isLoading } = useHouseholdCore();

  // Calendar State — `selectedDate` is the focused day; the visible week is derived from it.
  const [selectedDate, setSelectedDate] = useState(new Date());

  // The meal-plan listener only keeps the current week ± 1 live; fetch any other
  // week the user navigates to on demand.
  useEffect(() => {
    ensureMealPlanWeek(selectedDate);
  }, [selectedDate, ensureMealPlanWeek]);

  // Per-meal action sheet (replaces the cluttered inline icon buttons)
  const [actionSheetItem, setActionSheetItem] = useState<MealPlanItem | null>(null);

  // Overflow menu for the two lower-frequency week actions (Copy last week /
  // Shop for this week) — keeps the calendar header to nav + day-strip + the
  // primary "Plan my week" action.
  const [isWeekMenuOpen, setIsWeekMenuOpen] = useState(false);

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

      // Base new orders on the max existing order (not list length) — orders are
      // never renumbered on delete, so length can be lower than the highest order.
      const maxOrder = shoppingList.length > 0 ? Math.max(...shoppingList.map(i => i.order || 0)) : 0;

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
                order: maxOrder + 1 + index
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

  // Calendar Logic — `weekStart` still anchors the week-scoped actions (Plan my
  // week, Copy last week, Shop for this week) to the week containing the
  // selected day, even though navigation is now a free-scrolling day strip.
  const weekStart = useMemo(() => startOfWeek(selectedDate, { weekStartsOn: 1 }), [selectedDate]);
  // The full run of days rendered in the scrollable strip. Anchored to the
  // current week and pre-formatted once — the strip render never calls `format`.
  const stripDays = useMemo(() => {
    const rangeStart = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), -7 * STRIP_WEEKS_BACK);
    return Array.from({ length: 7 * (STRIP_WEEKS_BACK + STRIP_WEEKS_FORWARD + 1) }, (_, i) => {
      const date = addDays(rangeStart, i);
      return {
        date,
        dateStr: format(date, 'yyyy-MM-dd'),
        dayLetter: format(date, 'EEEEE'),
        dayNumber: format(date, 'd'),
        ariaLabel: format(date, 'EEEE, MMMM d'),
      };
    });
  }, []);

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

      // Base new orders on the max existing order (not list length) — orders are
      // never renumbered on delete, so length can be lower than the highest order.
      const maxOrder = shoppingList.length > 0 ? Math.max(...shoppingList.map(i => i.order || 0)) : 0;

      // Resolve categories from the grocery catalog (purchase history) like
      // handleConfirmIngredients does, so known items land in their aisle
      // grouping instead of all piling into "Uncategorized".
      const catalogMap = new Map(groceryCatalog.map(item => [normalizeToKey(item.name), item]));

      const itemsToAdd = ingredientsToAdd.map((ing, index) => ({
          name: ing.name,
          category: catalogMap.get(normalizeToKey(ing.name))?.category || 'Uncategorized',
          quantity: ing.quantity || '',
          isPurchased: false,
          // Increment order for each new item to maintain sequence
          order: maxOrder + 1 + index
      }));

      try {
        await addShoppingItems(itemsToAdd);
        toast.success(`Added ${itemsToAdd.length} item${itemsToAdd.length === 1 ? '' : 's'} to shopping list`);
      } catch (error) {
        console.error('Failed to add ingredients:', error);
        toast.error('Failed to add items');
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
          // Duplicate guard: if a recipe with the same name (up to
          // case/spacing/punctuation) already exists, update that recipe
          // instead of creating a copy — non-empty form fields win, existing
          // content is preserved. Skipped for an explicit "Save as New Meal
          // (Copy)", which is an intentional duplicate.
          const existing = forceNew
            ? undefined
            : meals.find(m => normalizeMealName(m.name) === normalizeMealName(currentMeal.name!));
          if (existing) {
              try {
                await updateMeal(mergeFormIntoMeal(existing, currentMeal));
                mealId = existing.id;
                toast(`Matched your existing "${existing.name}" recipe`, { icon: '📖' });
              } catch (_error) {
                toast.error('Failed to save meal');
                return;
              }
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
  const { todayStr, selectedDateStr, weekStartStr } = useMemo(() => ({
    todayStr: format(new Date(), 'yyyy-MM-dd'),
    selectedDateStr: format(selectedDate, 'yyyy-MM-dd'),
    weekStartStr: format(weekStart, 'yyyy-MM-dd'),
  }), [selectedDate, weekStart]);

  // Count meals per day (for the day-strip indicators) — O(N) scan over every
  // loaded plan item, since the scrollable strip is no longer week-confined.
  // Note: the listener only keeps the current week ± 1 (plus fetched weeks)
  // live, so far-off days simply show no dots until they're visited.
  const countByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of mealPlan || []) {
      counts.set(item.date, (counts.get(item.date) || 0) + 1);
    }
    return counts;
  }, [mealPlan]);

  // --- Scrollable strip mechanics -------------------------------------------
  const stripRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  // Center a day chip in the strip; instant on first paint, smooth afterwards.
  const scrollStripTo = useCallback((dateStr: string) => {
    const container = stripRef.current;
    const chip = container?.querySelector<HTMLElement>(`[data-date="${dateStr}"]`);
    if (!container || !chip) return;
    const left = chip.offsetLeft - (container.clientWidth - chip.offsetWidth) / 2;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ left, behavior: didInitialScrollRef.current ? 'smooth' : 'auto' });
    } else {
      // jsdom (tests) has no Element.scrollTo
      container.scrollLeft = left;
    }
    didInitialScrollRef.current = true;
  }, []);

  useEffect(() => {
    scrollStripTo(selectedDateStr);
  }, [selectedDateStr, scrollStripTo]);

  // Month label above the strip follows the center of the viewport as the user
  // scrolls. Reads are batched into one rAF per frame so rapid scroll events
  // don't thrash layout (identical-string setState bails out, so it's cheap).
  const [visibleMonth, setVisibleMonth] = useState(() => format(new Date(), 'MMMM yyyy'));
  const scrollRafRef = useRef(0);
  const handleStripScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const container = stripRef.current;
      if (!container) return;
      const first = container.children[0] as HTMLElement | undefined;
      const second = container.children[1] as HTMLElement | undefined;
      if (!first || !second) return;
      const stride = second.offsetLeft - first.offsetLeft;
      if (stride <= 0) return;
      const rawIdx = Math.round((container.scrollLeft + container.clientWidth / 2 - first.offsetLeft) / stride);
      const day = stripDays[Math.min(stripDays.length - 1, Math.max(0, rawIdx))];
      if (day) setVisibleMonth(format(day.date, 'MMMM yyyy'));
    });
  }, [stripDays]);
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);

  const handleJumpToToday = useCallback(() => {
    const todayDateStr = format(new Date(), 'yyyy-MM-dd');
    if (selectedDateStr !== todayDateStr) setSelectedDate(new Date());
    // Re-center explicitly — when today is already selected the centering
    // effect won't re-run because selectedDateStr is unchanged.
    scrollStripTo(todayDateStr);
  }, [scrollStripTo, selectedDateStr]);

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

  const weekMenuItems: MenuItem[] = [
    {
      key: 'copy-last-week',
      label: 'Copy last week',
      icon: <Copy size={16} />,
      onSelect: handleCopyLastWeek,
    },
    {
      key: 'shop-week',
      label: 'Shop for this week',
      icon: <ShoppingCart size={16} />,
      onSelect: handleShopForWeek,
    },
  ];

  return (
    <div className="space-y-3 pb-20">
      {/* Date selector — leads the page above the day's meals (owner request,
          reversing the earlier agenda-first order). A slim actions row (month
          label + Today / Plan my week / overflow) sits above one continuous
          horizontally scrollable run of day chips, so date selection isn't
          confined to a single week. */}
      <div className="surface-section p-2 pt-1.5 space-y-1">
        <div className="flex items-center justify-between pl-2">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                {visibleMonth}
            </span>
            <div className="flex items-center">
                {/* Today — shown once the selection has left today */}
                {selectedDateStr !== todayStr && (
                    <button
                        onClick={handleJumpToToday}
                        aria-label="Jump to today"
                        title="Today"
                        className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-full transition-colors active:scale-95 dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/50 shrink-0"
                    >
                        <CalendarDays className="w-4 h-4" />
                    </button>
                )}

                <button
                    onClick={() => setIsWeeklyPlanOpen(true)}
                    aria-label="Plan my week"
                    title="Plan my week"
                    className="p-2 text-accent-600 hover:text-accent-700 hover:bg-accent-50 rounded-full transition-colors active:scale-95 dark:text-accent-300 dark:hover:text-accent-200 dark:hover:bg-accent-900/30 shrink-0"
                >
                    <Sparkles className="w-4 h-4" />
                </button>

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setIsWeekMenuOpen(v => !v)}
                        className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-full transition-colors active:scale-95 dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
                        aria-label="More week actions"
                        aria-haspopup="menu"
                        aria-expanded={isWeekMenuOpen}
                    >
                        <MoreHorizontal className="w-4 h-4" />
                    </button>
                    <Menu
                        isOpen={isWeekMenuOpen}
                        onClose={() => setIsWeekMenuOpen(false)}
                        items={weekMenuItems}
                        ariaLabel="Week actions"
                        position="top-full right-0 mt-2"
                        className="min-w-[208px]"
                    />
                </div>
            </div>
        </div>

        {/* Day strip — one continuous scrollable run of days */}
        <div
            ref={stripRef}
            onScroll={handleStripScroll}
            className="relative flex gap-1 overflow-x-auto no-scrollbar snap-x"
        >
            {stripDays.map(day => {
                const { dateStr } = day;
                const count = countByDate.get(dateStr) || 0;
                const isSelected = dateStr === selectedDateStr;
                const isToday = dateStr === todayStr;

                return (
                    <button
                        key={dateStr}
                        data-date={dateStr}
                        onClick={() => setSelectedDate(day.date)}
                        aria-label={`${day.ariaLabel}${count > 0 ? `, ${count} meals planned` : ''}`}
                        aria-pressed={isSelected}
                        className={clsx(
                            "w-12 shrink-0 snap-center flex flex-col items-center gap-0.5 py-1.5 rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard) active:scale-95",
                            isSelected
                                ? "bg-accent-600"
                                : "hover:bg-brand-100 dark:hover:bg-brand-700/50"
                        )}
                    >
                        <span className={clsx(
                            "text-xxs font-bold uppercase tracking-wide",
                            isSelected ? "text-white/80" : "text-brand-400 dark:text-brand-450"
                        )}>
                            {day.dayLetter}
                        </span>
                        <span className={clsx(
                            "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold tabular-nums transition-colors",
                            isSelected
                                ? "text-white"
                                : isToday
                                    ? "bg-accent-100 text-accent-700 ring-1 ring-accent-300 dark:bg-accent-900/40 dark:text-accent-200 dark:ring-accent-700"
                                    : "text-brand-700 dark:text-brand-300"
                        )}>
                            {day.dayNumber}
                        </span>
                        <span className="flex items-center justify-center gap-0.5 h-1">
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
            <Button
                variant="primary"
                size="sm"
                onClick={() => handleAddMealToDate(selectedDate)}
                leftIcon={<Plus className="w-4 h-4" />}
            >
                Add meal
            </Button>
        </div>

        {isLoading ? (
            <div className="space-y-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-[88px] w-full rounded-card" />
                ))}
            </div>
        ) : dayMeals.length > 0 ? (
            <SurfaceList>
                {dayMeals.map((planItem) => {
                    const linkedMeal = planItem.mealId ? mealsById.get(planItem.mealId) : null;
                    const mealName = planItem.mealName || linkedMeal?.name || 'Untitled meal';
                    const isCooked = planItem.isCooked;
                    const typeMeta = MEAL_TYPE_META[planItem.type] ?? MEAL_TYPE_META['dinner']!; // 'dinner' is a known key

                    return (
                        <Row
                            key={planItem.id}
                            interactive={!!linkedMeal}
                            onClick={() => { if (linkedMeal) setViewingMeal({ meal: linkedMeal, planItem }); }}
                            className={clsx(
                                "group items-stretch",
                                isCooked && "bg-money-bgPos/60 dark:bg-money-pos/10",
                                // Keep the green "Cooked" cue visible on hover — Row's
                                // generic hover:bg-brand-50 would otherwise wash it out.
                                isCooked && linkedMeal && "hover:bg-money-bgPos/80 dark:hover:bg-money-pos/15"
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
                                        <Badge variant="success" size="sm" className="gap-1">
                                            <CheckCircle2 size={10} /> Cooked
                                        </Badge>
                                    )}
                                </div>
                                <div className={clsx("font-semibold tracking-tight leading-snug line-clamp-2", isCooked ? "text-money-pos dark:text-money-posDark" : "text-brand-900 dark:text-brand-50")}>
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
                                className="self-start -mr-1 -mt-0.5 p-2 text-brand-400 hover:text-brand-700 hover:bg-brand-100 rounded-btn transition-colors active:scale-95 shrink-0 dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
                                aria-label={`Actions for ${mealName}`}
                            >
                                <MoreVertical className="w-5 h-5" />
                            </button>
                        </Row>
                    );
                })}
            </SurfaceList>
        ) : (
            <EmptyState
                variant="dashed"
                size="compact"
                icon={<Utensils className="w-7 h-7" />}
                title="No meals planned"
                description="Nothing planned for this day yet."
                action={
                    <Button
                        variant="primary"
                        leftIcon={<Plus className="w-4 h-4" />}
                        onClick={() => handleAddMealToDate(selectedDate)}
                    >
                        Add meal
                    </Button>
                }
            />
        )}
      </div>

      {/* Per-meal action sheet */}
      {actionSheetItem && (() => {
        const item = actionSheetItem;
        const hasRecipe = !!(item.mealId && mealsById.get(item.mealId));
        const actionClass = "w-full flex items-center gap-3 px-4 py-3.5 rounded-btn text-left font-semibold transition-colors";
        return (
          <Drawer
            isOpen={!!actionSheetItem}
            onClose={() => setActionSheetItem(null)}
            title={item.mealName || 'Meal'}
          >
            <div className="space-y-1 pb-2">
              {hasRecipe && (
                <button onClick={() => sheetView(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                  <Eye className="w-5 h-5 text-brand-400 dark:text-brand-450" /> View recipe
                </button>
              )}
              <button onClick={() => sheetMoveTomorrow(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <ChevronRight className="w-5 h-5 text-brand-400 dark:text-brand-450" /> Move to tomorrow
              </button>
              <button onClick={() => sheetDuplicate(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <Copy className="w-5 h-5 text-brand-400 dark:text-brand-450" /> Duplicate
              </button>
              <button onClick={() => sheetEdit(item)} className={clsx(actionClass, "text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-700/50")}>
                <Edit2 className="w-5 h-5 text-brand-400 dark:text-brand-450" /> Edit
              </button>
              <button onClick={() => sheetDelete(item)} className={clsx(actionClass, "text-money-neg hover:bg-money-bgNeg dark:text-money-negDark dark:hover:bg-money-neg/15")}>
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
