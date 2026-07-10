import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode, useCallback } from 'react';
import {
  collection,
  query,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  getDoc,
  getDocs,
  where,
  orderBy,
  increment,
  setDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import {
  householdMemberConverter,
  pendingItemConverter,
  insightConverter,
} from '@/utils/firestoreConverters';
import { db } from '@/firebase.config';
import { useAuth } from '@/contexts/AuthContext';
import {
  Account,
  BudgetBucket,
  Transaction,
  CalendarItem,
  Habit,
  Challenge,
  RewardItem,
  HouseholdMember,
  Household,
  BucketPeriodSnapshot,
  YearlyGoal,
  FreezeBank,
  Meal,
  ShoppingItem,
  MealPlanItem,
  ToDo,
  Insight,
  GroceryCatalogItem,
  Store,
  QuickStockList,
  HouseholdApiKey,
  PendingItem,
  ModuleKey,
  WeeklyRecap,
  SavingsGoal
} from '@/types/schema';
import { calculateSafeToSpendBreakdownFromExpanded } from '@/utils/safeToSpendCalculator';
import { calculatePointsForDate, calculatePointsForDateRange, computeManagedMemberPointsReset, isHabitStale, getHabitResetUpdate } from '@/utils/habitLogic';
import { calculateBucketSpent } from '@/utils/bucketSpentCalculator';
import { migrateBucketsToPeriods, needsMigration, migrateToPaycheckPeriods, needsPaycheckMigration } from '@/utils/migrations/payPeriodMigration';
import { migrateOrphanedHabits, needsHabitMigration } from '@/utils/migrations/habitMigration';
import { migrateDuplicateMeals, needsMealDedup } from '@/utils/migrations/mealDedupMigration';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';
import { usePointsSync, type PointsSyncUpdate } from '@/hooks/usePointsSync';
import { useHabitActions } from '@/hooks/useHabitActions';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  getTransactionWindowStart,
  getMealPlanWindow,
} from '@/utils/listenerWindows';
import { ParsedShoppingList, ParsedTodoList, ParsedExpense } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';
import { isSameDay, isSameWeek, parseISO, format, startOfWeek, addMonths } from 'date-fns';
import { mergeById } from '@/contexts/household/selectors';
import { attachTodoListeners } from '@/contexts/household/listeners/todoListeners';
import { attachMealListeners } from '@/contexts/household/listeners/mealListeners';
import { attachShoppingListeners } from '@/contexts/household/listeners/shoppingListeners';
import { attachGamificationListeners } from '@/contexts/household/listeners/gamificationListeners';
import { attachCoreListeners } from '@/contexts/household/listeners/coreListeners';
import { attachFinanceListeners, attachTransactionsListener } from '@/contexts/household/listeners/financeListeners';
import {
  makeAccountMutations,
  makeBucketCrudMutations,
  makeReallocateBucket,
  makeResetBucketsForNewPeriod,
  makeInitializeFirstPeriod,
  makeHandlePaycheckApproval,
  makeTransactionLoaders,
  makeLoadAllBucketHistory,
} from '@/contexts/household/mutations/financeMutations';
import { makeSavingsGoalMutations } from '@/contexts/household/mutations/savingsGoalMutations';
import {
  makeAddCalendarItem,
  makeUpdateCalendarItem,
  makeCalendarDeleteMutations,
  makeDeleteCalendarItem,
  makePayCalendarItem,
  makeDeferCalendarItem,
} from '@/contexts/household/mutations/calendarMutations';
import {
  makeAddTransaction,
  makeUpdateTransactionCategory,
  makeUpdateTransaction,
  makeDeleteTransaction,
  makeMergeTransactions,
  makeKeepBothTransactions,
  makeSplitTransaction,
} from '@/contexts/household/mutations/transactionMutations';
import {
  makeGetTransactionComments,
  makeAddTransactionComment,
  makeDeleteTransactionComment,
} from '@/contexts/household/mutations/commentMutations';
import {
  makeAddToDo,
  makeTodoCrudMutations,
  makeCompleteToDo,
  makeLoadOlderCompletedTodos,
} from '@/contexts/household/mutations/todoMutations';
import {
  makeAddMeal,
  makeMealCrudMutations,
  makeRefreshMealPlanWeek,
  makeEnsureMealPlanWeek,
  makeAddMealPlanItem,
  makeMealPlanItemEditMutations,
} from '@/contexts/household/mutations/mealMutations';
import {
  makeShoppingListMutations,
  makeToggleShoppingItemPurchased,
  makeClearPurchasedShoppingItems,
  makeStoreSettingsMutations,
  makeDeleteStore,
} from '@/contexts/household/mutations/shoppingMutations';
import {
  makeCreateYearlyGoal,
  makeYearlyGoalCrudMutations,
  makeUpdateYearlyGoalProgress,
  makeUpdateChallenge,
  makeAddChallenge,
  makeMarkChallengeComplete,
  makeRedeemReward,
  makeAddReward,
  makeRewardCrudMutations,
  makeRequestRedemption,
  makeRedemptionResolutionMutations,
  makeAutoApplyFreezes,
  makeRolloverFreezeBankTokens,
} from '@/contexts/household/mutations/gamificationMutations';
import {
  makeHouseholdSettingsMutations,
  makeRefreshInsight,
} from '@/contexts/household/mutations/coreMutations';
import {
  makeAddMember,
  makeMemberCrudMutations,
  makeDeleteHousehold,
} from '@/contexts/household/mutations/memberMutations';
import {
  makeAddKidProfile,
  makeKidProfileCrudMutations,
} from '@/contexts/household/mutations/kidMutations';
import type {
  MutationOpts,
  HouseholdContextType,
  FinanceContextValue,
  GamificationContextValue,
  MealPlanContextValue,
  ShoppingContextValue,
  MealsContextValue,
  TodosContextValue,
  HouseholdCoreContextValue,
} from '@/contexts/household/types';

export type {
  MutationOpts,
  HouseholdContextType,
  FinanceContextValue,
  GamificationContextValue,
  MealPlanContextValue,
  ShoppingContextValue,
  MealsContextValue,
  TodosContextValue,
  HouseholdCoreContextValue,
};

// ---------------------------------------------------------------------------
// VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE MODEL (Plan 015 "Option A" + account tagging)
//
// A transaction's balance impact lands on the account it is TAGGED to
// (`tx.accountId`), falling back to the checking account when untagged
// (backward compatible). The sign is account-type aware (see
// utils/accountImpact.ts):
//   - Asset (checking/savings) or untagged: income +amount, expense −amount.
//   - Credit (balance = debt owed, stored POSITIVE): a charge increases the
//     debt (+amount), a payment (`creditPayment === true`) decreases it.
//
// The checking-account balance is entered MANUALLY and is assumed by
// Safe-to-Spend NOT to reflect un-cleared (pending_review) spending — the
// calculator subtracts current-period pending spend separately, and now
// excludes pending transactions tagged to non-checking accounts (see
// utils/safeToSpendCalculator.ts:sumPendingSpend). The invariant that keeps the
// two consistent:
//
//   An account's balance reflects a transaction's account-aware impact IF AND
//   ONLY IF the transaction is `verified`. A `pending_review` transaction NEVER
//   touches any balance; on a pending → verified transition the impact is
//   applied, on verified → pending it is reversed, on delete only an EFFECTIVE
//   (verified) impact is reversed. Each transaction's impact lands exactly once
//   over its lifetime while verified.
//
// `effectiveAccountImpact(tx, account)` is the status-gated, account-aware
// signed amount; `resolveTargetAccount(accountId, accounts)` picks the doc to
// mutate. Every create/mutate/delete path computes per-account deltas as
//   delta = effectiveAccountImpact(after, target) − effectiveAccountImpact(before, target)
// and writes increment(roundMoney(delta)) only when non-zero. When an edit
// MOVES a transaction between accounts the old account's impact is reversed and
// the new account's applied (merged per-account so a single batch never writes
// the same doc twice).
// ---------------------------------------------------------------------------

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);
const GamificationContext = createContext<GamificationContextValue | undefined>(undefined);
const MealPlanContext = createContext<MealPlanContextValue | undefined>(undefined);
const ShoppingContext = createContext<ShoppingContextValue | undefined>(undefined);
const TodosContext = createContext<TodosContextValue | undefined>(undefined);
const HouseholdCoreContext = createContext<HouseholdCoreContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useFinance = (): FinanceContextValue => {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FirebaseHouseholdProvider');
  return ctx;
};

