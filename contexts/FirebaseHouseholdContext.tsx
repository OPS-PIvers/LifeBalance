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
  writeBatch,
  getDoc,
  getDocs,
  where,
  orderBy,
  increment,
  setDoc,
  limit,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import {
  accountConverter,
  budgetBucketConverter,
  bucketPeriodSnapshotConverter,
  calendarItemConverter,
  householdMemberConverter,
  pendingItemConverter,
  insightConverter,
  transactionConverter,
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
  WeeklyRecap
} from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { calculateSafeToSpendBreakdownFromExpanded, resolveBucketForCalendarItem } from '@/utils/safeToSpendCalculator';
import { effectiveAccountImpact, resolveTargetAccount } from '@/utils/accountImpact';
import { mergeTransactions as buildMergeUpdates } from '@/utils/transactionMerge';
import { processToggleHabit, calculatePointsForDate, calculatePointsForDateRange, computeManagedMemberPointsReset, isHabitStale, getHabitResetUpdate } from '@/utils/habitLogic';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { calculateBucketSpent, getTransactionsForBucket } from '@/utils/bucketSpentCalculator';
import { migrateBucketsToPeriods, needsMigration, migrateToPaycheckPeriods, needsPaycheckMigration } from '@/utils/migrations/payPeriodMigration';
import { migrateOrphanedHabits, needsHabitMigration } from '@/utils/migrations/habitMigration';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';
import { usePointsSync, type PointsSyncUpdate } from '@/hooks/usePointsSync';
import { useHabitActions } from '@/hooks/useHabitActions';
import { expandCalendarItems, parseRecurringId, isRecurringId } from '@/utils/calendarRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { roundMoney } from '@/utils/money';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  BUCKET_HISTORY_LIMIT,
  TRANSACTION_PAGE_SIZE,
  getTransactionWindowStart,
  getMealPlanWindow,
} from '@/utils/listenerWindows';
import { ParsedShoppingList, ParsedTodoList, ParsedExpense } from '@/services/geminiService.types';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { track } from '@/services/analytics';
import { shouldTrackFirstTime, FIRST_TRANSACTION_FLAG } from '@/utils/firstTimeFlags';
import toast from 'react-hot-toast';
import { isSameDay, isSameWeek, parseISO, format, subDays, startOfWeek, addDays, startOfToday, isAfter, isValid, addMonths } from 'date-fns';
import { mergeById, mapTransactionDoc } from '@/contexts/household/selectors';
import { attachTodoListeners } from '@/contexts/household/listeners/todoListeners';
import { attachMealListeners } from '@/contexts/household/listeners/mealListeners';
import { attachShoppingListeners } from '@/contexts/household/listeners/shoppingListeners';
import { attachGamificationListeners } from '@/contexts/household/listeners/gamificationListeners';
import { attachCoreListeners } from '@/contexts/household/listeners/coreListeners';
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
  makeUseFreezeBankToken,
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

    // Accounts listener
    const accountsQuery = query(collection(db, `households/${householdId}/accounts`).withConverter(accountConverter));
    unsubscribers.push(
      onSnapshot(accountsQuery, (snapshot) => {
        setAccounts(snapshot.docs.map(doc => doc.data()));
      }, (error) => {
        console.error('[accounts] listener failed:', error);
        toast.error('Lost connection to your accounts. Safe-to-Spend may be out of date.');
      })
    );

    // Buckets listener
    const bucketsQuery = query(collection(db, `households/${householdId}/buckets`).withConverter(budgetBucketConverter));
    unsubscribers.push(
      onSnapshot(bucketsQuery, (snapshot) => {
        setBuckets(snapshot.docs.map(doc => doc.data()));
      }, (error) => {
        console.error('[buckets] listener failed:', error);
        toast.error('Lost connection to your budget. Safe-to-Spend may be out of date.');
      })
    );

    // Bucket History listener — live window of the most recent N periods.
    // Older snapshots are fetched on demand via loadAllBucketHistory().
    const historyQuery = query(
      collection(db, `households/${householdId}/bucketHistory`).withConverter(bucketPeriodSnapshotConverter),
      orderBy('periodStartDate', 'desc'),
      limit(BUCKET_HISTORY_LIMIT)
    );
    unsubscribers.push(
      onSnapshot(historyQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => doc.data());
        setBucketHistoryWindow(data);
        // A full page means there are (probably) older periods to load. Don't
        // flip this back on once the caller has already loaded everything.
        if (!bucketHistoryLoadedAllRef.current) {
          setHasMoreBucketHistory(snapshot.size >= BUCKET_HISTORY_LIMIT);
        }
      }, (error) => {
        console.error('Error listening to bucketHistory:', error);
      })
    );

    // (Transactions are handled by their own effect below so the window can
    // track the current pay period without re-subscribing every other listener.)

    // Calendar listener
    const calQuery = query(collection(db, `households/${householdId}/calendarItems`).withConverter(calendarItemConverter));
    unsubscribers.push(
      onSnapshot(calQuery, (snapshot) => {
        setCalendarItems(snapshot.docs.map(doc => doc.data()));
      }, (error) => {
        // Calendar items feed Safe-to-Spend; a silent failure would leave that
        // metric stale. Surface it like the accounts/buckets listeners do.
        console.error('[calendarItems] listener failed:', error);
        toast.error('Failed to sync calendar items. Some figures may be out of date.');
      })
    );

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

    const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
    const txQuery = windowStart
      ? query(txCollection, where('date', '>=', windowStart), orderBy('date', 'desc'))
      : query(txCollection);

    const unsubscribe = onSnapshot(txQuery, (snapshot) => {
      setRecentTransactions(snapshot.docs.map(mapTransactionDoc));
    }, (error) => {
      console.error('Error listening to transactions:', error);
    });

    return () => unsubscribe();
  }, [householdId, loadedHouseholdId, currentPeriodId]);

  // Holds the live meal-plan window bounds so the on-demand loaders can tell
  // which weeks are already covered by the real-time listener.
  const mealPlanWindowRef = useRef(getMealPlanWindow(new Date()));

  // --- LISTENER WINDOWING: ON-DEMAND LOADERS ---

  const loadOlderTransactions = useCallback(async () => {
    const windowStart = txWindowStartRef.current;
    if (!householdId || windowStart === null) return;
    setIsLoadingOlderTransactions(true);
    try {
      const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
      const cursor = txOlderCursorRef.current;
      const olderQuery = cursor
        ? query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc'), startAfter(cursor), limit(TRANSACTION_PAGE_SIZE))
        : query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc'), limit(TRANSACTION_PAGE_SIZE));
      const snap = await getDocs(olderQuery);
      if (snap.docs.length > 0) {
        txOlderCursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
        const page = snap.docs.map(mapTransactionDoc);
        setOlderTransactions(prev => mergeById(prev, page));
      }
      setHasMoreTransactions(snap.docs.length === TRANSACTION_PAGE_SIZE);
    } catch (error) {
      console.error('[loadOlderTransactions] Failed:', error);
      toast.error('Failed to load older transactions');
    } finally {
      setIsLoadingOlderTransactions(false);
    }
  }, [householdId]);

  const loadAllTransactions = useCallback(async (): Promise<Transaction[]> => {
    const windowStart = txWindowStartRef.current;
    // No window (period tracking off) → everything is already loaded.
    if (!householdId || windowStart === null) return recentTransactionsRef.current;
    setIsLoadingOlderTransactions(true);
    try {
      const txCollection = collection(db, `households/${householdId}/transactions`).withConverter(transactionConverter);
      const snap = await getDocs(query(txCollection, where('date', '<', windowStart), orderBy('date', 'desc')));
      const older = snap.docs.map(mapTransactionDoc);
      txOlderCursorRef.current = snap.docs.length ? snap.docs[snap.docs.length - 1] ?? null : null;
      setOlderTransactions(older);
      setHasMoreTransactions(false);
      return mergeById(recentTransactionsRef.current, older);
    } catch (error) {
      console.error('[loadAllTransactions] Failed:', error);
      toast.error('Failed to load full transaction history');
      return recentTransactionsRef.current;
    } finally {
      setIsLoadingOlderTransactions(false);
    }
  }, [householdId]);

  const loadAllBucketHistory = useCallback(async () => {
    if (!householdId) return;
    setIsLoadingOlderBucketHistory(true);
    try {
      const snap = await getDocs(query(
        collection(db, `households/${householdId}/bucketHistory`).withConverter(bucketPeriodSnapshotConverter),
        orderBy('periodStartDate', 'desc')
      ));
      bucketHistoryLoadedAllRef.current = true;
      setBucketHistoryOlder(snap.docs.map(doc => doc.data()));
      setHasMoreBucketHistory(false);
    } catch (error) {
      console.error('[loadAllBucketHistory] Failed:', error);
      toast.error('Failed to load full budget history');
    } finally {
      setIsLoadingOlderBucketHistory(false);
    }
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

  const setAccountCardLast4 = useCallback(async (id: string, cardLast4: string) => {
    if (!householdId) return;
    // Defensive guard (the UI validates too): a non-empty but sub-4-digit value
    // would store something that can never match an incoming card, so reject it.
    const rawDigits = cardLast4.replace(/\D/g, '');
    if (rawDigits && rawDigits.length < 4) {
      toast.error('Card digits must be the last 4 numbers');
      return;
    }
    // Keep only digits and cap at the last 4 so "...8899" / "8899" both store as
    // "8899". An empty result clears the field (untags the card).
    const digits = rawDigits.slice(-4);
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      cardLast4: digits ? digits : deleteField(),
    });
    toast.success(digits ? 'Card digits saved' : 'Card digits cleared');
  }, [householdId]);

  const deleteAccount = useCallback(async (id: string) => {
    if (!householdId) return;
    // NOTE: transactions tagged to this account are intentionally left as-is
    // (no migration). Their `accountId` becomes a dangling reference, which
    // resolveTargetAccount() resolves to the checking account on the next
    // mutation. A pending charge orphaned from a deleted credit/savings account
    // stays excluded from Safe-to-Spend (sumPendingSpend excludes any accountId
    // not in the current checking set).
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

    // Round to whole cents up front so sub-cent input or float drift can't write
    // fractional cents into a bucket limit via increment() below.
    const roundedAmount = roundMoney(amount);

    // Validate input before writing — otherwise a bad amount flows straight into
    // the increments below: source===target collapses to a single same-doc update
    // that fabricates funds, a non-positive/non-finite amount reverses or no-ops
    // the transfer, and an amount above the source's limit drives that limit
    // negative. The caller is fire-and-forget, so surface the problem with a toast
    // and bail rather than throw.
    if (sourceId === targetId) {
      toast.error('Pick two different buckets to move funds between.');
      return;
    }
    if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
      toast.error('Enter an amount greater than zero to reallocate.');
      return;
    }
    // Compare in integer cents so float drift can't reject an exact full move.
    if (Math.round(roundedAmount * 100) > Math.round(sourceBucket.limit * 100)) {
      toast.error(`${sourceBucket.name} doesn't have that much to reallocate.`);
      return;
    }

    // Commit both limit changes in a single batch so a partial write can never
    // leave the source debited without crediting the target. Use increment()
    // (server-side field value) rather than absolute values from local state so
    // concurrent edits to either bucket's limit are not clobbered.
    const batch = writeBatch(db);
    batch.update(doc(db, `households/${householdId}/buckets`, sourceId), {
      limit: increment(-roundedAmount),
    });
    batch.update(doc(db, `households/${householdId}/buckets`, targetId), {
      limit: increment(roundedAmount),
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
        });

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

      // A paycheck dated ON/BEFORE the current period start (e.g. an older
      // overdue income item approved from the Action Queue AFTER a newer one)
      // must NOT roll the period: resetBucketsForNewPeriod would rewind
      // lastPaycheckDate and snapshot a period whose end precedes its start,
      // orphaning every current-period transaction. Record the income (done by
      // payCalendarItem) without touching period tracking. yyyy-MM-dd strings
      // compare lexicographically, so a plain string compare is date-correct.
      if (paycheckDate <= currentPeriodId) return;

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

  const deleteRecurringInstance = useCallback(async (syntheticId: string, opts?: MutationOpts) => {
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
        if (!opts?.silent) toast.success('Instance deleted');
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

      if (!opts?.silent) toast.success('Instance deleted');
    } catch (error) {
      console.error('[deleteRecurringInstance] Failed:', error);
      toast.error('Failed to delete instance. Please try again.');
      throw error;
    }
  }, [householdId, user, calendarItems]);

  const deleteCalendarItem = useCallback(async (id: string, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      // Check if this is a recurring instance (synthetic ID with date suffix)
      const isRecurringInstance = isRecurringId(id);

      if (isRecurringInstance) {
        // Delete only this instance, not the entire series
        await deleteRecurringInstance(id, opts);
      } else {
        // Direct deletion for non-recurring items or templates
        await deleteDoc(doc(db, `households/${householdId}/calendarItems`, id));
        if (!opts?.silent) toast.success('Event deleted');
      }
    } catch (error) {
      console.error('[deleteCalendarItem] Failed:', error);
      toast.error('Failed to delete event. Please try again.');
      throw error;
    }
  }, [householdId, deleteRecurringInstance]);

  const payCalendarItem = useCallback(async (itemId: string, accountId: string, opts?: MutationOpts) => {
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

      // NEW: If this is an income item (paycheck), trigger period reset BEFORE creating transaction.
      // This runs as its own prior atomic op before the writeBatch below.
      if (item.type === 'income') {
        await handlePaycheckApproval(specificDate);
      }

      // Auto-categorize before building the batch, using the same bucket-matching
      // rules as safe-to-spend's bill exclusion (see resolveBucketForCalendarItem).
      let category = 'Bills';
      if (item.type === 'expense') {
        const matchedBucket = resolveBucketForCalendarItem(item, buckets);
        if (matchedBucket) category = matchedBucket.name;
      } else {
        category = 'Income';
      }

      // Transaction dated to when the item was actually due/scheduled
      // (specificDate), not "today" — so a bill due on the 10th but paid on the
      // 15th records against the 10th and lands in the correct pay period.
      const transactionDate = specificDate;
      // For an INCOME item we already awaited handlePaycheckApproval(specificDate)
      // above. When it ADVANCED the period (paycheck dated after the current
      // period start), the closure-captured householdSettings still holds the OLD
      // date, so deriving the period from it would file the opening paycheck into
      // the period that just closed — use the just-approved date directly:
      // getPayPeriodForTransaction(specificDate, specificDate) === specificDate,
      // i.e. the new period this paycheck opens. When the approval was a no-op
      // (paycheck dated on/before the current period start — the pointer must not
      // rewind), keep the current period so the income files as historical rather
      // than opening a resurrected period.
      const priorPeriodId = householdSettings?.lastPaycheckDate;
      const effectiveLastPaycheck =
        item.type === 'income' && (!priorPeriodId || specificDate > priorPeriodId)
          ? specificDate
          : priorPeriodId;
      const payPeriodId = getPayPeriodForTransaction(transactionDate, effectiveLastPaycheck);

      // Account balance delta. Using increment() (a server-side delta) instead of
      // writing an absolute balance computed from local state prevents lost
      // updates when household members act concurrently.
      const balanceDelta = item.type === 'expense' ? -item.amount : item.amount;

      // Atomically commit the calendar item, account balance, and transaction in a
      // single writeBatch so they can never partially apply (e.g. balance moves but
      // the bill isn't marked paid). Pre-allocate the new transaction ref so it can
      // participate in the batch.
      const payBatch = writeBatch(db);

      // 1. Create or update the paid calendar item
      if (isRecurringInstance) {
        // Create a new paid instance record
        const newCalendarRef = doc(collection(db, `households/${householdId}/calendarItems`));
        payBatch.set(newCalendarRef, {
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
        payBatch.update(doc(db, `households/${householdId}/calendarItems`, itemId), {
          isPaid: true,
        });
      }

      // 2. Update account balance
      payBatch.update(doc(db, `households/${householdId}/accounts`, accountId), {
        balance: increment(roundMoney(balanceDelta)),
        lastUpdated: serverTimestamp(),
      });

      // 3. Create transaction. `accountId` records which account the bill was
      // paid from — it's what lets the Action Queue's swipe-approve suggest
      // "the account you used last time" for this bill going forward.
      const newTransactionRef = doc(collection(db, `households/${householdId}/transactions`));
      payBatch.set(newTransactionRef, {
        amount: item.amount,
        merchant: item.title,
        category: category,
        date: transactionDate,
        status: 'verified',
        isRecurring: !!item.isRecurring,
        source: 'recurring',
        autoCategorized: true,
        payPeriodId,
        accountId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      await payBatch.commit();

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions

      if (!opts?.silent) toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');
    } catch (error) {
      console.error('[payCalendarItem] Failed:', error);
      toast.error('Failed to process payment. Please try again.');
      throw error;
    }
  }, [householdId, user, accounts, calendarItems, buckets, householdSettings, handlePaycheckApproval]);

  const deferCalendarItem = useCallback(async (itemId: string, opts?: MutationOpts) => {
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

      if (!opts?.silent) {
        toast.success(`Deferred to ${format(parseISO(newDate), 'MMM d')}`);
      }
    } else {
      // Non-recurring item - just move the date
      const item = calendarItems.find(i => i.id === itemId);
      if (!item) return;

      const newDate = calculateDeferredDate(item.date);

      await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
        date: newDate,
      });

      if (!opts?.silent) {
        toast.success(`Deferred to ${format(parseISO(newDate), 'MMM d')}`);
      }
    }
  }, [householdId, user, calendarItems]);

  // --- ACTIONS: TRANSACTIONS ---

  const addTransaction = useCallback(async (tx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>) => {
    if (!householdId) {
      console.error('[addTransaction] No household selected');
      throw new Error('No household selected');
    }
    if (!user) {
      console.error('[addTransaction] Not authenticated');
      throw new Error('Not authenticated');
    }

    // Validate required fields before attempting Firestore write.
    // Note: a falsy check would wrongly reject a legitimate $0 transaction, so
    // we only reject non-numbers / NaN here (negative amounts are valid too,
    // e.g. refunds).
    if (typeof tx.amount !== 'number' || isNaN(tx.amount)) {
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

    try {
      // Round to whole cents once so the stored amount and the balance delta are
      // guaranteed to match exactly (no float drift between doc and account).
      const roundedAmount = roundMoney(tx.amount);

      // Assign pay period ID based on paycheck approval
      const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

      // Build the document data explicitly to ensure compliance with Firestore rules
      const docData: Record<string, unknown> = {
        amount: roundedAmount,
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
      const trimmedAccountId = tx.accountId && tx.accountId.trim() ? tx.accountId.trim() : undefined;
      if (trimmedAccountId) {
        docData.accountId = trimmedAccountId;
      }
      // creditPayment only matters on a credit account; persist only when true
      // (absent ⇒ charge), matching the optional-field convention above.
      if (tx.creditPayment === true) {
        docData.creditPayment = true;
      }
      if (tx.subBucketId && tx.subBucketId.trim()) {
        docData.subBucketId = tx.subBucketId.trim();
      }
      if (tx.notes && tx.notes.trim()) {
        docData.notes = tx.notes.trim();
      }

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: a new transaction touches a
      // balance only if it is created `verified`. A `pending_review` capture
      // (receipt / AI scan / Apple Pay stub) does NOT move any balance — it
      // influences Safe-to-Spend solely via the calculator's pendingSpend term,
      // so moving a balance here too would subtract it twice. The impact lands
      // on the TAGGED account (credit charges raise the card's debt; checking
      // expenses debit checking), falling back to checking when untagged.
      const target = resolveTargetAccount(trimmedAccountId, accounts);
      const balanceDelta = effectiveAccountImpact(
        { amount: roundedAmount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status },
        target
      );

      // Commit the new transaction and the account-balance delta in a SINGLE
      // writeBatch so they can never partially apply. Pre-allocate the
      // transaction ref so it participates in the batch.
      const batch = writeBatch(db);
      const txRef = doc(collection(db, `households/${householdId}/transactions`));
      batch.set(txRef, docData);

      // Update the target account balance only when the (verified) impact is
      // non-zero (server-side delta avoids lost updates from concurrent edits).
      if (balanceDelta !== 0 && target) {
        batch.update(doc(db, `households/${householdId}/accounts`, target.id), {
          balance: increment(roundMoney(balanceDelta)),
          lastUpdated: serverTimestamp(),
        });
      }

      // Read the live window BEFORE the commit so latency-compensated listeners
      // can't already include this write (ref, not `transactions`, to keep the
      // callback's deps free of per-transaction churn).
      const wasFirstTransaction = recentTransactionsRef.current.length === 0;

      await batch.commit();

      track('transaction_added', { source: tx.source || 'manual' });
      if (shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, wasFirstTransaction)) track('first_transaction_added');

      // DO NOT update bucket.spent - it's now calculated in real-time from transactions
      // The bucketSpentMap effect will automatically recalculate when transactions change
    } catch (error) {
      console.error('Error adding transaction:', error);
      throw error; // Re-throw to let caller handle
    }
  }, [householdId, user, householdSettings, accounts]);

  const updateTransactionCategory = useCallback(async (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; clearNeedsAmount?: boolean },
  ) => {
    if (!householdId || !currentUser) return;

    // Verifying a pending transaction may also increment related habits and the
    // household points. Commit the transaction update, the checking-balance
    // delta, every habit update, and the points increment in a SINGLE writeBatch
    // so they can never diverge (a partial failure previously left habits/points
    // inconsistent).
    const batch = writeBatch(db);
    let totalPointsChange = 0;
    let successfulHabitsCount = 0;

    // VERIFIED-ONLY BALANCE (Plan 015): this is the primary "verify" action — it
    // sets status to `verified` and may change the category. A pending_review
    // transaction has NOT yet touched the balance, so promoting it to verified
    // must apply its (now effective) impact; if it was already verified this is a
    // pure category change (delta = newImpact − oldImpact, e.g. expense→Income
    // flips the sign). before = the existing transaction; after = same amount
    // with the new category + verified status.
    // If the transaction isn't in local state we cannot know its amount, so we
    // can't apply the correct balance delta. Bail rather than verify it with a
    // zero delta (which would mark it verified without ever debiting checking) —
    // matching updateTransaction/deleteTransaction, which also require the row.
    const existingTx = transactions.find(t => t.id === id);
    if (!existingTx) {
      toast.error('Transaction not found');
      return;
    }
    // An optional `accountId` (Action Queue smart approve) re-tags the
    // transaction, so the OLD and NEW target accounts may differ. Reverse the
    // old account's effective impact (0 for a pending row) and apply the new
    // account's, merged per-account so one batch never writes the same doc
    // twice — the same rule `updateTransaction` uses. Promoting a pending
    // credit charge to verified raises the card's debt; verifying a checking
    // expense debits checking.
    // `accountId === null` is an EXPLICIT clear of a previously-tagged account
    // (distinct from `undefined`, which leaves the existing tag untouched). A
    // clear removes the stored field and re-routes the impact to the checking
    // fallback via resolveTargetAccount(undefined, …).
    const clearAccount = accountId === null;
    const newAccountId = clearAccount ? undefined : (accountId?.trim() || undefined);
    const oldTarget = resolveTargetAccount(existingTx.accountId, accounts);
    const newTarget = resolveTargetAccount(
      clearAccount ? undefined : (newAccountId ?? existingTx.accountId),
      accounts,
    );

    // An inline edit (Action Queue / on-open review) can change the amount in the
    // same verify. Use the OVERRIDE amount (not the possibly-stale/zero stored
    // amount) for the applied impact, so a $0 "awaiting amount" stub debits the
    // entered amount exactly once (reverse 0, apply −entered). Round to whole
    // cents before it drives both the stored amount and the balance delta.
    const editedAmount = overrides?.amount !== undefined ? roundMoney(overrides.amount) : undefined;
    const effectiveAmount = editedAmount ?? existingTx.amount;

    const reverseDelta = -effectiveAccountImpact(existingTx, oldTarget);
    const applyDelta = effectiveAccountImpact(
      { amount: effectiveAmount, category, creditPayment: existingTx.creditPayment, status: 'verified' },
      newTarget
    );
    const deltasByAccountId = new Map<string, number>();
    if (oldTarget) deltasByAccountId.set(oldTarget.id, (deltasByAccountId.get(oldTarget.id) ?? 0) + reverseDelta);
    if (newTarget) deltasByAccountId.set(newTarget.id, (deltasByAccountId.get(newTarget.id) ?? 0) + applyDelta);

    // A date edit re-buckets the transaction into the pay period covering the new
    // date (mirrors updateTransaction).
    const editedPayPeriodId = overrides?.date
      ? getPayPeriodForTransaction(overrides.date, householdSettings?.lastPaycheckDate)
      : undefined;

    // 1. Update Transaction. Verifying resolves any Action-Queue snooze, so the
    // stale marker doesn't linger on the doc. Inline edits (amount/merchant/date)
    // and clearing the `needsAmount` stub flag co-commit here in the same op.
    batch.update(doc(db, `households/${householdId}/transactions`, id), {
      category,
      status: 'verified',
      relatedHabitIds: relatedHabitIds || [],
      // An explicit clear removes the tag; a new tag sets it; undefined leaves it.
      ...(clearAccount ? { accountId: deleteField() } : newAccountId ? { accountId: newAccountId } : {}),
      ...(existingTx.reviewSnoozedUntil ? { reviewSnoozedUntil: deleteField() } : {}),
      ...(editedAmount !== undefined ? { amount: editedAmount } : {}),
      ...(overrides?.merchant !== undefined ? { merchant: overrides.merchant } : {}),
      // Truthy guard (not `!== undefined`): a blank date must not write an
      // undefined payPeriodId (WriteBatch.update throws on undefined). With the
      // truthy guard, editedPayPeriodId is only computed when a date is present.
      ...(overrides?.date ? { date: overrides.date, payPeriodId: editedPayPeriodId } : {}),
      ...(overrides?.clearNeedsAmount ? { needsAmount: false } : {}),
    });

    // 1b. Apply the account-balance impact of the status/category transition in
    // the SAME batch (server-side delta avoids lost updates from concurrent edits).
    for (const [accId, delta] of deltasByAccountId) {
      const rounded = roundMoney(delta);
      if (rounded !== 0) {
        batch.update(doc(db, `households/${householdId}/accounts`, accId), {
          balance: increment(rounded),
          lastUpdated: serverTimestamp(),
        });
      }
    }

    // 2. Increment Habits if any
    if (relatedHabitIds && relatedHabitIds.length > 0) {
      for (const habitId of relatedHabitIds) {
        const habit = habits.find(h => h.id === habitId);
        if (habit) {
          // Use extracted business logic
          const result = processToggleHabit(habit, 'up');
          if (result) {
            batch.update(doc(db, `households/${householdId}/habits`, habitId), {
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

      // 3. Update Household Points
      if (totalPointsChange !== 0) {
        batch.update(doc(db, `households/${householdId}`), {
          'points.daily': increment(totalPointsChange),
          'points.weekly': increment(totalPointsChange),
          'points.total': increment(totalPointsChange),
        });
      }
    }

    // Commit all writes atomically
    await batch.commit();

    // Only the pending→verified promotion is the engagement signal (this method
    // also handles pure category edits on already-verified rows).
    if (existingTx.status === 'pending_review') track('transaction_verified');

    // DO NOT update bucket.spent - it's now calculated in real-time from transactions
    // The bucketSpentMap effect will automatically recalculate when transactions change

    // Toast feedback for habits (only after a successful commit)
    if (totalPointsChange !== 0) {
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

    toast.success('Verified & Categorized!');
  }, [householdId, currentUser, habits, transactions, accounts, householdSettings]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Round any incoming amount to whole cents before it is both stored (via
      // sanitizedUpdates below) and used for the balance delta, so the persisted
      // amount and the account balance can't drift by sub-cent amounts.
      if (updates.amount !== undefined) {
        updates.amount = roundMoney(updates.amount);
      }

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: an edit can change amount,
      // category, status, accountId AND creditPayment simultaneously, and the
      // OLD and NEW target accounts may differ (and be different types). Reverse
      // the old account's effective impact and apply the new account's, then
      // merge per-account so a single batch never writes the same doc twice.
      // This single rule handles every case:
      //   - amount/category/status change on the same account → net impact delta
      //   - re-tag checking→card (or card→card)              → money moves accounts
      //   - pending → verified / verified → pending          → apply / reverse
      //   - credit charge ↔ payment toggle                   → sign flip on the card
      const newAmount = updates.amount ?? transaction.amount;
      const newCategory = updates.category ?? transaction.category;
      const newStatus = updates.status ?? transaction.status;
      const newAccountId = 'accountId' in updates
        ? (updates.accountId?.trim() || undefined)
        : transaction.accountId;
      const newCreditPayment = 'creditPayment' in updates ? updates.creditPayment : transaction.creditPayment;

      const oldTarget = resolveTargetAccount(transaction.accountId, accounts);
      const newTarget = resolveTargetAccount(newAccountId, accounts);

      const reverseDelta = -effectiveAccountImpact(transaction, oldTarget);
      const applyDelta = effectiveAccountImpact(
        { amount: newAmount, category: newCategory, creditPayment: newCreditPayment, status: newStatus },
        newTarget
      );

      // Merge by account id: when old and new resolve to the SAME doc, Firestore
      // rejects two writes to it in one batch, so collapse to a single net delta.
      const deltasByAccountId = new Map<string, number>();
      if (oldTarget) deltasByAccountId.set(oldTarget.id, (deltasByAccountId.get(oldTarget.id) ?? 0) + reverseDelta);
      if (newTarget) deltasByAccountId.set(newTarget.id, (deltasByAccountId.get(newTarget.id) ?? 0) + applyDelta);

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
        // Clearing a store: omitting the field leaves the old value in
        // Firestore, so a caller explicitly clearing a previously-set store
        // (present `store` key with an empty/undefined value) must remove it
        // with deleteField(). Callers that simply omit `store` are unaffected.
        if ('store' in updates && !updates.store && transaction.store) {
          sanitizedUpdates.store = deleteField();
        }
      } else if (typeof sanitizedUpdates.store === 'string') {
        sanitizedUpdates.store = sanitizedUpdates.store.trim();
      }
      if (sanitizedUpdates.accountId === undefined || sanitizedUpdates.accountId === '') {
        delete sanitizedUpdates.accountId;
        // Untagging: omitting the field leaves the old value in Firestore, so a
        // caller explicitly clearing a previously-tagged account must remove it
        // with deleteField(). (The balance delta already re-routes to checking.)
        if ('accountId' in updates && !updates.accountId && transaction.accountId) {
          sanitizedUpdates.accountId = deleteField();
        }
      } else if (typeof sanitizedUpdates.accountId === 'string') {
        sanitizedUpdates.accountId = sanitizedUpdates.accountId.trim();
      }
      // creditPayment is only persisted when true (absent ⇒ charge). If the
      // caller is explicitly clearing a previously-true flag, remove it from the
      // doc with deleteField(); otherwise just drop the non-true value.
      if (sanitizedUpdates.creditPayment !== true) {
        delete sanitizedUpdates.creditPayment;
        if ('creditPayment' in updates && updates.creditPayment !== true && transaction.creditPayment) {
          sanitizedUpdates.creditPayment = deleteField();
        }
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

      // Atomically commit the transaction update and the account balance deltas in
      // a single writeBatch so they can never partially apply.
      const updateBatch = writeBatch(db);

      updateBatch.update(doc(db, `households/${householdId}/transactions`, id), {
        ...sanitizedUpdates,
        payPeriodId,
      });

      // Apply each account's net effective-impact delta (atomic server-side
      // increment). A re-tag moves money off the old account and onto the new.
      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          updateBatch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      await updateBatch.commit();

      if (!opts?.silent) toast.success('Transaction updated!');
    } catch (error) {
      console.error('[updateTransaction] Failed:', error);
      toast.error('Failed to update transaction');
      throw error;
    }
  }, [householdId, transactions, householdSettings, accounts]);

  const deleteTransaction = useCallback(async (id: string, opts?: MutationOpts) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Atomically restore the target account balance and delete the
      // transaction in a single writeBatch so they can never partially apply
      // (server-side delta avoids lost updates from concurrent edits / stale
      // local state).
      const deleteBatch = writeBatch(db);

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: reverse only the EFFECTIVE impact,
      // on the account the transaction was tagged to. A verified transaction had
      // applied its account-aware impact, so deleting it reverses that (e.g.
      // deleting a verified card charge lowers the card's debt again); a
      // pending_review transaction never touched any balance, so deleting it must
      // NOT move a balance (its effective impact is 0).
      const target = resolveTargetAccount(transaction.accountId, accounts);
      const balanceDelta = -effectiveAccountImpact(transaction, target);
      if (balanceDelta !== 0 && target) {
        deleteBatch.update(doc(db, `households/${householdId}/accounts`, target.id), {
          balance: increment(roundMoney(balanceDelta)),
          lastUpdated: serverTimestamp(),
        });
      }

      deleteBatch.delete(doc(db, `households/${householdId}/transactions`, id));

      await deleteBatch.commit();

      if (!opts?.silent) toast.success('Transaction deleted');
    } catch (error) {
      console.error('[deleteTransaction] Failed:', error);
      toast.error('Failed to delete transaction');
      throw error;
    }
  }, [householdId, transactions, accounts]);

  const mergeTransactions = useCallback(async (keeperId: string, dupeId: string) => {
    if (!householdId) return;

    try {
      const keeperTx = transactions.find(tx => tx.id === keeperId);
      const dupeTx = transactions.find(tx => tx.id === dupeId);
      if (!keeperTx || !dupeTx) {
        // Throw (not return) so callers' catch blocks run and the review UI
        // doesn't advance as if the merge succeeded. The outer catch shows
        // the failure toast and re-throws.
        throw new Error('Transaction not found');
      }

      const updates = buildMergeUpdates(keeperTx, dupeTx);

      const mergeBatch = writeBatch(db);

      mergeBatch.update(doc(db, `households/${householdId}/transactions`, keeperId), {
        ...updates,
        // Always clear the flag on the surviving row — Firestore rejects a
        // plain `undefined`, so this uses the deleteField() sentinel rather
        // than routing through the pure `buildMergeUpdates` patch.
        possibleDuplicateOf: deleteField(),
      });

      // VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: deleting the dupe must reverse
      // its EFFECTIVE impact on the account it was tagged to — exactly the
      // same rule `deleteTransaction` applies. A pending_review dupe never
      // touched a balance, so this is a no-op for the (expected) common case
      // of merging two still-pending rows; it only fires when the dupe was
      // independently verified against a (possibly different) account than
      // the keeper, so both accounts are adjusted correctly.
      const dupeTarget = resolveTargetAccount(dupeTx.accountId, accounts);
      const dupeBalanceDelta = -effectiveAccountImpact(dupeTx, dupeTarget);
      if (dupeBalanceDelta !== 0 && dupeTarget) {
        mergeBatch.update(doc(db, `households/${householdId}/accounts`, dupeTarget.id), {
          balance: increment(roundMoney(dupeBalanceDelta)),
          lastUpdated: serverTimestamp(),
        });
      }

      mergeBatch.delete(doc(db, `households/${householdId}/transactions`, dupeId));

      await mergeBatch.commit();

      track('duplicate_merged', { source: dupeTx.source });
      toast.success('Transactions merged');
    } catch (error) {
      console.error('[mergeTransactions] Failed:', error);
      toast.error('Failed to merge transactions');
      throw error;
    }
  }, [householdId, transactions, accounts]);

  const keepBothTransactions = useCallback(async (txnId: string) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, `households/${householdId}/transactions`, txnId), {
        possibleDuplicateOf: deleteField(),
      });
      track('duplicate_kept_both');
    } catch (error) {
      console.error('[keepBothTransactions] Failed:', error);
      toast.error('Failed to update transaction');
      throw error;
    }
  }, [householdId]);

  const splitTransaction = useCallback(async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    if (!householdId || !user) return;

    try {
      const batch = writeBatch(db);
      const originalTx = transactions.find(t => t.id === originalTransactionId);

      if (!originalTx) {
        throw new Error('Original transaction not found');
      }

      // Round each split's STORED amount to whole cents ONCE, and use the same
      // value for the account deltas below (mirrors addTransaction). Persisting
      // the caller's raw amount (e.g. a typed "3.005") while applying a rounded
      // balance delta would desync the doc from the balance by a sub-cent forever.
      const roundedSplits = newTransactions.map(tx => ({ ...tx, amount: roundMoney(tx.amount) }));

      // 1. Delete original transaction
      const originalTxRef = doc(db, `households/${householdId}/transactions`, originalTransactionId);
      batch.delete(originalTxRef);

      // 2. Create new transactions
      roundedSplits.forEach(tx => {
        const newTxRef = doc(collection(db, `households/${householdId}/transactions`));
        const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

        batch.set(newTxRef, {
          ...tx,
          payPeriodId: payPeriodId || null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });

      // 3. VERIFIED-ONLY, ACCOUNT-ROUTED BALANCE: the net change is
      // Σ effectiveAccountImpact(newSplit, its target) − effectiveAccountImpact(original, its target).
      // Splits may land on different accounts than the original and from each
      // other, so accumulate per-account and merge (a single batch must not write
      // the same account doc twice). When a VERIFIED expense is split into
      // verified expenses on the same account summing to the same total this nets
      // to 0 (historical no-op); splitting a PENDING_REVIEW capture into verified
      // splits applies their now-effective impact to the correct accounts.
      const deltasByAccountId = new Map<string, number>();
      const origTarget = resolveTargetAccount(originalTx.accountId, accounts);
      if (origTarget) {
        deltasByAccountId.set(origTarget.id, (deltasByAccountId.get(origTarget.id) ?? 0) - effectiveAccountImpact(originalTx, origTarget));
      }
      for (const tx of roundedSplits) {
        const t = resolveTargetAccount(tx.accountId?.trim() || undefined, accounts);
        if (t) {
          // tx.amount is already rounded to whole cents above — the SAME value
          // that was persisted — so the per-account delta can't desync from the
          // stored amount by a sub-cent.
          deltasByAccountId.set(t.id, (deltasByAccountId.get(t.id) ?? 0) + effectiveAccountImpact({ amount: tx.amount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status }, t));
        }
      }
      for (const [accId, delta] of deltasByAccountId) {
        const rounded = roundMoney(delta);
        if (rounded !== 0) {
          batch.update(doc(db, `households/${householdId}/accounts`, accId), {
            balance: increment(rounded),
            lastUpdated: serverTimestamp(),
          });
        }
      }

      // 4. Commit batch
      await batch.commit();

      toast.success('Transaction split successfully');
    } catch (error) {
      console.error('[splitTransaction] Failed:', error);
      toast.error('Failed to split transaction');
      throw error;
    }
  }, [householdId, user, transactions, householdSettings, accounts]);


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

  const useFreezeBankToken = useCallback(async (habitId: string, targetDate: string) => {
    await makeUseFreezeBankToken({ db, householdId, freezeBank, habits }).useFreezeBankToken(habitId, targetDate);
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
    await makeAddKidProfile({ db, householdId, user, householdSettings, membersRef }).addKidProfile(input);
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
  }), [
    safeToSpend, safeToSpendBreakdown, accounts, buckets, calendarItems, transactions, currentPeriodId, bucketSpentMap, bucketHistory,
    transactionWindowStart, isLoadingOlderTransactions, hasMoreTransactions, loadOlderTransactions, loadAllTransactions,
    isLoadingOlderBucketHistory, hasMoreBucketHistory, loadAllBucketHistory,
    addAccount, updateAccountBalance, setAccountGoal, setAccountCardLast4, deleteAccount, updateAccountOrder, reorderAccounts,
    addBucket, updateBucket, deleteBucket, updateBucketLimit, reallocateBucket,
    addCalendarItem, updateCalendarItem, deleteCalendarItem, payCalendarItem, deferCalendarItem,
    addTransaction, updateTransactionCategory, updateTransaction, deleteTransaction, splitTransaction,
    mergeTransactions, keepBothTransactions,
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
    useFreezeBankToken,
    rolloverFreezeBankTokens,
  }), [
    dailyPoints, weeklyPoints, totalPoints, habits, activeChallenge, challenges, yearlyGoals, activeYearlyGoals,
    primaryYearlyGoal, rewards, freezeBank, habitActions,
    updateChallenge, addChallenge, markChallengeComplete, redeemReward,
    addReward, updateReward, deleteReward,
    requestRedemption, approveRedemption, denyRedemption,
    createYearlyGoal, updateYearlyGoal, updateYearlyGoalProgress, deleteYearlyGoal,
    useFreezeBankToken, rolloverFreezeBankTokens,
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
