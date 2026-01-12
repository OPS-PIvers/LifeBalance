import React, { useState, ReactNode, useCallback } from 'react';
import { FirebaseHouseholdContext, HouseholdContextType } from './FirebaseHouseholdContext';
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
  PantryItem,
  Meal,
  ShoppingItem,
  MealPlanItem,
  ToDo,
  Insight,
  GroceryCatalogItem,
  Store
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
    date: new Date().toISOString().split('T')[0],
    status: 'verified', isRecurring: false, source: 'manual',
    autoCategorized: false, payPeriodId: '2024-01-01'
  },
  {
    id: 'tx2', amount: 120.00, merchant: 'PG&E', category: 'Utilities',
    date: new Date().toISOString().split('T')[0],
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

const SEED_PANTRY: PantryItem[] = [
  { id: 'p1', name: 'Milk', quantity: '1 gallon', category: 'Dairy', expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
  { id: 'p2', name: 'Eggs', quantity: '12 count', category: 'Protein' },
];

export const MockHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // State management with in-memory persistence
  const [accounts, setAccounts] = useState<Account[]>(SEED_ACCOUNTS);
  const [buckets, setBuckets] = useState<BudgetBucket[]>(SEED_BUCKETS);
  const [transactions, setTransactions] = useState<Transaction[]>(SEED_TRANSACTIONS);
  const [habits, setHabits] = useState<Habit[]>(SEED_HABITS);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [challenges] = useState<Challenge[]>([]);
  const [yearlyGoals] = useState<any[]>([]);
  const [rewards] = useState<RewardItem[]>([]);
  const [members] = useState<HouseholdMember[]>(SEED_MEMBERS);
  const [pantry, setPantry] = useState<PantryItem[]>(SEED_PANTRY);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [groceryCatalog] = useState<GroceryCatalogItem[]>([]);
  const [insightsHistory] = useState<Insight[]>([]);
  const [insight] = useState("🧪 Test Mode: This is mock data for AI testing");
  const [stores, setStores] = useState<Store[]>(SEED_STORES);
  const [groceryCategories, setGroceryCategories] = useState<string[]>([]);

  // Account operations
  const addAccount = useCallback(async (account: Omit<Account, 'id'>) => {
    const newAccount = { ...account, id: generateId() } as Account;
    setAccounts(prev => [...prev, newAccount]);
    toast.success('Mock: Account added');
  }, []);

  const updateAccount = useCallback(async (account: Account) => {
    setAccounts(prev => prev.map(a => a.id === account.id ? account : a));
    toast.success('Mock: Account updated');
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

  // Habit operations
  const addHabit = useCallback(async (habit: Omit<Habit, 'id'>) => {
    const newHabit = { ...habit, id: generateId() } as Habit;
    setHabits(prev => [...prev, newHabit]);
    toast.success('Mock: Habit added');
  }, []);

  const updateHabit = useCallback(async (habit: Habit) => {
    setHabits(prev => prev.map(h => h.id === habit.id ? habit : h));
    toast.success('Mock: Habit updated');
  }, []);

  const deleteHabit = useCallback(async (id: string) => {
    setHabits(prev => prev.filter(h => h.id !== id));
    toast.success('Mock: Habit deleted');
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

  // Pantry operations
  const addPantryItem = useCallback(async (item: Omit<PantryItem, 'id' | 'addedAt' | 'addedBy'>) => {
    const newItem = { ...item, id: generateId(), addedAt: new Date().toISOString(), addedBy: 'test-user-id' } as PantryItem;
    setPantry(prev => [...prev, newItem]);
    toast.success('Mock: Pantry item added');
  }, []);

  const updatePantryItem = useCallback(async (item: PantryItem) => {
    setPantry(prev => prev.map(p => p.id === item.id ? item : p));
    toast.success('Mock: Pantry item updated');
  }, []);

  const deletePantryItem = useCallback(async (id: string) => {
    setPantry(prev => prev.filter(p => p.id !== id));
    toast.success('Mock: Pantry item deleted');
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

  const updateShoppingItem = useCallback(async (item: ShoppingItem) => {
    setShoppingList(prev => prev.map(s => s.id === item.id ? item : s));
    toast.success('Mock: Shopping item updated');
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

  // No-op functions for features not critical to testing
  const noOp = useCallback(async <T,>(..._args: any[]): Promise<T | void> => {
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
  const activeYearlyGoals: any[] = [];
  const primaryYearlyGoal = null;
  const rewardsInventory = rewards;
  const freezeBank = null;
  const isGeneratingInsight = false;
  const householdSettings = null;
  const currentPeriodId = '2024-01-01';
  const bucketSpentMap = new Map();

  const contextValue: HouseholdContextType = {
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
    pantry,
    meals,
    shoppingList,
    mealPlan,
    todos,
    groceryCatalog,
    insightsHistory,
    insight,
    stores,
    groceryCategories,

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
    addCalendarItem,
    updateCalendarItem,
    deleteCalendarItem,
    payCalendarItem: noOp,
    deferCalendarItem: noOp,
    addHabit,
    updateHabit,
    deleteHabit,
    toggleHabit,
    resetHabit: noOp,
    addHabitSubmission: noOp,
    updateHabitSubmission: noOp,
    deleteHabitSubmission: noOp,
    getHabitSubmissions,
    addPantryItem,
    updatePantryItem,
    deletePantryItem,
    addMeal,
    updateMeal,
    deleteMeal,
    addShoppingItem,
    updateShoppingItem,
    deleteShoppingItem,
    toggleShoppingItemPurchased: noOp,
    clearPurchasedShoppingItems: noOp,
    addMealPlanItem: addMealPlan,
    updateMealPlanItem: noOp,
    deleteMealPlanItem: deleteMealPlan,
    addToDo,
    updateToDo,
    deleteToDo,
    completeToDo: noOp,
    addStore,
    updateStore,
    deleteStore,
    updateGroceryCategories,
    addGroceryCatalogItem: noOp,
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

  return (
    <FirebaseHouseholdContext.Provider value={contextValue}>
      {children}
    </FirebaseHouseholdContext.Provider>
  );
};
