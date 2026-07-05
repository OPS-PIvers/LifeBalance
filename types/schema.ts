
// 'kid' (Plan 080) is a login-less managed child profile — a member doc a parent
// creates/manages, never added to the household memberUids array (no credential).
export type Role = 'admin' | 'member' | 'kid';

// Plan 090 (Modular pages): the toggleable surfaces. 'plan' is the footer page;
// 'todos' | 'meals' | 'shopping' are its sub-tabs. 'habits' and 'money' are
// top-level footer pages. Home and Settings are always-on and not in this set.
export type ModuleKey = 'habits' | 'money' | 'plan' | 'todos' | 'meals' | 'shopping';

export const INCOME_CATEGORY = 'Income';

export interface NotificationPreferences {
  // Habit reminders
  habitReminders: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour)
  };

  // Action queue (todos) morning reminder
  actionQueueReminders: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour)
  };

  // Budget alerts when safe-to-spend is low
  budgetAlerts: {
    enabled: boolean;
    threshold?: number; // Alert when safe-to-spend drops below this amount
  };

  // Streak warnings (habit streak about to break)
  streakWarnings: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour) - when to check and warn
  };

  // Bill payment reminders
  billReminders: {
    enabled: boolean;
    daysBeforeDue: number; // How many days before due date to remind
    time: string; // HH:MM format (24-hour)
  };

  // Weekly recap push (Plan 02). Sent server-side Sundays ~17:00 in the
  // member's timezone; no time selection needed, so it's a bare toggle.
  // Optional so legacy docs deserialize — treat absent as enabled (default ON).
  weeklyRecap?: {
    enabled: boolean;
  };

  // General notification settings
  timezone?: string; // IANA timezone (e.g., 'America/New_York')
}

export interface HouseholdMember {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  role: Role;
  telegramChatId?: string;
  points: { daily: number; weekly: number; total: number };
  // Tracking when points were last reset (YYYY-MM-DD format)
  lastDailyPointsReset?: string;
  lastWeeklyPointsReset?: string;
  fcmTokens?: string[]; // Array of FCM tokens for push notifications
  notificationPreferences?: NotificationPreferences; // User's notification settings
  // Legal consent captured at signup — Plan 011
  consentAcceptedAt?: string; // ISO timestamp when Terms + Privacy were accepted
  consentVersion?: string; // CONSENT_VERSION accepted (see utils/legal.ts)

  // --- Plan 080: managed kid profiles (login-less child member docs) ---
  // A kid is a member doc a PARENT creates/manages; its synthetic `kid_<uuid>` uid
  // never enters the household memberUids array, so it holds no credential. See
  // plans/080-kid-mode-family-profiles.md.
  isManaged?: boolean; // true = login-less managed profile (a kid)
  managedByUid?: string; // uid of the parent who created this profile
  avatarColor?: string; // kid-friendly avatar accent (e.g. a brand-* / habit-* token)
  avatarEmoji?: string; // kid-friendly avatar glyph
  allowanceCents?: number; // tracked IOU/allowance ledger (NOT an in-app payout)

  // Plan 02 (weekly recap): per-member push-delivery dedupe marker — the ISO
  // week ('2026-W27') of the last recap push sent to this member. Written
  // server-side only (the scheduled function); the client never writes it.
  lastRecapSentWeek?: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit';
  balance: number;
  lastUpdated: string;
  monthlyGoal?: number;
  order?: number; // Display order within asset/liability group
  /** Last 4 digits of the debit/credit card tied to this account (e.g. "8899").
   *  Used to auto-route incoming Shortcut/bank-notification transactions to the
   *  right account: the Wells Fargo email automation sends the card's last 4
   *  ("...8899") and quickAddExpense matches it against this field. Optional —
   *  accounts without a card (savings) or the user hasn't tagged one leave it
   *  unset, and untagged transactions fall back to the checking account. */
  cardLast4?: string;
  /** Advisory balance from a linked Plaid account (server-written by
   *  `plaidsynctransactions`; see CLAUDE.md Atomicity notes). NEVER overwrites
   *  `balance` — the manual field stays authoritative; these three fields only
   *  power the "Update to bank balance" chip in the budget account cards.
   *  Absent for accounts with no linked Plaid mapping. */
  plaidBalanceCurrent?: number;
  plaidBalanceAvailable?: number;
  /** ISO timestamp of the last successful balance read for this account. */
  plaidBalanceUpdatedAt?: string;
}

