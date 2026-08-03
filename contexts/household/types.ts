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
  HabitInsightsDoc,
  GroceryCatalogItem,
  Store,
  QuickStockList,
  TaskTemplate,
  HouseholdApiKey,
  ModuleKey,
  CaptureType,
  CaptureReviewMode,
  WeeklyRecap,
  MonthlyMoneyRecap,
  NetWorthSnapshot,
  ActivityLogEntry,
  TransactionComment,
  SplitParticipant,
  DietaryProfile,
  FreezeMode,
  CeremonyTone,
  NotificationLogEntry
} from '@/types/schema';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type TrashedItem } from '@/utils/trash';
import { type TriggerSource } from '@/utils/habitTriggers';
import { type TodoSubtaskToggleResult, type TodoCompletionOptions } from '@/contexts/household/mutations/todoMutations';
import { type MerchantRuleDraft } from '@/contexts/household/mutations/merchantRuleMutations';

/** Options accepted by mutations that normally toast per call. `silent: true`
 *  suppresses the per-item success toast so BULK flows (Action Queue
 *  multi-select) can show one summary toast instead of N stacked ones.
 *  Error toasts are never suppressed. */
export interface MutationOpts {
  silent?: boolean;
}

/**
 * A bank descriptor to LEARN onto a bill in the SAME batch as the merge that
 * proved it (`mergeTransactions`' optional third argument). Used by the
 * settled-bill duplicate arm (`utils/settledBillDuplicate.ts`): once the user
 * confirms the bank's row is a copy of a bill they already paid by hand, the
 * descriptor the bank used is known to name that bill, so teaching it lets the
 * nightly sync match it server-side next month instead of importing another
 * duplicate.
 *
 * `calendarItemId` must be the recurring TEMPLATE when the settled doc is a
 * paid instance — a paid instance is a one-shot doc and an alias there teaches
 * nothing about the next occurrence (`aliasTargetForSettledRow` resolves it).
 * `descriptor` must be the RAW stored merchant, never a merchant-rule display
 * name.
 */
export interface MergeLearnAlias {
  calendarItemId: string;
  descriptor: string;
}

/**
 * Which per-collection live listeners have delivered their FIRST snapshot for
 * the household that is currently loaded.
 *
 * `isLoading` answers a DIFFERENT question: it is driven exclusively by the
 * household DOCUMENT listener (`coreListeners.ts` calls `setLoadedHouseholdId`
 * there), so `isLoading === false` says nothing about whether the transactions
 * or habits listeners have produced anything yet — and the transactions
 * listener is not even attached until `isLoading` has already flipped.
 *
 * Without this, an empty array is ambiguous: "this household genuinely has no
 * transactions this week" and "the listener has not answered yet" look
 * identical, and any consumer that computes a total from the array will
 * confidently report `0` for the second case. Consumers that must not do that
 * — today the weekly-recap derivation (`useRecapForWeek`), which would
 * otherwise render a "$0 spent, 0 habits" ceremony and permanently mark it as
 * shown — gate on these flags instead of on array length, so a household that
 * legitimately holds zero rows still resolves (honestly empty) the moment its
 * listener answers.
 *
 * Each flag flips true when its listener delivers, and back to false on a
 * household switch (they are compared against the CURRENT `householdId`). A
 * listener that ERRORS deliberately never marks itself ready: showing nothing
 * is recoverable next session, whereas a confident wrong answer is not.
 */
export interface ListenerReadiness {
  /** The windowed transactions listener has delivered at least once. */
  transactions: boolean;
  /** The habits listener has delivered at least once. */
  habits: boolean;
  /** The members listener has delivered at least once. */
  members: boolean;
  /** The calendar-items listener has delivered at least once. */
  calendarItems: boolean;
}

