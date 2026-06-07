import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode, useCallback } from 'react';
import {
  collection,
  query,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDoc,
  getDocs,
  where,
  orderBy,
  increment,
  runTransaction,
  setDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { useAuth } from '@/contexts/AuthContext';
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
  Household,
  BucketPeriodSnapshot,
  YearlyGoal,
  FreezeBank,
  FreezeBankHistoryEntry,
  Meal,
  ShoppingItem,
  MealPlanItem,
  ToDo,
  PendingItem,
  Insight,
  GroceryCatalogItem,
  Store,
  QuickStockList,
  HouseholdApiKey
} from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { calculateSafeToSpendBreakdownFromExpanded, type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { processToggleHabit, calculatePointsForDate, calculatePointsForDateRange, isHabitStale, calculateStreak } from '@/utils/habitLogic';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { calculateBucketSpent, getTransactionsForBucket, type BucketSpent } from '@/utils/bucketSpentCalculator';
import { migrateBucketsToPeriods, needsMigration, migrateToPaycheckPeriods, needsPaycheckMigration } from '@/utils/migrations/payPeriodMigration';
import { migrateFreezeBankToEnhanced, needsFreezeBankMigration } from '@/utils/migrations/freezeBankMigration';
import { migrateOrphanedHabits, needsHabitMigration } from '@/utils/migrations/habitMigration';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { canUseFreezeBankToken } from '@/utils/freezeBankValidator';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';
import { useHabitActions } from '@/hooks/useHabitActions';
import { expandCalendarItems, parseRecurringId, isRecurringId } from '@/utils/calendarRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';
import { ParsedShoppingList, ParsedTodoList, ParsedExpense } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';
import { isSameDay, isSameWeek, parseISO, format, subDays, startOfWeek, addDays, startOfToday, isAfter, isValid, addMonths } from 'date-fns';

export interface HouseholdContextType {
  // State
  /** True during the initial cold load before the first household snapshot resolves. */
  isLoading: boolean;
  safeToSpend: number;
  /**
   * Itemized breakdown behind the safe-to-spend number (memoized, no re-expansion).
   * Optional because alternate providers (e.g. the Test Mode mock context) may not
   * supply it; the real Firebase provider always does.
   */
  safeToSpendBreakdown?: SafeToSpendBreakdown;
  dailyPoints: number;
  weeklyPoints: number;
  totalPoints: number;
  currentUser: HouseholdMember | null;
  members: HouseholdMember[];
  accounts: Account[];
  buckets: BudgetBucket[];
  calendarItems: CalendarItem[];
  transactions: Transaction[];
  habits: Habit[];
  activeChallenge: Challenge | null;
  challenges: Challenge[];
  yearlyGoals: YearlyGoal[];
  activeYearlyGoals: YearlyGoal[];
  primaryYearlyGoal: YearlyGoal | null;
  rewardsInventory: RewardItem[];
  freezeBank: FreezeBank | null;
  insight: string;
  insightsHistory: Insight[];
  isGeneratingInsight: boolean;
  meals: Meal[];
  shoppingList: ShoppingItem[];
  mealPlan: MealPlanItem[];
  todos: ToDo[];
  groceryCatalog: GroceryCatalogItem[];
  bucketHistory: BucketPeriodSnapshot[];

  // Natural Language Processing
  pendingItemsCount: number;

  // Shopping List Settings
  stores: Store[];
  groceryCategories: string[];
  quickStockLists: QuickStockList[];

  // iOS Shortcuts API Keys
  apiKeys: HouseholdApiKey[];

  // Pay Period Tracking State
  householdId: string | null;
  currentPeriodId: string;
  bucketSpentMap: Map<string, BucketSpent>;
  householdSettings: Household | null;
  household: Household | null; // Alias for householdSettings

  // Account Actions
  addAccount: (account: Account) => Promise<void>;
  updateAccountBalance: (id: string, newBalance: number) => Promise<void>;
  setAccountGoal: (id: string, goal: number) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  updateAccountOrder: (accountId: string, newOrder: number) => Promise<void>;
  reorderAccounts: (orderedIds: string[]) => Promise<void>;

  // Bucket Actions
  addBucket: (bucket: BudgetBucket) => Promise<void>;
  updateBucket: (bucket: BudgetBucket) => Promise<void>;
  deleteBucket: (id: string) => Promise<void>;
  updateBucketLimit: (id: string, newLimit: number) => Promise<void>;
  reallocateBucket: (sourceId: string, targetId: string, amount: number) => Promise<void>;

  // Calendar Actions
  addCalendarItem: (item: CalendarItem) => Promise<void>;
  updateCalendarItem: (item: CalendarItem) => Promise<void>;
  deleteCalendarItem: (id: string) => Promise<void>;
  payCalendarItem: (itemId: string, accountId: string) => Promise<void>;
  deferCalendarItem: (itemId: string) => Promise<void>;

  // Transaction Actions
  addTransaction: (tx: Transaction) => Promise<void>;
  updateTransactionCategory: (id: string, category: string, relatedHabitIds?: string[]) => Promise<void>;
  updateTransaction: (id: string, updates: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  splitTransaction: (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => Promise<void>;

  // Habit Actions
  addHabit: (habit: Habit) => Promise<string>;
  updateHabit: (habit: Habit) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  reorderHabits: (updates: { id: string; order: number; category?: string }[]) => Promise<void>;
  toggleHabit: (id: string, direction: 'up' | 'down') => Promise<void>;
  resetHabit: (id: string) => Promise<void>;

  // Habit Submission Actions
  addHabitSubmission: (habitId: string, count: number, timestamp?: string) => Promise<void>;
  updateHabitSubmission: (habitId: string, submissionId: string, updates: Partial<HabitSubmission>) => Promise<void>;
  deleteHabitSubmission: (habitId: string, submissionId: string) => Promise<void>;
  getHabitSubmissions: (habitId: string, startDate?: string, endDate?: string) => Promise<HabitSubmission[]>;

  // Challenge & Reward Actions
  updateChallenge: (challenge: Challenge) => Promise<void>;
  markChallengeComplete: (challengeId: string, success: boolean) => Promise<void>;
  redeemReward: (rewardId: string) => Promise<void>;
  refreshInsight: () => Promise<void>;

  // Yearly Goal Actions
  createYearlyGoal: (goal: Omit<YearlyGoal, 'id'>) => Promise<void>;
  updateYearlyGoal: (goalId: string, updates: Partial<YearlyGoal>) => Promise<void>;
  updateYearlyGoalProgress: (goalId: string, month: string, success: boolean) => Promise<void>;
  deleteYearlyGoal: (goalId: string) => Promise<void>;

  // Freeze Bank Actions
  useFreezeBankToken: (habitId: string, targetDate: string) => Promise<void>;
  rolloverFreezeBankTokens: () => Promise<void>;

  // Member Management Actions
  addMember: (memberData: Partial<HouseholdMember>) => Promise<void>;
  updateMember: (memberId: string, updates: Partial<HouseholdMember>) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;

  // Meal Actions
  addMeal: (meal: Omit<Meal, 'id'>, options?: { suppressToast?: boolean }) => Promise<string>;
  updateMeal: (meal: Meal) => Promise<void>;
  deleteMeal: (id: string) => Promise<void>;

  // Shopping List Actions
  addShoppingItem: (item: Omit<ShoppingItem, 'id'>) => Promise<void>;
  addShoppingItems: (items: Omit<ShoppingItem, 'id'>[]) => Promise<void>;
  updateShoppingItem: (item: ShoppingItem) => Promise<void>;
  reorderShoppingItems: (items: ShoppingItem[]) => Promise<void>;
  deleteShoppingItem: (id: string) => Promise<void>;
  toggleShoppingItemPurchased: (id: string) => Promise<void>;
  clearPurchasedShoppingItems: () => Promise<void>;

  // Shopping Settings Actions
  addStore: (store: Omit<Store, 'id'>) => Promise<void>;
  updateStore: (store: Store) => Promise<void>;
  deleteStore: (id: string) => Promise<void>;
  updateGroceryCategories: (categories: string[]) => Promise<void>;
  addQuickStockList: (list: Omit<QuickStockList, 'id'>) => Promise<void>;
  updateQuickStockList: (list: QuickStockList) => Promise<void>;
  deleteQuickStockList: (id: string) => Promise<void>;

  // Grocery Catalog Actions
  addGroceryCatalogItem: (item: Omit<GroceryCatalogItem, 'id'>) => Promise<string>;
  updateGroceryCatalogItem: (id: string, updates: Partial<GroceryCatalogItem>) => Promise<void>;
  deleteGroceryCatalogItem: (id: string) => Promise<void>;

  // Meal Plan Actions
  addMealPlanItem: (item: Omit<MealPlanItem, 'id'>, options?: { suppressToast?: boolean, throwOnError?: boolean }) => Promise<void>;
  updateMealPlanItem: (id: string, updates: Partial<MealPlanItem>) => Promise<void>;
  deleteMealPlanItem: (id: string) => Promise<void>;

  // To-Do Actions
  addToDo: (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
  updateToDo: (id: string, updates: Partial<ToDo>) => Promise<void>;
  deleteToDo: (id: string) => Promise<void>;
  completeToDo: (id: string) => Promise<void>;
}

// --- DOMAIN CONTEXT SLICES ---
//
// The household state is split into five domain slices so a component only
// re-renders when the slice it actually reads changes (adding a transaction no
// longer re-renders the meal planner, etc.). The slice value types are derived
// from `HouseholdContextType` with `Pick` so they stay in sync with the legacy
// shape automatically — there is a single source of truth for every field.

export type FinanceContextValue = Pick<HouseholdContextType,
  | 'safeToSpend' | 'safeToSpendBreakdown' | 'accounts' | 'buckets' | 'calendarItems' | 'transactions'
  | 'currentPeriodId' | 'bucketSpentMap' | 'bucketHistory'
  | 'addAccount' | 'updateAccountBalance' | 'setAccountGoal' | 'deleteAccount'
  | 'updateAccountOrder' | 'reorderAccounts'
  | 'addBucket' | 'updateBucket' | 'deleteBucket' | 'updateBucketLimit' | 'reallocateBucket'
  | 'addCalendarItem' | 'updateCalendarItem' | 'deleteCalendarItem' | 'payCalendarItem' | 'deferCalendarItem'
  | 'addTransaction' | 'updateTransactionCategory' | 'updateTransaction' | 'deleteTransaction' | 'splitTransaction'
>;

export type GamificationContextValue = Pick<HouseholdContextType,
  | 'dailyPoints' | 'weeklyPoints' | 'totalPoints' | 'habits'
  | 'activeChallenge' | 'challenges'
  | 'yearlyGoals' | 'activeYearlyGoals' | 'primaryYearlyGoal'
  | 'rewardsInventory' | 'freezeBank'
  | 'addHabit' | 'updateHabit' | 'deleteHabit' | 'reorderHabits' | 'toggleHabit' | 'resetHabit'
  | 'addHabitSubmission' | 'updateHabitSubmission' | 'deleteHabitSubmission' | 'getHabitSubmissions'
  | 'updateChallenge' | 'markChallengeComplete' | 'redeemReward'
  | 'createYearlyGoal' | 'updateYearlyGoal' | 'updateYearlyGoalProgress' | 'deleteYearlyGoal'
  | 'useFreezeBankToken' | 'rolloverFreezeBankTokens'
>;

export type MealsContextValue = Pick<HouseholdContextType,
  | 'meals' | 'shoppingList' | 'mealPlan' | 'groceryCatalog'
  | 'stores' | 'groceryCategories' | 'quickStockLists'
  | 'addMeal' | 'updateMeal' | 'deleteMeal'
  | 'addShoppingItem' | 'addShoppingItems' | 'updateShoppingItem' | 'reorderShoppingItems'
  | 'deleteShoppingItem' | 'toggleShoppingItemPurchased' | 'clearPurchasedShoppingItems'
  | 'addStore' | 'updateStore' | 'deleteStore' | 'updateGroceryCategories'
  | 'addQuickStockList' | 'updateQuickStockList' | 'deleteQuickStockList'
  | 'addGroceryCatalogItem' | 'updateGroceryCatalogItem' | 'deleteGroceryCatalogItem'
  | 'addMealPlanItem' | 'updateMealPlanItem' | 'deleteMealPlanItem'
>;

export type TodosContextValue = Pick<HouseholdContextType,
  | 'todos' | 'addToDo' | 'updateToDo' | 'deleteToDo' | 'completeToDo'
>;

export type HouseholdCoreContextValue = Pick<HouseholdContextType,
  | 'isLoading' | 'currentUser' | 'members'
  | 'insight' | 'insightsHistory' | 'isGeneratingInsight'
  | 'pendingItemsCount' | 'apiKeys'
  | 'householdId' | 'householdSettings' | 'household'
  | 'refreshInsight' | 'addMember' | 'updateMember' | 'removeMember'
>;

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);
const GamificationContext = createContext<GamificationContextValue | undefined>(undefined);
const MealsContext = createContext<MealsContextValue | undefined>(undefined);
const TodosContext = createContext<TodosContextValue | undefined>(undefined);
const HouseholdCoreContext = createContext<HouseholdCoreContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useFinance = (): FinanceContextValue => {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useGamification = (): GamificationContextValue => {
  const ctx = useContext(GamificationContext);
  if (!ctx) throw new Error('useGamification must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useMeals = (): MealsContextValue => {
  const ctx = useContext(MealsContext);
  if (!ctx) throw new Error('useMeals must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTodos = (): TodosContextValue => {
  const ctx = useContext(TodosContext);
  if (!ctx) throw new Error('useTodos must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useHouseholdCore = (): HouseholdCoreContextValue => {
  const ctx = useContext(HouseholdCoreContext);
  if (!ctx) throw new Error('useHouseholdCore must be used within FirebaseHouseholdProvider');
  return ctx;
};

/**
 * Backward-compatible shim. Reads every slice and merges them into the legacy
 * shape so un-migrated consumers keep working unchanged.
 *
 * NOTE: because it subscribes to all five contexts, a component using this hook
 * re-renders on any slice change. Migrate hot components to the granular hooks
 * above (`useFinance`, `useMeals`, …) to get the render-isolation win.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useHousehold = (): HouseholdContextType => {
  const finance = useFinance();
  const gamification = useGamification();
  const meals = useMeals();
  const todos = useTodos();
  const core = useHouseholdCore();
  return useMemo(
    () => ({ ...finance, ...gamification, ...meals, ...todos, ...core }),
    [finance, gamification, meals, todos, core]
  );
};

/**
 * Nests the five domain context providers. Shared by the real Firestore-backed
 * provider and the Test Mode mock provider so both stay in lockstep.
 */
export const HouseholdSliceProviders: React.FC<{
  finance: FinanceContextValue;
  gamification: GamificationContextValue;
  meals: MealsContextValue;
  todos: TodosContextValue;
  core: HouseholdCoreContextValue;
  children: ReactNode;
}> = ({ finance, gamification, meals, todos, core, children }) => (
  <HouseholdCoreContext.Provider value={core}>
    <FinanceContext.Provider value={finance}>
      <GamificationContext.Provider value={gamification}>
        <MealsContext.Provider value={meals}>
          <TodosContext.Provider value={todos}>
            {children}
          </TodosContext.Provider>
        </MealsContext.Provider>
      </GamificationContext.Provider>
    </FinanceContext.Provider>
  </HouseholdCoreContext.Provider>
);

export const FirebaseHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, householdId } = useAuth();

  // Real-time state from Firestore
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [buckets, setBuckets] = useState<BudgetBucket[]>([]);
  const bucketsRef = useRef(buckets); // Ref to access latest buckets in listeners

  useEffect(() => {
    bucketsRef.current = buckets;
  }, [buckets]);

  // Ref to access the latest authenticated user inside the listener callbacks
  // without keying the listener effect on the whole `user` object (Firebase
  // swaps that reference on every ~hourly token refresh — see the listener
  // effect's dependency note). uid is stable, so the effect re-subscribes only
  // on a real account change; the callbacks read fresh user fields from the ref.
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currentUser, setCurrentUser] = useState<HouseholdMember | null>(null);
  const [insight, setInsight] = useState("Tap 'Get Insight' to analyze your habits and spending.");
  const [insightsHistory, setInsightsHistory] = useState<Insight[]>([]);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [yearlyGoals, setYearlyGoals] = useState<YearlyGoal[]>([]);
  const [freezeBank, setFreezeBank] = useState<FreezeBank | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>([]);
  const [bucketHistory, setBucketHistory] = useState<BucketPeriodSnapshot[]>([]);
  const [apiKeys, setApiKeys] = useState<HouseholdApiKey[]>([]);
  const [pendingItemsCount, setPendingItemsCount] = useState<number>(0);
  // Tracks which household's first snapshot has resolved. Deriving isLoading from
  // this (rather than a boolean flag) means switching households automatically
  // re-shows skeletons until the new household loads — with no setState in an
  // effect body (which the lint rules forbid).
  const [loadedHouseholdId, setLoadedHouseholdId] = useState<string | null>(null);

  // Pay Period Tracking State
  const [householdSettings, setHouseholdSettings] = useState<Household | null>(null);

  // Habit Actions Hook
  const habitActions = useHabitActions(householdId, currentUser, habits, householdSettings);

  // Derived state (Optimized to prevent extra re-renders)
  const currentPeriodId = householdSettings?.lastPaycheckDate || '';
  const bucketSpentMap = useMemo(
    () => calculateBucketSpent(buckets, transactions, currentPeriodId),
    [buckets, transactions, currentPeriodId]
  );

  // Other derived state
  const activeChallenge = useMemo(() => challenges.find(c => c.status === 'active') ?? null, [challenges]);
  const activeYearlyGoals = useMemo(() => yearlyGoals.filter(g => g.status === 'in_progress'), [yearlyGoals]);
  const primaryYearlyGoal = useMemo(() => activeYearlyGoals[0] ?? null, [activeYearlyGoals]);

  // Memoize expanded calendar items separately to prevent expensive re-calculation
  // when only accounts/balance changes (which happens frequently)
  const expandedCalendarItemsForSafeToSpend = useMemo(() => {
    if (!currentPeriodId) return [];
    const paycheckA = parseISO(currentPeriodId);
    // Expand for 60 days (same window as original calculateSafeToSpend)
    const searchWindowEnd = addMonths(paycheckA, 2);
    return expandCalendarItems(calendarItems, paycheckA, searchWindowEnd);
  }, [calendarItems, currentPeriodId]);

  const safeToSpendBreakdown = useMemo(
    () => calculateSafeToSpendBreakdownFromExpanded(accounts, expandedCalendarItemsForSafeToSpend, buckets, currentPeriodId),
    [accounts, expandedCalendarItemsForSafeToSpend, buckets, currentPeriodId]
  );
  const safeToSpend = safeToSpendBreakdown.safeToSpend;
  const dailyPoints = householdSettings?.points?.daily || 0;
  const weeklyPoints = householdSettings?.points?.weekly || 0;
  const totalPoints = householdSettings?.points?.total || 0;

  // Shopping Settings state derived from householdSettings
  const stores = useMemo(() => householdSettings?.stores || [], [householdSettings?.stores]);
  const groceryCategories = useMemo(() => householdSettings?.groceryCategories || [], [householdSettings?.groceryCategories]);
  const quickStockLists = useMemo(() => householdSettings?.quickStockLists || [], [householdSettings?.quickStockLists]);

  // Tracks the household for which the missing-member-document recovery has
  // already been attempted, so the recovery getDoc runs at most once per
  // household (not on every members snapshot). Storing the householdId rather
  // than a boolean means it auto-resets when the household changes.
  const memberRecoveryAttemptedForHousehold = useRef<string | null>(null);

  // Real-time listeners
  useEffect(() => {
    if (!householdId) return;

    const unsubscribers: (() => void)[] = [];

    // Accounts listener
    const accountsQuery = query(collection(db, `households/${householdId}/accounts`));
    unsubscribers.push(
      onSnapshot(accountsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            ...d,
            id: doc.id,
            lastUpdated: d.lastUpdated instanceof Timestamp ? d.lastUpdated.toDate().toISOString() : d.lastUpdated,
          } as Account;
        });
        setAccounts(data);
      })
    );

    // Buckets listener
    const bucketsQuery = query(collection(db, `households/${householdId}/buckets`));
    unsubscribers.push(
      onSnapshot(bucketsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as BudgetBucket));
        setBuckets(data);
      })
    );

    // Bucket History listener (Ordered by most recent period first)
    // NOTE: This might require an index on periodStartDate desc
    const historyQuery = query(collection(db, `households/${householdId}/bucketHistory`), orderBy('periodStartDate', 'desc'));
    unsubscribers.push(
      onSnapshot(historyQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as BucketPeriodSnapshot));
        setBucketHistory(data);
      }, (error) => {
        console.error('Error listening to bucketHistory:', error);
      })
    );

    // Transactions listener
    const txQuery = query(collection(db, `households/${householdId}/transactions`));
    unsubscribers.push(
      onSnapshot(txQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            ...d,
            id: doc.id,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : d.createdAt,
          } as Transaction;
        });
        setTransactions(data);
      })
    );

    // Calendar listener
    const calQuery = query(collection(db, `households/${householdId}/calendarItems`));
    unsubscribers.push(
      onSnapshot(calQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CalendarItem));
        setCalendarItems(data);
      })
    );

    // Habits listener
    const habitsQuery = query(collection(db, `households/${householdId}/habits`));
    unsubscribers.push(
      onSnapshot(habitsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            ...d,
            id: doc.id,
            scoringType: d.scoringType || 'threshold',
            lastUpdated: d.lastUpdated instanceof Timestamp ? d.lastUpdated.toDate().toISOString() : d.lastUpdated,
          } as Habit;
        });
        setHabits(data);
      })
    );

    // Challenges listener
    const challengesQuery = query(collection(db, `households/${householdId}/challenges`));
    unsubscribers.push(
      onSnapshot(challengesQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Challenge));
        setChallenges(data);
      })
    );

    // Yearly Goals listener
    const yearlyGoalsQuery = query(collection(db, `households/${householdId}/yearlyGoals`));
    unsubscribers.push(
      onSnapshot(yearlyGoalsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as YearlyGoal));
        setYearlyGoals(data);
      })
    );

    // Rewards listener
    const rewardsQuery = query(collection(db, `households/${householdId}/rewards`));
    unsubscribers.push(
      onSnapshot(rewardsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as RewardItem));
        setRewards(data);
      })
    );

    // Members listener
    const membersQuery = query(collection(db, `households/${householdId}/members`));
    unsubscribers.push(
      onSnapshot(membersQuery, async (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as HouseholdMember));
        setMembers(data);

        // Set current user (read latest user from the ref, not effect closure)
        const u = userRef.current;
        const current = data.find(m => m.uid === u?.uid);
        setCurrentUser(current || null);

        // AUTO-FIX: Ensure current user has a member document
        // This handles legacy households created before member documents were required.
        // Guard with a ref so the recovery getDoc runs at most once per household,
        // instead of firing on every snapshot while the member doc is missing.
        if (u && !current && memberRecoveryAttemptedForHousehold.current !== householdId) {
          memberRecoveryAttemptedForHousehold.current = householdId;
          console.log('[FirebaseHouseholdContext] Member document missing for current user, creating...');
          try {
            // Check if user is in household's memberUids array
            const householdDoc = await getDoc(doc(db, 'households', householdId));
            const householdData = householdDoc.data();

            if (householdData && householdData.memberUids?.includes(u.uid)) {
              // User is in memberUids but missing member document - create it
              const isCreator = householdData.createdBy === u.uid;
              await setDoc(doc(db, 'households', householdId, 'members', u.uid), {
                uid: u.uid,
                displayName: u.displayName || 'User',
                email: u.email || '',
                photoURL: u.photoURL || '',
                role: isCreator ? 'admin' : 'member',
                points: {
                  daily: 0,
                  weekly: 0,
                  total: 0,
                },
                joinedAt: serverTimestamp(),
              });
              console.log('[FirebaseHouseholdContext] Member document created successfully');
            } else {
              console.warn('[FirebaseHouseholdContext] User not in household memberUids, cannot create member doc');
            }
          } catch (error) {
            console.error('[FirebaseHouseholdContext] Failed to create member document:', error);
            // Transient failure (offline/permission blip/doc not yet propagated):
            // clear the guard so a later snapshot retries, instead of leaving the
            // current user without a member document for the whole session.
            if (memberRecoveryAttemptedForHousehold.current === householdId) {
              memberRecoveryAttemptedForHousehold.current = null;
            }
          }
        }
      })
    );

    // Household settings listener (for pay period tracking and freeze bank)
    const householdDocRef = doc(db, `households/${householdId}`);
    unsubscribers.push(
      onSnapshot(householdDocRef, async (snapshot) => {
        const data = snapshot.data() as Household | undefined;
        // Include the document ID in householdSettings
        setHouseholdSettings(data ? { ...data, id: snapshot.id } : null);
        // Core data has arrived — mark this household as loaded.
        setLoadedHouseholdId(householdId);

        // Extract and set freezeBank
        if (data?.freezeBank) {
          // Check if migration is needed
          if (needsFreezeBankMigration(data.freezeBank)) {
            try {
              // Cast to unknown first to satisfy linter, then to legacy format expected by migration
              await migrateFreezeBankToEnhanced(
                householdId,
                data.freezeBank as unknown as { current: number; accrued: number; lastMonth: string }
              );
              // Migration will trigger a new snapshot with updated data
            } catch (error) {
              console.error('[FreezeBank] Migration failed:', error);
              // Fall back to a default freeze bank
              setFreezeBank({
                tokens: 2,
                maxTokens: 3,
                lastRolloverDate: format(new Date(), 'yyyy-MM-dd'),
                lastRolloverMonth: format(new Date(), 'yyyy-MM'),
                history: []
              });
            }
          } else {
            setFreezeBank(data.freezeBank as FreezeBank);
          }
        }
      }, (error) => {
        // Without this, a permission/network error would leave isLoading stuck
        // true forever (permanent skeleton). Clear the loading state so the UI
        // can recover and surface whatever data is available.
        console.error('[Household] Failed to listen to household document:', error);
        setLoadedHouseholdId(householdId);
      })
    );

    // Meals listener
    const mealsQuery = query(collection(db, `households/${householdId}/meals`));
    unsubscribers.push(
      onSnapshot(mealsQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Meal));
        setMeals(data);
      })
    );

    // Shopping List listener
    const shoppingListQuery = query(collection(db, `households/${householdId}/shoppingList`));
    unsubscribers.push(
      onSnapshot(shoppingListQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ShoppingItem));
        setShoppingList(data);
      })
    );

    // Grocery Catalog listener
    const groceryCatalogQuery = query(collection(db, `households/${householdId}/groceryCatalog`));
    unsubscribers.push(
      onSnapshot(groceryCatalogQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as GroceryCatalogItem));
        setGroceryCatalog(data);
      })
    );

    // Meal Plan listener
    const mealPlanQuery = query(collection(db, `households/${householdId}/mealPlan`));
    unsubscribers.push(
      onSnapshot(mealPlanQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as MealPlanItem));
        setMealPlan(data);
      })
    );

    // To-Do listener
    const todosQuery = query(collection(db, `households/${householdId}/todos`));
    unsubscribers.push(
      onSnapshot(todosQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            ...d,
            id: doc.id,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : d.createdAt,
            completedAt: d.completedAt
              ? (d.completedAt instanceof Timestamp ? d.completedAt.toDate().toISOString() : d.completedAt)
              : undefined,
          } as ToDo;
        });
        setTodos(data);
      })
    );

    // Pending Items listener (for natural language voice commands)
    const pendingItemsQuery = query(
      collection(db, `households/${householdId}/pendingItems`),
      where('processed', '==', false)
    );
    unsubscribers.push(
      onSnapshot(pendingItemsQuery, async (snapshot) => {
        setPendingItemsCount(snapshot.size);

        if (snapshot.size > 0) {
          // Auto-process pending items
          for (const docSnapshot of snapshot.docs) {
            const item = { ...docSnapshot.data(), id: docSnapshot.id } as PendingItem;

            try {
              // Get available categories for parsing
              const expenseCategories = bucketsRef.current.map(b => b.name);

              // Parse with Gemini
              // Dynamically load to prevent circular dependency and bundle bloat
              const { parseNaturalLanguageCommand } = await import('@/services/geminiService');
              const parsed = await parseNaturalLanguageCommand(
                householdId,
                item.text,
                item.type || 'unknown',
                {
                  shopping: [...GROCERY_CATEGORIES],
                  expense: expenseCategories
                }
              );

              // Route to appropriate handler
              if (parsed.detectedType === 'shopping') {
                await handleShoppingItems(parsed);
                toast.success(`Added ${parsed.items.length} item(s) from voice command`);
              } else if (parsed.detectedType === 'todo') {
                await handleTodoItems(parsed);
                toast.success(`Added ${parsed.tasks.length} task(s) from voice command`);
              } else if (parsed.detectedType === 'expense') {
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                await handleExpense(parsed);
                toast.success(`Added expense: $${parsed.amount?.toFixed(2) || '0.00'} at ${parsed.merchant || 'Unknown'}`);
              }

              // Mark as processed
              await updateDoc(doc(db, `households/${householdId}/pendingItems`, docSnapshot.id), {
                processed: true,
                processedAt: serverTimestamp()
              });

            } catch (error) {
              console.error('Failed to process pending item:', error);

              const errorMessage = error instanceof Error ? error.message : 'Unknown error';

              // Mark as processed with error
              await updateDoc(doc(db, `households/${householdId}/pendingItems`, docSnapshot.id), {
                processed: true,
                processedAt: serverTimestamp(),
                error: errorMessage
              });

              toast.error(`Voice command failed: ${errorMessage}`);
            }
          }
        }
      })
    );

    // Helper: Handle shopping items from parsed voice command
    async function handleShoppingItems(parsed: ParsedShoppingList) {
      const shoppingRef = collection(db, `households/${householdId}/shoppingList`);

      // Fetch the unpurchased shopping list ONCE (avoids a per-item N+1 round-trip)
      // and index existing items by normalized name for case-insensitive dedupe
      // (so "Milk" and "milk" collapse to the same entry).
      const normalize = (name: string) => name.trim().toLowerCase();
      const unpurchasedSnapshot = await getDocs(
        query(shoppingRef, where('isPurchased', '==', false))
      );
      const existingByName = new Map<string, ReturnType<typeof doc>>();
      for (const docSnap of unpurchasedSnapshot.docs) {
        const name = (docSnap.data().name as string | undefined) ?? '';
        const key = normalize(name);
        // Keep the first occurrence (mirrors prior `existing.docs[0]` behavior).
        if (!existingByName.has(key)) {
          existingByName.set(key, docSnap.ref);
        }
      }

      for (const item of parsed.items) {
        const key = normalize(item.item);
        const existingDocRef = existingByName.get(key);

        if (existingDocRef) {
          // Increment quantity on the matched existing item
          await updateDoc(existingDocRef, {
            quantity: increment(item.quantity),
            lastUpdated: serverTimestamp()
          });
        } else {
          // Add new item
          const newDocRef = await addDoc(shoppingRef, {
            name: item.item,
            quantity: String(item.quantity),
            category: item.category,
            isPurchased: false,
            source: 'voice',
            createdAt: serverTimestamp()
          });
          // Track it so later parsed items with the same name dedupe against it
          // (preserves the original re-query-each-iteration behavior).
          existingByName.set(key, newDocRef);
        }
      }
    }

    // Helper: Handle todo items from parsed voice command
    async function handleTodoItems(parsed: ParsedTodoList) {
      const todosRef = collection(db, `households/${householdId}/todos`);

      for (const item of parsed.tasks) {
        await addDoc(todosRef, {
          text: item.task,
          isCompleted: false,
          priority: item.priority || 'medium',
          source: 'voice',
          completeByDate: getLocalDateString(), // Default to today (local)
          assignedTo: userRef.current?.uid || '',
          createdAt: serverTimestamp(),
          createdBy: userRef.current?.uid || ''
        });
      }
    }

    // Helper: Handle expense from parsed voice command
    async function handleExpense(data: ParsedExpense) {
      if (!data.amount) {
        throw new Error('Expense must include an amount');
      }

      const transactionsRef = collection(db, `households/${householdId}/transactions`);

      await addDoc(transactionsRef, {
        amount: data.amount,
        merchant: data.merchant || 'Unknown',
        category: data.category || 'Uncategorized',
        status: 'pending_review',
        notes: data.notes || '',
        date: getLocalDateString(),
        source: 'voice',
        isRecurring: false,
        autoCategorized: false,
        createdAt: serverTimestamp()
      });
    }

    // API Keys listener (for iOS Shortcuts)
    const apiKeysQuery = query(collection(db, `households/${householdId}/apiKeys`));
    unsubscribers.push(
      onSnapshot(apiKeysQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            ...d,
            id: doc.id,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : d.createdAt,
            lastUsedAt: d.lastUsedAt instanceof Timestamp ? d.lastUsedAt.toDate().toISOString() : d.lastUsedAt,
          } as HouseholdApiKey;
        });
        setApiKeys(data);
      }, (error) => {
        // Silently ignore permission errors for non-admin users
        if (error.code !== 'permission-denied') {
          console.error('Error fetching API keys:', error);
        }
      })
    );

    // Insights listener
    // NOTE: This query requires a Firestore composite index:
    //   Collection: households/{householdId}/insights
    //   Field: generatedAt (Descending)
    // If the index is missing, Firestore will throw an error with a URL to create it.
    // You can pre-create the index via the Firebase console or add to firestore.indexes.json:
    // {
    //   "collectionGroup": "insights",
    //   "queryScope": "COLLECTION",
    //   "fields": [{"fieldPath": "generatedAt", "order": "DESCENDING"}]
    // }
    const insightsQuery = query(collection(db, `households/${householdId}/insights`), orderBy('generatedAt', 'desc'));
    unsubscribers.push(
      onSnapshot(
        insightsQuery,
        (snapshot) => {
          const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Insight));
          setInsightsHistory(data);
          if (data.length > 0) {
            setInsight(data[0]!.text); // length > 0 checked above
          }
        },
        (error) => {
          console.error('Error listening to insights collection:', error);
          // Don't show error toast to user as this is non-critical data
        }
      )
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
    // Key on user?.uid (not the whole user object) so the ~hourly Firebase token
    // refresh — which replaces the user object reference — does not tear down and
    // re-subscribe every listener. The callbacks read fresh user fields from userRef.
  }, [householdId, user?.uid]);

  // Memoize habit reset data to avoid unnecessary callback re-creation
  // Only recreate when habit IDs, periods, or lastUpdated values change
  const habitResetData = useMemo(() =>
    habits.map(h => ({ id: h.id, period: h.period, lastUpdated: h.lastUpdated })),
    [habits]
  );

  // Habit auto-reset callback
  // Resets daily habits at midnight and weekly habits on Monday at midnight
  const checkHabitResets = useCallback(async () => {
    if (!householdId || habitResetData.length === 0) return;

    const habitsToReset: string[] = [];

    habitResetData.forEach(habit => {
      try {
        if (isHabitStale(habit)) {
          habitsToReset.push(habit.id);
        }
      } catch (error) {
        console.error(`[checkHabitResets] Error checking habit ${habit.id}:`, error);
        // Do NOT add to reset list if check failed with an exception.
        // This prevents infinite reset loops for permanently corrupted habits.
      }
    });

    // Batch update all habits that need reset with error handling
    for (const habitId of habitsToReset) {
      try {
        // Use serverTimestamp() for consistency with the rest of the codebase
        await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
          count: 0,
          lastUpdated: serverTimestamp(),
        });
      } catch (error) {
        console.error(`[checkHabitResets] Failed to reset habit ${habitId}:`, error);
      }
    }
  }, [householdId, habitResetData]);

  // Use the midnight scheduler hook for habit resets
  useMidnightScheduler(checkHabitResets, !!(householdId && habitResetData.length > 0));

  // Extract specific fields to narrow dependency array and prevent unnecessary re-runs
  const lastDailyPointsReset = householdSettings?.lastDailyPointsReset;
  const lastWeeklyPointsReset = householdSettings?.lastWeeklyPointsReset;

  // Household points auto-reset callback
  // Daily points reset at midnight, weekly points reset Sunday night into Monday
  // IMPORTANT: This recalculates points from habits completed today, not just zeros them
  const checkPointsReset = useCallback(async () => {
    if (!householdId) return;

    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const householdRef = doc(db, `households/${householdId}`);

    // We need to track when points were last reset
    // These fields may not exist yet, so we handle that case
    const lastDailyReset = lastDailyPointsReset
      ? parseISO(lastDailyPointsReset)
      : new Date(0); // If never set, treat as very old

    const lastWeeklyReset = lastWeeklyPointsReset
      ? parseISO(lastWeeklyPointsReset)
      : new Date(0);

    const updates: Record<string, number | string> = {};

    // Check if daily points need reset (new day since last reset)
    if (!isSameDay(now, lastDailyReset)) {
      // Recalculate daily points from habits completed today
      // This handles the case where habits were completed earlier today but the user
      // just logged in and this reset logic is running
      const todayPoints = calculatePointsForDate(habits, today);
      updates['points.daily'] = todayPoints;
      updates['lastDailyPointsReset'] = today;
    }

    // Check if weekly points need reset (new week since last reset)
    // weekStartsOn: 1 means Monday is day 1, Sunday is day 7
    if (!isSameWeek(now, lastWeeklyReset, { weekStartsOn: 1 })) {
      // Calculate points from all days this week (Monday through today)
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weeklyPoints = calculatePointsForDateRange(habits, weekStartStr, today);
      updates['points.weekly'] = weeklyPoints;
      updates['lastWeeklyPointsReset'] = today;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      try {
        await updateDoc(householdRef, updates);
      } catch (error) {
        console.error('[checkPointsReset] Failed to reset points:', error);
      }
    }
  }, [householdId, lastDailyPointsReset, lastWeeklyPointsReset, habits]);

  // Use the midnight scheduler hook for points resets
  // Add 100ms delay to stagger initialization and prevent race conditions with habit resets
  useMidnightScheduler(checkPointsReset, !!householdId, { initialDelayMs: 100 });

  // --- PAY PERIOD TRACKING EFFECTS ---

  // Run data migration if needed
  useEffect(() => {
    if (!householdId || !householdSettings?.startDate || !currentPeriodId) return;
    if (buckets.length === 0) return; // No data to migrate

    const runMigrations = async () => {
      if (needsMigration(buckets)) {
        console.log('[Migration] Starting pay period migration...');
        try {
          await migrateBucketsToPeriods(householdId, currentPeriodId);
          toast.success('Data migrated to pay period tracking');
        } catch (error) {
          console.error('[Migration] Failed:', error);
          toast.error('Migration failed. Please refresh the page.');
        }
      }
    };

    runMigrations();

  }, [householdId, householdSettings, currentPeriodId, transactions, buckets]);

  // Migrate from date-based periods to paycheck-based periods if needed
  useEffect(() => {
    if (!householdId || !householdSettings) return;

    const runPaycheckMigration = async () => {
      if (needsPaycheckMigration(householdSettings)) {
        console.log('[Migration] Starting paycheck period migration...');
        try {
          await migrateToPaycheckPeriods(
            householdId,
            householdSettings.payPeriodSettings!.startDate
          );
        } catch (error) {
          console.error('[Migration] Failed to migrate to paycheck periods:', error);
          toast.error('Migration failed. Please refresh the page.');
        }
      }
    };

    runPaycheckMigration();

  }, [householdId, householdSettings]);

  // Migrate orphaned preset habits to custom habits
  const hasAttemptedHabitMigration = useRef(false);

  useEffect(() => {
    if (!householdId || !habits.length) return;
    if (hasAttemptedHabitMigration.current) return;

    const runHabitMigration = async () => {
      if (needsHabitMigration(habits)) {
        // Mark as attempted before running to prevent race conditions/loops
        hasAttemptedHabitMigration.current = true;

        console.log('[Migration] Starting habit migration...');
        try {
          await migrateOrphanedHabits(householdId, habits);
        } catch (error) {
          console.error('[Migration] Failed to migrate habits:', error);
          // Allow retrying on next session/reload if it failed
          // But kept true for this session to avoid loop spamming
        }
      }
    };

    runHabitMigration();
  }, [householdId, habits]);

  // Sync daily/weekly/total points from actual habit completions
  // This ensures points accurately reflect completed habits, fixing any desync issues
  // ALWAYS recalculates and updates if values don't match - no complex conditional logic
  useEffect(() => {
    if (!householdId || !householdSettings?.points || habits.length === 0) return;

    const syncHouseholdPoints = async () => {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const currentPoints = householdSettings.points;
      if (!currentPoints) return;

      // Calculate what points SHOULD be based on actual habit completions
      const correctDailyPoints = calculatePointsForDate(habits, today);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const correctWeeklyPoints = calculatePointsForDateRange(habits, weekStartStr, today);

      // Determine correct total points
      // Check if all habit completions are within the current week
      const allDatesThisWeek = habits.every(habit =>
        habit.completedDates.every(date => date >= weekStartStr)
      );

      let correctTotalPoints;
      if (allDatesThisWeek && habits.some(h => h.completedDates.length > 0)) {
        // If all completions are this week, total should equal weekly
        correctTotalPoints = correctWeeklyPoints;
      } else {
        // Otherwise, total should be at least as much as weekly (cumulative)
        correctTotalPoints = Math.max(currentPoints.total, correctWeeklyPoints);
      }

      // Check if ANY value needs fixing
      const needsUpdate =
        currentPoints.daily !== correctDailyPoints ||
        currentPoints.weekly !== correctWeeklyPoints ||
        currentPoints.total !== correctTotalPoints;

      // Short-circuit to avoid redundant writes: if the stored values already
      // match the recomputed ones AND the reset markers are already stamped for
      // today, there is nothing to do. Without this, every habit toggle (which
      // mutates householdSettings.points) re-runs this effect and would otherwise
      // re-stamp lastDaily/WeeklyPointsReset on each pass, creating churn.
      const resetMarkersUpToDate =
        lastDailyPointsReset === today &&
        lastWeeklyPointsReset === today;

      if (!needsUpdate && resetMarkersUpToDate) {
        return;
      }

      if (needsUpdate) {
        console.log(`[PointsSync] Correcting points:
          daily: ${currentPoints.daily} -> ${correctDailyPoints}
          weekly: ${currentPoints.weekly} -> ${correctWeeklyPoints}
          total: ${currentPoints.total} -> ${correctTotalPoints}`);

        try {
          await updateDoc(doc(db, `households/${householdId}`), {
            'points.daily': correctDailyPoints,
            'points.weekly': correctWeeklyPoints,
            'points.total': correctTotalPoints,
            'lastDailyPointsReset': today,
            'lastWeeklyPointsReset': today,
          });
          console.log(`[PointsSync] Points corrected successfully`);
        } catch (error) {
          console.error('[PointsSync] Failed to sync points:', error);
        }
      }
    };

    syncHouseholdPoints();
  }, [householdId, householdSettings?.points, habits, lastDailyPointsReset, lastWeeklyPointsReset]);

  // Refresh FCM token periodically to prevent token staleness
  // iOS/Safari is particularly sensitive to stale tokens and will stop receiving notifications
  // See: https://github.com/firebase/firebase-js-sdk/issues/8013
  useEffect(() => {
    if (!householdId || !user) return;

    // Only refresh if notifications are enabled
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // Token refresh function
    const refreshToken = () => {
      import('@/services/notificationService').then(({ refreshFCMTokenIfNeeded }) => {
        refreshFCMTokenIfNeeded(householdId, user.uid).catch(console.error);
      });
    };

    // Refresh immediately on mount
    refreshToken();

    // Poll hourly while the app is running to catch any token changes
    // The refreshFCMTokenIfNeeded function internally checks if 7 days have passed
    const intervalId = setInterval(refreshToken, 60 * 60 * 1000); // 1 hour

    return () => {
      clearInterval(intervalId);
    };
  }, [householdId, user]);

  // --- ACTIONS: ACCOUNTS ---

  const addAccount = useCallback(async (account: Account) => {
    if (!householdId || !user) return;
    await addDoc(collection(db, `households/${householdId}/accounts`), {
      ...account,
      createdBy: user.uid,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account added');
  }, [householdId, user]);

  const updateAccountBalance = useCallback(async (id: string, newBalance: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      balance: newBalance,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account updated');
  }, [householdId]);

  const setAccountGoal = useCallback(async (id: string, goal: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      monthlyGoal: goal,
    });
    toast.success('Goal set');
  }, [householdId]);

  const deleteAccount = useCallback(async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/accounts`, id));
    toast.success('Account deleted');
  }, [householdId]);

  const updateAccountOrder = useCallback(async (accountId: string, newOrder: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, accountId), {
      order: newOrder,
    });
  }, [householdId]);

  const reorderAccounts = useCallback(async (orderedIds: string[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      orderedIds.forEach((id, index) => {
        const accountRef = doc(db, `households/${householdId}/accounts`, id);
        batch.update(accountRef, { order: index });
      });
      await batch.commit();
    } catch (error) {
      console.error('[reorderAccounts] Failed:', error);
      toast.error('Failed to reorder accounts');
      throw error;
    }
  }, [householdId]);

  // --- ACTIONS: BUCKETS ---

  const addBucket = useCallback(async (bucket: BudgetBucket) => {
    if (!householdId || !user) return;
    // Exclude 'id' field - it's not stored in Firestore (document ID is separate)
    const { id: _id, spent: _spent, ...bucketWithoutId } = bucket;
    const sanitizedBucket = sanitizeFirestoreData(bucketWithoutId);
    await addDoc(collection(db, `households/${householdId}/buckets`), {
      ...sanitizedBucket,
      createdBy: user.uid,
    });
    toast.success('Bucket added');
  }, [householdId, user]);

  const updateBucket = useCallback(async (bucket: BudgetBucket) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/buckets`, bucket.id), {
      name: bucket.name,
      limit: bucket.limit,
      color: bucket.color,
      isVariable: bucket.isVariable,
      isCore: bucket.isCore,
      // DO NOT update spent - it's calculated in real-time
    });
    toast.success('Bucket updated');
  }, [householdId]);

  const deleteBucket = useCallback(async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/buckets`, id));
    toast.success('Bucket deleted');
  }, [householdId]);

  const updateBucketLimit = useCallback(async (id: string, newLimit: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/buckets`, id), {
      limit: newLimit,
    });
    toast.success('Limit updated');
  }, [householdId]);

  const reallocateBucket = useCallback(async (sourceId: string, targetId: string, amount: number) => {
    if (!householdId) return;

    const sourceBucket = buckets.find(b => b.id === sourceId);
    const targetBucket = buckets.find(b => b.id === targetId);

    if (!sourceBucket || !targetBucket) return;

    // Commit both limit changes in a single batch so a partial write can never
    // leave the source debited without crediting the target. Use increment()
    // (server-side field value) rather than absolute values from local state so
    // concurrent edits to either bucket's limit are not clobbered.
    const batch = writeBatch(db);
    batch.update(doc(db, `households/${householdId}/buckets`, sourceId), {
      limit: increment(-amount),
    });
    batch.update(doc(db, `households/${householdId}/buckets`, targetId), {
      limit: increment(amount),
    });
    await batch.commit();

    toast.success('Funds reallocated');
  }, [householdId, buckets]);

  // --- ACTIONS: PAY PERIOD MANAGEMENT ---

  const resetBucketsForNewPeriod = useCallback(async (newPeriodId: string) => {
    if (!householdId || !currentPeriodId) return;

    try {
      const batch = writeBatch(db);

      // Create snapshots for all buckets from the old period
      for (const bucket of buckets) {
        const spent = bucketSpentMap.get(bucket.id) || { verified: 0, pending: 0 };
        const bucketTransactions = getTransactionsForBucket(bucket.name, transactions, currentPeriodId);

        const periodStart = currentPeriodId;
        const periodEnd = format(subDays(parseISO(newPeriodId), 1), 'yyyy-MM-dd');

        // Create snapshot in bucketHistory subcollection
        const snapshotRef = doc(collection(db, `households/${householdId}/bucketHistory`));
        batch.set(snapshotRef, {
          bucketId: bucket.id,
          bucketName: bucket.name,
          periodId: currentPeriodId,
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
          limit: bucket.limit,
          totalSpent: spent.verified,
          totalPending: spent.pending,
          transactionCount: bucketTransactions.length,
          createdAt: new Date().toISOString(),
        } as BucketPeriodSnapshot);

        // Update bucket's current period
        const bucketRef = doc(db, `households/${householdId}/buckets`, bucket.id);
        batch.update(bucketRef, {
          currentPeriodId: newPeriodId,
          lastResetDate: periodStart,
        });
      }

      // Advance the household's last paycheck date IN THE SAME BATCH as the
      // bucket resets, so periods can never desync (either everything commits
      // or nothing does).
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        lastPaycheckDate: newPeriodId,
      });

      // Commit all changes atomically
      await batch.commit();
      toast.success('Buckets reset for new pay period');
    } catch (error) {
      console.error('[resetBucketsForNewPeriod] Failed:', error);
      toast.error('Failed to reset period. Please try again.');
      throw error; // Re-throw so handlePaycheckApproval can catch it
    }
  }, [householdId, currentPeriodId, buckets, bucketSpentMap, transactions]);

  const initializeFirstPeriod = useCallback(async (paycheckDate: string) => {
    if (!householdId || !user) return;

    try {
      const batch = writeBatch(db);

      // Set household's first paycheck
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        lastPaycheckDate: paycheckDate,
      });

      // Initialize all buckets with this period ID
      for (const bucket of buckets) {
        const bucketRef = doc(db, `households/${householdId}/buckets`, bucket.id);
        batch.update(bucketRef, {
          currentPeriodId: paycheckDate,
          lastResetDate: paycheckDate,
        });
      }

      await batch.commit();
      toast.success('Pay period tracking initialized!');
    } catch (error) {
      console.error('[initializeFirstPeriod] Failed:', error);
      toast.error('Failed to initialize period tracking');
      throw error; // Re-throw so handlePaycheckApproval can catch it
    }
  }, [householdId, user, buckets]);

  const handlePaycheckApproval = useCallback(async (paycheckDate: string) => {
    if (!householdId || !user) return;

    try {
      if (!currentPeriodId) {
        // First paycheck ever - initialize period tracking
        await initializeFirstPeriod(paycheckDate);
        return;
      }

      // Reset buckets for the period that just ended. This also advances the
      // household's lastPaycheckDate within the same atomic batch, so the bucket
      // resets and the period pointer can never desync from a partial write.
      await resetBucketsForNewPeriod(paycheckDate);
    } catch (error) {
      console.error('[handlePaycheckApproval] Failed:', error);
      toast.error('Failed to process paycheck approval. Please try again.');
      throw error;
    }
  }, [householdId, user, currentPeriodId, initializeFirstPeriod, resetBucketsForNewPeriod]);

  // --- ACTIONS: CALENDAR ---

  const addCalendarItem = useCallback(async (item: CalendarItem) => {
    if (!householdId || !user) return;

    try {
      // Exclude 'id' field - it's not stored in Firestore (document ID is separate)
      const { id: _id, ...itemWithoutId } = item;
      const sanitizedItem = sanitizeFirestoreData(itemWithoutId);

      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        ...sanitizedItem,
        createdBy: user.uid,
      });
      toast.success('Event added');
    } catch (error) {
      console.error('[addCalendarItem] Failed:', error);
      toast.error('Failed to add event. Please try again.');
      throw error;
    }
  }, [householdId, user]);

  const updateCalendarItem = useCallback(async (item: CalendarItem) => {
    if (!householdId) return;

    try {
      const updates: Record<string, unknown> = {
        title: item.title,
        amount: item.amount,
        date: item.date,
        type: item.type,
        isPaid: item.isPaid,
        isRecurring: item.isRecurring,
      };

      // Handle frequency field: delete it if not recurring, otherwise include it
      if (item.isRecurring && item.frequency) {
        updates.frequency = item.frequency;
      } else if (!item.isRecurring) {
        // Explicitly delete the frequency field when toggling off recurring
        updates.frequency = deleteField();
      }

      const sanitizedUpdates = sanitizeFirestoreData(updates);
      await updateDoc(doc(db, `households/${householdId}/calendarItems`, item.id), sanitizedUpdates);
      toast.success('Event updated');
    } catch (error) {
      console.error('[updateCalendarItem] Failed:', error);
      toast.error('Failed to update event. Please try again.');
      throw error;
    }
  }, [householdId]);

  const deleteRecurringInstance = useCallback(async (syntheticId: string) => {
    if (!householdId || !user) return;

    try {
      // Parse synthetic ID to get template ID and date
      const parsed = parseRecurringId(syntheticId);
      if (!parsed) return;
      const { templateId: parentRecurringId, date: specificDate } = parsed;

      // Find the recurring template to get item details
      const template = calendarItems.find(i => i.id === parentRecurringId);
      if (!template) return;

      // Check if this specific date has already been deleted or paid
      const existingInstance = calendarItems.find(
        i => i.parentRecurringId === parentRecurringId && i.date === specificDate
      );
      if (existingInstance) {
        // If it's already a paid/deleted instance, just delete that record
        await deleteDoc(doc(db, `households/${householdId}/calendarItems`, existingInstance.id));
        toast.success('Instance deleted');
        return;
      }

      // Create a deleted instance marker
      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        title: template.title,
        amount: template.amount,
        date: specificDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        isDeleted: true,
        parentRecurringId: parentRecurringId,
        createdBy: user.uid,
      });

      toast.success('Instance deleted');
    } catch (error) {
      console.error('[deleteRecurringInstance] Failed:', error);
      toast.error('Failed to delete instance. Please try again.');
      throw error;
    }
  }, [householdId, user, calendarItems]);

  const deleteCalendarItem = useCallback(async (id: string) => {
    if (!householdId) return;

    try {
      // Check if this is a recurring instance (synthetic ID with date suffix)
      const isRecurringInstance = isRecurringId(id);

      if (isRecurringInstance) {
        // Delete only this instance, not the entire series
        await deleteRecurringInstance(id);
      } else {
        // Direct deletion for non-recurring items or templates
        await deleteDoc(doc(db, `households/${householdId}/calendarItems`, id));
        toast.success('Event deleted');
      }
    } catch (error) {
      console.error('[deleteCalendarItem] Failed:', error);
      toast.error('Failed to delete event. Please try again.');
      throw error;
    }
  }, [householdId, deleteRecurringInstance]);

  const payCalendarItem = useCallback(async (itemId: string, accountId: string) => {
    if (!householdId || !user) return;

    try {
      const account = accounts.find(a => a.id === accountId);
      if (!account) return;

      // Check if this is a recurring instance
      const isRecurringInstance = isRecurringId(itemId);

      let item: CalendarItem | undefined;
      let parentRecurringId: string | undefined;
      let specificDate: string;

      if (isRecurringInstance) {
        // Parse synthetic ID to get original template ID and date
        const parsed = parseRecurringId(itemId);
        if (!parsed) return;
        parentRecurringId = parsed.templateId;
        specificDate = parsed.date;

        // Find the recurring template
        const template = calendarItems.find(i => i.id === parentRecurringId);
        if (!template) return;

        // Check if this specific date has already been paid
        const existingPaidInstance = calendarItems.find(
          i => i.parentRecurringId === parentRecurringId && i.date === specificDate && i.isPaid
        );
        if (existingPaidInstance) return;

        // Create item object for this specific instance
        item = {
          ...template,
          date: specificDate,
        };
      } else {
        // Non-recurring item
        item = calendarItems.find(i => i.id === itemId);
        if (!item || item.isPaid) return;
        specificDate = item.date;
      }

      // NEW: If this is an income item (paycheck), trigger period reset BEFORE creating transaction
      if (item.type === 'income') {
        await handlePaycheckApproval(specificDate);
      }

      // 1. Create or update the paid calendar item
      if (isRecurringInstance) {
        // Create a new paid instance record
        await addDoc(collection(db, `households/${householdId}/calendarItems`), {
          title: item.title,
          amount: item.amount,
          date: specificDate,
          type: item.type,
          isPaid: true,
          isRecurring: false, // Individual instances are not recurring
          parentRecurringId: parentRecurringId,
          createdBy: user.uid,
        });
      } else {
        // Mark non-recurring item as paid
        await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
          isPaid: true,
        });
      }

      // 2. Update account balance atomically. Using increment() (a server-side
      // delta) instead of writing an absolute balance computed from local state
      // prevents lost updates when household members act concurrently.
      const balanceDelta = item.type === 'expense' ? -item.amount : item.amount;

      await updateDoc(doc(db, `households/${householdId}/accounts`, accountId), {
        balance: increment(roundMoney(balanceDelta)),
        lastUpdated: serverTimestamp(),
      });

      // 3. Auto-categorize
      let category = 'Bills';
      if (item.type === 'expense') {
        const matchedBucket = buckets.find(b => item.title.toLowerCase().includes(b.name.toLowerCase()));
        if (matchedBucket) category = matchedBucket.name;
      } else {
        category = 'Income';
      }

      // 4. Create transaction
      const transactionDate = getLocalDateString();
      const payPeriodId = getPayPeriodForTransaction(transactionDate, householdSettings?.lastPaycheckDate);

      await addDoc(collection(db, `households/${householdId}/transactions`), {
        amount: item.amount,
        merchant: item.title,
        category: category,
        date: transactionDate,
        status: 'verified',
        isRecurring: !!item.isRecurring,
        source: 'recurring',
        autoCategorized: true,
        payPeriodId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions

      toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');
    } catch (error) {
      console.error('[payCalendarItem] Failed:', error);
      toast.error('Failed to process payment. Please try again.');
      throw error;
    }
  }, [householdId, user, accounts, calendarItems, buckets, householdSettings, handlePaycheckApproval]);

  const deferCalendarItem = useCallback(async (itemId: string) => {
    if (!householdId || !user) return;

    // Common date calculation logic:
    // "Tomorrow", unless the item is already in the future, then +1 day from item date.
    // This ensures deferring always pushes it forward relative to today.
    const calculateDeferredDate = (currentDateString: string): string => {
      const today = startOfToday();
      const tomorrowDate = addDays(today, 1);
      const originalDate = parseISO(currentDateString);

      if (!isValid(originalDate)) {
        return format(tomorrowDate, 'yyyy-MM-dd');
      }

      // Default: defer to tomorrow relative to TODAY
      // If original date is in the future (after today), add 1 day to it
      // So if due Jan 10 (and today is Jan 5), deferring makes it Jan 11.
      // If due Jan 1 (and today is Jan 5), deferring makes it Jan 6 (tomorrow).
      const deferredFromOriginal = addDays(originalDate, 1);

      // If deferredFromOriginal is after tomorrow, use it. Otherwise use tomorrow.
      const newDate = isAfter(deferredFromOriginal, tomorrowDate)
        ? deferredFromOriginal
        : tomorrowDate;

      return format(newDate, 'yyyy-MM-dd');
    };

    // Check if this is a recurring instance
    const isRecurringInstance = isRecurringId(itemId);

    if (isRecurringInstance) {
      // For recurring instances:
      // 1. Create a one-time deferred item
      // 2. Hide (delete) the original recurring instance to prevent duplication

      const parsed = parseRecurringId(itemId);
      if (!parsed) return;
      const { templateId: parentRecurringId, date: specificDate } = parsed;

      // Find the recurring template
      const template = calendarItems.find(i => i.id === parentRecurringId);
      if (!template) return;

      const newDate = calculateDeferredDate(specificDate);

      // 1. Create deferred item
      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        title: template.title,
        amount: template.amount,
        date: newDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        createdBy: user.uid,
      });

      // 2. Delete/Hide original instance
      // We create a "tombstone" with isDeleted: true to hide this specific instance from expansion
      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        title: template.title,
        amount: template.amount,
        date: specificDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        isDeleted: true,
        parentRecurringId: parentRecurringId,
        createdBy: user.uid,
      });

      const formattedDate = format(parseISO(newDate), 'MMM d');
      toast.success(`Deferred to ${formattedDate}`);
    } else {
      // Non-recurring item - just move the date
      const item = calendarItems.find(i => i.id === itemId);
      if (!item) return;

      const newDate = calculateDeferredDate(item.date);

      await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
        date: newDate,
      });

      const formattedDate = format(parseISO(newDate), 'MMM d');
      toast.success(`Deferred to ${formattedDate}`);
    }
  }, [householdId, user, calendarItems]);

  // --- ACTIONS: TRANSACTIONS ---

  const addTransaction = useCallback(async (tx: Transaction) => {
    console.log('[addTransaction] Called with:', {
      source: tx.source,
      amount: tx.amount,
      merchant: tx.merchant,
      category: tx.category,
      date: tx.date,
      status: tx.status,
      isRecurring: tx.isRecurring,
      isRecurringType: typeof tx.isRecurring,
      autoCategorized: tx.autoCategorized,
      autoCategorizedType: typeof tx.autoCategorized
    });

    if (!householdId) {
      console.error('[addTransaction] No household selected');
      throw new Error('No household selected');
    }
    if (!user) {
      console.error('[addTransaction] Not authenticated');
      throw new Error('Not authenticated');
    }

    // Validate required fields before attempting Firestore write
    if (!tx.amount || typeof tx.amount !== 'number') {
      console.error('[addTransaction] Invalid amount:', tx.amount, typeof tx.amount);
      throw new Error('Invalid amount');
    }
    if (!tx.merchant || typeof tx.merchant !== 'string' || !tx.merchant.trim()) {
      console.error('[addTransaction] Invalid merchant:', tx.merchant, typeof tx.merchant);
      throw new Error('Invalid merchant');
    }
    if (!tx.category || typeof tx.category !== 'string') {
      console.error('[addTransaction] Invalid category:', tx.category, typeof tx.category);
      throw new Error('Invalid category');
    }
    if (!tx.date || typeof tx.date !== 'string') {
      console.error('[addTransaction] Invalid date:', tx.date, typeof tx.date);
      throw new Error('Invalid date');
    }
    if (!['verified', 'pending_review'].includes(tx.status)) {
      console.error('[addTransaction] Invalid status:', tx.status);
      throw new Error('Invalid status');
    }
    if (typeof tx.isRecurring !== 'boolean') {
      console.error('[addTransaction] isRecurring must be boolean, got:', tx.isRecurring, typeof tx.isRecurring);
      throw new Error('isRecurring must be boolean');
    }
    if (typeof tx.autoCategorized !== 'boolean') {
      console.error('[addTransaction] autoCategorized must be boolean, got:', tx.autoCategorized, typeof tx.autoCategorized);
      throw new Error('autoCategorized must be boolean');
    }

    console.log('[addTransaction] All validations passed');

    try {
      // Assign pay period ID based on paycheck approval
      const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

      // Build the document data explicitly to ensure compliance with Firestore rules
      const docData: Record<string, unknown> = {
        amount: tx.amount,
        merchant: tx.merchant.trim(),
        category: tx.category,
        date: tx.date,
        status: tx.status,
        isRecurring: tx.isRecurring,
        source: tx.source || 'manual',
        autoCategorized: tx.autoCategorized,
        payPeriodId: payPeriodId || null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      };

      // Add optional fields only if they exist and are not empty strings
      if (tx.relatedHabitIds && tx.relatedHabitIds.length > 0) {
        docData.relatedHabitIds = tx.relatedHabitIds;
      }
      if (tx.store && tx.store.trim()) {
        docData.store = tx.store.trim();
      }
      if (tx.accountId && tx.accountId.trim()) {
        docData.accountId = tx.accountId.trim();
      }
      if (tx.subBucketId && tx.subBucketId.trim()) {
        docData.subBucketId = tx.subBucketId.trim();
      }
      if (tx.notes && tx.notes.trim()) {
        docData.notes = tx.notes.trim();
      }

      console.log('Adding transaction to Firestore:', JSON.stringify(docData, null, 2));
      await addDoc(collection(db, `households/${householdId}/transactions`), docData);
      console.log('Transaction added successfully');

      // Update checking account balance atomically (server-side delta avoids
      // lost updates from concurrent edits / stale local state).
      const checkingAcc = accounts.find(a => a.type === 'checking');
      if (checkingAcc) {
        await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
          balance: increment(roundMoney(-tx.amount)),
          lastUpdated: serverTimestamp(),
        });
      }

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions
      // The bucketSpentMap effect will automatically recalculate when transactions change
    } catch (error) {
      console.error('Error adding transaction:', error);
      throw error; // Re-throw to let caller handle
    }
  }, [householdId, user, householdSettings, accounts]);

  const updateTransactionCategory = useCallback(async (id: string, category: string, relatedHabitIds?: string[]) => {
    if (!householdId || !currentUser) return;

    // Get current transaction status to check if we are verifying a pending one
    // Only increment habits if transitioning from pending_review -> verified (which this function implies by setting status='verified')
    // Ideally we should check the current status, but for now assuming this is called from Action Queue (pending items)

    // 1. Update Transaction
    await updateDoc(doc(db, `households/${householdId}/transactions`, id), {
      category,
      status: 'verified',
      relatedHabitIds: relatedHabitIds || []
    });

    // 2. Increment Habits if any
    if (relatedHabitIds && relatedHabitIds.length > 0) {
      let totalPointsChange = 0;
      let successfulHabitsCount = 0;

      // We need to process each habit sequentially or carefully to update household points correctly
      // Since toggleHabit updates household points atomically with increment(), calling it multiple times is safe for the counter
      // However, we need to be careful not to trigger race conditions on the habit document if updated in parallel
      // Ideally, we should do this in a batch or transaction, but `processToggleHabit` returns derived state that depends on reads

      // Let's loop and process
      for (const habitId of relatedHabitIds) {
        const habit = habits.find(h => h.id === habitId);
        if (habit) {
          // Use extracted business logic
          const result = processToggleHabit(habit, 'up');
          if (result) {
            // Update habit doc
            await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
              count: result.updatedHabit.count,
              totalCount: result.updatedHabit.totalCount,
              completedDates: result.updatedHabit.completedDates,
              streakDays: result.updatedHabit.streakDays,
              lastUpdated: serverTimestamp(),
            });

            // Accumulate points change
            totalPointsChange += result.pointsChange;
            successfulHabitsCount++;
          }
        } else {
          console.warn(`Habit ID ${habitId} not found in habits array. Skipping habit increment.`);
        }
      }

      // 3. Update Household Points (Batch the points update if possible, or just one big increment)
      if (totalPointsChange !== 0) {
        await updateDoc(doc(db, `households/${householdId}`), {
          'points.daily': increment(totalPointsChange),
          'points.weekly': increment(totalPointsChange),
          'points.total': increment(totalPointsChange),
        });

        // Toast feedback for habits
        const sign = totalPointsChange > 0 ? '+' : '';
        toast(
          <div className="flex items-center gap-2">
            <span className="font-bold">{sign}{totalPointsChange} pts</span>
            <span className="text-sm opacity-80">from {successfulHabitsCount} habit(s)</span>
          </div>,
          {
            duration: 2000,
            icon: '🌟',
            style: {
              background: '#ECFDF5',
              color: '#065F46',
              border: '1px solid #A7F3D0',
            },
          }
        );
      }
    }

    // DO NOT update bucket.spent - it's now calculated in real-time from transactions
    // The bucketSpentMap effect will automatically recalculate when transactions change

    toast.success('Verified & Categorized!');
  }, [householdId, currentUser, habits]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      const oldAmount = transaction.amount;
      const newAmount = updates.amount ?? oldAmount;
      const amountDifference = newAmount - oldAmount;

      // Recalculate pay period if date changed
      let payPeriodId = transaction.payPeriodId;
      if (updates.date) {
        payPeriodId = getPayPeriodForTransaction(updates.date, householdSettings?.lastPaycheckDate);
      }

      // Sanitize optional string fields - remove undefined or empty strings from updates
      // This prevents Firestore validation errors for empty strings
      const sanitizedUpdates: Record<string, unknown> = { ...updates };
      if (sanitizedUpdates.store === undefined || sanitizedUpdates.store === '') {
        delete sanitizedUpdates.store;
      } else if (typeof sanitizedUpdates.store === 'string') {
        sanitizedUpdates.store = sanitizedUpdates.store.trim();
      }
      if (sanitizedUpdates.accountId === undefined || sanitizedUpdates.accountId === '') {
        delete sanitizedUpdates.accountId;
      } else if (typeof sanitizedUpdates.accountId === 'string') {
        sanitizedUpdates.accountId = sanitizedUpdates.accountId.trim();
      }
      if (sanitizedUpdates.subBucketId === undefined || sanitizedUpdates.subBucketId === '') {
        delete sanitizedUpdates.subBucketId;
      } else if (typeof sanitizedUpdates.subBucketId === 'string') {
        sanitizedUpdates.subBucketId = sanitizedUpdates.subBucketId.trim();
      }
      if (sanitizedUpdates.notes === undefined || sanitizedUpdates.notes === '') {
        delete sanitizedUpdates.notes;
      } else if (typeof sanitizedUpdates.notes === 'string') {
        sanitizedUpdates.notes = sanitizedUpdates.notes.trim();
      }

      // Update transaction in Firestore
      await updateDoc(doc(db, `households/${householdId}/transactions`, id), {
        ...sanitizedUpdates,
        payPeriodId,
      });

      // Update checking account balance if amount changed (atomic server-side delta).
      if (amountDifference !== 0) {
        const checkingAcc = accounts.find(a => a.type === 'checking');
        if (checkingAcc) {
          await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
            balance: increment(roundMoney(-amountDifference)),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      toast.success('Transaction updated!');
    } catch (error) {
      console.error('[updateTransaction] Failed:', error);
      toast.error('Failed to update transaction');
      throw error;
    }
  }, [householdId, transactions, householdSettings, accounts]);

  const deleteTransaction = useCallback(async (id: string) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Restore checking account balance atomically (server-side delta avoids
      // lost updates from concurrent edits / stale local state).
      const checkingAcc = accounts.find(a => a.type === 'checking');
      if (checkingAcc) {
        await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
          balance: increment(roundMoney(transaction.amount)),
          lastUpdated: serverTimestamp(),
        });
      }

      // Delete transaction from Firestore
      await deleteDoc(doc(db, `households/${householdId}/transactions`, id));

      toast.success('Transaction deleted');
    } catch (error) {
      console.error('[deleteTransaction] Failed:', error);
      toast.error('Failed to delete transaction');
      throw error;
    }
  }, [householdId, transactions, accounts]);

  const splitTransaction = useCallback(async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    if (!householdId || !user) return;

    try {
      const batch = writeBatch(db);
      const originalTx = transactions.find(t => t.id === originalTransactionId);

      if (!originalTx) {
        throw new Error('Original transaction not found');
      }

      // 1. Delete original transaction
      const originalTxRef = doc(db, `households/${householdId}/transactions`, originalTransactionId);
      batch.delete(originalTxRef);

      // 2. Create new transactions
      newTransactions.forEach(tx => {
        const newTxRef = doc(collection(db, `households/${householdId}/transactions`));
        const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

        batch.set(newTxRef, {
          ...tx,
          payPeriodId: payPeriodId || null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });

      // 3. Commit batch
      // Note: We don't need to update account balance because the sum of new transactions
      // equals the original transaction amount, so the net change is 0.
      await batch.commit();

      toast.success('Transaction split successfully');
    } catch (error) {
      console.error('[splitTransaction] Failed:', error);
      toast.error('Failed to split transaction');
      throw error;
    }
  }, [householdId, user, transactions, householdSettings]);


  // --- ACTIONS: YEARLY GOALS ---

  const createYearlyGoal = useCallback(async (goal: Omit<YearlyGoal, 'id'>) => {
    if (!householdId || !user) return;

    await addDoc(collection(db, `households/${householdId}/yearlyGoals`), {
      ...goal,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      status: 'in_progress',
      successfulMonths: [],
    });

    toast.success('Yearly goal created!');
  }, [householdId, user]);

  const updateYearlyGoal = useCallback(async (goalId: string, updates: Partial<YearlyGoal>) => {
    if (!householdId) return;

    await updateDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId), updates);
    toast.success('Yearly goal updated');
  }, [householdId]);

  const updateYearlyGoalProgress = useCallback(async (goalId: string, month: string, success: boolean) => {
    if (!householdId) return;

    const goal = yearlyGoals.find(g => g.id === goalId);
    if (!goal) return;

    let updatedMonths = [...goal.successfulMonths];

    if (success && !updatedMonths.includes(month)) {
      updatedMonths.push(month);
    } else if (!success && updatedMonths.includes(month)) {
      updatedMonths = updatedMonths.filter(m => m !== month);
    }

    // Check if yearly goal is achieved
    const isAchieved = updatedMonths.length >= goal.requiredMonths;

    const updates: Partial<YearlyGoal> = {
      successfulMonths: updatedMonths,
    };

    if (isAchieved && goal.status !== 'achieved') {
      updates.status = 'achieved';
      updates.achievedAt = serverTimestamp() as unknown as string;
    }

    await updateDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId), updates);

    if (isAchieved) {
      toast.success(`🎉 Yearly goal achieved: ${goal.title}!`, { duration: 5000 });
    }
  }, [householdId, yearlyGoals]);

  const deleteYearlyGoal = useCallback(async (goalId: string) => {
    if (!householdId) return;

    await deleteDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId));
    toast.success('Yearly goal deleted');
  }, [householdId]);

  // --- ACTIONS: CHALLENGES & REWARDS ---

  const updateChallenge = useCallback(async (challenge: Challenge) => {
    if (!householdId) return;

    // Calculate currentValue from linked habits
    const linkedHabits = habits.filter(h => challenge.relatedHabitIds.includes(h.id));

    const { currentValue } = calculateChallengeProgress(challenge, linkedHabits);

    // Build update object, filtering out undefined values (Firestore rejects undefined)
    const updatedChallenge = Object.fromEntries(
      Object.entries({
        ...challenge,
        currentValue,
        // Support both old and new schema fields
        targetValue: challenge.targetValue ?? challenge.targetTotalCount,
        targetType: challenge.targetType ?? 'count',
      }).filter(([, value]) => value !== undefined)
    );

    if (activeChallenge?.id) {
      await updateDoc(doc(db, `households/${householdId}/challenges`, activeChallenge.id), updatedChallenge);
    } else {
      // Remove placeholder ID if it exists
      const { id: _id, ...newChallengeData } = updatedChallenge;

      await addDoc(collection(db, `households/${householdId}/challenges`), {
        ...newChallengeData,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });
    }
    toast.success('Challenge Updated');
  }, [householdId, habits, activeChallenge, user]);

  const markChallengeComplete = useCallback(async (challengeId: string, success: boolean) => {
    if (!householdId) return;

    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    // Update challenge status
    await updateDoc(doc(db, `households/${householdId}/challenges`, challengeId), {
      status: success ? 'success' : 'failed',
      completedAt: serverTimestamp(),
    });

    // If successful and linked to yearly goal, update yearly goal progress
    if (success && challenge.yearlyGoalId) {
      const monthKey = challenge.month; // Already in YYYY-MM format
      await updateYearlyGoalProgress(challenge.yearlyGoalId, monthKey, true);
    }

    toast.success(success ? '🎉 Challenge completed!' : 'Challenge marked failed');
  }, [householdId, challenges, updateYearlyGoalProgress]);

  const redeemReward = useCallback(async (rewardId: string) => {
    if (!householdId) return;

    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return;

    // Use transaction to atomically check and deduct points
    // This prevents race conditions where multiple users redeem simultaneously
    try {
      await runTransaction(db, async (transaction) => {
        const householdRef = doc(db, `households/${householdId}`);
        const householdDoc = await transaction.get(householdRef);

        if (!householdDoc.exists()) {
          throw new Error('Household not found');
        }

        const currentTotalPoints = householdDoc.data().points?.total || 0;

        if (currentTotalPoints < reward.cost) {
          throw new Error('Not enough points');
        }

        // Atomically deduct points
        transaction.update(householdRef, {
          'points.total': increment(-reward.cost),
        });
      });

      toast.success(`Redeemed: ${reward.title}`);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not enough points') {
        toast.error('Not enough points');
      } else {
        console.error('[redeemReward] Transaction failed:', error);
        toast.error('Failed to redeem reward');
      }
    }
  }, [householdId, rewards]);

  // --- ACTIONS: FREEZE BANK ---

  const useFreezeBankToken = useCallback(async (habitId: string, targetDate: string) => {
    if (!householdId || !freezeBank || freezeBank.tokens <= 0) {
      toast.error('No freeze tokens available');
      return;
    }

    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    // Validate token usage
    const validation = canUseFreezeBankToken(habit, targetDate, freezeBank.tokens);
    if (!validation.allowed) {
      toast.error(validation.reason || 'Cannot use freeze token');
      return;
    }

    // Add the date to completedDates if not already present
    const updatedCompletedDates = [...habit.completedDates];
    if (!updatedCompletedDates.includes(targetDate)) {
      updatedCompletedDates.push(targetDate);
      updatedCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    }

    // Recalculate streak with patched date
    const newStreak = calculateStreak(updatedCompletedDates);

    // Update habit
    await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
      completedDates: updatedCompletedDates,
      streakDays: newStreak,
    });

    // Create history entry
    const historyEntry: FreezeBankHistoryEntry = {
      id: crypto.randomUUID(),
      type: 'used',
      amount: -1,
      date: format(new Date(), 'yyyy-MM-dd'),
      habitId,
      habitDate: targetDate,
      notes: `Used token to patch ${habit.title} on ${targetDate}`,
      createdAt: new Date().toISOString(),
    };

    // Update freezeBank balance and history
    const updatedFreezeBank: FreezeBank = {
      ...freezeBank,
      tokens: freezeBank.tokens - 1,
      history: [...freezeBank.history, historyEntry],
    };

    await updateDoc(doc(db, `households/${householdId}`), {
      freezeBank: updatedFreezeBank,
    });

    toast.success(`❄️ Freeze token used! ${habit.title} patched for ${targetDate}`);
  }, [householdId, freezeBank, habits]);

  const rolloverFreezeBankTokens = useCallback(async () => {
    if (!householdId || !freezeBank) return;

    const now = new Date();
    const currentMonth = format(now, 'yyyy-MM');

    // Only rollover if we're in a new month
    if (freezeBank.lastRolloverMonth === currentMonth) return;

    // Calculate new balance: min(current, 1) + 2, max 3
    const rolloverAmount = Math.min(freezeBank.tokens, 1);
    const newBalance = Math.min(rolloverAmount + 2, 3);
    const tokensAdded = newBalance - freezeBank.tokens;

    // Create history entry
    const historyEntry: FreezeBankHistoryEntry = {
      id: crypto.randomUUID(),
      type: 'rollover',
      amount: tokensAdded,
      date: format(now, 'yyyy-MM-dd'),
      notes: `Monthly rollover: ${rolloverAmount} carried + 2 new = ${newBalance} total`,
      createdAt: new Date().toISOString(),
    };

    // Update freezeBank
    const updatedFreezeBank: FreezeBank = {
      ...freezeBank,
      tokens: newBalance,
      lastRolloverDate: format(now, 'yyyy-MM-dd'),
      lastRolloverMonth: currentMonth,
      history: [...freezeBank.history, historyEntry],
    };

    await updateDoc(doc(db, `households/${householdId}`), {
      freezeBank: updatedFreezeBank,
    });

    toast.success(`❄️ Freeze Bank rollover: ${tokensAdded} tokens added!`);
  }, [householdId, freezeBank]);

  // --- ACTIONS: MEMBER MANAGEMENT ---

  const addMember = useCallback(async (memberData: Partial<HouseholdMember>) => {
    if (!householdId) return;

    try {
      // If UID is not provided (e.g. manual add), generate one
      // Note: These users cannot log in unless linked to a real auth account later
      const newMemberUid = memberData.uid || crypto.randomUUID();

      const member: HouseholdMember = {
        uid: newMemberUid,
        displayName: memberData.displayName || 'New Member',
        email: memberData.email || '',
        role: memberData.role || 'member',
        // Spread memberData first, then override points to ensure new members start at 0
        ...memberData,
        points: { daily: 0, weekly: 0, total: 0 },
      } as HouseholdMember;

      // 1. Add to members subcollection
      // Using setDoc with the UID as document ID
      await setDoc(doc(db, `households/${householdId}/members`, newMemberUid), {
        ...member,
        joinedAt: serverTimestamp(),
      });

      // 2. Add to household memberUids array
      await updateDoc(doc(db, `households/${householdId}`), {
        memberUids: arrayUnion(newMemberUid),
      });

      toast.success('Member added successfully');
    } catch (error) {
      console.error('[addMember] Failed:', error);
      toast.error('Failed to add member');
      throw error;
    }
  }, [householdId]);

  const updateMember = useCallback(async (memberId: string, updates: Partial<HouseholdMember>) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, `households/${householdId}/members`, memberId), updates);
      toast.success('Member updated successfully');
    } catch (error) {
      console.error('[updateMember] Failed:', error);
      toast.error('Failed to update member');
      throw error;
    }
  }, [householdId]);

  const removeMember = useCallback(async (memberId: string) => {
    if (!householdId) return;

    try {
      // Use batch to make both operations atomic
      const batch = writeBatch(db);

      // 1. Remove from household memberUids array
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        memberUids: arrayRemove(memberId),
      });

      // 2. Delete member document from subcollection
      const memberRef = doc(db, `households/${householdId}/members`, memberId);
      batch.delete(memberRef);

      // Commit both changes atomically
      await batch.commit();

      toast.success('Member removed successfully');
    } catch (error) {
      console.error('[removeMember] Failed:', error);
      toast.error('Failed to remove member');
      throw error;
    }
  }, [householdId]);

  // --- ACTIONS: MEALS ---

  const addMeal = useCallback(async (meal: Omit<Meal, 'id'>, options?: { suppressToast?: boolean }): Promise<string> => {
    if (!householdId || !user) throw new Error("Not authenticated");
    try {
      const sanitizedMeal = sanitizeFirestoreData(meal);
      const docRef = await addDoc(collection(db, `households/${householdId}/meals`), {
        ...sanitizedMeal,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      if (!options?.suppressToast) toast.success('Meal added');
      return docRef.id;
    } catch (error) {
      console.error('[addMeal] Failed:', error);
      toast.error('Failed to add meal');
      throw error;
    }
  }, [householdId, user]);

  const updateMeal = useCallback(async (meal: Meal) => {
    if (!householdId) return;
    try {
      const { id, ...mealData } = meal;
      const sanitizedData = sanitizeFirestoreData(mealData);
      await updateDoc(doc(db, `households/${householdId}/meals`, id), {
        ...sanitizedData,
        updatedAt: serverTimestamp(),
      });
      toast.success('Meal updated');
    } catch (error) {
      console.error('[updateMeal] Failed:', error);
      toast.error('Failed to update meal');
    }
  }, [householdId]);

  const deleteMeal = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/meals`, id));
      toast.success('Meal deleted');
    } catch (error) {
      console.error('[deleteMeal] Failed:', error);
      toast.error('Failed to delete meal');
    }
  }, [householdId]);

  // --- ACTIONS: SHOPPING LIST ---

  const addShoppingItem = useCallback(async (item: Omit<ShoppingItem, 'id'>) => {
    if (!householdId) return;
    try {
      const sanitizedItem = sanitizeFirestoreData(item);
      await addDoc(collection(db, `households/${householdId}/shoppingList`), {
        ...sanitizedItem,
        createdAt: serverTimestamp(),
      });
      toast.success('Added to shopping list');
    } catch (error) {
      console.error('[addShoppingItem] Failed:', error);
      toast.error('Failed to add item');
    }
  }, [householdId]);

  const addShoppingItems = useCallback(async (items: Omit<ShoppingItem, 'id'>[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      const collectionRef = collection(db, `households/${householdId}/shoppingList`);

      items.forEach(item => {
        const docRef = doc(collectionRef); // Generate new ID
        const sanitizedItem = sanitizeFirestoreData(item);
        batch.set(docRef, {
          ...sanitizedItem,
          createdAt: serverTimestamp(),
        });
      });

      await batch.commit();
      // Toast handled by caller or generic success
    } catch (error) {
      console.error('[addShoppingItems] Failed:', error);
      toast.error('Failed to add items');
      throw error;
    }
  }, [householdId]);

  const updateShoppingItem = useCallback(async (item: ShoppingItem) => {
    if (!householdId) return;
    try {
      const { id, ...itemData } = item;
      const sanitizedData = sanitizeFirestoreData(itemData);
      await updateDoc(doc(db, `households/${householdId}/shoppingList`, id), {
        ...sanitizedData,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[updateShoppingItem] Failed:', error);
      toast.error('Failed to update item');
    }
  }, [householdId]);

  const reorderShoppingItems = useCallback(async (items: ShoppingItem[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      items.forEach((item, index) => {
        const ref = doc(db, `households/${householdId}/shoppingList`, item.id);
        batch.update(ref, { order: index });
      });
      await batch.commit();
    } catch (error) {
      console.error('[reorderShoppingItems] Failed:', error);
      toast.error('Failed to reorder items');
    }
  }, [householdId]);

  const deleteShoppingItem = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/shoppingList`, id));
      toast.success('Removed from shopping list');
    } catch (error) {
      console.error('[deleteShoppingItem] Failed:', error);
      toast.error('Failed to remove item');
    }
  }, [householdId]);

  const toggleShoppingItemPurchased = useCallback(async (id: string) => {
    if (!householdId) return;

    try {
      const item = shoppingList.find(i => i.id === id);
      if (!item) return;

      if (!item.isPurchased) {
        // Mark as purchased
        await updateDoc(doc(db, `households/${householdId}/shoppingList`, id), {
          isPurchased: true,
        });

        const normalizedItemName = normalizeToKey(item.name);
        const normalizedItemCategory = normalizeToKey(item.category);

        // 1. Add to Grocery Catalog (History)
        // Check if item exists in catalog (by normalized name/category)
        const existingCatalogItem = groceryCatalog.find(c =>
          normalizeToKey(c.name) === normalizedItemName &&
          normalizeToKey(c.category) === normalizedItemCategory
        );

        if (existingCatalogItem) {
          // Update existing catalog item
          await updateDoc(doc(db, `households/${householdId}/groceryCatalog`, existingCatalogItem.id), {
            lastPurchased: new Date().toISOString(),
            purchaseCount: increment(1),
            // Update default store if current item has one
            ...(item.store ? { defaultStore: item.store } : {}),
            // Update default quantity if current item has one
            ...(item.quantity ? { defaultQuantity: item.quantity } : {})
          });
        } else {
          // Add new catalog item
          const newCatalogItem = {
            name: item.name,
            category: item.category,
            defaultQuantity: item.quantity,
            defaultStore: item.store,
            lastPurchased: new Date().toISOString(),
            purchaseCount: 1
          };
          await addDoc(collection(db, `households/${householdId}/groceryCatalog`), sanitizeFirestoreData(newCatalogItem));
        }

        toast.success('Marked as purchased');

      } else {
        // Unmark (undo)
        await updateDoc(doc(db, `households/${householdId}/shoppingList`, id), {
          isPurchased: false,
        });
        toast('Marked as not purchased', { icon: 'ℹ️' });
      }

    } catch (error) {
      console.error('[toggleShoppingItemPurchased] Failed:', error);
      toast.error('Failed to update status');
    }
  }, [householdId, shoppingList, groceryCatalog]);

  const clearPurchasedShoppingItems = useCallback(async () => {
    if (!householdId) return;

    try {
      const batch = writeBatch(db);
      const purchasedItems = shoppingList.filter(item => item.isPurchased);

      if (purchasedItems.length === 0) return;

      purchasedItems.forEach(item => {
        const itemRef = doc(db, `households/${householdId}/shoppingList`, item.id);
        batch.delete(itemRef);
      });

      await batch.commit();
      toast.success(`Cleared ${purchasedItems.length} items`);
    } catch (error) {
      console.error('[clearPurchasedShoppingItems] Failed:', error);
      toast.error('Failed to clear items');
    }
  }, [householdId, shoppingList]);

  // --- ACTIONS: SHOPPING SETTINGS ---

  const addStore = useCallback(async (store: Omit<Store, 'id'>) => {
    if (!householdId) return;
    try {
      const newStore = { ...store, id: crypto.randomUUID() };
      await updateDoc(doc(db, `households/${householdId}`), {
        stores: arrayUnion(newStore)
      });
      toast.success('Store added');
    } catch (error) {
      console.error('[addStore] Failed:', error);
      toast.error('Failed to add store');
    }
  }, [householdId]);

  const updateStore = useCallback(async (updatedStore: Store) => {
    if (!householdId || !householdSettings) return;
    try {
      // We need to replace the object in the array
      const currentStores = householdSettings.stores || [];
      const newStores = currentStores.map(s => s.id === updatedStore.id ? updatedStore : s);

      await updateDoc(doc(db, `households/${householdId}`), {
        stores: newStores
      });
      toast.success('Store updated');
    } catch (error) {
      console.error('[updateStore] Failed:', error);
      toast.error('Failed to update store');
    }
  }, [householdId, householdSettings]);

  const deleteStore = useCallback(async (id: string) => {
    if (!householdId || !householdSettings) return;
    try {
      const storeToDelete = householdSettings.stores?.find(s => s.id === id);
      const storeName = storeToDelete?.name;

      const batch = writeBatch(db);
      const householdRef = doc(db, `households/${householdId}`);

      // 1. Remove store from household settings
      const currentStores = householdSettings.stores || [];
      const newStores = currentStores.filter(s => s.id !== id);
      batch.update(householdRef, { stores: newStores });

      // 2. Remove store tag from shopping list items
      // Note: This relies on matching by name string as per current schema
      if (storeName) {
        const itemsToUpdate = shoppingList.filter(item => item.store === storeName);
        itemsToUpdate.forEach(item => {
          const itemRef = doc(db, `households/${householdId}/shoppingList`, item.id);
          // Use deleteField() to remove the field entirely or set to null/undefined
          // Since schema defines it as optional string, we update it to delete the field
          // We can just update with { store: deleteField() } but we need to import deleteField
          // Alternatively, just update with store: null or similar if the sanitizer handles it.
          // The sanitizer `sanitizeFirestoreData` removes undefined, converts "" to null.
          batch.update(itemRef, { store: deleteField() });
        });
      }

      await batch.commit();
      toast.success('Store deleted');
    } catch (error) {
      console.error('[deleteStore] Failed:', error);
      toast.error('Failed to delete store');
    }
  }, [householdId, householdSettings, shoppingList]);

  const updateGroceryCategories = useCallback(async (categories: string[]) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}`), {
        groceryCategories: categories
      });
      toast.success('Categories updated');
    } catch (error) {
      console.error('[updateGroceryCategories] Failed:', error);
      toast.error('Failed to update categories');
    }
  }, [householdId]);

  const addQuickStockList = useCallback(async (list: Omit<QuickStockList, 'id'>) => {
    if (!householdId) return;
    try {
      const newList = { ...list, id: crypto.randomUUID() };
      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: arrayUnion(newList)
      });
      toast.success('Template created');
    } catch (error) {
      console.error('[addQuickStockList] Failed:', error);
      toast.error('Failed to create template');
    }
  }, [householdId]);

  const updateQuickStockList = useCallback(async (updatedList: QuickStockList) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentLists = householdSettings.quickStockLists || [];
      const newLists = currentLists.map(l => l.id === updatedList.id ? updatedList : l);

      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: newLists
      });
      toast.success('Template updated');
    } catch (error) {
      console.error('[updateQuickStockList] Failed:', error);
      toast.error('Failed to update template');
    }
  }, [householdId, householdSettings]);

  const deleteQuickStockList = useCallback(async (id: string) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentLists = householdSettings.quickStockLists || [];
      const newLists = currentLists.filter(l => l.id !== id);

      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: newLists
      });
      toast.success('Template deleted');
    } catch (error) {
      console.error('[deleteQuickStockList] Failed:', error);
      toast.error('Failed to delete template');
    }
  }, [householdId, householdSettings]);

  // --- ACTIONS: GROCERY CATALOG ---

  const addGroceryCatalogItem = useCallback(async (item: Omit<GroceryCatalogItem, 'id'>): Promise<string> => {
    if (!householdId) throw new Error("Household ID missing");
    try {
      const docRef = await addDoc(collection(db, `households/${householdId}/groceryCatalog`), item);
      return docRef.id;
    } catch (error) {
      console.error('[addGroceryCatalogItem] Failed:', error);
      toast.error('Failed to add to history');
      throw error;
    }
  }, [householdId]);

  const updateGroceryCatalogItem = useCallback(async (id: string, updates: Partial<GroceryCatalogItem>) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/groceryCatalog`, id), updates);
      toast.success('Item updated');
    } catch (error) {
      console.error('[updateGroceryCatalogItem] Failed:', error);
      toast.error('Failed to update item');
    }
  }, [householdId]);

  const deleteGroceryCatalogItem = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/groceryCatalog`, id));
      toast.success('Removed from history');
    } catch (error) {
      console.error('[deleteGroceryCatalogItem] Failed:', error);
      toast.error('Failed to remove item');
    }
  }, [householdId]);

  // --- ACTIONS: MEAL PLAN ---

  const addMealPlanItem = useCallback(async (item: Omit<MealPlanItem, 'id'>, options?: { suppressToast?: boolean, throwOnError?: boolean }) => {
    if (!householdId || !user) return;
    try {
      await addDoc(collection(db, `households/${householdId}/mealPlan`), {
        ...item,
        createdAt: serverTimestamp(),
      });
      if (!options?.suppressToast) {
        toast.success('Added to plan');
      }
    } catch (error) {
      console.error('[addMealPlanItem] Failed:', error);
      if (!options?.suppressToast) {
        toast.error('Failed to add to plan');
      }
      if (options?.throwOnError) {
        throw error;
      }
    }
  }, [householdId, user]);

  const updateMealPlanItem = useCallback(async (id: string, updates: Partial<MealPlanItem>) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/mealPlan`, id), {
        ...updates,
      });
      toast.success('Plan updated');
    } catch (error) {
      console.error('[updateMealPlanItem] Failed:', error);
      toast.error('Failed to update plan');
    }
  }, [householdId]);

  const deleteMealPlanItem = useCallback(async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/mealPlan`, id));
      toast.success('Removed from plan');
    } catch (error) {
      console.error('[deleteMealPlanItem] Failed:', error);
      toast.error('Failed to remove from plan');
    }
  }, [householdId]);

  // --- ACTIONS: TO-DOS ---

  /**
   * Adds a new to-do item.
   * 
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers (e.g., ToDosPage, Dashboard) should display appropriate success/error toasts based on their context.
   * This maintains consistency with updateToDo and deleteToDo, which also delegate toast messaging to their callers.
   * 
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const addToDo = useCallback(async (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => {
    if (!householdId || !user) {
      throw new Error('User not authenticated or household not selected');
    }
    try {
      const sanitizedToDo = sanitizeFirestoreData(todo);
      await addDoc(collection(db, `households/${householdId}/todos`), {
        ...sanitizedToDo,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      // Note: Toast removed to allow UI-specific messaging (consistent with updateToDo/deleteToDo)
    } catch (error) {
      console.error('[addToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  }, [householdId, user]);

  /**
   * Updates an existing to-do item.
   * 
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context.
   * 
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const updateToDo = useCallback(async (id: string, updates: Partial<ToDo>) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      const sanitizedUpdates = sanitizeFirestoreData(updates);
      await updateDoc(doc(db, `households/${householdId}/todos`, id), sanitizedUpdates);
    } catch (error) {
      console.error('[updateToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  }, [householdId]);

  /**
   * Deletes a to-do item.
   * 
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context.
   * 
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const deleteToDo = useCallback(async (id: string) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      await deleteDoc(doc(db, `households/${householdId}/todos`, id));
    } catch (error) {
      console.error('[deleteToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  }, [householdId]);

  /**
   * Marks a to-do item as completed.
   * 
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context, maintaining
   * consistency with addToDo, updateToDo, and deleteToDo.
   * 
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const completeToDo = useCallback(async (id: string) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      await updateDoc(doc(db, `households/${householdId}/todos`, id), {
        isCompleted: true,
        completedAt: serverTimestamp()
      });
      // Note: Toast removed to allow UI-specific messaging (consistent with other CRUD operations)
    } catch (error) {
      console.error('[completeToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  }, [householdId]);


  const refreshInsight = useCallback(async () => {
    if (!householdId) return;

    // Prevent rapid clicking and multiple API calls
    if (isGeneratingInsight) {
      toast.error('An insight is already being generated. Please wait.');
      return;
    }

    // Validate that there's sufficient data to analyze
    const hasTransactions = Array.isArray(transactions) && transactions.length > 0;
    const hasHabits = Array.isArray(habits) && habits.length > 0;
    if (!hasTransactions && !hasHabits) {
      toast.error('Not enough data to generate insights yet. Add some transactions or habit activity first.');
      return;
    }

    try {
      setIsGeneratingInsight(true);
      toast.loading('Generating insight...', { id: 'insight-loading' });

      // Dynamically load Gemini service only when needed
      const { generateInsight } = await import('@/services/geminiService');

      // Get last 3 previous insights to avoid repetition
      const previousInsightsTexts = insightsHistory
        .slice(0, 3)
        .map(i => i.text);

      const { text, actions } = await generateInsight(householdId, transactions, habits, previousInsightsTexts);

      const newInsight: Omit<Insight, 'id'> = {
        text,
        actions,
        generatedAt: new Date().toISOString(),
        type: 'general'
      };

      await addDoc(collection(db, `households/${householdId}/insights`), newInsight);

      toast.success('New insight generated!', { id: 'insight-loading', icon: '✨' });
    } catch (error) {
      console.error("Failed to generate insight:", error);
      toast.error('Failed to generate insight', { id: 'insight-loading' });
    } finally {
      setIsGeneratingInsight(false);
    }
  }, [householdId, isGeneratingInsight, transactions, habits, insightsHistory]);

  // Check for freeze bank rollover on 1st of month (or first login)
  const checkFreezeBankRollover = useCallback(async () => {
    if (!householdId || !freezeBank) return;

    const currentMonth = format(new Date(), 'yyyy-MM');

    // Check if we're in a new month
    if (freezeBank.lastRolloverMonth !== currentMonth) {
      await rolloverFreezeBankTokens();
    }
  }, [householdId, freezeBank, rolloverFreezeBankTokens]);

  // Use midnight scheduler to check for rollover with a delay to avoid conflicts
  useMidnightScheduler(checkFreezeBankRollover, !!(householdId && freezeBank), { initialDelayMs: 500 });

  // Show skeletons only while a household is set but its first snapshot hasn't
  // arrived yet (or a different household is still loading). No household
  // (pre-setup) is not a "loading" state.
  const isLoading = !!householdId && loadedHouseholdId !== householdId;

  // Each slice value is memoized with a TIGHT dependency array so a change in
  // one domain (e.g. a transaction edit) does not produce a new reference for
  // unrelated slices (meals, todos, …) — that is the render-isolation win.

  const financeValue = useMemo<FinanceContextValue>(() => ({
    safeToSpend,
    safeToSpendBreakdown,
    accounts,
    buckets,
    calendarItems,
    transactions,
    currentPeriodId,
    bucketSpentMap,
    bucketHistory,
    addAccount,
    updateAccountBalance,
    setAccountGoal,
    deleteAccount,
    updateAccountOrder,
    reorderAccounts,
    addBucket,
    updateBucket,
    deleteBucket,
    updateBucketLimit,
    reallocateBucket,
    addCalendarItem,
    updateCalendarItem,
    deleteCalendarItem,
    payCalendarItem,
    deferCalendarItem,
    addTransaction,
    updateTransactionCategory,
    updateTransaction,
    deleteTransaction,
    splitTransaction,
  }), [
    safeToSpend, safeToSpendBreakdown, accounts, buckets, calendarItems, transactions, currentPeriodId, bucketSpentMap, bucketHistory,
    addAccount, updateAccountBalance, setAccountGoal, deleteAccount, updateAccountOrder, reorderAccounts,
    addBucket, updateBucket, deleteBucket, updateBucketLimit, reallocateBucket,
    addCalendarItem, updateCalendarItem, deleteCalendarItem, payCalendarItem, deferCalendarItem,
    addTransaction, updateTransactionCategory, updateTransaction, deleteTransaction, splitTransaction,
  ]);

  const gamificationValue = useMemo<GamificationContextValue>(() => ({
    dailyPoints,
    weeklyPoints,
    totalPoints,
    habits,
    activeChallenge,
    challenges,
    yearlyGoals,
    activeYearlyGoals,
    primaryYearlyGoal,
    rewardsInventory: rewards,
    freezeBank,
    ...habitActions,
    updateChallenge,
    markChallengeComplete,
    redeemReward,
    createYearlyGoal,
    updateYearlyGoal,
    updateYearlyGoalProgress,
    deleteYearlyGoal,
    useFreezeBankToken,
    rolloverFreezeBankTokens,
  }), [
    dailyPoints, weeklyPoints, totalPoints, habits, activeChallenge, challenges, yearlyGoals, activeYearlyGoals,
    primaryYearlyGoal, rewards, freezeBank, habitActions,
    updateChallenge, markChallengeComplete, redeemReward,
    createYearlyGoal, updateYearlyGoal, updateYearlyGoalProgress, deleteYearlyGoal,
    useFreezeBankToken, rolloverFreezeBankTokens,
  ]);

  const mealsValue = useMemo<MealsContextValue>(() => ({
    meals,
    shoppingList,
    mealPlan,
    groceryCatalog,
    stores,
    groceryCategories,
    quickStockLists,
    addMeal,
    updateMeal,
    deleteMeal,
    addShoppingItem,
    addShoppingItems,
    updateShoppingItem,
    reorderShoppingItems,
    deleteShoppingItem,
    toggleShoppingItemPurchased,
    clearPurchasedShoppingItems,
    addStore,
    updateStore,
    deleteStore,
    updateGroceryCategories,
    addQuickStockList,
    updateQuickStockList,
    deleteQuickStockList,
    addGroceryCatalogItem,
    updateGroceryCatalogItem,
    deleteGroceryCatalogItem,
    addMealPlanItem,
    updateMealPlanItem,
    deleteMealPlanItem,
  }), [
    meals, shoppingList, mealPlan, groceryCatalog, stores, groceryCategories, quickStockLists,
    addMeal, updateMeal, deleteMeal,
    addShoppingItem, addShoppingItems, updateShoppingItem, reorderShoppingItems, deleteShoppingItem, toggleShoppingItemPurchased, clearPurchasedShoppingItems,
    addStore, updateStore, deleteStore, updateGroceryCategories,
    addQuickStockList, updateQuickStockList, deleteQuickStockList,
    addGroceryCatalogItem, updateGroceryCatalogItem, deleteGroceryCatalogItem,
    addMealPlanItem, updateMealPlanItem, deleteMealPlanItem,
  ]);

  const todosValue = useMemo<TodosContextValue>(() => ({
    todos,
    addToDo,
    updateToDo,
    deleteToDo,
    completeToDo,
  }), [todos, addToDo, updateToDo, deleteToDo, completeToDo]);

  const coreValue = useMemo<HouseholdCoreContextValue>(() => ({
    isLoading,
    currentUser,
    members,
    insight,
    insightsHistory,
    isGeneratingInsight,
    pendingItemsCount,
    apiKeys,
    householdId,
    householdSettings,
    household: householdSettings, // Provide alias
    refreshInsight,
    addMember,
    updateMember,
    removeMember,
  }), [
    isLoading, currentUser, members, insight, insightsHistory, isGeneratingInsight, pendingItemsCount, apiKeys,
    householdId, householdSettings, refreshInsight, addMember, updateMember, removeMember,
  ]);

  return (
    <HouseholdSliceProviders
      finance={financeValue}
      gamification={gamificationValue}
      meals={mealsValue}
      todos={todosValue}
      core={coreValue}
    >
      {children}
    </HouseholdSliceProviders>
  );
};
