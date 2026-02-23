import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, Sparkles, ChefHat, ChevronRight, ChevronLeft, ShoppingCart, Loader2, X, Copy, MoreVertical } from 'lucide-react';
import { normalizeToKey } from '@/utils/stringNormalizer';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { IngredientSelectorModal } from './IngredientSelectorModal';
import { CookbookModal } from './CookbookModal';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';

const COMMON_TAGS = ['Quick', 'Healthy', 'Vegetarian', 'Gluten-Free', 'High Protein', 'Family Favorite'];

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

  // Mobile Action Drawer State
  const [actionDrawerItem, setActionDrawerItem] = useState<{ planItem: MealPlanItem, linkedMeal: Meal | undefined } | null>(null);

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
      setIngredientName('');
      setIngredientQty('');
      setTagInput('');
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
      <div className="space-y-4">
        {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const planItems = mealPlan ? mealPlan.filter((i: MealPlanItem) => i.date === dateStr) : [];
            const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

            return (
                <div
                    key={dateStr}
                    className={`bg-white/80 backdrop-blur-xl rounded-2xl shadow-glass p-6 ring-1 transition-all ${isToday ? 'ring-brand-200 bg-brand-50/30' : 'ring-black/5'}`}
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

                                return (
                                    <div key={planItem.id} className="group bg-white/60 border border-slate-200/60 rounded-xl p-4 shadow-sm hover:shadow-md hover:bg-white transition-all flex justify-between items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold uppercase tracking-wider bg-brand-50 text-brand-600 border border-brand-100">
                                                    {planItem.type || 'dinner'}
                                                </span>
                                            </div>
                                            <div className="font-semibold text-slate-900 truncate pr-2 tracking-tight">{mealName}</div>

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

                                        <div className="flex sm:flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity items-center sm:items-end">
                                            {/* Desktop: Inline Buttons */}
                                            <div className="hidden sm:flex flex-col gap-1">
                                                <button
                                                    onClick={() => handleEditMealPlanItem(planItem, linkedMeal ?? undefined)}
                                                    className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors active:scale-95"
                                                    aria-label={`Edit ${mealName}`}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => deleteMealPlanItem(planItem.id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                                                    aria-label={`Delete ${mealName}`}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Mobile: Drawer Trigger */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActionDrawerItem({ planItem, linkedMeal: linkedMeal ?? undefined });
                                                }}
                                                className="sm:hidden p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-black/5 active:bg-black/10 transition-colors"
                                                aria-label="Options"
                                            >
                                                <MoreVertical className="w-5 h-5" />
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
      {isAddModalOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
            style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) handleCancel();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
              <div className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-lg max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] flex flex-col overflow-hidden shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200">
                  <div className="px-6 py-4 border-b border-slate-200/50 flex justify-between items-center shrink-0">
                      <h3 id="modal-title" className="text-lg font-bold text-slate-900 tracking-tight">
                          {editingPlanItemId ? 'Edit Meal Plan' : targetDate ? `Plan for ${format(parseISO(targetDate), 'MMM d')}` : 'Add Meal'}
                      </h3>
                      <button
                          onClick={handleCancel}
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                          aria-label="Close modal"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      {/* Top Actions */}
                      <div className="grid grid-cols-2 gap-4">
                          <button
                              onClick={() => setIsPreviousMealsModalOpen(true)}
                              className="flex items-center justify-center gap-2 py-3 px-4 bg-indigo-50/80 text-indigo-700 rounded-xl hover:bg-indigo-100 font-bold text-sm transition-colors border border-indigo-100/50"
                          >
                              <ChefHat className="w-4.5 h-4.5" /> Cookbook
                          </button>
                          <button
                              onClick={() => setIsAIModalOpen(true)}
                              className="flex items-center justify-center gap-2 py-3 px-4 bg-violet-50/80 text-violet-700 rounded-xl hover:bg-violet-100 font-bold text-sm transition-colors border border-violet-100/50"
                          >
                              <Sparkles className="w-4.5 h-4.5" /> AI Suggest
                          </button>
                      </div>

                      {/* Meal Details */}
                      <div className="space-y-5">
                          <div>
                              <label htmlFor="meal-name" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Meal Name</label>
                              <input
                                  id="meal-name"
                                  type="text"
                                  value={currentMeal.name}
                                  onChange={e => setCurrentMeal({...currentMeal, name: e.target.value})}
                                  className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none font-medium text-slate-900"
                                  placeholder="e.g. Adobo Chicken & Rice"
                              />
                          </div>

                          <div role="radiogroup" aria-labelledby="meal-type-label">
                              <label id="meal-type-label" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Meal Type</label>
                              <div className="flex p-1 bg-slate-100/80 rounded-xl">
                                  {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                                      <button
                                          key={type}
                                          role="radio"
                                          aria-checked={mealType === type}
                                          onClick={() => setMealType(type as 'breakfast' | 'lunch' | 'dinner' | 'snack')}
                                          className={`flex-1 py-2 px-1 rounded-lg text-sm font-bold capitalize transition-all ${
                                              mealType === type
                                                  ? 'bg-white text-slate-900 shadow-sm'
                                                  : 'text-slate-500 hover:text-slate-700'
                                          }`}
                                      >
                                          {type}
                                      </button>
                                  ))}
                              </div>
                          </div>

                          <div>
                              <label htmlFor="meal-description" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Description</label>
                              <textarea
                                  id="meal-description"
                                  value={currentMeal.description}
                                  onChange={e => setCurrentMeal({...currentMeal, description: e.target.value})}
                                  className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none text-sm text-slate-700 leading-relaxed"
                                  rows={2}
                                  placeholder="Add notes about preparation..."
                              />
                          </div>

                          {/* Collapsible Sections could go here if content gets too long */}
                          <div>
                              <label htmlFor="meal-instructions" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Instructions</label>
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
                                  className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none text-sm font-mono text-slate-600"
                                  rows={4}
                                  placeholder="Step 1...&#10;Step 2..."
                              />
                          </div>

                          <div>
                              <label htmlFor="meal-url" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Recipe URL</label>
                              <input
                                  id="meal-url"
                                  type="url"
                                  value={currentMeal.recipeUrl || ''}
                                  onChange={e => setCurrentMeal({...currentMeal, recipeUrl: e.target.value})}
                                  className="w-full p-3 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all outline-none text-sm text-blue-600"
                                  placeholder="https://example.com/recipe"
                              />
                          </div>

                          {/* Tags Section */}
                          <div>
                              <label id="tags-label" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Tags</label>

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
                                                      ? 'bg-brand-50 text-brand-700 border-brand-200'
                                                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
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
                                          className="w-full py-1.5 pl-3 pr-8 rounded-full bg-slate-50 border border-slate-200 text-xs focus:border-brand-500 focus:ring-brand-500 outline-none"
                                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                                      />
                                      <button
                                          onClick={handleAddTag}
                                          disabled={!tagInput.trim()}
                                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white shadow-sm rounded-full text-brand-600 disabled:opacity-50 hover:bg-slate-50"
                                          aria-label="Add custom tag"
                                      >
                                          <Plus className="w-3 h-3" />
                                      </button>
                                  </div>
                              </div>
                          </div>

                      {/* Ingredients Section */}
                      <div>
                           <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Ingredients</label>

                           {/* Current Ingredients List */}
                           {currentMeal.ingredients && currentMeal.ingredients.length > 0 && (
                               <div className="mb-4 flex flex-wrap gap-2">
                                   {currentMeal.ingredients.map((ing, idx) => (
                                       <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm shadow-sm">
                                           <span className="font-semibold text-slate-700">{ing.name}</span>
                                           <span className="text-slate-400 text-xs bg-slate-50 px-1.5 py-0.5 rounded">{ing.quantity}</span>
                                           <button
                                               onClick={() => {
                                                   setCurrentMeal(prev => ({
                                                       ...prev,
                                                       ingredients: prev.ingredients?.filter((_, i) => i !== idx)
                                                   }));
                                               }}
                                               className="text-slate-300 hover:text-red-500 ml-1"
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
                               <div className="bg-white/60 p-4 rounded-xl border border-slate-200/60 shadow-sm">
                                    <label htmlFor="ingredient-name" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Add Ingredient</label>
                                    <div className="flex gap-2">
                                        <input
                                            id="ingredient-name"
                                            type="text"
                                            placeholder="Item name"
                                            className="flex-1 rounded-xl border-slate-200 bg-white text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5"
                                            value={ingredientName}
                                            onChange={(e) => setIngredientName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                                        />
                                        <input
                                            aria-label="Ingredient quantity"
                                            type="text"
                                            placeholder="Qty"
                                            className="w-20 rounded-xl border-slate-200 bg-white text-sm focus:border-brand-500 focus:ring-brand-500 outline-none p-2.5"
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
                                    <p className="text-xxs text-slate-400 mt-2 pl-1">
                                        Ingredients will be added to the shopping list when creating a new meal plan.
                                    </p>
                               </div>
                           </div>
                      </div>

                      </div>
                  </div>

                  <div className="p-4 border-t border-slate-200/50 bg-white flex flex-col gap-2 shrink-0">
                      {editingMealId && (
                          <button
                              onClick={() => saveMeal(true)}
                              className="w-full py-2 text-brand-600 font-bold text-sm hover:underline"
                          >
                              Save as New Meal (Copy)
                          </button>
                      )}
                      <div className="flex gap-3 w-full">
                        <button
                            onClick={handleCancel}
                            className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => saveMeal(false)}
                            className="flex-1 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg hover:bg-brand-900 transition-all active:scale-95"
                        >
                            {editingMealId ? 'Update & Save' : 'Save to Plan'}
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Previous Meals Modal (Smart Cookbook) */}
      <CookbookModal
        isOpen={isPreviousMealsModalOpen}
        onClose={() => setIsPreviousMealsModalOpen(false)}
        meals={meals}
        onSelect={handleSelectMeal}
        onClone={handleCloneMeal}
      />

      {/* AI Modal */}
      {isAIModalOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) setIsAIModalOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-modal-title"
          >
              <div className="bg-white/95 backdrop-blur-xl rounded-2xl w-full max-w-sm p-6 shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200">
                  <h3 id="ai-modal-title" className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 tracking-tight">
                      <Sparkles className="text-violet-600 w-6 h-6" /> Chef AI
                  </h3>

                  <div className="space-y-3 mb-8">
                      <label className="flex items-center gap-3 p-3 border border-slate-200/60 rounded-xl cursor-pointer hover:bg-slate-50/50 transition-colors">
                          <input
                              type="checkbox"
                              checked={aiOptions.cheap}
                              onChange={e => setAiOptions({...aiOptions, cheap: e.target.checked})}
                              className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                          />
                          <div>
                              <div className="font-bold text-slate-800">Budget Friendly</div>
                              <div className="text-xs text-slate-500 mt-0.5">Low cost ingredients</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 border border-slate-200/60 rounded-xl cursor-pointer hover:bg-violet-50/30 hover:border-violet-200/50 transition-all">
                          <input
                              type="checkbox"
                              checked={aiOptions.quick}
                              onChange={e => setAiOptions({...aiOptions, quick: e.target.checked})}
                              className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                          />
                          <div>
                              <div className="font-bold text-slate-800">Quick & Easy</div>
                              <div className="text-xs text-slate-500 mt-0.5">Under 30 minutes</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 border border-slate-200/60 rounded-xl cursor-pointer hover:bg-violet-50/30 hover:border-violet-200/50 transition-all">
                          <input
                              type="checkbox"
                              checked={aiOptions.new}
                              onChange={e => setAiOptions({...aiOptions, new: e.target.checked})}
                              className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                          />
                          <div>
                              <div className="font-bold text-slate-800">Try Something New</div>
                              <div className="text-xs text-slate-500 mt-0.5">Avoid recent meals</div>
                          </div>
                      </label>
                  </div>

                  <button
                      onClick={handleAIRequest}
                      disabled={isGeneratingAI}
                      className="w-full py-3.5 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-violet-200 transition-all active:scale-95"
                  >
                      {isGeneratingAI ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                      {isGeneratingAI ? 'Consulting Chef...' : 'Suggest Meal'}
                  </button>

                  <button
                      onClick={() => setIsAIModalOpen(false)}
                      disabled={isGeneratingAI}
                      className="mt-3 w-full py-3 text-slate-500 hover:bg-slate-50 hover:text-slate-700 font-bold rounded-xl transition-colors"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}

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

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionDrawerItem}
        onClose={() => setActionDrawerItem(null)}
        title={actionDrawerItem?.linkedMeal?.name || actionDrawerItem?.planItem.mealName || "Meal Options"}
      >
        <div className="space-y-2">
            <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Edit2 className="text-brand-500" />}
                onClick={() => {
                    if (actionDrawerItem) {
                        handleEditMealPlanItem(actionDrawerItem.planItem, actionDrawerItem.linkedMeal);
                        setActionDrawerItem(null);
                    }
                }}
            >
                Edit Meal
            </Button>
            <div className="h-px bg-gray-100 my-2" />
            <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                     if (actionDrawerItem) {
                        deleteMealPlanItem(actionDrawerItem.planItem.id);
                        setActionDrawerItem(null);
                     }
                }}
            >
                Delete from Plan
            </Button>
        </div>
      </Drawer>
    </div>
  );
};

export default MealPlanTab;
