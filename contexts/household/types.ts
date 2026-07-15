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
  SavingsGoal,
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
  TaskTemplate,
  HouseholdApiKey,
  ModuleKey,
  WeeklyRecap,
  MonthlyMoneyRecap,
  NetWorthSnapshot,
  TransactionComment,
  SplitParticipant,
  NotificationLogEntry
} from '@/types/schema';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';

/** Options accepted by mutations that normally toast per call. `silent: true`
 *  suppresses the per-item success toast so BULK flows (Action Queue
 *  multi-select) can show one summary toast instead of N stacked ones.
 *  Error toasts are never suppressed. */
export interface MutationOpts {
  silent?: boolean;
}

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
  /** Plan 24 — savings goals / sinking funds. Manual-contribution only; NEVER
   *  feeds `safeToSpend` (see CLAUDE.md hard invariant). */
  savingsGoals: SavingsGoal[];
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
  /** F-TODO-03 — task-bundle templates ("Quick Task Lists"). */
  taskTemplates: TaskTemplate[];
  groceryCatalog: GroceryCatalogItem[];
  bucketHistory: BucketPeriodSnapshot[];
  /** Weekly recaps (Plan 02) — newest first, bounded live window (RECAPS_LIMIT). */
  recaps: WeeklyRecap[];
  /** Monthly money recaps (F-MONEY-06) — newest first, bounded live window
   *  (MONEY_RECAPS_LIMIT). */
  moneyRecaps: MonthlyMoneyRecap[];
  /** Net worth history (F-MONEY-09) — newest first, bounded live window
   *  (NET_WORTH_HISTORY_LIMIT). Server-written daily; clients only read. */
  netWorthHistory: NetWorthSnapshot[];
  /** In-app notification inbox (F-NOTIF-02) — the current member's own log
   *  entries, newest first, already filtered from the bounded household-wide
   *  fetch window (NOTIFICATION_LOG_FETCH_LIMIT). Server-written; clients only
   *  read + mark read. */
  notificationLog: NotificationLogEntry[];
  /** Count of `notificationLog` entries not yet read by the current member. */
  unreadNotificationCount: number;
  /** Marks one notification-log entry as read by the current member. */
  markNotificationRead: (entryId: string) => Promise<void>;
  /** Marks every currently-loaded unread notification-log entry as read. */
  markAllNotificationsRead: () => Promise<void>;

  // --- Listener windowing / pagination ---
  // The high-cardinality collections below are windowed on cold load (see
  // utils/listenerWindows.ts) and expose "load older" helpers for history
  // beyond the live window.
  /** Inclusive lower bound (yyyy-MM-dd) of the live transactions window, or null when every transaction is loaded (no period tracking). */
  transactionWindowStart: string | null;
  /** True while older transactions are being fetched. */
  isLoadingOlderTransactions: boolean;
  /** True when older transactions may exist beyond the loaded set. */
  hasMoreTransactions: boolean;
  /** Fetch the next page of older transactions (cursor pagination). */
  loadOlderTransactions: () => Promise<void>;
  /** Fetch every remaining older transaction (e.g. before analytics or export). Resolves with the complete, merged transaction list. */
  loadAllTransactions: () => Promise<Transaction[]>;
  /** True while the full bucket history is being fetched. */
  isLoadingOlderBucketHistory: boolean;
  /** True when older bucket-history snapshots exist beyond the live window. */
  hasMoreBucketHistory: boolean;
  /** Fetch every bucket-history snapshot beyond the live window. */
  loadAllBucketHistory: () => Promise<void>;
  /** True when older insights exist beyond the live window. */
  hasMoreInsights: boolean;
  /** Fetch every insight beyond the live window. */
  loadAllInsights: () => Promise<void>;
  /** True while older completed to-dos are being fetched. */
  isLoadingOlderTodos: boolean;
  /** True when older completed to-dos exist beyond the live window. */
  hasMoreCompletedTodos: boolean;
  /** Fetch the next page of older completed to-dos. */
  loadOlderCompletedTodos: () => Promise<void>;
  /** Ensure the meal-plan entries for the week containing `date` are loaded. */
  ensureMealPlanWeek: (date: Date) => Promise<void>;
  /** Fetch every meal beyond the bounded live window (cookbook view). Idempotent per household. */
  loadAllMeals: () => Promise<void>;
  /** Fetch the full grocery catalog beyond the bounded live window (shopping-form search fallback). Idempotent per household. */
  loadFullGroceryCatalog: () => Promise<void>;

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
  /** Set (or clear, with an empty string) the last-4 card digits used to
   *  auto-route incoming Shortcut/Wells-Fargo-email transactions to this account. */
  setAccountCardLast4: (id: string, cardLast4: string) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  /** Soft-delete: hide from active lists/net worth/Safe-to-Spend while keeping
   *  the account doc so historical transactions keep resolving to it. */
  archiveAccount: (id: string) => Promise<void>;
  unarchiveAccount: (id: string) => Promise<void>;
  updateAccountOrder: (accountId: string, newOrder: number) => Promise<void>;
  reorderAccounts: (orderedIds: string[]) => Promise<void>;

  // Savings Goal Actions (Plan 24) — v1 manual contributions only.
  addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'completedAt'>) => Promise<void>;
  updateSavingsGoal: (id: string, updates: Partial<Pick<SavingsGoal, 'name' | 'targetAmount' | 'dueDate' | 'ownerId' | 'color'>>) => Promise<void>;
  deleteSavingsGoal: (id: string) => Promise<void>;
  /** Manual "Add to goal" contribution: adds `amount` to `savedAmount` (cents-safe) and stamps `completedAt` on first reaching target. */
  contributeToGoal: (id: string, amount: number) => Promise<void>;

  // Bucket Actions
  addBucket: (bucket: BudgetBucket) => Promise<void>;
  updateBucket: (bucket: BudgetBucket) => Promise<void>;
  deleteBucket: (id: string) => Promise<void>;
  updateBucketLimit: (id: string, newLimit: number) => Promise<void>;
  reallocateBucket: (sourceId: string, targetId: string, amount: number) => Promise<void>;

  // Calendar Actions
  addCalendarItem: (item: CalendarItem) => Promise<void>;
  updateCalendarItem: (item: CalendarItem) => Promise<void>;
  deleteCalendarItem: (id: string, opts?: MutationOpts) => Promise<void>;
  /** Mark a calendar item paid/received. Optional `actualAmount` records what
   *  was really paid (variable bills) — it drives the balance delta and the
   *  created transaction (and the paid instance record) instead of the item's
   *  budgeted `amount`; a recurring template's own amount is left untouched. */
  payCalendarItem: (itemId: string, accountId: string, opts?: MutationOpts & { actualAmount?: number }) => Promise<void>;
  deferCalendarItem: (itemId: string, opts?: MutationOpts) => Promise<void>;

  // Transaction Actions
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>) => Promise<void>;
  /** F-DASH-04: add SEVERAL transactions (e.g. an itemized receipt split into
   *  category transactions) with their combined balance effects in ONE
   *  writeBatch — atomic, so a partial split can never land. */
  addTransactions: (txs: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => Promise<void>;
  /** Verify a pending transaction under `category`. Optional `accountId`
   *  additionally (re)tags the transaction so the verify-time balance impact
   *  lands on that account (used by the Action Queue's smart approve); pass
   *  `null` to EXPLICITLY clear a previously-tagged account (the impact then
   *  re-routes to checking). Optional `overrides` co-commit an inline edit
   *  (amount/merchant/date, plus clearing the `needsAmount` stub flag) in the
   *  SAME atomic batch, so verify + edit + account + habits + points can never
   *  diverge; `overrides.amount` (not the possibly-stale stored amount) drives
   *  the checking-balance delta. `overrides.creditPayment` co-commits the
   *  credit Charge/Payment flag (false clears a stored flag) and drives the
   *  verify-time balance delta, so a credit-card payment approved in review
   *  pays the card DOWN instead of raising its debt. */
  updateTransactionCategory: (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; clearNeedsAmount?: boolean; creditPayment?: boolean },
  ) => Promise<void>;
  updateTransaction: (id: string, updates: Partial<Transaction>, opts?: MutationOpts) => Promise<void>;
  deleteTransaction: (id: string, opts?: MutationOpts) => Promise<void>;
  splitTransaction: (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => Promise<void>;
  /** F-MONEY-13: save (or clear) a transaction's shared-expense split overlay.
   *  Bookkeeping-only — NEVER touches an account balance — so it is a single
   *  `updateDoc`, not a batch. Pass an empty array or `null` to remove the
   *  split entirely. See `utils/settlement.ts`. */
  setTransactionSplit: (transactionId: string, split: SplitParticipant[] | null) => Promise<void>;
  /** F-MONEY-13: toggle one participant's `settled` flag on a split (addressed
   *  by `splitParticipantKey`). No balance change; single `updateDoc`. */
  markSplitSettled: (transactionId: string, participantKey: string, settled?: boolean) => Promise<void>;
  /** Merge a `possibleDuplicateOf`-flagged pair of transactions (plan 03 PR-3):
   *  applies `utils/transactionMerge`'s field-level winner set to the keeper,
   *  deletes the dupe, and reverses the dupe's account-balance impact if it
   *  was `verified` — all in ONE writeBatch (mirrors `deleteTransaction`). The
   *  caller picks which id is the keeper vs. the dupe (typically via
   *  `pickKeeper` from the same util). */
  mergeTransactions: (keeperId: string, dupeId: string) => Promise<void>;
  /** Dismiss a possible-duplicate flag without merging: clears
   *  `possibleDuplicateOf` on the given transaction (single update, no batch
   *  needed — nothing else changes). */
  keepBothTransactions: (txnId: string) => Promise<void>;

  // Transaction Comment Actions (Plan 23) — ON-DEMAND fetch (no standing
  // listener). NOTE: the `comments` subcollection has no firestore.rules
  // entry yet; calls reject with permission-denied until that separate,
  // human-watched rules PR ships (see advisor-plans/23-transaction-comments-spike.md).
  /** One-shot fetch of a transaction's comment thread, oldest-first. Call on
   *  detail-view open — never wire this to a listener. */
  getTransactionComments: (transactionId: string) => Promise<TransactionComment[]>;
  /** Adds a comment (≤500 chars) and bumps `Transaction.commentCount` in the
   *  SAME writeBatch. */
  addTransactionComment: (transactionId: string, text: string) => Promise<void>;
  /** Deletes a comment and decrements `Transaction.commentCount` in the SAME
   *  writeBatch. Author-only in the (future) rules; not enforced client-side. */
  deleteTransactionComment: (transactionId: string, commentId: string) => Promise<void>;

  // Habit Actions
  addHabit: (habit: Habit) => Promise<string>;
  updateHabit: (habit: Habit) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  /** F-HABITS-05: soft-retire — sets `archivedAt`, no points change, no batch. */
  archiveHabit: (id: string) => Promise<void>;
  unarchiveHabit: (id: string) => Promise<void>;
  reorderHabits: (updates: { id: string; order: number; category?: string }[]) => Promise<void>;
  toggleHabit: (id: string, direction: 'up' | 'down') => Promise<void>;
  resetHabit: (id: string) => Promise<void>;
  /** F-HABITS-01: set (yyyy-MM-dd) or clear (null) a habit's planned-break end
   *  date. A paused habit skips the auto-reset penalty and freeze-token
   *  consumption, and its streak bridges the break. */
  setHabitPause: (id: string, pausedUntil: string | null) => Promise<void>;

  // Habit Submission Actions
  addHabitSubmission: (habitId: string, count: number, timestamp?: string, note?: string, mood?: HabitSubmission['mood']) => Promise<void>;
  updateHabitSubmission: (habitId: string, submissionId: string, updates: Partial<HabitSubmission>) => Promise<void>;
  deleteHabitSubmission: (habitId: string, submissionId: string) => Promise<void>;
  getHabitSubmissions: (habitId: string, startDate?: string, endDate?: string) => Promise<HabitSubmission[]>;
  /** Clear ONE calendar day of a habit's log: deletes that day's submissions
   *  (or reverses a toggle-path completion), reversing exactly the points that
   *  were credited, and recomputes streaks — all in one atomic batch. */
  resetHabitDay: (habitId: string, date: string) => Promise<void>;

  // Challenge & Reward Actions
  updateChallenge: (challenge: Challenge) => Promise<void>;
  // Plan 080e — create a NEW family challenge, decoupled from yearly goals (no
  // yearlyGoalId required). createdBy/createdAt/month are filled in server-side.
  addChallenge: (input: {
    title: string;
    description?: string;
    relatedHabitIds: string[];
    targetValue?: number;
    month?: string;
  }) => Promise<void>;
  markChallengeComplete: (challengeId: string, success: boolean) => Promise<void>;
  redeemReward: (rewardId: string) => Promise<void>;
  // Plan 080d — Reward CRUD (parent-managed rewards store). createdBy is set
  // server-side from the authenticated user on create.
  addReward: (input: Omit<RewardItem, 'id' | 'createdBy'>) => Promise<void>;
  updateReward: (reward: RewardItem) => Promise<void>;
  deleteReward: (id: string) => Promise<void>;
  // Plan 080d-2 — Reward REDEMPTION (kid requests → parent approves/denies).
  // requestRedemption appends a pending RewardRedemption to the household doc.
  // approveRedemption/denyRedemption resolve it (transactional + idempotent);
  // approval deducts the kid's points and credits the allowance IOU.
  requestRedemption: (rewardId: string, memberId: string) => Promise<void>;
  approveRedemption: (redemptionId: string) => Promise<void>;
  denyRedemption: (redemptionId: string) => Promise<void>;
  refreshInsight: () => Promise<void>;

  // Yearly Goal Actions
  createYearlyGoal: (goal: Omit<YearlyGoal, 'id'>) => Promise<void>;
  updateYearlyGoal: (goalId: string, updates: Partial<YearlyGoal>) => Promise<void>;
  updateYearlyGoalProgress: (goalId: string, month: string, success: boolean) => Promise<void>;
  deleteYearlyGoal: (goalId: string) => Promise<void>;

  // Freeze Bank Actions (Plan 25: freezes are AUTO-applied; the manual
  // patch-a-date flow was removed)
  autoApplyFreezes: () => Promise<void>;
  rolloverFreezeBankTokens: () => Promise<void>;

  // Member Management Actions
  addMember: (memberData: Partial<HouseholdMember>) => Promise<void>;
  updateMember: (memberId: string, updates: Partial<HouseholdMember>) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  deleteHousehold: () => Promise<void>;

  // Kid Profile Actions (Plan 080a-2)
  addKidProfile: (input: { displayName: string; avatarColor?: string; avatarEmoji?: string }) => Promise<void>;
  updateKidProfile: (memberId: string, updates: { displayName?: string; avatarColor?: string; avatarEmoji?: string }) => Promise<void>;
  removeKidProfile: (memberId: string) => Promise<void>;

  // Active member (kid-mode switching)
  activeMemberId: string | null;
  actAs: (memberId: string) => void;
  exitToParent: () => void;

  // Onboarding
  /** Mark the first-run onboarding wizard as finished so it is never shown again. */
  completeOnboarding: () => Promise<void>;

  /** Set the household's display currency (ISO-4217 code, e.g. 'USD', 'EUR'). */
  setHouseholdCurrency: (currency: string) => Promise<void>;

  /** Plan 090 — toggle a module on/off for the household (merge-writes moduleVisibility.<key>). */
  setModuleVisibility: (key: ModuleKey, value: boolean) => Promise<void>;

  /** F-PLAT-07 — apply a full module-visibility preset in one write (merge-writes every key at once). */
  updateModuleVisibility: (patch: Partial<Record<ModuleKey, boolean>>) => Promise<void>;

  /** Set (raw PIN, salted+hashed before write) or clear (null) the Kid Mode exit PIN. */
  setKidModePin: (pin: string | null) => Promise<void>;

  /** F-MEALS-04: set (habit id) or clear (null) the habit auto-credited when a meal is marked cooked. */
  setMealCookedHabitId: (habitId: string | null) => Promise<void>;

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
  /** Persists `Store.order` for every store in `orderedIds` sequence (F-MEALS-07; mirrors reorderAccounts). */
  reorderStores: (orderedIds: string[]) => Promise<void>;
  updateGroceryCategories: (categories: string[]) => Promise<void>;
  addQuickStockList: (list: Omit<QuickStockList, 'id'>) => Promise<void>;
  updateQuickStockList: (list: QuickStockList) => Promise<void>;
  /**
   * Replaces the ENTIRE quickStockLists array in a single write. Use this when a
   * mutation touches more than one list at once (e.g. moving a catalog item from
   * one list to another), so the change can't be split across two sequential
   * `updateQuickStockList` calls that both start from the same stale snapshot and
   * clobber each other.
   */
  updateQuickStockLists: (lists: QuickStockList[]) => Promise<void>;
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
  /** F-TODO-03 — Task templates ("Quick Task Lists"). */
  addTaskTemplate: (template: Omit<TaskTemplate, 'id'>) => Promise<void>;
  updateTaskTemplate: (template: TaskTemplate) => Promise<void>;
  deleteTaskTemplate: (id: string) => Promise<void>;
  /** One-tap creation of a bundle of to-dos from a saved template. Resolves
   *  with the number of to-dos created. */
  applyTaskTemplate: (template: TaskTemplate) => Promise<number>;
}