export interface SubBucket {
  id: string;
  name: string;
}

export interface BudgetBucket {
  id: string;
  name: string;
  limit: number;
  spent?: number; // DEPRECATED: Now calculated in real-time from transactions. Will be removed after migration.
  color: string; // Key from BUCKET_COLORS (data/bucketColors). Legacy docs store a raw 'bg-*-500' class; the Firestore converter normalizes it to a key on read.
  isVariable: boolean;
  isCore: boolean;
  currentPeriodId?: string; // Current pay period ID (YYYY-MM-DD)
  lastResetDate?: string; // YYYY-MM-DD when last reset occurred
  subBuckets?: SubBucket[];
}

export interface BucketPeriodSnapshot {
  id: string;
  bucketId: string;
  bucketName: string; // Snapshot of name (in case bucket is renamed or deleted)
  periodId: string; // YYYY-MM-DD format of period start
  periodStartDate: string; // YYYY-MM-DD
  periodEndDate: string; // YYYY-MM-DD
  limit: number; // Snapshot of limit for this period
  totalSpent: number; // Final verified spent amount for the period
  totalPending: number; // Final pending amount when period closed
  transactionCount: number; // Number of transactions in this bucket for this period
  createdAt: string; // Timestamp when snapshot was created
}

export interface Transaction {
  id: string;
  amount: number;
  merchant: string;
  category: string;
  date: string;
  status: 'verified' | 'pending_review';
  isRecurring: boolean;
  source: 'manual' | 'camera-scan' | 'file-upload' | 'telegram' | 'recurring' | 'shortcut' | 'plaid';
  autoCategorized: boolean;
  payPeriodId?: string; // Pay period ID (YYYY-MM-DD of period start), empty string if no period tracking
  relatedHabitIds?: string[];
  subBucketId?: string;
  store?: string;
  accountId?: string;
  /** When the transaction is tagged to a CREDIT account, marks it as a PAYMENT
   *  toward the card (reduces the credit balance) rather than a charge (which
   *  increases it). Meaningless / ignored for checking & savings accounts.
   *  Absent ⇒ treated as a charge. Never represents income or bucket spend. */
  creditPayment?: boolean;
  notes?: string;
  createdAt?: string; // ISO timestamp
  /** Apple Pay $0 pre-authorization stub (created by the quickAddExpense Cloud
   *  Function): the merchant + date are known but the real charge amount is not
   *  yet entered, so `amount` is a placeholder 0. Cleared (set false) once the
   *  user supplies the amount during review. Absent on normal transactions. */
  needsAmount?: boolean;
  /** LEGACY — no longer written or read. The retired "awaiting amount" drawer
   *  stamped this to suppress its auto-pop; the on-open review drawer now simply
   *  re-opens while un-snoozed `pending_review` transactions remain. Kept so
   *  historical docs carrying the field still type-check. */
  needsAmountPromptedAt?: string;
  /** Plaid `transaction_id` for transactions synced from a linked bank
   *  (`source: 'plaid'`). The dedup key: a sync skips any item whose
   *  `plaidTransactionId` already exists, so re-syncs never duplicate. Absent on
   *  manual / scan / shortcut transactions. */
  plaidTransactionId?: string;
  /** Plan 03: doc id of an existing transaction this row is a *possible*
   *  duplicate of (verdict 'possible' from `utils/transactionIdentity.ts` at
   *  ingestion time). The review UI renders a Merge / Keep-both choice; both
   *  actions clear the flag. Absent on rows with no suspected twin. */
  possibleDuplicateOf?: string;
  /** Action-Queue snooze for a `pending_review` transaction (yyyy-MM-dd, local).
   *  Set by the "Defer" gesture on the Action Queue; while it is AFTER today the
   *  row is hidden from the queue (it still counts toward pendingSpend /
   *  Safe-to-Spend — deferring the review doesn't defer the money). Cleared when
   *  the transaction is verified. Absent on never-deferred rows. */
  reviewSnoozedUntil?: string;
  /** Plan 04: a Plaid `modified` update to a row the user already `verified`
   *  (so it was NOT clobbered — see functions/src/plaid/revisions.ts). Holds
   *  only the fields that actually changed. Surfacing a review UI for this is
   *  OUT of scope for plan 04; the field is written and passed through so a
   *  future review surface has something to read. Absent on rows with no
   *  pending Plaid revision. */
  plaidRevision?: {
    amount?: number;
    merchant?: string;
    date?: string;
    /** ISO timestamp of when the revision was recorded. */
    revisedAt?: string;
  };
  /** Plan 04: Plaid reported this `verified` row as `removed` from the bank's
   *  data (e.g. a pending charge that never settled). The row is NOT deleted
   *  — the user's money already moved in-app — so this flags it for manual
   *  reconciliation instead. Absent on rows Plaid has not reported removed. */
  plaidRemoved?: boolean;
}

