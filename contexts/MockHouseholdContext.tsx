import React, { useState, ReactNode } from 'react';
import { FirebaseHouseholdContext, HouseholdContextType } from './FirebaseHouseholdContext';
import {
  Account,
  BudgetBucket,
  Transaction,
  CalendarItem,
  Habit,
  Challenge,
  RewardItem,
  HouseholdMember,
  PantryItem,
  Meal,
  ShoppingItem,
  MealPlanItem,
  ToDo,
  Insight,
  GroceryCatalogItem
} from '@/types/schema';
import toast from 'react-hot-toast';

// Seed Data
const SEED_ACCOUNTS: Account[] = [
  { id: 'acc1', name: 'Main Checking', type: 'checking', balance: 5000, lastUpdated: new Date().toISOString() },
  { id: 'acc2', name: 'Savings', type: 'savings', balance: 12000, lastUpdated: new Date().toISOString() },
];

const SEED_BUCKETS: BudgetBucket[] = [
  { id: 'b1', name: 'Groceries', limit: 600, color: 'green', isVariable: true, isCore: true, createdBy: 'test-user-id' },
  { id: 'b2', name: 'Entertainment', limit: 200, color: 'purple', isVariable: true, isCore: false, createdBy: 'test-user-id' },
  { id: 'b3', name: 'Utilities', limit: 300, color: 'blue', isVariable: false, isCore: true, createdBy: 'test-user-id' },
];

const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx1', amount: 45.50, merchant: 'Grocery Store', category: 'Groceries', date: new Date().toISOString().split('T')[0],
    status: 'verified', createdBy: 'test-user-id', createdAt: new Date().toISOString(), payPeriodId: '2024-01-01'
  },
  {
    id: 'tx2', amount: 120.00, merchant: 'Electric Co', category: 'Utilities', date: new Date().toISOString().split('T')[0],
    status: 'verified', createdBy: 'test-user-id', createdAt: new Date().toISOString(), payPeriodId: '2024-01-01'
  }
];

const SEED_HABITS: Habit[] = [
  {
    id: 'h1', title: 'Drink Water', category: 'Health', type: 'positive', basePoints: 5,
    scoringType: 'threshold', period: 'daily', targetCount: 3, totalCount: 1, count: 1,
    completedDates: [], streakDays: 0, createdBy: 'test-user-id', lastUpdated: new Date().toISOString()
  }
];

const SEED_MEMBERS: HouseholdMember[] = [
  {
    uid: 'test-user-id', displayName: 'Test User', email: 'test@example.com', role: 'admin',
    points: { daily: 5, weekly: 35, total: 150 }, joinedAt: new Date().toISOString()
  }
];