// --- DOMAIN CONTEXT SLICES ---
//
// The household state is split into five domain slices so a component only
// re-renders when the slice it actually reads changes (adding a transaction no
// longer re-renders the meal planner, etc.). The slice value types are derived
// from `HouseholdContextType` with `Pick` so they stay in sync with the legacy
// shape automatically — there is a single source of truth for every field.

export type FinanceContextValue = Pick<HouseholdContextType,
  | 'safeToSpend' | 'safeToSpendBreakdown' | 'accounts' | 'buckets' | 'savingsGoals' | 'calendarItems' | 'transactions'
  | 'currentPeriodId' | 'bucketSpentMap' | 'bucketHistory' | 'netWorthHistory'
  | 'transactionWindowStart' | 'isLoadingOlderTransactions' | 'hasMoreTransactions'
  | 'loadOlderTransactions' | 'loadAllTransactions'
  | 'isLoadingOlderBucketHistory' | 'hasMoreBucketHistory' | 'loadAllBucketHistory'
  | 'addAccount' | 'updateAccountBalance' | 'setAccountGoal' | 'setAccountCardLast4' | 'deleteAccount'
  | 'archiveAccount' | 'unarchiveAccount'
  | 'updateAccountOrder' | 'reorderAccounts'
  | 'addSavingsGoal' | 'updateSavingsGoal' | 'deleteSavingsGoal' | 'contributeToGoal'
  | 'addBucket' | 'updateBucket' | 'deleteBucket' | 'updateBucketLimit' | 'reallocateBucket'
  | 'addCalendarItem' | 'updateCalendarItem' | 'deleteCalendarItem' | 'payCalendarItem' | 'deferCalendarItem'
  | 'addTransaction' | 'addTransactions' | 'updateTransactionCategory' | 'updateTransaction' | 'deleteTransaction' | 'splitTransaction'
  | 'setTransactionSplit' | 'markSplitSettled'
  | 'mergeTransactions' | 'keepBothTransactions'
  | 'getTransactionComments' | 'addTransactionComment' | 'deleteTransactionComment'