export interface HouseholdContextType {
  // State
  /** True during the initial cold load before the first household snapshot resolves. */
  isLoading: boolean;
  /**
   * Per-listener first-snapshot readiness — see `ListenerReadiness`. NOT a
   * substitute for `isLoading` (which gates the app-wide skeleton); this is
   * for consumers that must distinguish "delivered, and empty" from "has not
   * delivered".
   */
  listenersReady: ListenerReadiness;
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
  /** Household-defined custom habit categories (reusable chips in the habit
   *  form). Defaults are UI-only; only user-added extras are stored/persisted. */
  habitCategories: string[];
  /** F-DASH-03 — Habit Coach card. Latest `analyzeHabitPatterns()` output,
   *  null until first generated for this household. */
  habitPatterns: HabitInsightsDoc | null;
  isGeneratingHabitPatterns: boolean;
  refreshHabitPatterns: () => Promise<void>;
  insight: string;
  insightsHistory: Insight[];
  isGeneratingInsight: boolean;
  meals: Meal[];
  /** Visible shopping items — excludes held-for-review captures (`needsReview === true`). */
  shoppingList: ShoppingItem[];
  /** Held-for-review shopping captures (`needsReview === true`), hidden from `shoppingList`. */
  shoppingAwaitingReview: ShoppingItem[];
  mealPlan: MealPlanItem[];
  /** Visible to-dos — excludes held-for-review captures (`needsReview === true`). */
  todos: ToDo[];
  /** Held-for-review todo captures (`needsReview === true`), hidden from `todos`. */
  todosAwaitingReview: ToDo[];
  /** F-TODO-16 — household-defined to-do categories (reusable chips on the
   *  to-do surfaces). Mirrors `habitCategories`: only user-added values are
   *  stored/persisted, and defaults to `[]` when the household doc has none. */
  todoCategories: string[];
  /** F-TODO-03 — task-bundle templates ("Quick Task Lists"). */
  taskTemplates: TaskTemplate[];
  groceryCatalog: GroceryCatalogItem[];
  bucketHistory: BucketPeriodSnapshot[];
  /** Weekly recaps (Plan 02) — newest first, bounded live window (RECAPS_LIMIT). */
  recaps: WeeklyRecap[];
  /**
   * On-demand lookup of ONE stored recap doc by ISO week (ARCH-1), for a week
   * outside the bounded `recaps` live window (older than `RECAPS_LIMIT`
   * weeks). The server document remains the source of truth for the AI
   * narrative no matter how old the week is — the client-side derivation
   * (`utils/recapCompose.ts`) is only a fallback for weeks that were never
   * generated at all. Resolves `null` when no doc exists for that week
   * (the common case; not an error). Idempotent from the caller's
   * perspective — safe to call repeatedly for the same week.
   */
  fetchStoredRecap: (isoWeek: string) => Promise<WeeklyRecap | null>;
  /** Monthly money recaps (F-MONEY-06) — newest first, bounded live window
   *  (MONEY_RECAPS_LIMIT). */
  moneyRecaps: MonthlyMoneyRecap[];
  /** Net worth history (F-MONEY-09) — newest first, bounded live window
   *  (NET_WORTH_HISTORY_LIMIT). Server-written daily; clients only read. */
  netWorthHistory: NetWorthSnapshot[];
  /** Household activity log (F-XCUT-01) — newest first, bounded live window
   *  (ACTIVITY_LOG_LIMIT). Read visibility is gated to admins in the UI. */
  activityLog: ActivityLogEntry[];
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
  /** Fetch every meal beyond the bounded live window (cookbook view). Idempotent per household; resolves with the full, up-to-date meals list. */
  loadAllMeals: () => Promise<Meal[]>;
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
  /** Set (or clear) the bank account-number last-4 and the full list of
   *  tagged debit/credit cards for this account. Migrates the legacy
   *  `cardLast4` field into `cardLast4s` (clearing the legacy field) so
   *  readers only need to consult `cardLast4s` going forward — see
   *  `functions/src/quickAdd/accountMatch.ts`, which still reads both for
   *  docs not yet migrated. */
  setAccountCardDetails: (
    id: string,
    details: { accountLast4?: string; cardLast4s: string[] }
  ) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  /** Soft-delete: hide from active lists/net worth/Safe-to-Spend while keeping
   *  the account doc so historical transactions keep resolving to it. */
  archiveAccount: (id: string) => Promise<void>;
  unarchiveAccount: (id: string) => Promise<void>;
  updateAccountOrder: (accountId: string, newOrder: number) => Promise<void>;
  reorderAccounts: (orderedIds: string[]) => Promise<void>;
  /** `Household.defaultAccountId` — the account new transactions pre-select when
   *  they carry none of their own. `undefined` while unset (legacy behaviour). */
  defaultAccountId: string | undefined;
  /** Set (account id) or clear (null) the household's default account. */
  setDefaultAccountId: (accountId: string | null) => Promise<void>;

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
  /** Pay-period ceremony save: set several bucket limits in ONE writeBatch
   *  (all-or-nothing) so a period's budget plan can't half-apply. */
  setBucketLimits: (updates: { id: string; limit: number }[]) => Promise<void>;
  /** Pay-period ceremony save covering BOTH bucket limits and account balance
   *  true-ups in ONE writeBatch (all-or-nothing). Balances may be negative
   *  (overdrawn); balance writes stamp lastUpdated like updateAccountBalance. */
  saveCeremonyChanges: (updates: {
    bucketLimits: { id: string; limit: number }[];
    accountBalances: { id: string; balance: number }[];
  }) => Promise<void>;
  reallocateBucket: (sourceId: string, targetId: string, amount: number) => Promise<void>;

