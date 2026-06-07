import React, { useState, ReactNode, useCallback } from 'react';
import { HouseholdContextType, HouseholdSliceProviders } from './FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  Account,
  BudgetBucket,
  Transaction,
  CalendarItem,
  Habit,
  HabitSubmission,
  Challenge,
  RewardItem,
  HouseholdMember,
  Meal,
  ShoppingItem,
  MealPlanItem,
  ToDo,
  Insight,
  GroceryCatalogItem,
  Store,
  QuickStockList,
  YearlyGoal,
  BucketPeriodSnapshot,
  Household,
  FreezeBank
} from '@/types/schema';
import toast from 'react-hot-toast';

// Helper to generate unique IDs
const generateId = () => `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Seed data with realistic examples
const SEED_ACCOUNTS: Account[] = [
  { id: 'acc1', name: 'Main Checking', type: 'checking', balance: 5420.50, lastUpdated: new Date().toISOString() },
  { id: 'acc2', name: 'Savings Account', type: 'savings', balance: 12000, lastUpdated: new Date().toISOString() },
  { id: 'acc3', name: 'Credit Card', type: 'credit', balance: -850.25, lastUpdated: new Date().toISOString() },
];

const SEED_BUCKETS: BudgetBucket[] = [
  { id: 'b1', name: 'Groceries', limit: 600, color: 'green', isVariable: true, isCore: true },
  { id: 'b2', name: 'Entertainment', limit: 200, color: 'purple', isVariable: true, isCore: false },
  { id: 'b3', name: 'Utilities', limit: 300, color: 'blue', isVariable: false, isCore: true },
  { id: 'b4', name: 'Gas', limit: 150, color: 'orange', isVariable: true, isCore: true },
];

const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx1', amount: 45.50, merchant: 'Safeway', category: 'Groceries',
    date: getLocalDateString(),
    status: 'verified', isRecurring: false, source: 'manual',
    autoCategorized: false, payPeriodId: '2024-01-01'
  },
  {
    id: 'tx2', amount: 120.00, merchant: 'PG&E', category: 'Utilities',
    date: getLocalDateString(),
    status: 'verified', isRecurring: true, source: 'manual',
    autoCategorized: false, payPeriodId: '2024-01-01'
  },
];

const SEED_HABITS: Habit[] = [
  {
    id: 'h1', title: 'Drink 8 Glasses of Water', category: 'Health', type: 'positive',
    basePoints: 10, scoringType: 'threshold', period: 'daily', targetCount: 8,
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
    createdBy: 'test-user-id', lastUpdated: new Date().toISOString(), weatherSensitive: false
  },
  {
    id: 'h2', title: 'Exercise 30min', category: 'Fitness', type: 'positive',
    basePoints: 20, scoringType: 'threshold', period: 'daily', targetCount: 1,
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
    createdBy: 'test-user-id', lastUpdated: new Date().toISOString(), weatherSensitive: false
  },
];

const SEED_MEMBERS: HouseholdMember[] = [
  {
    uid: 'test-user-id', displayName: 'Test User', email: 'test@example.com',
    role: 'admin', points: { daily: 30, weekly: 150, total: 500 }
  }
];

const SEED_STORES: Store[] = [
  { id: 's1', name: 'Safeway', icon: 'Store' },
  { id: 's2', name: 'Costco', icon: 'Store' },
];

const SEED_GROCERY_CATALOG: GroceryCatalogItem[] = [
  { id: 'gc1', name: 'Milk', category: 'Dairy', defaultQuantity: '1', defaultStore: 'Safeway', purchaseCount: 10, lastPurchased: new Date().toISOString() },
  { id: 'gc2', name: 'Eggs', category: 'Dairy', defaultQuantity: '12', defaultStore: 'Costco', purchaseCount: 5, lastPurchased: new Date().toISOString() },
  { id: 'gc3', name: 'Bread', category: 'Bakery', defaultQuantity: '1', defaultStore: 'Safeway', purchaseCount: 8, lastPurchased: new Date().toISOString() },
];

export const MockHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // State management with in-memory persistence
  const [accounts, setAccounts] = useState<Account[]>(SEED_ACCOUNTS);
  const [buckets, setBuckets] = useState<BudgetBucket[]>(SEED_BUCKETS);
  const [transactions, setTransactions] = useState<Transaction[]>(SEED_TRANSACTIONS);
  const [habits, setHabits] = useState<Habit[]>(SEED_HABITS);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [challenges] = useState<Challenge[]>([]);
  const [yearlyGoals] = useState<YearlyGoal[]>([]);
  const [rewards] = useState<RewardItem[]>([]);
  const [members] = useState<HouseholdMember[]>(SEED_MEMBERS);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>(SEED_GROCERY_CATALOG);
  const [bucketHistory] = useState<BucketPeriodSnapshot[]>([]); // Mock empty history
  const [insightsHistory] = useState<Insight[]>([]);
  const [insight] = useState("🧪 Test Mode: This is mock data for AI testing");
  const [stores, setStores] = useState<Store[]>(SEED_STORES);
  const [groceryCategories, setGroceryCategories] = useState<string[]>([]);
  const [quickStockLists, setQuickStockLists] = useState<QuickStockList[]>([]);

  // Account operations
  const addAccount = useCallback(async (account: Omit<Account, 'id'>) => {
    const newAccount = { ...account, id: generateId() } as Account;
    setAccounts(prev => [...prev, newAccount]);
    toast.success('Mock: Account added');
  }, []);

  const deleteAccount = useCallback(async (id: string) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
    toast.success('Mock: Account deleted');
  }, []);

  const updateAccountBalance = useCallback(async (id: string, newBalance: number) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, balance: newBalance, lastUpdated: new Date().toISOString() } : a));
    toast.success('Mock: Balance updated');
  }, []);

  // Bucket operations
  const addBucket = useCallback(async (bucket: Omit<BudgetBucket, 'id'>) => {
    const newBucket = { ...bucket, id: generateId() } as BudgetBucket;
    setBuckets(prev => [...prev, newBucket]);
    toast.success('Mock: Bucket added');
  }, []);

  const updateBucket = useCallback(async (bucket: BudgetBucket) => {
    setBuckets(prev => prev.map(b => b.id === bucket.id ? bucket : b));
    toast.success('Mock: Bucket updated');
  }, []);

  const deleteBucket = useCallback(async (id: string) => {
    setBuckets(prev => prev.filter(b => b.id !== id));
    toast.success('Mock: Bucket deleted');
  }, []);

  // Transaction operations
  const addTransaction = useCallback(async (tx: Omit<Transaction, 'id'>) => {
    const newTx = { ...tx, id: generateId() } as Transaction;
    setTransactions(prev => [...prev, newTx]);
    toast.success('Mock: Transaction added');
  }, []);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    toast.success('Mock: Transaction updated');
  }, []);

  const deleteTransaction = useCallback(async (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    toast.success('Mock: Transaction deleted');
  }, []);

  const splitTransaction = useCallback(async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    setTransactions(prev => {
      // Filter out original transaction
      const filtered = prev.filter(t => t.id !== originalTransactionId);

      // Create full Transaction objects for new splits
      const newTxs = newTransactions.map(t => ({
        ...t,
        id: generateId(),
        createdAt: new Date().toISOString(),
        payPeriodId: '2024-01-01', // Mock pay period
        createdBy: 'test-user-id',
      } as Transaction));

      return [...filtered, ...newTxs];
    });
    toast.success('Mock: Transaction split');
  }, []);

  // Habit operations
  const addHabit = useCallback(async (habit: Omit<Habit, 'id'>) => {
    const id = generateId();
    const newHabit = { ...habit, id } as Habit;
    setHabits(prev => [...prev, newHabit]);
    toast.success('Mock: Habit added');
    return id;
  }, []);

  const updateHabit = useCallback(async (habit: Habit) => {
    setHabits(prev => prev.map(h => h.id === habit.id ? habit : h));
    toast.success('Mock: Habit updated');
  }, []);

  const deleteHabit = useCallback(async (id: string) => {
    setHabits(prev => prev.filter(h => h.id !== id));
    toast.success('Mock: Habit deleted');
  }, []);

  const reorderHabits = useCallback(async (updates: { id: string; order: number; category?: string }[]) => {
    setHabits(prev => prev.map(h => {
      const update = updates.find(u => u.id === h.id);
      if (update) {
        return { ...h, order: update.order, category: update.category || h.category };
      }
      return h;
    }));
    toast.success('Mock: Habits reordered');
  }, []);

  const toggleHabit = useCallback(async (id: string, direction: 'up' | 'down') => {
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const change = direction === 'up' ? 1 : -1;
      return { ...h, count: Math.max(0, h.count + change), totalCount: Math.max(0, h.totalCount + change) };
    }));
    toast.success(`Mock: Habit ${direction === 'up' ? 'incremented' : 'decremented'}`);
  }, []);

  // Calendar operations
  const addCalendarItem = useCallback(async (item: Omit<CalendarItem, 'id'>) => {
    const newItem = { ...item, id: generateId() } as CalendarItem;
    setCalendarItems(prev => [...prev, newItem]);
    toast.success('Mock: Calendar item added');
  }, []);

  const updateCalendarItem = useCallback(async (item: CalendarItem) => {
    setCalendarItems(prev => prev.map(i => i.id === item.id ? item : i));
    toast.success('Mock: Calendar item updated');
  }, []);

  const deleteCalendarItem = useCallback(async (id: string) => {
    setCalendarItems(prev => prev.filter(i => i.id !== id));
    toast.success('Mock: Calendar item deleted');
  }, []);

  // Meal operations
  const addMeal = useCallback(async (meal: Omit<Meal, 'id'>) => {
    const id = generateId();
    const newMeal = { ...meal, id } as Meal;
    setMeals(prev => [...prev, newMeal]);
    toast.success('Mock: Meal added');
    return id;
  }, []);

  const updateMeal = useCallback(async (meal: Meal) => {
    setMeals(prev => prev.map(m => m.id === meal.id ? meal : m));
    toast.success('Mock: Meal updated');
  }, []);

  const deleteMeal = useCallback(async (id: string) => {
    setMeals(prev => prev.filter(m => m.id !== id));
    toast.success('Mock: Meal deleted');
  }, []);

  // Shopping list operations
  const addShoppingItem = useCallback(async (item: Omit<ShoppingItem, 'id'>) => {
    const newItem = { ...item, id: generateId() } as ShoppingItem;
    setShoppingList(prev => [...prev, newItem]);
    toast.success('Mock: Shopping item added');
  }, []);

  const addShoppingItems = useCallback(async (items: Omit<ShoppingItem, 'id'>[]) => {
    const newItems = items.map(item => ({ ...item, id: generateId() } as ShoppingItem));
    setShoppingList(prev => [...prev, ...newItems]);
    toast.success('Mock: Shopping items added');
  }, []);

  const updateShoppingItem = useCallback(async (item: ShoppingItem) => {
    setShoppingList(prev => prev.map(s => s.id === item.id ? item : s));
    toast.success('Mock: Shopping item updated');
  }, []);

  const reorderShoppingItems = useCallback(async (items: ShoppingItem[]) => {
    setShoppingList(items);
    toast.success('Mock: Shopping items reordered');
  }, []);

  const deleteShoppingItem = useCallback(async (id: string) => {
    setShoppingList(prev => prev.filter(s => s.id !== id));
    toast.success('Mock: Shopping item deleted');
  }, []);

  // Meal plan operations
  const addMealPlan = useCallback(async (plan: Omit<MealPlanItem, 'id'>) => {
    const newPlan = { ...plan, id: generateId() } as MealPlanItem;
    setMealPlan(prev => [...prev, newPlan]);
    toast.success('Mock: Meal plan added');
  }, []);

  const updateMealPlan = useCallback(async (id: string, updates: Partial<MealPlanItem>) => {
    setMealPlan(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    toast.success('Mock: Meal updated');
  }, []);

  const deleteMealPlan = useCallback(async (id: string) => {
    setMealPlan(prev => prev.filter(p => p.id !== id));
    toast.success('Mock: Meal plan deleted');
  }, []);

  // ToDo operations
  const addToDo = useCallback(async (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => {
    const newTodo = {
      ...todo,
      id: generateId(),
      createdAt: new Date().toISOString(),
      createdBy: 'test-user-id'
    } as ToDo;
    setTodos(prev => [...prev, newTodo]);
    toast.success('Mock: ToDo added');
  }, []);

  const updateToDo = useCallback(async (id: string, updates: Partial<ToDo>) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    toast.success('Mock: ToDo updated');
  }, []);

  const deleteToDo = useCallback(async (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
    toast.success('Mock: ToDo deleted');
  }, []);

  // Store operations
  const addStore = useCallback(async (store: Omit<Store, 'id'>) => {
    const newStore = { ...store, id: generateId() } as Store;
    setStores(prev => [...prev, newStore]);
    toast.success('Mock: Store added');
  }, []);

  const updateStore = useCallback(async (store: Store) => {
    setStores(prev => prev.map(s => s.id === store.id ? store : s));
    toast.success('Mock: Store updated');
  }, []);

  const deleteStore = useCallback(async (id: string) => {
    setStores(prev => prev.filter(s => s.id !== id));
    // Also remove store tags from shopping items
    setShoppingList(prev => prev.map(item => item.store === id ? { ...item, store: undefined } : item));
    toast.success('Mock: Store deleted');
  }, []);

  // Grocery categories
  const updateGroceryCategories = useCallback(async (categories: string[]) => {
    setGroceryCategories(categories);
    toast.success('Mock: Categories updated');
  }, []);

  // Quick Stock Lists
  const addQuickStockList = useCallback(async (list: Omit<QuickStockList, 'id'>) => {
    const newList = { ...list, id: generateId() } as QuickStockList;
    setQuickStockLists(prev => [...prev, newList]);
    toast.success('Mock: Template created');
  }, []);

  const updateQuickStockList = useCallback(async (list: QuickStockList) => {
    setQuickStockLists(prev => prev.map(l => l.id === list.id ? list : l));
    toast.success('Mock: Template updated');
  }, []);

  const deleteQuickStockList = useCallback(async (id: string) => {
    setQuickStockLists(prev => prev.filter(l => l.id !== id));
    toast.success('Mock: Template deleted');
  }, []);

  const addGroceryCatalogItem = useCallback(async (item: Omit<GroceryCatalogItem, 'id'>): Promise<string> => {
    const id = generateId();
    const newItem = { ...item, id } as GroceryCatalogItem;
    setGroceryCatalog(prev => [...prev, newItem]);
    toast.success('Mock: Item added to history');
    return id;
  }, []);

  // No-op functions for features not critical to testing

  const noOp = useCallback(async <T,>(..._args: unknown[]): Promise<T | void> => {
    // toast.info doesn't exist, use toast with custom styling instead
    toast('Mock: Operation not implemented in test mode', {
      icon: 'ℹ️',
      duration: 2000
    });
  }, []);

  // Special no-op that returns empty array (for getHabitSubmissions)

  const getHabitSubmissions = useCallback(async (_habitId: string, _startDate?: string, _endDate?: string): Promise<HabitSubmission[]> => {
    return [];
  }, []);

  // Computed/derived state to match interface
  const safeToSpend = 4000; // Mock value
  const dailyPoints = 30;
  const weeklyPoints = 150;
  const totalPoints = 500;
  const currentUser = members[0] || null;
  const activeChallenge = challenges[0] || null;
  const activeYearlyGoals: YearlyGoal[] = [];
  const primaryYearlyGoal: YearlyGoal | null = null;
  const rewardsInventory = rewards;
  const freezeBank: FreezeBank | null = null;
  const isGeneratingInsight = false;
  const householdSettings = {
    id: 'test-household-id',
    name: 'Test Household',
    inviteCode: 'TEST-1234',
    members: members,
    freezeBank: { tokens: 3, maxTokens: 3, lastRolloverDate: '2024-01-01', lastRolloverMonth: '2024-01', history: [] },
    accounts: accounts,
    rewardsInventory: rewards,
    coreTemplates: { expenses: [], buckets: [] },
    stores: stores,
    groceryCategories: groceryCategories

  } as unknown as Household;
  const currentPeriodId = '2024-01-01';
  const bucketSpentMap = new Map();

  const contextValue: HouseholdContextType = {
    // Mock data is available synchronously — never in a loading state.
    isLoading: false,
    // Computed State
    safeToSpend,
    dailyPoints,
    weeklyPoints,
    totalPoints,
    currentUser,
    activeChallenge,
    activeYearlyGoals,
    primaryYearlyGoal,
    rewardsInventory,
    freezeBank,
    isGeneratingInsight,
    householdId: 'test-household-id',
    currentPeriodId,
    bucketSpentMap,
    householdSettings,
    household: householdSettings,

    // Data
    accounts,
    buckets,
    transactions,
    calendarItems,
    habits,
    challenges,
    yearlyGoals,
    members,
    meals,
    shoppingList,
    mealPlan,
    todos,
    groceryCatalog,
    bucketHistory,
    insightsHistory,
    insight,
    stores,
    groceryCategories,
    quickStockLists,
    apiKeys: [], // iOS Shortcuts - empty in test mode
    pendingItemsCount: 0, // Voice commands - always 0 in test mode

    // Listener windowing / pagination — Test Mode keeps everything in memory,
    // so there is never anything "older" to load. The helpers are no-ops and the
    // flags report a fully-loaded state so the UI affordances stay hidden.
    transactionWindowStart: null,
    isLoadingOlderTransactions: false,
    hasMoreTransactions: false,
    loadOlderTransactions: async () => {},
    loadAllTransactions: async () => transactions,
    isLoadingOlderBucketHistory: false,
    hasMoreBucketHistory: false,
    loadAllBucketHistory: async () => {},
    hasMoreInsights: false,
    loadAllInsights: async () => {},
    isLoadingOlderTodos: false,
    hasMoreCompletedTodos: false,
    loadOlderCompletedTodos: async () => {},
    ensureMealPlanWeek: async () => {},

    // Operations
    addAccount,
    deleteAccount,
    updateAccountBalance,
    setAccountGoal: noOp,
    updateAccountOrder: noOp,
    reorderAccounts: noOp,
    addBucket,
    updateBucket,
    deleteBucket,
    updateBucketLimit: noOp,
    reallocateBucket: noOp,
    addTransaction,
    updateTransaction,
    updateTransactionCategory: noOp,
    deleteTransaction,
    splitTransaction,
    addCalendarItem,
    updateCalendarItem,
    deleteCalendarItem,
    payCalendarItem: noOp,
    deferCalendarItem: noOp,
    addHabit,
    updateHabit,
    deleteHabit,
    reorderHabits,
    toggleHabit,
    resetHabit: noOp,
    addHabitSubmission: noOp,
    updateHabitSubmission: noOp,
    deleteHabitSubmission: noOp,
    getHabitSubmissions,
    addMeal,
    updateMeal,
    deleteMeal,
    addShoppingItem,
    addShoppingItems,
    updateShoppingItem,
    reorderShoppingItems,
    deleteShoppingItem,
    toggleShoppingItemPurchased: noOp,
    clearPurchasedShoppingItems: noOp,
    addMealPlanItem: addMealPlan,
    updateMealPlanItem: updateMealPlan,
    deleteMealPlanItem: deleteMealPlan,
    addToDo,
    updateToDo,
    deleteToDo,
    completeToDo: useCallback(async (id: string) => {
      setTodos(prev => prev.map(t => t.id === id ? { ...t, isCompleted: true, completedAt: new Date().toISOString() } : t));
      toast.success('Mock: ToDo completed');
    }, []),
    addStore,
    updateStore,
    deleteStore,
    updateGroceryCategories,
    addQuickStockList,
    updateQuickStockList,
    deleteQuickStockList,
    addGroceryCatalogItem,
    updateGroceryCatalogItem: noOp,
    deleteGroceryCatalogItem: noOp,
    updateChallenge: noOp,
    markChallengeComplete: noOp,
    redeemReward: noOp,
    refreshInsight: noOp,
    createYearlyGoal: noOp,
    updateYearlyGoal: noOp,
    updateYearlyGoalProgress: noOp,
    deleteYearlyGoal: noOp,
    useFreezeBankToken: noOp,
    rolloverFreezeBankTokens: noOp,
    addMember: noOp,
    updateMember: noOp,
    removeMember: noOp,
  };

  // Test Mode does not need render isolation, so every slice receives the same
  // composed value object. `HouseholdContextType` satisfies each slice type, so
  // the granular hooks (`useFinance`, `useMeals`, …) and the `useHousehold`
  // shim all resolve against this mock data identically to production.
  return (
    <HouseholdSliceProviders
      finance={contextValue}
      gamification={contextValue}
      meals={contextValue}
      todos={contextValue}
      core={contextValue}
    >
      {children}
    </HouseholdSliceProviders>
  );
};