>;

export type GamificationContextValue = Pick<HouseholdContextType,
  | 'dailyPoints' | 'weeklyPoints' | 'totalPoints' | 'habits'
  | 'activeChallenge' | 'challenges'
  | 'yearlyGoals' | 'activeYearlyGoals' | 'primaryYearlyGoal'
  | 'rewardsInventory' | 'freezeBank'
  | 'addHabit' | 'updateHabit' | 'deleteHabit' | 'archiveHabit' | 'unarchiveHabit' | 'reorderHabits' | 'toggleHabit' | 'resetHabit' | 'setHabitPause'
  | 'addHabitSubmission' | 'updateHabitSubmission' | 'deleteHabitSubmission' | 'getHabitSubmissions'
  | 'resetHabitDay'
  | 'updateChallenge' | 'addChallenge' | 'markChallengeComplete' | 'redeemReward'
  | 'addReward' | 'updateReward' | 'deleteReward'
  | 'requestRedemption' | 'approveRedemption' | 'denyRedemption'
  | 'createYearlyGoal' | 'updateYearlyGoal' | 'updateYearlyGoalProgress' | 'deleteYearlyGoal'
  | 'autoApplyFreezes' | 'rolloverFreezeBankTokens'
>;

export type MealPlanContextValue = Pick<HouseholdContextType,
  | 'meals' | 'mealPlan' | 'ensureMealPlanWeek' | 'loadAllMeals'
  | 'addMeal' | 'updateMeal' | 'deleteMeal'
  | 'addMealPlanItem' | 'updateMealPlanItem' | 'deleteMealPlanItem'