/**
 * Memoized recurring-calendar expansion over an arbitrary [start, end] window.
 *
 * `expandCalendarItems` is moderately expensive (it walks every recurring item
 * across the window), so widgets that each needed a different window previously
 * recomputed it independently on every render. This hook centralises that work:
 * it pulls `calendarItems` from the finance slice and memoizes the expansion
 * keyed on the raw item list plus the window bounds, so a render that doesn't
 * change any of those reuses the prior result. Each distinct window still gets
 * its own expansion (the bounds are part of the cache key), keeping results
 * byte-for-byte identical to the previous per-call-site behaviour.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useExpandedCalendarItems = (start: Date, end: Date): CalendarItem[] => {
  const { calendarItems } = useFinance();
  const startMs = start.getTime();
  const endMs = end.getTime();
  return useMemo(
    () => expandCalendarItems(calendarItems, new Date(startMs), new Date(endMs)),
    [calendarItems, startMs, endMs]
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useGamification = (): GamificationContextValue => {
  const ctx = useContext(GamificationContext);
  if (!ctx) throw new Error('useGamification must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useMealPlan = (): MealPlanContextValue => {
  const ctx = useContext(MealPlanContext);
  if (!ctx) throw new Error('useMealPlan must be used within FirebaseHouseholdProvider');
  return ctx;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useShopping = (): ShoppingContextValue => {
  const ctx = useContext(ShoppingContext);
  if (!ctx) throw new Error('useShopping must be used within FirebaseHouseholdProvider');
  return ctx;
};

/**
 * Backward-compatible shim. Composes both meal-plan and shopping slices into
 * the legacy combined shape so un-migrated consumers keep working unchanged.
 *
 * NOTE: because it subscribes to both meal-plan and shopping contexts, a
 * component using this hook re-renders on any change in either slice. Migrate
 * hot components to `useMealPlan()` or `useShopping()` to get render-isolation.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useMeals = (): MealsContextValue => {
  const mealPlan = useMealPlan();
  const shopping = useShopping();
  return useMemo(
    () => ({ ...mealPlan, ...shopping }),
    [mealPlan, shopping]
  );
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
 * NOTE: because it subscribes to all contexts, a component using this hook
 * re-renders on any slice change. Migrate hot components to the granular hooks
 * above (`useFinance`, `useMealPlan`, `useShopping`, …) to get the
 * render-isolation win.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useHousehold = (): HouseholdContextType => {
  const finance = useFinance();
  const gamification = useGamification();
  const mealPlan = useMealPlan();
  const shopping = useShopping();
  const todos = useTodos();
  const core = useHouseholdCore();
  return useMemo(
    () => ({ ...finance, ...gamification, ...mealPlan, ...shopping, ...todos, ...core }),
    [finance, gamification, mealPlan, shopping, todos, core]
  );
};

/**
 * Nests the domain context providers. Shared by the real Firestore-backed
 * provider and the Test Mode mock provider so both stay in lockstep.
 */
export const HouseholdSliceProviders: React.FC<{
  finance: FinanceContextValue;
  gamification: GamificationContextValue;
  mealPlan: MealPlanContextValue;
  shopping: ShoppingContextValue;
  todos: TodosContextValue;
  core: HouseholdCoreContextValue;
  children: ReactNode;
}> = ({ finance, gamification, mealPlan, shopping, todos, core, children }) => (
  <HouseholdCoreContext.Provider value={core}>
    <FinanceContext.Provider value={finance}>
      <GamificationContext.Provider value={gamification}>
        <MealPlanContext.Provider value={mealPlan}>
          <ShoppingContext.Provider value={shopping}>
            <TodosContext.Provider value={todos}>
              {children}
            </TodosContext.Provider>
          </ShoppingContext.Provider>
        </MealPlanContext.Provider>
      </GamificationContext.Provider>
    </FinanceContext.Provider>
  </HouseholdCoreContext.Provider>
);

// Plan 080b: persist the acting-as member across a page refresh (tab-session
// scoped). Without this a kid could simply reload to escape the scoped view back
// to the parent surface, defeating the exit PIN. Cleared on exit and on tab close.
const ACTIVE_MEMBER_STORAGE_KEY = 'LIFEBALANCE_ACTIVE_MEMBER';