export const MockHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // State
  const [accounts, setAccounts] = useState<Account[]>(SEED_ACCOUNTS);
  const [buckets, setBuckets] = useState<BudgetBucket[]>(SEED_BUCKETS);
  const [transactions, setTransactions] = useState<Transaction[]>(SEED_TRANSACTIONS);
  const [habits, setHabits] = useState<Habit[]>(SEED_HABITS);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [yearlyGoals, setYearlyGoals] = useState<any[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>(SEED_MEMBERS);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>([]);
  const [insightsHistory, setInsightsHistory] = useState<Insight[]>([]);
  const [insight, setInsight] = useState("Mock Insight: You are doing great!");

  // Helpers
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Actions
  const addAccount = async (account: Account) => {
    setAccounts([...accounts, { ...account, id: generateId() }]);
    toast.success('Mock: Account added');
  };

  const updateAccountBalance = async (id: string, newBalance: number) => {
    setAccounts(accounts.map(a => a.id === id ? { ...a, balance: newBalance } : a));
    toast.success('Mock: Balance updated');
  };

  const addBucket = async (bucket: BudgetBucket) => {
    setBuckets([...buckets, { ...bucket, id: generateId() }]);
    toast.success('Mock: Bucket added');
  };

  const updateBucket = async (bucket: BudgetBucket) => {
    setBuckets(buckets.map(b => b.id === bucket.id ? bucket : b));
    toast.success('Mock: Bucket updated');
  };

  const deleteBucket = async (id: string) => {
    setBuckets(buckets.filter(b => b.id !== id));
    toast.success('Mock: Bucket deleted');
  };

  const addTransaction = async (tx: Transaction) => {
    setTransactions([...transactions, { ...tx, id: generateId() }]);
    toast.success('Mock: Transaction added');
  };

  const updateTransaction = async (id: string, updates: Partial<Transaction>) => {
    setTransactions(transactions.map(t => t.id === id ? { ...t, ...updates } : t));
    toast.success('Mock: Transaction updated');
  };

  const deleteTransaction = async (id: string) => {
    setTransactions(transactions.filter(t => t.id !== id));
    toast.success('Mock: Transaction deleted');
  };

  const addHabit = async (habit: Habit) => {
    setHabits([...habits, { ...habit, id: generateId() }]);
    toast.success('Mock: Habit added');
  };

  const updateHabit = async (habit: Habit) => {
    setHabits(habits.map(h => h.id === habit.id ? habit : h));
    toast.success('Mock: Habit updated');
  };

  const toggleHabit = async (id: string, direction: 'up' | 'down') => {
    setHabits(habits.map(h => {
        if (h.id !== id) return h;
        const change = direction === 'up' ? 1 : -1;
        return { ...h, count: Math.max(0, h.count + change) };
    }));
    toast.success('Mock: Habit toggled');
  };

  const addToDo = async (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => {
     setTodos([...todos, {
         ...todo,
         id: generateId(),
         createdAt: new Date().toISOString(),
         createdBy: 'test-user-id'
     } as ToDo]);
  };

  const updateToDo = async (id: string, updates: Partial<ToDo>) => {
      setTodos(todos.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const deleteToDo = async (id: string) => {
      setTodos(todos.filter(t => t.id !== id));
  };

  const completeToDo = async (id: string) => {
      setTodos(todos.map(t => t.id === id ? { ...t, isCompleted: true } : t));
  };


  // No-ops for complex stuff
  const noOp = async () => {};

  return (
    <FirebaseHouseholdContext.Provider
      value={{
        safeToSpend: 4500,
        dailyPoints: 10,
        weeklyPoints: 50,
        totalPoints: 200,
        currentUser: members[0],
        members,
        accounts,
        buckets,
        calendarItems,
        transactions,
        habits,
        activeChallenge: null,
        challenges,
        yearlyGoals,
        activeYearlyGoals: [],
        primaryYearlyGoal: null,
        rewardsInventory: rewards,
        freezeBank: { tokens: 2, maxTokens: 3, lastRolloverDate: '', lastRolloverMonth: '', history: [] },
        insight,
        insightsHistory,
        isGeneratingInsight: false,
        householdId: 'test-household-id',
        currentPeriodId: '2024-01-01',
        bucketSpentMap: new Map(),
        householdSettings: {
             id: 'test-household-id',
             name: 'Test Household',
             memberUids: ['test-user-id'],
             currency: 'USD',
             points: { daily: 10, weekly: 50, total: 200 },
             freezeBank: { current: 0, accrued: 0, lastMonth: '' },
             inviteCode: 'TEST01',
             createdAt: { seconds: 0, nanoseconds: 0 } as any,
             createdBy: 'test-user-id'
        },
        pantry,
        meals,
        shoppingList,
        mealPlan,
        todos,
        groceryCatalog,

        addAccount,
        updateAccountBalance,
        setAccountGoal: noOp as any,
        deleteAccount: noOp as any,
        updateAccountOrder: noOp as any,
        reorderAccounts: noOp as any,

        addBucket,
        updateBucket,
        deleteBucket,
        updateBucketLimit: noOp as any,
        reallocateBucket: noOp as any,

        addCalendarItem: async (item) => { setCalendarItems([...calendarItems, {...item, id: generateId()}]); toast.success('Mock: Calendar Item Added'); },
        updateCalendarItem: async (item) => { setCalendarItems(calendarItems.map(c => c.id === item.id ? item : c)); toast.success('Mock: Calendar Updated'); },
        deleteCalendarItem: async (id) => { setCalendarItems(calendarItems.filter(c => c.id !== id)); toast.success('Mock: Calendar Deleted'); },
        payCalendarItem: noOp as any,
        deferCalendarItem: noOp as any,

        addTransaction,
        updateTransactionCategory: async (id, cat) => { setTransactions(transactions.map(t => t.id === id ? {...t, category: cat, status: 'verified'} : t)); toast.success('Mock: Categorized'); },
        updateTransaction,
        deleteTransaction,

        addHabit,
        updateHabit,
        deleteHabit: async (id) => { setHabits(habits.filter(h => h.id !== id)); toast.success('Mock: Habit deleted'); },
        toggleHabit,
        resetHabit: async (id) => { setHabits(habits.map(h => h.id === id ? {...h, count: 0} : h)); toast.success('Mock: Reset'); },

        addHabitSubmission: noOp as any,
        updateHabitSubmission: noOp as any,
        deleteHabitSubmission: noOp as any,
        getHabitSubmissions: async () => [],

        updateChallenge: noOp as any,
        markChallengeComplete: noOp as any,
        redeemReward: noOp as any,
        refreshInsight: async () => { setInsight('New Mock Insight Generated!'); },

        createYearlyGoal: noOp as any,
        updateYearlyGoal: noOp as any,
        updateYearlyGoalProgress: noOp as any,
        deleteYearlyGoal: noOp as any,

        useFreezeBankToken: noOp as any,
        rolloverFreezeBankTokens: noOp as any,

        addMember: noOp as any,
        updateMember: noOp as any,
        removeMember: noOp as any,

        addPantryItem: async (item) => { setPantry([...pantry, { ...item, id: generateId() } as PantryItem]); toast.success('Mock: Pantry Add'); },
        updatePantryItem: async (item) => { setPantry(pantry.map(p => p.id === item.id ? item : p)); toast.success('Mock: Pantry Update'); },
        deletePantryItem: async (id) => { setPantry(pantry.filter(p => p.id !== id)); toast.success('Mock: Pantry Delete'); },

        addMeal: async (meal) => { const id = generateId(); setMeals([...meals, { ...meal, id } as Meal]); return id; },
        updateMeal: async (meal) => { setMeals(meals.map(m => m.id === meal.id ? meal : m)); },
        deleteMeal: async (id) => { setMeals(meals.filter(m => m.id !== id)); },

        addShoppingItem: async (item) => { setShoppingList([...shoppingList, { ...item, id: generateId() } as ShoppingItem]); },
        updateShoppingItem: async (item) => { setShoppingList(shoppingList.map(s => s.id === item.id ? item : s)); },
        deleteShoppingItem: async (id) => { setShoppingList(shoppingList.filter(s => s.id !== id)); },
        toggleShoppingItemPurchased: async (id) => { setShoppingList(shoppingList.map(s => s.id === id ? {...s, isPurchased: !s.isPurchased} : s)); },
        clearPurchasedShoppingItems: async () => { setShoppingList(shoppingList.filter(s => !s.isPurchased)); },

        addGroceryCatalogItem: noOp as any,
        updateGroceryCatalogItem: noOp as any,
        deleteGroceryCatalogItem: noOp as any,

        addMealPlanItem: async (item) => { setMealPlan([...mealPlan, { ...item, id: generateId() } as MealPlanItem]); },
        updateMealPlanItem: async (id, updates) => { setMealPlan(mealPlan.map(m => m.id === id ? {...m, ...updates} : m)); },
        deleteMealPlanItem: async (id) => { setMealPlan(mealPlan.filter(m => m.id !== id)); },

        addToDo,
        updateToDo,
        deleteToDo,
        completeToDo
      }}
    >
      {children}
    </FirebaseHouseholdContext.Provider>
  );
};