export interface CalendarItem {
  id: string;
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD
  type: 'income' | 'expense';
  isPaid: boolean;
  isRecurring?: boolean;
  frequency?: 'weekly' | 'bi-weekly' | 'monthly';
  parentRecurringId?: string; // If this is a paid instance of a recurring event, points to parent
  isDeleted?: boolean; // If this is a deleted instance of a recurring event, prevents it from appearing
  accountId?: string;
  /** Optional: ID of the BudgetBucket that covers this calendar expense item.
   *  When present, bucket-coverage matching uses this exact ID instead of
   *  falling back to name-based heuristics, making the check precise and
   *  immune to false-positive substring matches. */
  bucketId?: string;
}

export type EffortLevel = 'easy' | 'medium' | 'hard' | 'very_hard';

export interface Habit {
  id: string;
  title: string;
  category: string;
  type: 'positive' | 'negative';

  // Scoring & Frequency
  basePoints: number;
  scoringType: 'incremental' | 'threshold';
  period: 'daily' | 'weekly';
  targetCount: number;

  // State
  count: number;
  totalCount: number; // Lifetime count
  completedDates: string[]; // YYYY-MM-DD
  streakDays: number;
  lastUpdated: string; // To handle resets

  // Ownership (for Firebase multi-user support)
  isShared?: boolean; // true = household-wide, false/undefined = personal
  ownerId?: string; // uid if personal habit
  createdBy?: string; // uid of creator

  // Plan 080 (Kid Mode): the member this habit is assigned to as a chore — a real
  // member uid or a synthetic `kid_<uuid>`. The kid dashboard (080b) shows only
  // habits where `assignedTo === activeKidUid`; the assignment UI + per-kid point
  // crediting land in 080c. Absent on every existing habit (an unassigned habit).
  assignedTo?: string;

  // Preset vs Custom tracking
  presetId?: string; // If from a preset, stores the preset ID
  isCustom?: boolean; // true = user-created, false/undefined = from preset
  effortLevel?: EffortLevel; // Effort level for the habit
  order?: number; // Display order for sorting

  // Legacy/Optional
  weatherSensitive: boolean;
  telegramAlias?: string;

  // Submission Tracking
  hasSubmissionTracking?: boolean; // true = uses submissions subcollection
}

export interface HabitSubmission {
  id: string;
  habitId: string;
  habitTitle: string; // Denormalized for display
  timestamp: string; // ISO 8601 datetime
  date: string; // YYYY-MM-DD for grouping
  count: number; // Number of completions in this submission
  pointsEarned: number; // Points earned at time of submission
  streakDaysAtTime: number; // Snapshot of streak when submitted
  multiplierApplied: number; // 1.0, 1.5, or 2.0
  createdBy: string; // uid of member who submitted
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp if edited
}