  // Calendar Actions
  addCalendarItem: (item: CalendarItem) => Promise<void>;
  updateCalendarItem: (item: CalendarItem, opts?: MutationOpts) => Promise<void>;
  deleteCalendarItem: (id: string, opts?: MutationOpts) => Promise<void>;
  /** Mark a calendar item paid/received. Optional `actualAmount` records what
   *  was really paid (variable bills) — it drives the balance delta and the
   *  created transaction (and the paid instance record) instead of the item's
   *  budgeted `amount`; a recurring template's own amount is left untouched. */
  payCalendarItem: (itemId: string, accountId: string, opts?: MutationOpts & { actualAmount?: number }) => Promise<void>;
  deferCalendarItem: (itemId: string, opts?: MutationOpts) => Promise<void>;
  /** Reconcile a bank-synced transaction (carries a `bankRef`) as the payment
   *  for an unpaid expense calendar item: marks the bill paid at the txn's
   *  actual amount (NO account-balance write — the row's balance is already
   *  authoritative), files the transaction as `Budgeted in Calendar`, and
   *  learns the transaction's merchant descriptor onto the bill's
   *  `bankDescriptorAliases` so future nightly syncs auto-match it.
   *  `calendarItemId` accepts either a plain calendar item id or a synthetic
   *  recurring-occurrence id (`templateId_instance_yyyy-MM-dd`).
   *  Returns `true` only when the link actually committed — `false` for any
   *  guard early-return (already paid, bad id, etc.); callers must not treat
   *  a `false` result as success. */
  linkBankTransactionToBill: (transactionId: string, calendarItemId: string) => Promise<boolean>;
  /** The retract half of alias learning: drop ONE learned bank descriptor from
   *  a bill's `bankDescriptorAliases`. A wrong alias makes the nightly sync
   *  auto-mark that bill paid off an unrelated charge every period, so this is
   *  the repair path for it. `calendarItemId` must be the REAL doc id that
   *  carries the array — the recurring TEMPLATE for a series, never a synthetic
   *  occurrence id. `alias` must be the exact stored string (`arrayRemove`
   *  matches by equality; do not normalize it first). Deliberately NOT folded
   *  into `updateCalendarItem`, whose field allowlist omits this array on
   *  purpose so a stale-snapshot Save can never clobber it. */
  forgetBillDescriptorAlias: (calendarItemId: string, alias: string) => Promise<void>;
  /** TODO.md 2H(a) — "this charge IS that planned bill". Settles an unpaid
   *  expense calendar item using an EXISTING transaction, creating no second
   *  transaction: marks the bill paid at the transaction's (scanned) amount,
   *  verifies + files the transaction as `Budgeted in Calendar`, stamps
   *  `Transaction.paidCalendarItemId` with the REAL paid doc id, moves the
   *  account balance by the row's now-effective impact (a `pending_review` row
   *  debits its amount; a bank-sync row whose balance is already authoritative
   *  moves nothing), and learns the descriptor onto the bill's
   *  `bankDescriptorAliases`. The transaction's `payPeriodId` is left untouched.
   *  `calendarItemId` accepts a plain doc id or a synthetic
   *  recurring-occurrence id (`templateId_instance_yyyy-MM-dd`) — NEVER a
   *  recurring template's own id, which would rewrite every future
   *  occurrence's budgeted amount. `accountId` overrides which account the
   *  balance delta lands on (the picker's confirmation); omit to use the
   *  transaction's existing tag. `amount` co-commits a corrected amount onto the
   *  transaction in the SAME batch and is what the bill is marked paid at and
   *  what the balance moves by — the review form's live field, so settling a
   *  mis-OCR'd row the user just fixed can't settle at the stale figure; omit to
   *  use the stored amount. Returns `true` only when the batch committed;
   *  `false` means nothing was written. */
  settleBillWithTransaction: (
    transactionId: string,
    calendarItemId: string,
    accountId?: string,
    amount?: number,
  ) => Promise<boolean>;

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
   *  (amount/merchant/date/notes, plus clearing the `needsAmount` stub flag) in the
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
    overrides?: { amount?: number; merchant?: string; date?: string; notes?: string; clearNeedsAmount?: boolean; creditPayment?: boolean; isRecurring?: boolean },
  ) => Promise<void>;
  /** Habit Automations (PRD #1065): atomic UNDO for a swipe-approve that fired
   *  habits. Reverses the transaction to `pending_review` (restoring prior
   *  category/account/relatedHabitIds and crediting back the balance delta),
   *  decrements every habit in `firedHabitIds` with its points, and clears the
   *  transaction's fired ledger — all in ONE writeBatch. `firedHabitIds` is the
   *  set the approve just fired (passed explicitly so undo is race-free). */
  reverseTransactionApproval: (
    id: string,
    prior: { category: string; accountId?: string; relatedHabitIds?: string[] },
    firedHabitIds: string[],
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
   *  `pickKeeper` from the same util) — EXCEPT on the settled-bill arm, where
   *  the keeper is always the row carrying `paidCalendarItemId` (see
   *  `utils/settledBillDuplicate.ts`; `pickKeeper` would name the bank row and
   *  the merge would then refuse via the settled-bill guard).
   *
   *  `learnAlias` optionally teaches a bank descriptor to a bill in the SAME
   *  batch — used by that arm (only on `descriptor`-tier evidence) so the
   *  nightly sync matches the descriptor server-side next month instead of
   *  importing another duplicate.
   *
   *  Resolves TRUE when the dupe was merged away, FALSE when the merge was
   *  refused without writing (no household / the settled-bill guard); throws on
   *  a real failure. Advance a review UI only on `true`. */
  mergeTransactions: (keeperId: string, dupeId: string, learnAlias?: MergeLearnAlias) => Promise<boolean>;
  /** Dismiss a duplicate banner without merging: clears `possibleDuplicateOf`.
   *  `dismissDuplicateOf` — passed ONLY by the settled-bill arm, which is
   *  computed at render and has no stored flag to clear — additionally
   *  persists `duplicateDismissedFor` so that ONE pairing stops being offered
   *  (see `utils/settledBillDuplicate.ts`). */
  keepBothTransactions: (txnId: string, dismissDuplicateOf?: string) => Promise<void>;

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
  /** Habit Automations (PRD #1065): an optional `source` attributes an
   *  automated fire (e.g. `{ type: 'geo', ... }`) — it fires exactly like a
   *  manual tap (same batch/scoring), just with a toast + activity-log tag. */
  toggleHabit: (id: string, direction: 'up' | 'down', source?: TriggerSource) => Promise<void>;
  resetHabit: (id: string) => Promise<void>;
  /** F-HABITS-01: set (yyyy-MM-dd) or clear (null) a habit's planned-break end
   *  date. A paused habit skips the auto-reset penalty and freeze-token
   *  consumption, and its streak bridges the break. */
  setHabitPause: (id: string, pausedUntil: string | null) => Promise<void>;
  /** Persists the household's custom habit-category chip list to the household
   *  doc (mirrors updateGroceryCategories). Pass only the user-added extras —
   *  the default categories are UI-only and not stored. */
  updateHabitCategories: (categories: string[]) => Promise<void>;

  // Habit Submission Actions
  addHabitSubmission: (
    habitId: string,
    count: number,
    timestamp?: string,
    note?: string,
    mood?: HabitSubmission['mood'],
    /** Member uids this log is FOR. One submission doc of `count` units per
     *  uid, so a two-person log adds `count × uids.length` units. Omit for the
     *  legacy behaviour: a single doc attributed to the assignee, else the
     *  signed-in member. */
    attributeTo?: readonly string[],
  ) => Promise<void>;
  updateHabitSubmission: (habitId: string, submissionId: string, updates: Partial<HabitSubmission>) => Promise<void>;
  deleteHabitSubmission: (habitId: string, submissionId: string) => Promise<void>;
  getHabitSubmissions: (habitId: string, startDate?: string, endDate?: string) => Promise<HabitSubmission[]>;
  /** Clear ONE calendar day of a habit's log: deletes that day's submissions
   *  (or reverses a toggle-path completion), reversing exactly the points that
   *  were credited, and recomputes streaks — all in one atomic batch. */
  resetHabitDay: (habitId: string, date: string) => Promise<void>;

  // Per-member habit points (stage 1) — the attribution write API. Nothing in
  // the UI calls these yet; the stage-2 long-press picker will.
  /** Credit ONE completion to each of `memberIds` on `date` (default today).
   *  Member-set based, so "Me" / "Jen" / "Both of us" are the same call with a
   *  different set. Each member is credited a full completion at their OWN
   *  streak multiplier; the habit's counters move one unit per member. */
  creditHabitCompletion: (habitId: string, memberIds: string[], date?: string) => Promise<void>;
  /** Un-credit ONE of `memberId`'s completions on `date` (default today):
   *  decrements their count, drops the date from their completion set once it
   *  hits zero, and reverses exactly the points that completion earned (their
   *  own streak multiplier AT that date). A no-op on an unattributed
   *  (pre-feature) completion. */
  uncreditHabitCompletion: (habitId: string, memberId: string, date?: string) => Promise<void>;

  // Household credit mode — the attribution layer's "credits nobody" twins.
  /** Credit ONE completion on `date` (default today) to the HOUSEHOLD and to
   *  nobody individually. Writes no `completedBy` entry, so the completion
   *  scores through the unattributed path: one award at the habit's OWN flame,
   *  paid to the pool. */
  creditHouseholdCompletion: (habitId: string, date?: string) => Promise<void>;
  /** Take back ONE unattributed completion on `date` (default today). No member
   *  is debited (none was credited); the pool loses exactly what the
   *  unattributed remainder contributed. */
  uncreditHouseholdCompletion: (habitId: string, date?: string) => Promise<void>;

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
  // F-DASH-11 — thumbs up/down feedback on a single insight doc.
  rateInsight: (insightId: string, feedback: 'up' | 'down') => Promise<void>;

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

  // Unified trash / recently-deleted recovery (F-XCUT-03)
  /** Soft-deleted records across the trash-enabled domains (todos, shopping
   *  items, meals, planned meals, habits), newest-first and bounded. Empty when
   *  the `trash` rules PR hasn't shipped yet (reads permission-deny). */
  trashedItems: TrashedItem[];
  /** Restore a soft-deleted record: re-creates the original doc and clears the
   *  trash entry, atomically. */
  restoreTrashedItem: (item: TrashedItem) => Promise<void>;
  /** Permanently delete a trashed record now (no recovery). */
  purgeTrashedItem: (item: TrashedItem) => Promise<void>;

  // Onboarding
  /** Mark the first-run onboarding wizard as finished so it is never shown again. */
  completeOnboarding: () => Promise<void>;

  /** Set the household's display currency (ISO-4217 code, e.g. 'USD', 'EUR'). */
  setHouseholdCurrency: (currency: string) => Promise<void>;

  /** Plan 090 — toggle a module on/off for the household (merge-writes moduleVisibility.<key>). */
  setModuleVisibility: (key: ModuleKey, value: boolean) => Promise<void>;

  /** F-PLAT-07 — apply a full module-visibility preset in one write (merge-writes every key at once). */
  updateModuleVisibility: (patch: Partial<Record<ModuleKey, boolean>>) => Promise<void>;

  /** Set a household's capture-review routing for one quick-add input type (merge-writes captureReview.<type>). See utils/captureReview.ts. */
  setCaptureReviewMode: (type: CaptureType, mode: CaptureReviewMode) => Promise<void>;

  /** Set (raw PIN, salted+hashed before write) or clear (null) the Kid Mode exit PIN. */
  setKidModePin: (pin: string | null) => Promise<void>;

  /** F-MEALS-03: set the household's standing dietary restrictions/allergens. */
  setDietaryProfile: (profile: DietaryProfile) => Promise<void>;

  /** F-MEALS-04: set (habit id) or clear (null) the habit auto-credited when a meal is marked cooked. */
  setMealCookedHabitId: (habitId: string | null) => Promise<void>;

  /** Per-member habit points (stage 6): how the household spends freeze tokens. See utils/freezeSettings.ts. */
  setFreezeMode: (mode: FreezeMode) => Promise<void>;

  /** Per-member habit points (stage 6): how the weekly ceremony frames the week. Consumed by stage 5. */
  setCeremonyTone: (tone: CeremonyTone) => Promise<void>;

  // Merchant rule actions (F-MONEY-14). `Household.merchantRules` is a bounded
  // array on the household settings doc, so these sit on the CORE slice
  // alongside the other household-doc writers — every consumer of the rules
  // already reads them through `householdSettings` on that same slice.
  // All three transact on the household doc; see merchantRuleMutations.ts for
  // why no array operator is safe here. Each rejects (after toasting) when the
  // save does not happen, so an editor form can stay open.
  /** Append a rule, enforcing MAX_MERCHANT_RULES against the server's array. */
  addMerchantRule: (draft: MerchantRuleDraft) => Promise<void>;
  /** Replace a rule's draft fields; createdAt/matchCount/lastMatchedAt survive. */
  updateMerchantRule: (id: string, draft: MerchantRuleDraft) => Promise<void>;
  deleteMerchantRule: (id: string) => Promise<void>;

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
  /**
   * Approves a held-for-review shopping capture (`shoppingAwaitingReview`):
   * persists any edited `overrides` AND clears `needsReview` in one write.
   * Reject is `deleteShoppingItem` — there is no separate reject mutation.
   */
  approveShoppingItem: (
    id: string,
    overrides?: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'category' | 'store'>>
  ) => Promise<void>;

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
  /** @param options.subtaskToggle by-id subtask flip persisted in the SAME
   *  completion batch — used by inline subtask auto-complete so the triggering
   *  step is written (merged onto a fresh read) atomically with the completion. */
  completeToDo: (id: string, options?: TodoCompletionOptions) => Promise<void>;
  /**
   * Approves a held-for-review to-do capture (`todosAwaitingReview`):
   * persists any edited `overrides` AND clears `needsReview` in one write.
   * Reject is `deleteToDo` — there is no separate reject mutation.
   */
  approveTodo: (
    id: string,
    overrides?: Partial<Pick<ToDo, 'text' | 'completeByDate' | 'assignedTo' | 'isImportant'>>
  ) => Promise<void>;
  /** Counterpart of completeToDo: restores a completed to-do to active and
   *  atomically reverses any managed-kid points the completion credited.
   *  @param options.subtaskToggle by-id subtask flip to apply in the same batch
   *  — used to re-uncheck (`{ done: false }`) the subtask that triggered an
   *  auto-complete, merged onto a fresh read. */
  uncompleteToDo: (id: string, options?: TodoCompletionOptions) => Promise<void>;
  /** Inline subtask access (owner-approved): flip one subtask's done state from
   *  the list row. Checking the LAST step auto-completes the parent to-do in a
   *  single writeBatch (subtasks + completion + linked-habit fire + kid points);
   *  every other toggle is a plain subtasks-array update. */
  toggleTodoSubtask: (todoId: string, subtaskId: string) => Promise<TodoSubtaskToggleResult>;
  /** F-TODO-16 — persists the household's to-do category vocabulary (mirrors
   *  `updateHabitCategories`). Callers pass the WHOLE next list. */
  updateTodoCategories: (categories: string[]) => Promise<void>;
  /** F-TODO-16 — renames a category across every matching to-do (active AND
   *  completed, case-insensitive match) and the household list, in chunked
   *  batches. No-op for a blank or unchanged name; MERGES into an existing
   *  category when the new name collides with one case-insensitively. */
  renameTodoCategory: (oldName: string, newName: string) => Promise<void>;
  /** F-TODO-16 — removes a category from the household list and CLEARS it from
   *  every matching to-do (the field is deleted, so they fall back to
   *  Uncategorized), in chunked batches. */
  deleteTodoCategory: (name: string) => Promise<void>;
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
  | 'addAccount' | 'updateAccountBalance' | 'setAccountGoal' | 'setAccountCardLast4' | 'setAccountCardDetails' | 'deleteAccount'
  | 'archiveAccount' | 'unarchiveAccount'
  | 'updateAccountOrder' | 'reorderAccounts' | 'defaultAccountId' | 'setDefaultAccountId'
  | 'addSavingsGoal' | 'updateSavingsGoal' | 'deleteSavingsGoal' | 'contributeToGoal'
  | 'addBucket' | 'updateBucket' | 'deleteBucket' | 'updateBucketLimit' | 'setBucketLimits' | 'saveCeremonyChanges' | 'reallocateBucket'
  | 'addCalendarItem' | 'updateCalendarItem' | 'deleteCalendarItem' | 'payCalendarItem' | 'deferCalendarItem'
  | 'linkBankTransactionToBill' | 'settleBillWithTransaction' | 'forgetBillDescriptorAlias'
  | 'addTransaction' | 'addTransactions' | 'updateTransactionCategory' | 'reverseTransactionApproval' | 'updateTransaction' | 'deleteTransaction' | 'splitTransaction'
  | 'setTransactionSplit' | 'markSplitSettled'
  | 'mergeTransactions' | 'keepBothTransactions'
  | 'getTransactionComments' | 'addTransactionComment' | 'deleteTransactionComment'