export const FirebaseHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, householdId } = useAuth();

  // Real-time state from Firestore
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [buckets, setBuckets] = useState<BudgetBucket[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
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

  // Transactions are windowed: `recentTransactions` is the live (last-90-days)
  // listener result; `olderTransactions` accumulates on-demand "load older"
  // pages. The exposed `transactions` array is the de-duplicated merge.
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  // Mirror of the live window so loadAllTransactions() can return the complete
  // merged list without depending on (and re-creating on) every transaction change.
  const recentTransactionsRef = useRef<Transaction[]>([]);
  useEffect(() => { recentTransactionsRef.current = recentTransactions; }, [recentTransactions]);
  const [olderTransactions, setOlderTransactions] = useState<Transaction[]>([]);
  const transactions = useMemo(
    () => mergeById(recentTransactions, olderTransactions),
    [recentTransactions, olderTransactions]
  );
  const [transactionWindowStart, setTransactionWindowStart] = useState<string | null>(null);
  const [isLoadingOlderTransactions, setIsLoadingOlderTransactions] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  // Cursor + window bound for the transactions "load older" pagination. Refs so
  // the load callbacks stay stable and always read the latest values.
  const txOlderCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const txWindowStartRef = useRef<string | null>(null);

  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currentUser, setCurrentUser] = useState<HouseholdMember | null>(null);
  // Plan 080a-2: active member for kid-mode switching (null = viewing as parent).
  // Initialized from sessionStorage so a refresh keeps the kid view (see below).
  const [activeMemberId, setActiveMemberId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTIVE_MEMBER_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [insight, setInsight] = useState("Tap 'Get Insight' to analyze your habits and spending.");
  // Insights: live window (most-recent N) merged with on-demand older history.
  const [insightsWindow, setInsightsWindow] = useState<Insight[]>([]);
  const [insightsOlder, setInsightsOlder] = useState<Insight[]>([]);
  const insightsHistory = useMemo(
    () => mergeById(insightsWindow, insightsOlder),
    [insightsWindow, insightsOlder]
  );
  const [hasMoreInsights, setHasMoreInsights] = useState(false);
  const insightsLoadedAllRef = useRef(false);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);
  const [yearlyGoals, setYearlyGoals] = useState<YearlyGoal[]>([]);
  const [freezeBank, setFreezeBank] = useState<FreezeBank | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  // Meal plan: live window (current week ± 1) merged with weeks loaded on demand
  // as the user navigates the calendar.
  const [mealPlanWindow, setMealPlanWindow] = useState<MealPlanItem[]>([]);
  const [mealPlanExtra, setMealPlanExtra] = useState<MealPlanItem[]>([]);
  const mealPlan = useMemo(
    () => mergeById(mealPlanWindow, mealPlanExtra),
    [mealPlanWindow, mealPlanExtra]
  );
  // Ref-backed mirror of the latest mealPlan so update/delete callbacks can look
  // up the previous item without closing over the `mealPlan` array (which changes
  // on every meal-plan snapshot) — keeping those callbacks referentially stable.
  const mealPlanRef = useRef(mealPlan);
  // Update the ref in an effect (not during render) so it stays correct under
  // concurrent rendering; the consumers read it from event handlers, after commit.
  useEffect(() => {
    mealPlanRef.current = mealPlan;
  }, [mealPlan]);
  const loadedMealPlanWeeksRef = useRef<Set<string>>(new Set());
  // To-dos: all active items are live; completed items are windowed to the last
  // 30 days with older completions loadable on demand.
  const [activeTodos, setActiveTodos] = useState<ToDo[]>([]);
  const [completedTodos, setCompletedTodos] = useState<ToDo[]>([]);
  const [olderCompletedTodos, setOlderCompletedTodos] = useState<ToDo[]>([]);
  const todos = useMemo(
    () => mergeById(mergeById(activeTodos, completedTodos), olderCompletedTodos),
    [activeTodos, completedTodos, olderCompletedTodos]
  );
  const [isLoadingOlderTodos, setIsLoadingOlderTodos] = useState(false);
  const [hasMoreCompletedTodos, setHasMoreCompletedTodos] = useState(false);
  const completedTodoCursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const completedTodoWindowStartRef = useRef<Date | null>(null);
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>([]);
  // Bucket history: live window (most-recent N periods) merged with older history.
  // Weekly recaps (Plan 02) — bounded live window, newest first (see RECAPS_LIMIT).
  const [recaps, setRecaps] = useState<WeeklyRecap[]>([]);
  const [bucketHistoryWindow, setBucketHistoryWindow] = useState<BucketPeriodSnapshot[]>([]);
  const [bucketHistoryOlder, setBucketHistoryOlder] = useState<BucketPeriodSnapshot[]>([]);
  const bucketHistory = useMemo(
    () => mergeById(bucketHistoryWindow, bucketHistoryOlder),
    [bucketHistoryWindow, bucketHistoryOlder]
  );
  const [isLoadingOlderBucketHistory, setIsLoadingOlderBucketHistory] = useState(false);
  const [hasMoreBucketHistory, setHasMoreBucketHistory] = useState(false);
  const bucketHistoryLoadedAllRef = useRef(false);
  const [apiKeys, setApiKeys] = useState<HouseholdApiKey[]>([]);
  const [pendingItemsCount, setPendingItemsCount] = useState<number>(0);
  // Tracks pendingItems currently being processed so a snapshot that re-fires
  // before the `processed: true` write settles can't double-process an item
  // (which would create duplicate shopping items / todos / transactions).
  const processingItemIdsRef = useRef<Set<string>>(new Set());
  // FIFO queue of pending voice-command items awaiting Gemini parsing. The
  // pendingItems snapshot callback only enqueues (so it returns immediately and
  // never blocks the listener on the network); a separate async drain loop
  // (`drainingPendingRef` guards against running two drains at once) processes
  // them. Items in `processingItemIdsRef` are never re-enqueued, preserving the
  // double-processing guard.
  const pendingItemQueueRef = useRef<PendingItem[]>([]);
  const drainingPendingRef = useRef<boolean>(false);
  // Tracks which household's first snapshot has resolved; isLoading is derived
  // from it so switching households automatically re-shows skeletons until the
  // new household loads. It is re-armed to null in the listener effect's reset
  // block (alongside the rest of the household state) on every household change.
  const [loadedHouseholdId, setLoadedHouseholdId] = useState<string | null>(null);

  // Pay Period Tracking State
  const [householdSettings, setHouseholdSettings] = useState<Household | null>(null);

  // Refs mirroring the latest habits / household settings so the points
  // recalculation can read fresh values WITHOUT keying its effect on them. Putting
  // `habits` and `householdSettings.points` in the recalc effect's deps created a
  // feedback loop: every habit toggle (which atomically writes the correct points
  // delta) mutated both, re-triggering an O(habits×dates) recompute on each toggle.
  // The per-toggle delta in useHabitActions remains the source of truth between
  // recalcs; the recalc only runs on login + the midnight/periodic scheduler path
  // and corrects any accumulated drift. See T1 in the optimization pass.
  const habitsRef = useRef<Habit[]>(habits);
  useEffect(() => { habitsRef.current = habits; }, [habits]);

  // Mirror members for the points-reset path (Plan 080c-2): checkPointsReset reads
  // the latest members via this ref to roll over each managed kid's balance without
  // keying its callback on `members` (which changes on every points write).
  const membersRef = useRef<HouseholdMember[]>(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  // Mirror the latest household settings so listener callbacks (e.g. the
  // pending-item drain's success toast) can read the configured currency without
  // keying their effect on `householdSettings` — which is rewritten on every
  // points delta and would otherwise re-subscribe the listener constantly.
  const householdSettingsRef = useRef<Household | null>(householdSettings);
  useEffect(() => { householdSettingsRef.current = householdSettings; }, [householdSettings]);

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
    () => calculateSafeToSpendBreakdownFromExpanded(accounts, expandedCalendarItemsForSafeToSpend, buckets, currentPeriodId, transactions),
    [accounts, expandedCalendarItemsForSafeToSpend, buckets, currentPeriodId, transactions]
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
    // SECURITY/PRIVACY: clear every household-scoped slice up front — BEFORE the
    // early return — so switching households or logging out can never leak a
    // previous household's data. The provider is mounted at the app root and so
    // stays alive across auth changes, meaning state would otherwise persist in
    // memory (and could flash during a transition or be read by the next user
    // who signs in without a full reload).
    // This effect synchronizes with an external system (Firestore real-time
    // listeners); the synchronous reset is an intentional security teardown of
    // the previous household before re-subscribing, not derivable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional cross-household state teardown; see comment above
    setAccounts([]);
    setBuckets([]);
    setSavingsGoals([]);
    setRecentTransactions([]);
    setOlderTransactions([]);
    recentTransactionsRef.current = [];
    setTransactionWindowStart(null);
    setHasMoreTransactions(false);
    setIsLoadingOlderTransactions(false);
    txOlderCursorRef.current = null;
    txWindowStartRef.current = null;
    setCalendarItems([]);
    setHabits([]);
    setChallenges([]);
    setRewards([]);
    setMembers([]);
    setCurrentUser(null);
    setHouseholdSettings(null);
    setFreezeBank(null);
    setYearlyGoals([]);
    setMeals([]);
    setShoppingList([]);
    setGroceryCatalog([]);
    setMealPlanWindow([]);
    setMealPlanExtra([]);
    loadedMealPlanWeeksRef.current = new Set();
    mealPlanWindowRef.current = getMealPlanWindow(new Date());
    setActiveTodos([]);
    setCompletedTodos([]);
    setOlderCompletedTodos([]);
    completedTodoCursorRef.current = null;
    completedTodoWindowStartRef.current = null;
    setHasMoreCompletedTodos(true);
    setIsLoadingOlderTodos(false);
    setRecaps([]);
    setBucketHistoryWindow([]);
    setBucketHistoryOlder([]);
    bucketHistoryLoadedAllRef.current = false;
    setHasMoreBucketHistory(false);
    setIsLoadingOlderBucketHistory(false);
    setInsightsWindow([]);
    setInsightsOlder([]);
    insightsLoadedAllRef.current = false;
    setHasMoreInsights(false);
    setApiKeys([]);
    setPendingItemsCount(0);
    // Drop any queued voice-command items from the previous household so the
    // drain loop never processes them against the new household's collection.
    pendingItemQueueRef.current = [];
    processingItemIdsRef.current.clear();
    // Re-arms the isLoading skeleton until the new household's first snapshot lands.
    setLoadedHouseholdId(null);

    if (!householdId) return;

    const unsubscribers: (() => void)[] = [];

    // Accounts, Buckets, Bucket History, Calendar Items listeners
    // (contexts/household/listeners/financeListeners.ts)
    unsubscribers.push(...attachFinanceListeners({
      db,
      householdId,
      setAccounts: (data) => setAccounts(data),
      setBuckets: (data) => setBuckets(data),
      setBucketHistoryWindow: (data) => setBucketHistoryWindow(data),
      setHasMoreBucketHistory: (data) => setHasMoreBucketHistory(data),
      bucketHistoryLoadedAllRef,
      setCalendarItems: (data) => setCalendarItems(data),
      setSavingsGoals: (data) => setSavingsGoals(data),
    }));

    // (Transactions are handled by their own effect below so the window can
    // track the current pay period without re-subscribing every other listener.)

    // Habits, Challenges, Yearly Goals, Rewards listeners (contexts/household/listeners/gamificationListeners.ts)
    unsubscribers.push(...attachGamificationListeners({
      db,
      householdId,
      setHabits: (data) => setHabits(data),
      setChallenges: (data) => setChallenges(data),
      setYearlyGoals: (data) => setYearlyGoals(data),
      setRewards: (data) => setRewards(data),
    }));

    // Members listener
    const membersQuery = query(collection(db, `households/${householdId}/members`).withConverter(householdMemberConverter));
    unsubscribers.push(
      onSnapshot(membersQuery, async (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data());
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
      }, (error) => {
        console.error('[members] listener failed:', error);
        toast.error('Failed to sync household members. Try refreshing.');
      })
    );

    // Core listeners: household doc (settings + freezeBank), recaps, API keys,
    // insights (contexts/household/listeners/coreListeners.ts)
    unsubscribers.push(...attachCoreListeners({
      db,
      householdId,
      setHouseholdSettings: (data) => setHouseholdSettings(data),
      setLoadedHouseholdId: (id) => setLoadedHouseholdId(id),
      setFreezeBank: (data) => setFreezeBank(data),
      setRecaps: (data) => setRecaps(data),
      setApiKeys: (data) => setApiKeys(data),
      setInsightsWindow: (data) => setInsightsWindow(data),
      setHasMoreInsights: (data) => setHasMoreInsights(data),
      setInsight: (text) => setInsight(text),
      insightsLoadedAllRef,
    }));

    // Meals + Meal Plan listeners (contexts/household/listeners/mealListeners.ts)
    unsubscribers.push(...attachMealListeners({
      db,
      householdId,
      mealPlanRange: mealPlanWindowRef.current,
      setMeals: (data) => setMeals(data),
      setMealPlanWindow: (data) => setMealPlanWindow(data),
    }));

    // Shopping List + Grocery Catalog listeners (contexts/household/listeners/shoppingListeners.ts)
    unsubscribers.push(...attachShoppingListeners({
      db,
      householdId,
      setShoppingList: (data) => setShoppingList(data),
      setGroceryCatalog: (data) => setGroceryCatalog(data),
    }));

    // To-Do listeners (contexts/household/listeners/todoListeners.ts)
    unsubscribers.push(...attachTodoListeners({
      db,
      householdId,
      completedTodoWindowStartRef,
      setActiveTodos: (data) => setActiveTodos(data),
      setCompletedTodos: (data) => setCompletedTodos(data),
    }));

    // Pending Items listener (for natural language voice commands)
    const pendingItemsQuery = query(
      collection(db, `households/${householdId}/pendingItems`).withConverter(pendingItemConverter),
      where('processed', '==', false)
    );
    // Drains the pending-item queue one item at a time, off the snapshot
    // callback's critical path. Each item is parsed via Gemini and routed to the
    // appropriate handler; the in-flight `processingItemIdsRef` marker is held
    // for the whole parse+write so a re-firing snapshot can't enqueue a duplicate.
    async function drainPendingItemQueue(hid: string) {
      // Single-flight: only one drain loop runs at a time. A new enqueue while a
      // drain is in progress will be picked up by the in-progress loop (it reads
      // the queue ref fresh each iteration).
      if (drainingPendingRef.current) return;
      drainingPendingRef.current = true;
      try {
        for (;;) {
          const item = pendingItemQueueRef.current.shift();
          if (!item) break;

          try {
            // Get available categories for parsing
            const expenseCategories = bucketsRef.current.map(b => b.name);

            // Parse with Gemini
            // Dynamically load to prevent circular dependency and bundle bloat
            const { parseNaturalLanguageCommand } = await import('@/services/geminiService');
            const parsed = await parseNaturalLanguageCommand(
              hid,
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
              toast.success(`Added expense: ${formatCurrency(parsed.amount ?? 0, { currency: householdSettingsRef.current?.currency })} at ${parsed.merchant || 'Unknown'}`);
            }

            // Mark as processed
            await updateDoc(doc(db, `households/${hid}/pendingItems`, item.id), {
              processed: true,
              processedAt: serverTimestamp()
            });

          } catch (error) {
            console.error('Failed to process pending item:', error);

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Mark as processed with error
            await updateDoc(doc(db, `households/${hid}/pendingItems`, item.id), {
              processed: true,
              processedAt: serverTimestamp(),
              error: errorMessage
            });

            toast.error(`Voice command failed: ${errorMessage}`);
          }
          // The id stays in `processingItemIdsRef` for the rest of the session
          // (it's cleared only on household switch). Both the success and error
          // paths above set `processed: true`, so the item never needs
          // re-processing; retaining the marker closes the race where a snapshot
          // fires during the `updateDoc` propagation delay and re-enqueues it.
        }
      } finally {
        drainingPendingRef.current = false;
      }
    }

    unsubscribers.push(
      onSnapshot(pendingItemsQuery, (snapshot) => {
        setPendingItemsCount(snapshot.size);

        // Enqueue any not-yet-seen items and return immediately. Parsing happens
        // in drainPendingItemQueue() so this callback never blocks the listener
        // on the (potentially slow) Gemini network call.
        let enqueuedAny = false;
        for (const docSnapshot of snapshot.docs) {
          // Re-entry guard: skip items already queued or being processed by an
          // earlier, still in-flight pass so we never double-process them.
          if (processingItemIdsRef.current.has(docSnapshot.id)) {
            continue;
          }
          processingItemIdsRef.current.add(docSnapshot.id);
          pendingItemQueueRef.current.push(docSnapshot.data());
          enqueuedAny = true;
        }

        if (enqueuedAny) {
          // Fire-and-forget: the drain loop is single-flighted internally.
          // `householdId` is non-null here (the effect early-returns otherwise).
          void drainPendingItemQueue(householdId);
        }
      }, (error) => {
        console.error('[pendingItems] listener failed:', error);
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

      if (parsed.items.length === 0) return;

      // Apply all adds/increments in a single atomic writeBatch (one round-trip
      // instead of one updateDoc/addDoc per parsed item). Voice commands produce
      // far fewer than the 500-op batch limit.
      const batch = writeBatch(db);
      for (const item of parsed.items) {
        const key = normalize(item.item);
        const existingDocRef = existingByName.get(key);

        if (existingDocRef) {
          // Increment quantity on the matched existing item
          batch.update(existingDocRef, {
            quantity: increment(item.quantity),
            lastUpdated: serverTimestamp()
          });
        } else {
          // Add new item with a pre-allocated id so later parsed items with the
          // same name dedupe against it (preserves the original behavior).
          const newDocRef = doc(shoppingRef);
          batch.set(newDocRef, {
            name: item.item,
            quantity: String(item.quantity),
            category: item.category,
            isPurchased: false,
            source: 'voice',
            createdAt: serverTimestamp()
          });
          existingByName.set(key, newDocRef);
        }
      }
      await batch.commit();
    }

    // Helper: Handle todo items from parsed voice command
    async function handleTodoItems(parsed: ParsedTodoList) {
      const todosRef = collection(db, `households/${householdId}/todos`);

      if (parsed.tasks.length === 0) return;

      // Apply all adds in a single atomic writeBatch (one round-trip instead of
      // one addDoc per parsed task), mirroring handleShoppingItems above. Voice
      // commands produce far fewer than the 500-op batch limit.
      const batch = writeBatch(db);
      for (const item of parsed.tasks) {
        const newDocRef = doc(todosRef);
        batch.set(newDocRef, {
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
      await batch.commit();
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

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
    // Key on user?.uid (not the whole user object) so the ~hourly Firebase token
    // refresh — which replaces the user object reference — does not tear down and
    // re-subscribe every listener. The callbacks read fresh user fields from userRef.
  }, [householdId, user?.uid]);

  // Transactions listener — kept in its own effect so the live window can track
  // the current pay period (currentPeriodId) without re-subscribing every other
  // listener. The window always reaches back to at least the start of the current
  // period, so bucketSpent (which sums the current period) stays exact. When
  // period tracking is off, all transactions are loaded (legacy behaviour).
  //
  // Gated on the household having loaded so we never subscribe while
  // currentPeriodId is still transiently '' (which would briefly read the entire
  // unbounded collection and defeat the cold-load bound).
  useEffect(() => {
    if (!householdId || loadedHouseholdId !== householdId) return;

    const windowStart = getTransactionWindowStart(currentPeriodId);
    txWindowStartRef.current = windowStart;
    // Reset any previously paged-in older transactions for the new window.
    // This effect synchronizes with an external system (the Firestore
    // transactions listener); these synchronous resets re-baseline the live
    // window before (re-)subscribing and are not derivable state.
    txOlderCursorRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional listener-window re-baseline; see comment above
    setOlderTransactions([]);
    setTransactionWindowStart(windowStart);
    setHasMoreTransactions(windowStart !== null);

    const unsubscribe = attachTransactionsListener({
      db,
      householdId,
      windowStart,
      setRecentTransactions: (data) => setRecentTransactions(data),
    });

    return () => unsubscribe();
  }, [householdId, loadedHouseholdId, currentPeriodId]);

  // Holds the live meal-plan window bounds so the on-demand loaders can tell
  // which weeks are already covered by the real-time listener.
  const mealPlanWindowRef = useRef(getMealPlanWindow(new Date()));

  // --- LISTENER WINDOWING: ON-DEMAND LOADERS ---

  const loadOlderTransactions = useCallback(async () => {
    await makeTransactionLoaders({
      db, householdId,
      txWindowStartRef, txOlderCursorRef, recentTransactionsRef,
      setIsLoadingOlderTransactions, setOlderTransactions, setHasMoreTransactions,
    }).loadOlderTransactions();
  }, [householdId]);

  const loadAllTransactions = useCallback(async (): Promise<Transaction[]> => {
    return makeTransactionLoaders({
      db, householdId,
      txWindowStartRef, txOlderCursorRef, recentTransactionsRef,
      setIsLoadingOlderTransactions, setOlderTransactions, setHasMoreTransactions,
    }).loadAllTransactions();
  }, [householdId]);

  const loadAllBucketHistory = useCallback(async () => {
    await makeLoadAllBucketHistory({
      db, householdId, bucketHistoryLoadedAllRef,
      setIsLoadingOlderBucketHistory, setBucketHistoryOlder, setHasMoreBucketHistory,
    }).loadAllBucketHistory();
  }, [householdId]);

  const loadAllInsights = useCallback(async () => {
    if (!householdId) return;
    try {
      const snap = await getDocs(query(
        collection(db, `households/${householdId}/insights`).withConverter(insightConverter),
        orderBy('generatedAt', 'desc')
      ));
      insightsLoadedAllRef.current = true;
      setInsightsOlder(snap.docs.map(doc => doc.data()));
      setHasMoreInsights(false);
    } catch (error) {
      console.error('[loadAllInsights] Failed:', error);
    }
  }, [householdId]);

  const loadOlderCompletedTodos = useCallback(async () => {
    await makeLoadOlderCompletedTodos({
      db, householdId,
      completedTodoWindowStartRef, completedTodoCursorRef,
      setIsLoadingOlderTodos, setOlderCompletedTodos, setHasMoreCompletedTodos,
    }).loadOlderCompletedTodos();
  }, [householdId]);

  // Fetch a single week of meal-plan entries that falls outside the live window,
  // replacing any previously-loaded entries for that week (so edits stay correct).
  const refreshMealPlanWeek = useCallback(async (date: Date) => {
    await makeRefreshMealPlanWeek({
      db, householdId, loadedMealPlanWeeksRef, mealPlanWindowRef, setMealPlanExtra,
    }).refreshMealPlanWeek(date);
  }, [householdId]);

  // Public helper: load a navigated-to week once (no-op if already loaded/live).
  const ensureMealPlanWeek = useCallback(async (date: Date) => {
    await makeEnsureMealPlanWeek({
      loadedMealPlanWeeksRef, mealPlanWindowRef, refreshMealPlanWeek,
    }).ensureMealPlanWeek(date);
  }, [refreshMealPlanWeek]);

  // Memoize habit reset data to avoid unnecessary callback re-creation
  // Only recreate when habit IDs, periods, or lastUpdated values change
  const habitResetData = useMemo(() =>
    habits.map(h => ({ id: h.id, period: h.period, lastUpdated: h.lastUpdated, completedDates: h.completedDates })),
    [habits]
  );

  // Habit auto-reset callback
  // Resets daily habits at midnight and weekly habits on Monday at midnight
  const checkHabitResets = useCallback(async () => {
    if (!householdId || habitResetData.length === 0) return;

    const habitsToReset: typeof habitResetData = [];

    habitResetData.forEach(habit => {
      try {
        if (isHabitStale(habit)) {
          habitsToReset.push(habit);
        }
      } catch (error) {
        console.error(`[checkHabitResets] Error checking habit ${habit.id}:`, error);
        // Do NOT add to reset list if check failed with an exception.
        // This prevents infinite reset loops for permanently corrupted habits.
      }
    });

    const today = getLocalDateString();

    // Reset all stale habits in parallel with per-item error isolation, so one
    // failed write doesn't block the others (and N writes go out concurrently
    // instead of serially).
    //
    // Mirror the manual resetHabit path: zero count AND drop today from
    // completedDates so a habit completed today-but-reset can't leave the
    // (count === 0, today ∈ completedDates) state that desyncs the daily
    // points recalc from weekly/total. See utils/habitLogic.getHabitResetUpdate.
    // Use serverTimestamp() for consistency with the rest of the codebase.
    await Promise.allSettled(
      habitsToReset.map(habit =>
        updateDoc(doc(db, `households/${householdId}/habits`, habit.id), {
          ...getHabitResetUpdate(habit, today),
          lastUpdated: serverTimestamp(),
        }).catch(error => {
          console.error(`[checkHabitResets] Failed to reset habit ${habit.id}:`, error);
        })
      )
    );
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

    // These fields may not exist yet, so treat "never set" as very old.
    const lastDailyReset = lastDailyPointsReset ? parseISO(lastDailyPointsReset) : new Date(0);
    const lastWeeklyReset = lastWeeklyPointsReset ? parseISO(lastWeeklyPointsReset) : new Date(0);

    const dayRolled = !isSameDay(now, lastDailyReset);
    // weekStartsOn: 1 means Monday is day 1, Sunday is day 7.
    const weekRolled = !isSameWeek(now, lastWeeklyReset, { weekStartsOn: 1 });
    if (!dayRolled && !weekRolled) return;

    // Read the latest habits/members via refs so this callback isn't re-created on
    // every habit/points change (the scheduler recomputes against fresh data).
    const currentHabits = habitsRef.current;
    const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    // Household pool. calculatePointsForDate/Range default-exclude assigned chores —
    // those belong to each kid's own balance, rolled over below.
    const householdUpdates: Record<string, number | string> = {};
    if (dayRolled) {
      householdUpdates['points.daily'] = calculatePointsForDate(currentHabits, today);
      householdUpdates['lastDailyPointsReset'] = today;
    }
    if (weekRolled) {
      householdUpdates['points.weekly'] = calculatePointsForDateRange(currentHabits, weekStartStr, today);
      householdUpdates['lastWeeklyPointsReset'] = today;
    }

    // Plan 080c-2: roll over each managed kid's daily/weekly from THEIR assigned
    // chores on the same boundary (empty for non-Kid-Mode households → no member
    // writes, so this is a no-op there).
    const kidResets = computeManagedMemberPointsReset(membersRef.current, currentHabits, weekStartStr, today);

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, `households/${householdId}`), householdUpdates);
      for (const kid of kidResets) {
        const kidUpdates: Record<string, number> = {};
        if (dayRolled) kidUpdates['points.daily'] = kid.daily;
        if (weekRolled) kidUpdates['points.weekly'] = kid.weekly;
        batch.update(doc(db, `households/${householdId}/members`, kid.memberUid), kidUpdates);
      }
      await batch.commit();
    } catch (error) {
      console.error('[checkPointsReset] Failed to reset points:', error);
    }
  }, [householdId, lastDailyPointsReset, lastWeeklyPointsReset]);

  // Use the midnight scheduler hook for points resets
  // Add 100ms delay to stagger initialization and prevent race conditions with habit resets
  useMidnightScheduler(checkPointsReset, !!householdId, { initialDelayMs: 100 });

  // --- PAY PERIOD TRACKING EFFECTS ---

  // Run data migration if needed.
  // Guarded with a run-once ref (mirroring the habit-migration effect below) so it
  // isn't re-evaluated on every `householdSettings` write (points are written to the
  // household doc on each habit toggle). Depends on `householdSettings?.startDate`
  // (the only field its body reads) rather than the whole object, and no longer on
  // `transactions` (its body only reads `buckets`).
  const hasAttemptedBucketMigration = useRef(false);
  useEffect(() => {
    if (!householdId || !householdSettings?.startDate || !currentPeriodId) return;
    if (buckets.length === 0) return; // No data to migrate
    if (hasAttemptedBucketMigration.current) return;

    const runMigrations = async () => {
      if (needsMigration(buckets)) {
        hasAttemptedBucketMigration.current = true;
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

  }, [householdId, householdSettings?.startDate, currentPeriodId, buckets]);

  // Migrate from date-based periods to paycheck-based periods if needed.
  // Run-once guarded for the same reason as the bucket migration above.
  const hasAttemptedPaycheckMigration = useRef(false);
  useEffect(() => {
    if (!householdId || !householdSettings) return;
    if (hasAttemptedPaycheckMigration.current) return;

    const runPaycheckMigration = async () => {
      if (needsPaycheckMigration(householdSettings)) {
        // needsPaycheckMigration() doesn't narrow payPeriodSettings, so narrow it
        // here explicitly rather than asserting non-null. If startDate is somehow
        // absent the migration can't run, so skip it.
        const pps = householdSettings.payPeriodSettings;
        if (!pps?.startDate) {
          console.warn('[Migration] Skipping paycheck migration: payPeriodSettings.startDate missing');
          return;
        }
        hasAttemptedPaycheckMigration.current = true;
        console.log('[Migration] Starting paycheck period migration...');
        try {
          await migrateToPaycheckPeriods(householdId, pps.startDate);
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

  // Merge duplicate recipes (same name up to case/spacing/punctuation) —
  // owner-approved cleanup; run-once guarded per household (keyed on the id,
  // not a boolean, so switching households still gets its own pass).
  const attemptedMealDedupFor = useRef<string | null>(null);
  useEffect(() => {
    if (!householdId || !meals.length) return;
    if (attemptedMealDedupFor.current === householdId) return;

    if (needsMealDedup(meals)) {
      // Mark as attempted before running to prevent race conditions/loops
      attemptedMealDedupFor.current = householdId;
      console.log('[Migration] Starting duplicate-meal merge...');
      // Errors are caught and logged inside migrateDuplicateMeals.
      migrateDuplicateMeals(householdId, meals);
    }
  }, [householdId, meals]);

  // Persist the corrected points + reset markers for the corrective sync.
  // Stable across renders (keyed on householdId) so it doesn't re-fire the sync.
  const writeSyncedPoints = useCallback(async (update: PointsSyncUpdate) => {
    if (!householdId) return;
    console.log(`[PointsSync] Correcting points -> daily: ${update.daily}, weekly: ${update.weekly}, total: ${update.total}`);
    try {
      await updateDoc(doc(db, `households/${householdId}`), {
        'points.daily': update.daily,
        'points.weekly': update.weekly,
        'points.total': update.total,
        'lastDailyPointsReset': update.today,
        'lastWeeklyPointsReset': update.today,
      });
      console.log(`[PointsSync] Points corrected successfully`);
    } catch (error) {
      console.error('[PointsSync] Failed to sync points:', error);
    }
  }, [householdId]);

  // Sync daily/weekly/total points from actual habit completions. This corrects
  // any drift between the per-toggle deltas (written atomically by useHabitActions,
  // the source of truth between recalcs) and the canonical recomputation.
  //
  // The hook reads `habits`/`points` via refs and runs the recompute (a) once per
  // household load and (b) on the midnight/periodic scheduler — never on the very
  // points write it produces, so a habit toggle never triggers an O(habits×dates)
  // recompute. The canonical recompute itself is the pure, unit-tested
  // `computeHouseholdPointsSync`. See hooks/usePointsSync.ts.
  usePointsSync({
    householdId,
    points: householdSettings?.points,
    habits,
    writePoints: writeSyncedPoints,
  });

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

  // --- ACTIONS: ACCOUNTS ---
  // (contexts/household/mutations/financeMutations.ts)

  const addAccount = useCallback(async (account: Account) => {
    await makeAccountMutations({ db, householdId, user }).addAccount(account);
  }, [householdId, user]);

  const updateAccountBalance = useCallback(async (id: string, newBalance: number) => {
    await makeAccountMutations({ db, householdId, user }).updateAccountBalance(id, newBalance);
  }, [householdId, user]);

  const setAccountGoal = useCallback(async (id: string, goal: number) => {
    await makeAccountMutations({ db, householdId, user }).setAccountGoal(id, goal);
  }, [householdId, user]);

  const setAccountCardLast4 = useCallback(async (id: string, cardLast4: string) => {
    await makeAccountMutations({ db, householdId, user }).setAccountCardLast4(id, cardLast4);
  }, [householdId, user]);

  const deleteAccount = useCallback(async (id: string) => {
    await makeAccountMutations({ db, householdId, user }).deleteAccount(id);
  }, [householdId, user]);

  const updateAccountOrder = useCallback(async (accountId: string, newOrder: number) => {
    await makeAccountMutations({ db, householdId, user }).updateAccountOrder(accountId, newOrder);
  }, [householdId, user]);

  const reorderAccounts = useCallback(async (orderedIds: string[]) => {
    await makeAccountMutations({ db, householdId, user }).reorderAccounts(orderedIds);
  }, [householdId, user]);

  // --- ACTIONS: SAVINGS GOALS (Plan 24) ---
  // (contexts/household/mutations/savingsGoalMutations.ts)

  const addSavingsGoal = useCallback(async (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'completedAt'>) => {
    await makeSavingsGoalMutations({ db, householdId }).addSavingsGoal(goal);
  }, [householdId]);

  const updateSavingsGoal = useCallback(async (id: string, updates: Partial<Pick<SavingsGoal, 'name' | 'targetAmount' | 'dueDate' | 'ownerId' | 'color'>>) => {
    await makeSavingsGoalMutations({ db, householdId }).updateSavingsGoal(id, updates);
  }, [householdId]);

  const deleteSavingsGoal = useCallback(async (id: string) => {
    await makeSavingsGoalMutations({ db, householdId }).deleteSavingsGoal(id);
  }, [householdId]);

  const contributeToGoal = useCallback(async (id: string, amount: number) => {
    await makeSavingsGoalMutations({ db, householdId }).contributeToGoal(id, amount);
  }, [householdId]);

  // --- ACTIONS: BUCKETS ---
  // (contexts/household/mutations/financeMutations.ts)

  const addBucket = useCallback(async (bucket: BudgetBucket) => {
    await makeBucketCrudMutations({ db, householdId, user }).addBucket(bucket);
  }, [householdId, user]);

  const updateBucket = useCallback(async (bucket: BudgetBucket) => {
    await makeBucketCrudMutations({ db, householdId, user }).updateBucket(bucket);
  }, [householdId, user]);

  const deleteBucket = useCallback(async (id: string) => {
    await makeBucketCrudMutations({ db, householdId, user }).deleteBucket(id);
  }, [householdId, user]);

  const updateBucketLimit = useCallback(async (id: string, newLimit: number) => {
    await makeBucketCrudMutations({ db, householdId, user }).updateBucketLimit(id, newLimit);
  }, [householdId, user]);

  const reallocateBucket = useCallback(async (sourceId: string, targetId: string, amount: number) => {
    await makeReallocateBucket({ db, householdId, buckets }).reallocateBucket(sourceId, targetId, amount);
  }, [householdId, buckets]);

  // --- ACTIONS: PAY PERIOD MANAGEMENT ---
  // (contexts/household/mutations/financeMutations.ts)

  const resetBucketsForNewPeriod = useCallback(async (newPeriodId: string) => {
    await makeResetBucketsForNewPeriod({
      db, householdId, currentPeriodId, buckets, bucketSpentMap, transactions,
    }).resetBucketsForNewPeriod(newPeriodId);
  }, [householdId, currentPeriodId, buckets, bucketSpentMap, transactions]);

  const initializeFirstPeriod = useCallback(async (paycheckDate: string) => {
    await makeInitializeFirstPeriod({ db, householdId, user, buckets }).initializeFirstPeriod(paycheckDate);
  }, [householdId, user, buckets]);

  const handlePaycheckApproval = useCallback(async (paycheckDate: string) => {
    await makeHandlePaycheckApproval({
      householdId, user, currentPeriodId, initializeFirstPeriod, resetBucketsForNewPeriod,
    }).handlePaycheckApproval(paycheckDate);
  }, [householdId, user, currentPeriodId, initializeFirstPeriod, resetBucketsForNewPeriod]);

  // --- ACTIONS: CALENDAR ---
  // (contexts/household/mutations/financeMutations.ts)

  const addCalendarItem = useCallback(async (item: CalendarItem) => {
    await makeAddCalendarItem({ db, householdId, user }).addCalendarItem(item);
  }, [householdId, user]);

  const updateCalendarItem = useCallback(async (item: CalendarItem) => {
    await makeUpdateCalendarItem({ db, householdId, calendarItems }).updateCalendarItem(item);
  }, [householdId, calendarItems]);

  const deleteRecurringInstance = useCallback(async (syntheticId: string, opts?: MutationOpts) => {
    await makeCalendarDeleteMutations({ db, householdId, user, calendarItems }).deleteRecurringInstance(syntheticId, opts);
  }, [householdId, user, calendarItems]);

  const deleteCalendarItem = useCallback(async (id: string, opts?: MutationOpts) => {
    await makeDeleteCalendarItem({ db, householdId, deleteRecurringInstance }).deleteCalendarItem(id, opts);
  }, [householdId, deleteRecurringInstance]);

  const payCalendarItem = useCallback(async (itemId: string, accountId: string, opts?: MutationOpts) => {
    await makePayCalendarItem({
      db, householdId, user, accounts, calendarItems, buckets, householdSettings, handlePaycheckApproval,
    }).payCalendarItem(itemId, accountId, opts);
  }, [householdId, user, accounts, calendarItems, buckets, householdSettings, handlePaycheckApproval]);

  const deferCalendarItem = useCallback(async (itemId: string, opts?: MutationOpts) => {
    await makeDeferCalendarItem({ db, householdId, user, calendarItems }).deferCalendarItem(itemId, opts);
  }, [householdId, user, calendarItems]);

  // --- ACTIONS: TRANSACTIONS ---
  // (contexts/household/mutations/transactionMutations.ts)

  const addTransaction = useCallback(async (tx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>) => {
    await makeAddTransaction({
      db, householdId, user, householdSettings, accounts, recentTransactionsRef,
    }).addTransaction(tx);
  }, [householdId, user, householdSettings, accounts]);

  const updateTransactionCategory = useCallback(async (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; clearNeedsAmount?: boolean; creditPayment?: boolean },
  ) => {
    await makeUpdateTransactionCategory({
      db, householdId, currentUser, habits, transactions, accounts, householdSettings,
    }).updateTransactionCategory(id, category, relatedHabitIds, accountId, overrides);
  }, [householdId, currentUser, habits, transactions, accounts, householdSettings]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>, opts?: MutationOpts) => {
    await makeUpdateTransaction({
      db, householdId, transactions, householdSettings, accounts,
    }).updateTransaction(id, updates, opts);
  }, [householdId, transactions, householdSettings, accounts]);

  const deleteTransaction = useCallback(async (id: string, opts?: MutationOpts) => {
    await makeDeleteTransaction({ db, householdId, transactions, accounts }).deleteTransaction(id, opts);
  }, [householdId, transactions, accounts]);

  const mergeTransactions = useCallback(async (keeperId: string, dupeId: string) => {
    await makeMergeTransactions({ db, householdId, transactions, accounts }).mergeTransactions(keeperId, dupeId);
  }, [householdId, transactions, accounts]);

  const keepBothTransactions = useCallback(async (txnId: string) => {
    await makeKeepBothTransactions({ db, householdId }).keepBothTransactions(txnId);
  }, [householdId]);

  const splitTransaction = useCallback(async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    await makeSplitTransaction({
      db, householdId, user, transactions, householdSettings, accounts,
    }).splitTransaction(originalTransactionId, newTransactions);
  }, [householdId, user, transactions, householdSettings, accounts]);

  // Plan 23 — transaction comments. ON-DEMAND fetch (no listener); the
  // households/{id}/transactions/{txnId}/comments subcollection has no
  // firestore.rules entry yet (separate human-watched PR) so these reject
  // with permission-denied until it deploys — see the spike doc.
  const getTransactionComments = useCallback(async (transactionId: string) => {
    return makeGetTransactionComments({ db, householdId }).getTransactionComments(transactionId);
  }, [householdId]);

  const addTransactionComment = useCallback(async (transactionId: string, text: string) => {
    await makeAddTransactionComment({ db, householdId, user }).addTransactionComment(transactionId, text);
  }, [householdId, user]);

  const deleteTransactionComment = useCallback(async (transactionId: string, commentId: string) => {
    await makeDeleteTransactionComment({ db, householdId }).deleteTransactionComment(transactionId, commentId);
  }, [householdId]);


  // --- ACTIONS: YEARLY GOALS, CHALLENGES, REWARDS, FREEZE BANK ---
  // (contexts/household/mutations/gamificationMutations.ts)

  const createYearlyGoal = useCallback(async (goal: Omit<YearlyGoal, 'id'>) => {
    await makeCreateYearlyGoal({ db, householdId, user }).createYearlyGoal(goal);
  }, [householdId, user]);

  const updateYearlyGoal = useCallback(async (goalId: string, updates: Partial<YearlyGoal>) => {
    await makeYearlyGoalCrudMutations({ db, householdId }).updateYearlyGoal(goalId, updates);
  }, [householdId]);

  const deleteYearlyGoal = useCallback(async (goalId: string) => {
    await makeYearlyGoalCrudMutations({ db, householdId }).deleteYearlyGoal(goalId);
  }, [householdId]);

  const updateYearlyGoalProgress = useCallback(async (goalId: string, month: string, success: boolean) => {
    await makeUpdateYearlyGoalProgress({ db, householdId, yearlyGoals }).updateYearlyGoalProgress(goalId, month, success);
  }, [householdId, yearlyGoals]);

  const updateChallenge = useCallback(async (challenge: Challenge) => {
    await makeUpdateChallenge({ db, householdId, habits, activeChallenge, user }).updateChallenge(challenge);
  }, [householdId, habits, activeChallenge, user]);

  const addChallenge = useCallback(async (input: {
    title: string;
    description?: string;
    relatedHabitIds: string[];
    targetValue?: number;
    month?: string;
  }): Promise<void> => {
    await makeAddChallenge({ db, householdId, user }).addChallenge(input);
  }, [householdId, user]);

  const markChallengeComplete = useCallback(async (challengeId: string, success: boolean) => {
    await makeMarkChallengeComplete({ db, householdId, challenges, updateYearlyGoalProgress }).markChallengeComplete(challengeId, success);
  }, [householdId, challenges, updateYearlyGoalProgress]);

  const redeemReward = useCallback(async (rewardId: string) => {
    await makeRedeemReward({ db, householdId, rewards, userRef }).redeemReward(rewardId);
  }, [householdId, rewards]);

  const addReward = useCallback(async (input: Omit<RewardItem, 'id' | 'createdBy'>) => {
    await makeAddReward({ db, householdId, user }).addReward(input);
  }, [householdId, user]);

  const updateReward = useCallback(async (reward: RewardItem) => {
    await makeRewardCrudMutations({ db, householdId }).updateReward(reward);
  }, [householdId]);

  const deleteReward = useCallback(async (id: string) => {
    await makeRewardCrudMutations({ db, householdId }).deleteReward(id);
  }, [householdId]);

  const requestRedemption = useCallback(async (rewardId: string, memberId: string) => {
    await makeRequestRedemption({ db, householdId, user, rewards }).requestRedemption(rewardId, memberId);
  }, [householdId, user, rewards]);

  const approveRedemption = useCallback(async (redemptionId: string) => {
    await makeRedemptionResolutionMutations({ db, householdId }).approveRedemption(redemptionId);
  }, [householdId]);

  const denyRedemption = useCallback(async (redemptionId: string) => {
    await makeRedemptionResolutionMutations({ db, householdId }).denyRedemption(redemptionId);
  }, [householdId]);

  // Plan 25: auto-applied freeze protection (replaces the manual patch flow).
  const autoApplyFreezes = useCallback(async () => {
    await makeAutoApplyFreezes({ db, householdId, freezeBank, habits }).autoApplyFreezes();
  }, [householdId, freezeBank, habits]);

  const rolloverFreezeBankTokens = useCallback(async () => {
    await makeRolloverFreezeBankTokens({ db, householdId, freezeBank }).rolloverFreezeBankTokens();
  }, [householdId, freezeBank]);

  // --- ACTIONS: MEMBER MANAGEMENT ---

  const addMember = useCallback(async (memberData: Partial<HouseholdMember>) => {
    await makeAddMember({ db, householdId }).addMember(memberData);
  }, [householdId]);

  const updateMember = useCallback(async (memberId: string, updates: Partial<HouseholdMember>) => {
    await makeMemberCrudMutations({ db, householdId }).updateMember(memberId, updates);
  }, [householdId]);

  const removeMember = useCallback(async (memberId: string) => {
    await makeMemberCrudMutations({ db, householdId }).removeMember(memberId);
  }, [householdId]);

  const deleteHousehold = useCallback(async () => {
    await makeDeleteHousehold({ householdId }).deleteHousehold();
  }, [householdId]);

  // --- ACTIONS: KID PROFILES (Plan 080a-2) ---

  const addKidProfile = useCallback(async (
    input: { displayName: string; avatarColor?: string; avatarEmoji?: string }
  ): Promise<void> => {
    await makeAddKidProfile({ householdId, user, householdSettings, membersRef }).addKidProfile(input);
  }, [householdId, user, householdSettings]);

  const updateKidProfile = useCallback(async (
    memberId: string,
    updates: { displayName?: string; avatarColor?: string; avatarEmoji?: string }
  ): Promise<void> => {
    await makeKidProfileCrudMutations({ db, householdId, setActiveMemberId }).updateKidProfile(memberId, updates);
  }, [householdId]);

  const removeKidProfile = useCallback(async (memberId: string): Promise<void> => {
    await makeKidProfileCrudMutations({ db, householdId, setActiveMemberId }).removeKidProfile(memberId);
  }, [householdId]);

  const actAs = useCallback((memberId: string) => {
    setActiveMemberId(memberId);
  }, []);

  const exitToParent = useCallback(() => {
    setActiveMemberId(null);
  }, []);

  // Persist the acting-as selection to sessionStorage so a refresh keeps the kid
  // view (the exit PIN would be meaningless if a reload dropped back to parent).
  useEffect(() => {
    try {
      if (activeMemberId) {
        sessionStorage.setItem(ACTIVE_MEMBER_STORAGE_KEY, activeMemberId);
      } else {
        sessionStorage.removeItem(ACTIVE_MEMBER_STORAGE_KEY);
      }
    } catch {
      // sessionStorage can be unavailable (SSR, privacy mode) — non-fatal.
    }
  }, [activeMemberId]);

  // --- ACTIONS: ONBOARDING ---

  const completeOnboarding = useCallback(async () => {
    await makeHouseholdSettingsMutations({ db, householdId }).completeOnboarding();
  }, [householdId]);

  const setHouseholdCurrency = useCallback(async (currency: string) => {
    await makeHouseholdSettingsMutations({ db, householdId }).setHouseholdCurrency(currency);
  }, [householdId]);

  // Plan 090 — merge-write a single module flag using a dotted field path so
  // sibling keys in moduleVisibility are preserved (updateDoc merges nested
  // fields by dotted path; a plain { moduleVisibility: {...} } would overwrite
  // the whole map). Fail-open default means absent keys stay enabled.
  const setModuleVisibility = useCallback(async (key: ModuleKey, value: boolean) => {
    await makeHouseholdSettingsMutations({ db, householdId }).setModuleVisibility(key, value);
  }, [householdId]);

  // Plan 080b: set/clear the Kid Mode exit PIN. A raw PIN is salted+hashed here
  // (never stored plaintext); passing null removes the PIN so exiting needs none.
  const setKidModePin = useCallback(async (pin: string | null): Promise<void> => {
    await makeHouseholdSettingsMutations({ db, householdId }).setKidModePin(pin);
  }, [householdId]);

  // --- ACTIONS: MEALS ---

  const addMeal = useCallback(async (meal: Omit<Meal, 'id'>, options?: { suppressToast?: boolean }): Promise<string> => {
    return makeAddMeal({ db, householdId, user }).addMeal(meal, options);
  }, [householdId, user]);

  const updateMeal = useCallback(async (meal: Meal) => {
    await makeMealCrudMutations({ db, householdId }).updateMeal(meal);
  }, [householdId]);

  const deleteMeal = useCallback(async (id: string) => {
    await makeMealCrudMutations({ db, householdId }).deleteMeal(id);
  }, [householdId]);

  // --- ACTIONS: SHOPPING LIST ---

  const addShoppingItem = useCallback(async (item: Omit<ShoppingItem, 'id'>) => {
    await makeShoppingListMutations({ db, householdId }).addShoppingItem(item);
  }, [householdId]);

  const addShoppingItems = useCallback(async (items: Omit<ShoppingItem, 'id'>[]) => {
    await makeShoppingListMutations({ db, householdId }).addShoppingItems(items);
  }, [householdId]);

  const updateShoppingItem = useCallback(async (item: ShoppingItem) => {
    await makeShoppingListMutations({ db, householdId }).updateShoppingItem(item);
  }, [householdId]);

  const reorderShoppingItems = useCallback(async (items: ShoppingItem[]) => {
    await makeShoppingListMutations({ db, householdId }).reorderShoppingItems(items);
  }, [householdId]);

  const deleteShoppingItem = useCallback(async (id: string) => {
    await makeShoppingListMutations({ db, householdId }).deleteShoppingItem(id);
  }, [householdId]);

  const toggleShoppingItemPurchased = useCallback(async (id: string) => {
    await makeToggleShoppingItemPurchased({ db, householdId, shoppingList, groceryCatalog }).toggleShoppingItemPurchased(id);
  }, [householdId, shoppingList, groceryCatalog]);

  const clearPurchasedShoppingItems = useCallback(async () => {
    await makeClearPurchasedShoppingItems({ db, householdId, shoppingList }).clearPurchasedShoppingItems();
  }, [householdId, shoppingList]);

  // --- ACTIONS: SHOPPING SETTINGS ---

  const addStore = useCallback(async (store: Omit<Store, 'id'>) => {
    await makeShoppingListMutations({ db, householdId }).addStore(store);
  }, [householdId]);

  const updateStore = useCallback(async (updatedStore: Store) => {
    await makeStoreSettingsMutations({ db, householdId, householdSettings }).updateStore(updatedStore);
  }, [householdId, householdSettings]);

  const deleteStore = useCallback(async (id: string) => {
    await makeDeleteStore({ db, householdId, householdSettings, shoppingList }).deleteStore(id);
  }, [householdId, householdSettings, shoppingList]);

  const updateGroceryCategories = useCallback(async (categories: string[]) => {
    await makeShoppingListMutations({ db, householdId }).updateGroceryCategories(categories);
  }, [householdId]);

  const addQuickStockList = useCallback(async (list: Omit<QuickStockList, 'id'>) => {
    await makeShoppingListMutations({ db, householdId }).addQuickStockList(list);
  }, [householdId]);

  const updateQuickStockList = useCallback(async (updatedList: QuickStockList) => {
    await makeStoreSettingsMutations({ db, householdId, householdSettings }).updateQuickStockList(updatedList);
  }, [householdId, householdSettings]);

  // Replace the WHOLE quickStockLists array in one write. Callers that touch
  // multiple lists in a single user action (e.g. reassigning a catalog item
  // between lists) must compute the final array locally and persist it here,
  // rather than firing two sequential updateQuickStockList() calls — both of
  // those would start from the same stale `householdSettings` snapshot and the
  // second write would clobber the first.
  const updateQuickStockLists = useCallback(async (lists: QuickStockList[]) => {
    await makeShoppingListMutations({ db, householdId }).updateQuickStockLists(lists);
  }, [householdId]);

  const deleteQuickStockList = useCallback(async (id: string) => {
    await makeStoreSettingsMutations({ db, householdId, householdSettings }).deleteQuickStockList(id);
  }, [householdId, householdSettings]);

  // --- ACTIONS: GROCERY CATALOG ---

  const addGroceryCatalogItem = useCallback(async (item: Omit<GroceryCatalogItem, 'id'>): Promise<string> => {
    return makeShoppingListMutations({ db, householdId }).addGroceryCatalogItem(item);
  }, [householdId]);

  const updateGroceryCatalogItem = useCallback(async (id: string, updates: Partial<GroceryCatalogItem>) => {
    await makeShoppingListMutations({ db, householdId }).updateGroceryCatalogItem(id, updates);
  }, [householdId]);

  const deleteGroceryCatalogItem = useCallback(async (id: string) => {
    await makeShoppingListMutations({ db, householdId }).deleteGroceryCatalogItem(id);
  }, [householdId]);

  // --- ACTIONS: MEAL PLAN ---

  const addMealPlanItem = useCallback(async (item: Omit<MealPlanItem, 'id'>, options?: { suppressToast?: boolean, throwOnError?: boolean }) => {
    await makeAddMealPlanItem({ db, householdId, user, refreshMealPlanWeek }).addMealPlanItem(item, options);
  }, [householdId, user, refreshMealPlanWeek]);

  const updateMealPlanItem = useCallback(async (id: string, updates: Partial<MealPlanItem>) => {
    await makeMealPlanItemEditMutations({ db, householdId, mealPlanRef, refreshMealPlanWeek }).updateMealPlanItem(id, updates);
  }, [householdId, refreshMealPlanWeek]);

  const deleteMealPlanItem = useCallback(async (id: string) => {
    await makeMealPlanItemEditMutations({ db, householdId, mealPlanRef, refreshMealPlanWeek }).deleteMealPlanItem(id);
  }, [householdId, refreshMealPlanWeek]);

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
    await makeAddToDo({ db, householdId, user }).addToDo(todo);
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
    await makeTodoCrudMutations({ db, householdId }).updateToDo(id, updates);
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
    await makeTodoCrudMutations({ db, householdId }).deleteToDo(id);
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
    await makeCompleteToDo({ db, householdId, membersRef }).completeToDo(id);
  }, [householdId]);


  const refreshInsight = useCallback(async () => {
    await makeRefreshInsight({
      db,
      householdId,
      isGeneratingInsight,
      transactions,
      habits,
      insightsHistory,
      setIsGeneratingInsight,
    }).refreshInsight();
  }, [householdId, isGeneratingInsight, transactions, habits, insightsHistory]);

  // Freeze-bank maintenance at midnight / first login (Plan 25): refill to the
  // fixed max on a new month, otherwise auto-apply freezes to yesterday's
  // missed streaks.
  const checkFreezeBankRollover = useCallback(async () => {
    if (!householdId || !freezeBank) return;

    const currentMonth = format(new Date(), 'yyyy-MM');

    // Check if we're in a new month
    if (freezeBank.lastRolloverMonth !== currentMonth) {
      await rolloverFreezeBankTokens();
      // Skip auto-apply on this pass: it would consume from the STALE token
      // balance captured in this closure (the refill hasn't round-tripped
      // through the listener yet). The scheduler re-invokes within its 5-minute
      // interval with the refreshed freezeBank and applies then.
      return;
    }

    await autoApplyFreezes();
  }, [householdId, freezeBank, rolloverFreezeBankTokens, autoApplyFreezes]);

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
    savingsGoals,
    calendarItems,
    transactions,
    currentPeriodId,
    bucketSpentMap,
    bucketHistory,
    transactionWindowStart,
    isLoadingOlderTransactions,
    hasMoreTransactions,
    loadOlderTransactions,
    loadAllTransactions,
    isLoadingOlderBucketHistory,
    hasMoreBucketHistory,
    loadAllBucketHistory,
    addAccount,
    updateAccountBalance,
    setAccountGoal,
    setAccountCardLast4,
    deleteAccount,
    updateAccountOrder,
    reorderAccounts,
    addSavingsGoal,
    updateSavingsGoal,
    deleteSavingsGoal,
    contributeToGoal,
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
    mergeTransactions,
    keepBothTransactions,
    getTransactionComments,
    addTransactionComment,
    deleteTransactionComment,
  }), [
    safeToSpend, safeToSpendBreakdown, accounts, buckets, savingsGoals, calendarItems, transactions, currentPeriodId, bucketSpentMap, bucketHistory,
    transactionWindowStart, isLoadingOlderTransactions, hasMoreTransactions, loadOlderTransactions, loadAllTransactions,
    isLoadingOlderBucketHistory, hasMoreBucketHistory, loadAllBucketHistory,
    addAccount, updateAccountBalance, setAccountGoal, setAccountCardLast4, deleteAccount, updateAccountOrder, reorderAccounts,
    addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, contributeToGoal,
    addBucket, updateBucket, deleteBucket, updateBucketLimit, reallocateBucket,
    addCalendarItem, updateCalendarItem, deleteCalendarItem, payCalendarItem, deferCalendarItem,
    addTransaction, updateTransactionCategory, updateTransaction, deleteTransaction, splitTransaction,
    mergeTransactions, keepBothTransactions, getTransactionComments, addTransactionComment, deleteTransactionComment,
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
    addChallenge,
    markChallengeComplete,
    redeemReward,
    addReward,
    updateReward,
    deleteReward,
    requestRedemption,
    approveRedemption,
    denyRedemption,
    createYearlyGoal,
    updateYearlyGoal,
    updateYearlyGoalProgress,
    deleteYearlyGoal,
    autoApplyFreezes,
    rolloverFreezeBankTokens,
  }), [
    dailyPoints, weeklyPoints, totalPoints, habits, activeChallenge, challenges, yearlyGoals, activeYearlyGoals,
    primaryYearlyGoal, rewards, freezeBank, habitActions,
    updateChallenge, addChallenge, markChallengeComplete, redeemReward,
    addReward, updateReward, deleteReward,
    requestRedemption, approveRedemption, denyRedemption,
    createYearlyGoal, updateYearlyGoal, updateYearlyGoalProgress, deleteYearlyGoal,
    autoApplyFreezes, rolloverFreezeBankTokens,
  ]);

  const mealPlanValue = useMemo<MealPlanContextValue>(() => ({
    meals,
    mealPlan,
    ensureMealPlanWeek,
    addMeal,
    updateMeal,
    deleteMeal,
    addMealPlanItem,
    updateMealPlanItem,
    deleteMealPlanItem,
  }), [
    meals, mealPlan, ensureMealPlanWeek,
    addMeal, updateMeal, deleteMeal,
    addMealPlanItem, updateMealPlanItem, deleteMealPlanItem,
  ]);

  const shoppingValue = useMemo<ShoppingContextValue>(() => ({
    shoppingList,
    groceryCatalog,
    stores,
    groceryCategories,
    quickStockLists,
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
    updateQuickStockLists,
    deleteQuickStockList,
    addGroceryCatalogItem,
    updateGroceryCatalogItem,
    deleteGroceryCatalogItem,
  }), [
    shoppingList, groceryCatalog, stores, groceryCategories, quickStockLists,
    addShoppingItem, addShoppingItems, updateShoppingItem, reorderShoppingItems, deleteShoppingItem, toggleShoppingItemPurchased, clearPurchasedShoppingItems,
    addStore, updateStore, deleteStore, updateGroceryCategories,
    addQuickStockList, updateQuickStockList, updateQuickStockLists, deleteQuickStockList,
    addGroceryCatalogItem, updateGroceryCatalogItem, deleteGroceryCatalogItem,
  ]);

  const todosValue = useMemo<TodosContextValue>(() => ({
    todos,
    isLoadingOlderTodos,
    hasMoreCompletedTodos,
    loadOlderCompletedTodos,
    addToDo,
    updateToDo,
    deleteToDo,
    completeToDo,
  }), [
    todos, isLoadingOlderTodos, hasMoreCompletedTodos, loadOlderCompletedTodos,
    addToDo, updateToDo, deleteToDo, completeToDo,
  ]);

  const coreValue = useMemo<HouseholdCoreContextValue>(() => ({
    isLoading,
    currentUser,
    members,
    insight,
    insightsHistory,
    isGeneratingInsight,
    hasMoreInsights,
    loadAllInsights,
    pendingItemsCount,
    apiKeys,
    householdId,
    householdSettings,
    household: householdSettings, // Provide alias
    refreshInsight,
    addMember,
    updateMember,
    removeMember,
    deleteHousehold,
    completeOnboarding,
    setHouseholdCurrency,
    setModuleVisibility,
    setKidModePin,
    addKidProfile,
    updateKidProfile,
    removeKidProfile,
    activeMemberId,
    actAs,
    exitToParent,
    recaps,
  }), [
    isLoading, currentUser, members, insight, insightsHistory, isGeneratingInsight, hasMoreInsights, loadAllInsights,
    pendingItemsCount, apiKeys,
    householdId, householdSettings, refreshInsight, addMember, updateMember, removeMember, deleteHousehold,
    completeOnboarding, setHouseholdCurrency, setModuleVisibility, setKidModePin,
    addKidProfile, updateKidProfile, removeKidProfile, activeMemberId, actAs, exitToParent,
    recaps,
  ]);

  return (
    <HouseholdSliceProviders
      finance={financeValue}
      gamification={gamificationValue}
      mealPlan={mealPlanValue}
      shopping={shoppingValue}
      todos={todosValue}
      core={coreValue}
    >
      {children}
    </HouseholdSliceProviders>
  );
};