export interface RewardItem {
  id: string;
  title: string;
  cost: number;
  icon: string;
  createdBy: string;
  // Plan 080d — Kid-Mode reward kinds (all optional/legacy-safe; absent = realWorld).
  /** 'realWorld' = a physical/experiential reward; 'allowance' = credits a cash allowance. Defaults to 'realWorld' when absent. */
  type?: 'realWorld' | 'allowance';
  /** For allowance rewards: the cash amount credited, in integer cents. */
  allowanceCents?: number;
  /** A specific kid's uid this reward targets; absent = available to all kids. */
  targetMemberId?: string;
  /** Whether the reward is shown in the store. Treated as true when absent. */
  active?: boolean;
}

/**
 * RewardRedemption (Plan 080d-2): a kid's request to redeem a reward, awaiting
 * parent approval. Lives ONLY while `status === 'pending'` in the bounded
 * `Household.pendingRedemptions` array (removed on approve/deny), so the array
 * never accumulates resolved requests. A kid never has a credential — the request
 * write executes in the acting-as parent's session (Principle 2). On approval the
 * kid's point cost is deducted and, for allowance rewards, the allowance IOU is
 * credited (see utils/redemption.ts — the single source of truth for the delta).
 */
export interface RewardRedemption {
  id: string;
  rewardId: string;
  rewardTitle: string; // Snapshot of the reward title (reward may be edited/deleted later)
  memberId: string; // The kid uid the redemption is for
  cost: number; // Point cost deducted from the kid on approval
  type: 'realWorld' | 'allowance';
  allowanceCents?: number; // For allowance rewards: the IOU amount credited on approval
  status: 'pending';
  requestedAt: string; // ISO timestamp
  requestedByUid: string; // uid of the (parent) session that submitted the request
}

/**
 * RewardRedemptionRecord — a completed reward redemption, logged for the rewards
 * center's "Recently redeemed" history. Each instant redemption (the adult flow:
 * redeemReward → deduct shared household points) appends one of these. Stored as a
 * bounded, most-recent-first array on `Household.redemptionHistory` (capped at
 * REDEMPTION_HISTORY_LIMIT — see utils/redemption.ts), mirroring the rules-free
 * `pendingRedemptions` array so it needs no firestore.rules change. All fields are
 * snapshots so a later edit/delete of the reward can't rewrite history.
 */
export interface RewardRedemptionRecord {
  id: string;
  rewardId: string; // The reward that was redeemed (may be edited/deleted later)
  rewardTitle: string; // Snapshot of the reward title at redemption time
  icon: string; // Snapshot of the reward icon at redemption time
  cost: number; // Points deducted from the shared household total
  redeemedByUid: string; // uid of the member who redeemed (resolved to a name for display)
  redeemedAt: string; // ISO timestamp
}

export interface Challenge {
  id: string;
  month: string; // YYYY-MM format
  title: string;
  description?: string; // Optional challenge description
  relatedHabitIds: string[];

  // Enhanced targeting (backward compatible)
  targetType?: 'count' | 'percentage'; // Defaults to 'count' if not set
  targetValue?: number; // Replaces targetTotalCount
  targetTotalCount?: number; // DEPRECATED: Keep for backward compatibility, use targetValue
  currentValue?: number; // Calculated field

  // Yearly Goal Connection
  yearlyGoalId?: string; // Link to specific yearly goal
  // DECOUPLED from yearly goals in Plan 080e: optional so a challenge can exist
  // without a yearly-reward coupling. Legacy + yearly-linked challenges keep
  // their stored value; family challenges (created via addChallenge) omit it.
  yearlyRewardLabel?: string;

  // Plan 080e (Kid Mode): marks a challenge created through the dormant
  // "New family challenge" flow. Absent on all legacy/yearly challenges.
  isFamilyChallenge?: boolean;

  status: 'active' | 'success' | 'failed';

  // Metadata
  createdAt?: string;
  createdBy?: string;
  completedAt?: string; // When status changed to success/failed
}

export interface YearlyGoal {
  id: string;
  year: number; // e.g., 2025
  title: string; // e.g., "Family Trip to Disney"
  description?: string;
  requiredMonths: number; // e.g., 10 (out of 12)
  successfulMonths: string[]; // Array of YYYY-MM strings
  status: 'in_progress' | 'achieved' | 'failed';