>;

export type GamificationContextValue = Pick<HouseholdContextType,
  | 'dailyPoints' | 'weeklyPoints' | 'totalPoints' | 'habits' | 'habitCategories'
  | 'activeChallenge' | 'challenges'
  | 'yearlyGoals' | 'activeYearlyGoals' | 'primaryYearlyGoal'
  | 'rewardsInventory' | 'freezeBank'
  | 'habitPatterns' | 'isGeneratingHabitPatterns' | 'refreshHabitPatterns'
  | 'addHabit' | 'updateHabit' | 'deleteHabit' | 'archiveHabit' | 'unarchiveHabit' | 'reorderHabits' | 'toggleHabit' | 'resetHabit' | 'setHabitPause' | 'updateHabitCategories'
  | 'addHabitSubmission' | 'updateHabitSubmission' | 'deleteHabitSubmission' | 'getHabitSubmissions'
  | 'resetHabitDay' | 'creditHabitCompletion' | 'uncreditHabitCompletion'
  | 'creditHouseholdCompletion' | 'uncreditHouseholdCompletion'
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
  | 'shoppingList' | 'shoppingAwaitingReview' | 'groceryCatalog' | 'loadFullGroceryCatalog' | 'stores' | 'groceryCategories' | 'quickStockLists'
  | 'addShoppingItem' | 'addShoppingItems' | 'updateShoppingItem' | 'reorderShoppingItems'
  | 'deleteShoppingItem' | 'approveShoppingItem' | 'toggleShoppingItemPurchased' | 'clearPurchasedShoppingItems'
  | 'addStore' | 'updateStore' | 'deleteStore' | 'reorderStores' | 'updateGroceryCategories'
  | 'addQuickStockList' | 'updateQuickStockList' | 'updateQuickStockLists' | 'deleteQuickStockList'
  | 'addGroceryCatalogItem' | 'updateGroceryCatalogItem' | 'deleteGroceryCatalogItem'