>;

export type ShoppingContextValue = Pick<HouseholdContextType,
  | 'shoppingList' | 'groceryCatalog' | 'loadFullGroceryCatalog' | 'stores' | 'groceryCategories' | 'quickStockLists'
  | 'addShoppingItem' | 'addShoppingItems' | 'updateShoppingItem' | 'reorderShoppingItems'
  | 'deleteShoppingItem' | 'toggleShoppingItemPurchased' | 'clearPurchasedShoppingItems'
  | 'addStore' | 'updateStore' | 'deleteStore' | 'reorderStores' | 'updateGroceryCategories'
  | 'addQuickStockList' | 'updateQuickStockList' | 'updateQuickStockLists' | 'deleteQuickStockList'
  | 'addGroceryCatalogItem' | 'updateGroceryCatalogItem' | 'deleteGroceryCatalogItem'
>;

/** Backward-compatible union of both meal-plan and shopping slices. */
export type MealsContextValue = MealPlanContextValue & ShoppingContextValue;

export type TodosContextValue = Pick<HouseholdContextType,
  | 'todos' | 'addToDo' | 'updateToDo' | 'deleteToDo' | 'completeToDo'
  | 'isLoadingOlderTodos' | 'hasMoreCompletedTodos' | 'loadOlderCompletedTodos'
  | 'taskTemplates' | 'addTaskTemplate' | 'updateTaskTemplate' | 'deleteTaskTemplate' | 'applyTaskTemplate'
>;

export type HouseholdCoreContextValue = Pick<HouseholdContextType,
  | 'isLoading' | 'currentUser' | 'members'
  | 'insight' | 'insightsHistory' | 'isGeneratingInsight'
  | 'hasMoreInsights' | 'loadAllInsights'
  | 'pendingItemsCount' | 'apiKeys'
  | 'householdId' | 'householdSettings' | 'household'
  | 'refreshInsight' | 'addMember' | 'updateMember' | 'removeMember' | 'deleteHousehold'
  | 'completeOnboarding' | 'setHouseholdCurrency' | 'setModuleVisibility' | 'updateModuleVisibility' | 'setKidModePin' | 'setMealCookedHabitId'
  | 'addKidProfile' | 'updateKidProfile' | 'removeKidProfile'
  | 'activeMemberId' | 'actAs' | 'exitToParent'
  | 'recaps' | 'moneyRecaps'
  | 'notificationLog' | 'unreadNotificationCount' | 'markNotificationRead' | 'markAllNotificationsRead'
>;