  // Metadata
  createdBy: string;
  createdAt: string;
  achievedAt?: string;
}

export interface FreezeBankHistoryEntry {
  id: string;
  type: 'earned' | 'used' | 'rollover' | 'expired';
  amount: number; // +2 for earned, -1 for used
  date: string; // YYYY-MM-DD
  habitId?: string; // If type === 'used'
  habitDate?: string; // YYYY-MM-DD of patched date
  notes?: string;
  createdAt: string;
}

export interface FreezeBank {
  tokens: number; // Current balance (0-3)
  maxTokens: number; // Always 3
  lastRolloverDate: string; // YYYY-MM-DD
  lastRolloverMonth: string; // YYYY-MM for tracking
  history: FreezeBankHistoryEntry[]; // Audit trail
}

export interface MealIngredient {
  name: string;
  quantity?: string; // Amount needed
}

export interface Meal {
  id: string;
  name: string;
  description?: string;
  ingredients: MealIngredient[];
  instructions?: string[]; // Step-by-step cooking instructions
  recipeUrl?: string; // Link to external recipe
  tags: string[]; // "cheap", "quick", "favorite", "new"
  rating?: number;
  lastCooked?: string; // YYYY-MM-DD
  createdBy?: string;
  // This is the "Recipe" or "Meal Definition"
}

export interface MealPlanItem {
  id: string;
  date: string; // YYYY-MM-DD
  mealId?: string; // Link to a saved meal
  mealName: string; // For one-off meals or snapshot
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  isCooked: boolean;
}

export interface ShoppingItem {
  id: string;
  name: string;
  category: string; // "Produce", "Dairy", etc.
  store?: string;
  quantity?: string;
  isPurchased: boolean;
  notes?: string;
  addedFromMealId?: string; // Traceability
  order?: number;
}

export interface Store {
  id: string;
  name: string;
  icon?: string; // Lucide icon name
  color?: string; // Key from STORE_COLORS
}

export interface QuickStockList {
  id: string;
  name: string;
  items: string[]; // List of catalog item IDs (reference to GroceryCatalogItem.id)
  icon?: string;
  color?: string;
}

export interface GroceryCatalogItem {
  id: string;
  name: string;
  category: string;
  defaultQuantity?: string;
  defaultStore?: string;
  lastPurchased?: string; // ISO timestamp
  purchaseCount: number;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  groceryCategories?: string[]; // Custom categories
  stores?: Store[]; // User-defined stores
  quickStockLists?: QuickStockList[]; // User-defined shopping templates
  members: HouseholdMember[];
  points?: { daily: number; weekly: number; total: number }; // Shared household points
  lastDailyPointsReset?: string; // YYYY-MM-DD format
  lastWeeklyPointsReset?: string; // YYYY-MM-DD format
  freezeBank: FreezeBank | { current: number; accrued: number; lastMonth: string }; // Support both old and new format
  accounts: Account[];
  rewardsInventory: RewardItem[];
  coreTemplates: {
    expenses: Transaction[];
    buckets: BudgetBucket[];
  };
  location?: { lat: number; lon: number };
  lastPaycheckDate?: string; // YYYY-MM-DD of most recent approved paycheck

  aiUsage?: {
    dailyCount: number;
    lastResetDate: string; // YYYY-MM-DD
  };

  // First-run onboarding wizard. Set to true once the creator finishes (or skips)
  // the wizard so it is never shown again. Absent/false on legacy households means
  // they predate the wizard — they must never be routed into it (the wizard is
  // only triggered from the household-creation flow, not on dashboard load).
  onboardingComplete?: boolean;

  // ISO-4217 currency code (e.g. 'USD', 'EUR') used to format money throughout the
  // app. Absent on legacy households, which fall back to the default (USD).
  currency?: string;

  // Plan 090 (Modular pages): per-household on/off toggles for the toggleable
  // pages/sub-tabs (see ModuleKey). Fail-open: an absent map or absent key means
  // that module is ENABLED, so every legacy household keeps all pages (no
  // migration needed). Only an explicit `false` hides a module. Read through
  // utils/moduleVisibility.ts — the single source of truth.
  moduleVisibility?: Partial<Record<ModuleKey, boolean>>;