>;

/** Backward-compatible union of both meal-plan and shopping slices. */
export type MealsContextValue = MealPlanContextValue & ShoppingContextValue;

export type TodosContextValue = Pick<HouseholdContextType,
  | 'todos' | 'todosAwaitingReview' | 'addToDo' | 'updateToDo' | 'deleteToDo' | 'approveTodo' | 'completeToDo' | 'uncompleteToDo' | 'toggleTodoSubtask'
  | 'todoCategories' | 'updateTodoCategories' | 'renameTodoCategory' | 'deleteTodoCategory'
  | 'isLoadingOlderTodos' | 'hasMoreCompletedTodos' | 'loadOlderCompletedTodos'
  | 'taskTemplates' | 'addTaskTemplate' | 'updateTaskTemplate' | 'deleteTaskTemplate' | 'applyTaskTemplate'
>;

export type HouseholdCoreContextValue = Pick<HouseholdContextType,
  | 'isLoading' | 'listenersReady' | 'currentUser' | 'members'
  | 'insight' | 'insightsHistory' | 'isGeneratingInsight'
  | 'hasMoreInsights' | 'loadAllInsights'
  | 'pendingItemsCount' | 'apiKeys'
  | 'householdId' | 'householdSettings' | 'household'
  | 'refreshInsight' | 'rateInsight' | 'addMember' | 'updateMember' | 'removeMember' | 'deleteHousehold'
  | 'completeOnboarding' | 'setHouseholdCurrency' | 'setModuleVisibility' | 'updateModuleVisibility' | 'setCaptureReviewMode' | 'setKidModePin' | 'setDietaryProfile' | 'setMealCookedHabitId'
  | 'setFreezeMode' | 'setCeremonyTone'
  | 'addMerchantRule' | 'updateMerchantRule' | 'deleteMerchantRule'
  | 'addKidProfile' | 'updateKidProfile' | 'removeKidProfile'
  | 'activeMemberId' | 'actAs' | 'exitToParent'
  | 'recaps' | 'fetchStoredRecap' | 'moneyRecaps' | 'activityLog'
  | 'trashedItems' | 'restoreTrashedItem' | 'purgeTrashedItem'
  | 'notificationLog' | 'unreadNotificationCount' | 'markNotificationRead' | 'markAllNotificationsRead'
>;
