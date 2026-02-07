/* eslint-disable */
import React, { useState, useEffect, useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Meal, MealPlanItem, MealIngredient } from '@/types/schema';
import { Plus, Trash2, Edit2, Sparkles, ChefHat, ChevronRight, ChevronLeft, ShoppingCart, Loader2, X, Copy, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { normalizeToKey } from '@/utils/stringNormalizer';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { cn } from '@/utils/cn';

const COMMON_TAGS = ['Quick', 'Healthy', 'Vegetarian', 'Gluten-Free', 'High Protein', 'Family Favorite'];

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

  // Mobile Action Drawer State
  const [mobileActionItem, setMobileActionItem] = useState<{ planItem: MealPlanItem, linkedMeal: Meal | undefined } | null>(null);

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
                // TODO: Future improvement: Parse and sum quantities (e.g. "1 cup" + "2 cups")
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
        const itemDate = parseISO(item.date);
        const newDate = addDays(itemDate, 7);
        const newDateStr = format(newDate, 'yyyy-MM-dd');

        // TODO: Check if item already exists at target to prevent duplicates
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
      setCurrentMeal({
          name: linkedMeal?.name || planItem.mealName,
          description: linkedMeal?.description || '',
          ingredients: linkedMeal?.ingredients || [],
          instructions: linkedMeal?.instructions || [],
          recipeUrl: linkedMeal?.recipeUrl || '',
          tags: linkedMeal?.tags || []
      });

      setTargetDate(planItem.date);
      setEditingMealId(planItem.mealId);
      setEditingPlanItemId(planItem.id);
      setMealType(planItem.type || 'dinner');
      setIsAddModalOpen(true);
  };

  const saveMeal = async (forceNew = false) => {
      if (!currentMeal.name) return;

      let mealId = forceNew ? null : editingMealId;

      // 1. Handle Meal Library (Create or Update)
      if (mealId) {
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
      if (!editingPlanItemId && targetDate && currentMeal.ingredients && currentMeal.ingredients.length > 0) {
          await addIngredientsToShoppingList(currentMeal.ingredients);
      }

      handleCancel();
  };

  const handleCloneMeal = (meal: Meal) => {
      setCurrentMeal({
          name: `${meal.name} (Copy)`,
          description: meal.description,
          ingredients: meal.ingredients || [],
          instructions: meal.instructions || [],
          recipeUrl: meal.recipeUrl || '',
          tags: meal.tags || []
      });
      setEditingMealId(null);
      setIsPreviousMealsModalOpen(false);
      setIsAddModalOpen(true);
      toast.success('Cloned! You are editing a new copy.');
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
        setIsAIModalOpen(false);
        setIsAddModalOpen(true);
    } catch (e) {
        toast.error("Failed to generate meal");
    } finally {
        setIsGeneratingAI(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Calendar Header */}
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-glass ring-1 ring-black/5 p-4 flex flex-col items-center gap-4">
        <div className="flex items-center justify-between w-full">
            <button
                onClick={() => setSelectedDate(d => addDays(d, -7))}
                className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
                aria-label="Previous week"
            >
                <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="text-center">
                <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
                </h2>
                <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">Weekly Plan</div>
            </div>
            <button
                onClick={() => setSelectedDate(d => addDays(d, 7))}
                className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors"
                aria-label="Next week"
            >
                <ChevronRight className="w-6 h-6" />
            </button>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
            <button
                onClick={handleCopyLastWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-full text-xs font-bold uppercase tracking-wide hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
            >
                <Copy className="w-3.5 h-3.5" />
                Copy Last Week
            </button>
            <button
                onClick={handleShopForWeek}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white border border-transparent rounded-full text-xs font-bold uppercase tracking-wide hover:bg-slate-800 transition-all shadow-sm shadow-slate-200"
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
                    className={`rounded-2xl p-5 ring-1 transition-all ${
                        isToday
                        ? 'bg-slate-50/80 ring-slate-200 shadow-glass backdrop-blur-sm'
                        : 'bg-white/60 backdrop-blur-sm ring-black/5 shadow-sm'
                    }`}
                >
                    <div className="flex flex-col sm:flex-row gap-4">
                        {/* Date Column */}
                        <div className="min-w-[80px] shrink-0 flex sm:flex-col items-center sm:items-start justify-between sm:justify-start">
                            <div>
                                <div className="text-2xl font-bold tracking-tight text-slate-900 leading-none">{format(day, 'd')}</div>
                                <div className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">{format(day, 'EEEE')}</div>
                            </div>
                            <button
                                onClick={() => handleAddMealToDate(day)}
                                className="sm:mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white hover:bg-slate-50 hover:text-slate-900 px-3 py-1.5 rounded-full transition-colors border border-slate-200/60 shadow-sm"
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
                                    <div key={planItem.id} className="group bg-white/80 backdrop-blur-sm ring-1 ring-black/5 rounded-xl p-3 shadow-sm hover:shadow-glass hover:-translate-y-0.5 transition-all duration-300 flex justify-between items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold uppercase tracking-wider bg-slate-100 text-slate-600 ring-1 ring-black/5">
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
                                                        addIngredientsToShoppingList(linkedMeal.ingredients);
                                                    }}
                                                    className="mt-2 text-xxs font-medium text-slate-500 flex items-center gap-1 hover:text-slate-800 transition-colors"
                                                >
                                                    <ShoppingCart className="w-3 h-3" /> Shop Ingredients
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center">
                                            <div className="hidden sm:flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleEditMealPlanItem(planItem, linkedMeal ?? undefined)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors active:scale-95"
                                                    aria-label={`Edit ${mealName}`}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => deleteMealPlanItem(planItem.id)}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors active:scale-95"
                                                    aria-label={`Delete ${mealName}`}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setMobileActionItem({ planItem, linkedMeal: linkedMeal ?? undefined });
                                                }}
                                                className="sm:hidden p-3 text-slate-400 active:text-slate-700 active:bg-slate-100 rounded-lg"
                                                aria-label="More options"
                                            >
                                                <MoreVertical className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div
                                    onClick={() => handleAddMealToDate(day)}
                                    className="border border-dashed border-slate-200/60 rounded-xl p-4 text-center cursor-pointer hover:border-slate-300 hover:bg-slate-50/50 transition-all group"
                                >
                                    <p className="text-sm text-slate-400 group-hover:text-slate-600 font-medium">No meals planned</p>
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
              <div className="bg-white rounded-2xl w-full max-w-lg max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 ring-1 ring-black/5">
                  <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0 bg-white/50 backdrop-blur-xl">
                      <h3 id="modal-title" className="text-lg font-bold tracking-tight text-slate-900">
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
                              className="flex items-center justify-center gap-2 py-3 px-4 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 font-bold text-sm transition-colors border border-blue-100/50"
                          >
                              <ChefHat className="w-5 h-5" /> Cookbook
                          </button>
                          <button
                              onClick={() => setIsAIModalOpen(true)}
                              className="flex items-center justify-center gap-2 py-3 px-4 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 font-bold text-sm transition-colors border border-purple-100/50"
                          >
                              <Sparkles className="w-5 h-5" /> AI Suggest
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
                                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all outline-none font-medium text-slate-900 placeholder:text-slate-400"
                                  placeholder="e.g. Adobo Chicken & Rice"
                              />
                          </div>

                          <div role="radiogroup" aria-labelledby="meal-type-label">
                              <label id="meal-type-label" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Meal Type</label>
                              <div className="flex p-1 bg-slate-100 rounded-xl">
                                  {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                                      <button
                                          key={type}
                                          role="radio"
                                          aria-checked={mealType === type}
                                          onClick={() => setMealType(type as any)}
                                          className={`flex-1 py-2 px-1 rounded-lg text-sm font-bold capitalize transition-all ${
                                              mealType === type
                                                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5'
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
                                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all outline-none text-sm text-slate-700 placeholder:text-slate-400"
                                  rows={2}
                                  placeholder="Add notes about preparation..."
                              />
                          </div>

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
                                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all outline-none text-sm font-mono text-slate-700 placeholder:text-slate-400"
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
                                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-all outline-none text-sm text-blue-600 placeholder:text-slate-400"
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
                                                      ? 'bg-slate-900 text-white border-transparent shadow-md'
                                                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
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
                                      <span key={tag} className="bg-slate-100 text-slate-700 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 ring-1 ring-black/5">
                                          {tag}
                                          <button onClick={() => handleRemoveTag(tag)} className="hover:text-slate-900 p-0.5 rounded-full hover:bg-slate-200" aria-label={`Remove tag ${tag}`}>
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
                                          className="w-full py-1.5 pl-3 pr-8 rounded-full bg-slate-50 border border-slate-200 text-xs focus:border-slate-500 focus:ring-slate-500 outline-none text-slate-700 placeholder:text-slate-400"
                                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                                      />
                                      <button
                                          onClick={handleAddTag}
                                          disabled={!tagInput.trim()}
                                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-white shadow-sm rounded-full text-slate-600 disabled:opacity-50 hover:bg-slate-50"
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
                               <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <label htmlFor="ingredient-name" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Add Ingredient</label>
                                    <div className="flex gap-2">
                                        <input
                                            id="ingredient-name"
                                            type="text"
                                            placeholder="Item name"
                                            className="flex-1 rounded-xl border-slate-200 bg-slate-50 text-sm focus:border-slate-500 focus:ring-slate-500 outline-none p-2.5 text-slate-900 placeholder:text-slate-400"
                                            value={ingredientName}
                                            onChange={(e) => setIngredientName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                                        />
                                        <input
                                            aria-label="Ingredient quantity"
                                            type="text"
                                            placeholder="Qty"
                                            className="w-20 rounded-xl border-slate-200 bg-slate-50 text-sm focus:border-slate-500 focus:ring-slate-500 outline-none p-2.5 text-slate-900 placeholder:text-slate-400"
                                            value={ingredientQty}
                                            onChange={(e) => setIngredientQty(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIngredient())}
                                        />
                                        <button
                                            onClick={handleAddIngredient}
                                            disabled={!ingredientName.trim()}
                                            className="p-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-900 transition-colors shadow-sm"
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

                  <div className="p-4 border-t border-slate-100 bg-white flex flex-col gap-2 shrink-0">
                      {editingMealId && (
                          <button
                              onClick={() => saveMeal(true)}
                              className="w-full py-2 text-slate-600 font-bold text-sm hover:underline"
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
                            className="flex-1 py-3 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-slate-800 transition-all active:scale-95 shadow-slate-200"
                        >
                            {editingMealId ? 'Update & Save' : 'Save to Plan'}
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Previous Meals Modal */}
      {isPreviousMealsModalOpen && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-modal flex items-center justify-center p-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) setIsPreviousMealsModalOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="previous-meals-title"
          >
               <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[80vh] flex flex-col shadow-2xl ring-1 ring-black/5">
                   <h3 id="previous-meals-title" className="text-xl font-bold text-slate-900 mb-4 tracking-tight">Your Cookbook</h3>
                   <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                       {meals.sort((a,b) => a.name.localeCompare(b.name)).map(meal => (
                           <div key={meal.id} className="flex items-stretch gap-2">
                               <button
                                    onClick={() => {
                                        setCurrentMeal(meal);
                                        setEditingMealId(meal.id);
                                        setIsPreviousMealsModalOpen(false);
                                    }}
                                    className="flex-1 text-left p-4 hover:bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group transition-colors"
                               >
                                   <span className="font-semibold text-slate-700 group-hover:text-slate-900">{meal.name}</span>
                                   <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />
                               </button>
                               <button
                                    onClick={() => handleCloneMeal(meal)}
                                    className="px-4 text-slate-400 hover:text-slate-900 hover:bg-slate-50 border border-slate-100 rounded-xl transition-colors"
                                    title="Clone Meal"
                               >
                                    <Copy className="w-5 h-5" />
                               </button>
                           </div>
                       ))}
                       {meals.length === 0 && <p className="text-slate-500 text-center py-8">No saved meals yet.</p>}
                   </div>
                   <button
                        onClick={() => setIsPreviousMealsModalOpen(false)}
                        className="mt-6 w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                   >
                       Close
                   </button>
               </div>
          </div>
      )}

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
              <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200 ring-1 ring-black/5">
                  <h3 id="ai-modal-title" className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 tracking-tight">
                      <Sparkles className="text-purple-600 w-6 h-6" /> Chef AI
                  </h3>

                  <div className="space-y-3 mb-8">
                      <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                          <input
                              type="checkbox"
                              checked={aiOptions.cheap}
                              onChange={e => setAiOptions({...aiOptions, cheap: e.target.checked})}
                              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-bold text-slate-800">Budget Friendly</div>
                              <div className="text-xs text-slate-500 mt-0.5">Low cost ingredients</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 border border-slate-200 rounded-xl cursor-pointer hover:bg-purple-50 hover:border-purple-200 transition-all">
                          <input
                              type="checkbox"
                              checked={aiOptions.quick}
                              onChange={e => setAiOptions({...aiOptions, quick: e.target.checked})}
                              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                              <div className="font-bold text-slate-800">Quick & Easy</div>
                              <div className="text-xs text-slate-500 mt-0.5">Under 30 minutes</div>
                          </div>
                      </label>

                      <label className="flex items-center gap-3 p-4 border border-slate-200 rounded-xl cursor-pointer hover:bg-purple-50 hover:border-purple-200 transition-all">
                          <input
                              type="checkbox"
                              checked={aiOptions.new}
                              onChange={e => setAiOptions({...aiOptions, new: e.target.checked})}
                              className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500"
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
                      className="w-full py-3.5 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg shadow-purple-200 transition-all active:scale-95"
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

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!mobileActionItem}
        onClose={() => setMobileActionItem(null)}
        title={mobileActionItem?.planItem.mealName || "Meal Options"}
      >
          <div className="space-y-2">
            {mobileActionItem && (
                <>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-lg py-4"
                        leftIcon={<Edit2 className="text-brand-500" />}
                        onClick={() => {
                            handleEditMealPlanItem(mobileActionItem.planItem, mobileActionItem.linkedMeal);
                            setMobileActionItem(null);
                        }}
                    >
                        Edit Meal
                    </Button>
                    <Button
                        variant="ghost-destructive"
                        className="w-full justify-start text-lg py-4"
                        leftIcon={<Trash2 />}
                        onClick={() => {
                            deleteMealPlanItem(mobileActionItem.planItem.id);
                            setMobileActionItem(null);
                        }}
                    >
                        Remove from Plan
                    </Button>
                </>
            )}
          </div>
      </Drawer>
    </div>
  );
};

export default MealPlanTab;