  // Plan 080 (Kid Mode): salted hash of the parent PIN required to EXIT a kid
  // profile view back to a parent view (Netflix-Kids pattern). Absent until a
  // parent sets one; when absent, exiting requires no PIN. Dormant until the
  // app_config/global.kidModeEnabled flag is on.
  kidModePinHash?: string;

  // Plan 080d-2 (Kid Mode): kid reward-redemption requests awaiting parent
  // approval. Only PENDING requests live here — each is removed on approve/deny,
  // so the array stays bounded. Absent on every legacy + non-kid household
  // (treat absent as empty). The household-doc update rule is field-permissive,
  // so writing this array needs no firestore.rules change.
  pendingRedemptions?: RewardRedemption[];

  // Plan 02 part C (proactive insight triggers): server-written cap-tracking
  // fields for insights written by scheduled/trigger functions (streak-rescue,
  // budget-anomaly) rather than the manual "refresh insight" button. Capped at
  // 2 proactive insights per household per ISO week — see
  // functions/src/insights/proactiveCap.ts (the single source of truth for the
  // cap logic). The client never writes these; it only needs to tolerate their
  // presence on the household doc.
  proactiveInsightWeek?: string; // ISO week id, e.g. "2026-W27"
  proactiveInsightCount?: number; // Count of proactive insights written for that week

  // Rewards center: log of completed instant redemptions (the adult flow — points
  // are deducted from the shared household total). Bounded + most-recent-first,
  // capped at REDEMPTION_HISTORY_LIMIT (utils/redemption.ts) so the doc stays small.
  // Absent on legacy households (treat absent as empty). Like pendingRedemptions,
  // it rides on the field-permissive household-doc update rule (no rules change).
  redemptionHistory?: RewardRedemptionRecord[];

  // Billing / subscription (Plan 050). Absent on every legacy + free-tier
  // household — treat absent as the free plan everywhere (see utils/entitlements.ts).
  // Only the Stripe webhook (Admin SDK) ever writes this block; clients read it for
  // display. Never gate a paid feature on this client-readable value alone — the
  // server (Cloud Function / firestore.rules) is the source of truth for entitlement.
  subscription?: {
    plan: 'free' | 'premium';
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: string; // ISO 8601, derived from Stripe current_period_end (unix → ISO)
    priceId?: string;
  };

  // Plan 02 (weekly recap): household-level generation dedupe marker — the ISO
  // week ('2026-W27') of the last generated recap. Written server-side only by
  // the scheduled recap function; absent until the first recap is generated.
  lastRecapWeek?: string;

  // Legacy fields for migration support
  startDate?: string; // YYYY-MM-DD format - deprecated, use lastPaycheckDate
  payPeriodSettings?: { startDate: string }; // Deprecated, use lastPaycheckDate

  // Optional references for type awareness, though these are subcollections
  meals?: Meal[];
  shoppingList?: ShoppingItem[];
  todos?: ToDo[];
  groceryCatalog?: GroceryCatalogItem[];
}

/**
 * PendingItem Interface
 *
 * Stores raw voice commands from iOS Shortcuts for processing when app loads.
 * After Gemini parses the text, items are added to appropriate lists and marked processed.
 */
export interface PendingItem {
  id: string;
  text: string; // Raw voice input
  type?: 'shopping' | 'todo' | 'expense' | 'unknown'; // Detected from keywords
  source: 'shortcut';
  createdAt: string; // ISO timestamp
  processed: boolean; // False until app processes it
  processedAt?: string; // ISO timestamp
  error?: string; // If Gemini parsing fails
}

/**
 * ToDo Interface
 *
 * Date Field Conventions:
 * - completeByDate: Uses YYYY-MM-DD (date-only) format for scheduling and due date grouping
 * - completedAt: Uses ISO timestamp (with time) to record the exact moment of completion
 * This distinction allows date-based categorization while preserving precise completion history.
 */
export interface ToDo {
  id: string;
  text: string;
  completeByDate: string; // Due date for task completion (YYYY-MM-DD format)
  assignedTo: string; // uid of household member
  isCompleted: boolean;
  completedAt?: string; // ISO timestamp
  createdBy: string; // uid
  createdAt: string; // ISO timestamp

  // New fields for natural language support
  priority?: 'low' | 'medium' | 'high'; // Priority level (defaults to 'medium')
  notes?: string; // Additional task details
  source?: 'manual' | 'voice' | 'shortcut'; // How the todo was created

  // Plan 080c (Kid Mode): points credited to a MANAGED-KID assignee on completion
  // (defaults to DEFAULT_TODO_POINTS, see utils/todoPoints.ts). Absent on every
  // existing todo. Dormant for normal households: a non-managed assignee earns
  // nothing, so this field is inert unless the assignee is a managed kid.
  points?: number;
}

export interface UpdateBucketPayload {
  bucketName: string;
  newLimit: number;
}

export interface CreateHabitPayload {
  title: string;
  category: string;
  type?: 'positive' | 'negative';
  period?: 'daily' | 'weekly';
}

export interface CreateTodoPayload {
  text: string;
  completeByDate: string;
}

export interface CreateChallengePayload {
  title: string;
  description?: string;
  targetType: 'count' | 'percentage';
  targetValue: number;
  duration?: string;
  suggestedHabit?: CreateHabitPayload;
  relatedHabitId?: string;
}

export type InsightAction =
  | {
      type: 'update_bucket';
      label: string;
      payload: UpdateBucketPayload;
    }
  | {
      type: 'create_habit';
      label: string;
      payload: CreateHabitPayload;
    }
  | {
      type: 'create_todo';
      label: string;
      payload: CreateTodoPayload;
    }
  | {
      type: 'create_challenge';
      label: string;
      payload: CreateChallengePayload;
    };

export interface Insight {
  id: string;
  text: string;
  generatedAt: string; // ISO timestamp
  type: 'general' | 'spending' | 'habits';
  actions?: InsightAction[];
}

/**
 * Weekly recap (Plan 02) — one doc per ISO week at
 * `households/{id}/recaps/{isoWeek}`, written server-side Sundays by the
 * scheduled recap function (Admin SDK; clients only read). The synthetic `id`
 * equals the doc id, which equals `isoWeek`. Money fields are decimal dollars.
 */
export interface WeeklyRecap {
  id: string;
  isoWeek: string; // e.g. '2026-W27'
  generatedAt: string; // ISO timestamp
  totalSpend: number; // decimal dollars
  priorWeekSpend: number;
  topCategoryDeltas: Array<{ category: string; current: number; prior: number }>;
  habitCompletions: number;
  streaksAtRisk: Array<{ habitTitle: string; streakDays: number }>;
  pointsByMember: Array<{ memberId: string; name: string; points: number }>;
  upcomingBills: Array<{ title: string; amount: number; date: string }>;
  narrative: string;
  narrativeSource: 'ai' | 'template';
  premium: boolean;
}

export interface BetaTester {
  email: string;
  addedAt: string;
  status: 'active' | 'revoked';
  usageLimit: number; // Daily AI requests
}

export interface FeedbackReport {
  id: string;
  userId: string;
  householdId: string;
  message: string;
  timestamp: string;
  version: string;
  route: string;
  errorContext?: string;
}

// iOS Shortcuts API Key
export interface ApiKeyPermissions {
  habits: boolean;
  expenses: boolean;
  shoppingList: boolean;
  receiptScanning: boolean;  // Not yet implemented - see RECEIPT_SCANNING_IMPLEMENTATION.md
}

export interface HouseholdApiKey {
  id: string;
  hashedKey: string;           // SHA-256 hash of the actual key (never store plain text)
  keyPrefix: string;           // First 16 chars for display (e.g., "lb_abc123_7f4e9a")
  name: string;                // User-provided name (e.g., "iPhone Shortcut")
  createdAt: string;           // ISO timestamp
  createdBy: string;           // uid of creator
  lastUsedAt?: string;         // ISO timestamp of last API call
  usageCount: number;          // Total API calls made with this key
  status: 'active' | 'revoked';
  permissions: ApiKeyPermissions;
}
