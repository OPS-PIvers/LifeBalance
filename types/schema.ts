
// 'kid' (Plan 080) is a login-less managed child profile — a member doc a parent
// creates/manages, never added to the household memberUids array (no credential).
export type Role = 'admin' | 'member' | 'kid';

// Plan 090 (Modular pages): the toggleable surfaces. 'lists' is the footer page
// (route `/lists`); 'todos' | 'meals' | 'shopping' are its sub-tabs. 'habits'
// and 'money' are top-level footer pages. Home and Settings are always-on and
// not in this set — Settings is structurally un-hideable (lockout guard).
export type ModuleKey = 'habits' | 'money' | 'lists' | 'todos' | 'meals' | 'shopping';

// 2F.1 renamed the 'plan' module key to 'lists' (the route has been `/lists`
// for a while; only the key and the nav label still said "Plan"). Existing
// households have `moduleVisibility.plan` persisted, so 'plan' survives as a
// READ-TIME alias for 'lists' — resolved in utils/moduleVisibility.ts. It is
// never written; no data migration runs.
export type LegacyModuleKey = 'plan';

/** The persisted per-household module map, including the legacy read-only key. */
export type ModuleVisibilityMap = Partial<Record<ModuleKey | LegacyModuleKey, boolean>>;

// The quick-add-API / iOS Shortcut capture input types that can be routed to
// either land automatically or be held for manual review (see CaptureReviewMode).
export type CaptureType = 'expense' | 'shopping' | 'todo';

// 'auto' = the capture is added directly; 'review' = it is held (flagged
// `needsReview` for shopping/todo; expenses already land as `pending_review`
// transactions) until a household member approves it. Read through
// utils/captureReview.ts — the single source of truth for the default per type.
export type CaptureReviewMode = 'auto' | 'review';

export const INCOME_CATEGORY = 'Income';

// Sentinel category for transactions tagged to a CREDIT account. Credit spend
// is tracked on the card itself (balance / CreditCardActivityWidget), never
// against budget buckets, so credit-tagged transactions carry this instead of
// a bucket name. Excluded from bucket spent-tracking and category suggestions.
export const CREDIT_CARD_CATEGORY = 'Credit Card';

// F-HABITS-03: one habit's own reminder schedule, in the member's local time.
// `time` is an arbitrary HH:MM — the scheduled job runs every 15 minutes and
// fires at or just after it (the F-TODO-14 model), so the fire is "within a
// quarter hour of", not "exactly at". `days` are 0 (Sunday) … 6 (Saturday); an
// empty array is a valid "never fires" state rather than an error.
export interface HabitReminderConfig {
  enabled: boolean;
  time: string; // "HH:MM", 24-hour, member-local
  days: number[]; // 0 = Sunday … 6 = Saturday
}

export interface NotificationPreferences {
  // Habit reminders
  habitReminders: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour)
  };

  // F-HABITS-03: per-habit timed reminders, keyed by habit id.
  //
  // Deliberately on the MEMBER doc rather than the habit doc: habits are shared
  // household documents, so a per-uid map on the habit would put every member on
  // the same document's write path — the exact shape behind the habit-history
  // clobber incident. One writer per member doc sidesteps it, and the scheduled
  // job already loads member docs first anyway.
  //
  // The trade is that an entry outlives a deleted habit. That's inert (the job
  // skips ids it can't resolve to a live habit) and cleaned up opportunistically
  // rather than transactionally — a stale key costs a map entry, not a wrong push.
  perHabitReminders?: Record<string, HabitReminderConfig>;

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
    // F-NOTIF-05: temporary snooze set by tapping "Snooze 1 day" on a bill
    // reminder push. yyyy-MM-dd (local). The scheduled sendbillreminders job
    // skips sending while today <= snoozedUntil. Absent/past = not snoozed.
    snoozedUntil?: string;
  };

  // Weekly recap push (Plan 02). Sent server-side Sundays ~17:00 in the
  // member's timezone; no time selection needed, so it's a bare toggle.
  // Optional so legacy docs deserialize — treat absent as enabled (default ON).
  weeklyRecap?: {
    enabled: boolean;
  };

  // F-HABITS-06: opt-in evening nudge to jot a quick note/mood on today's
  // habit completions. Preference only — the scheduled sending job is a
  // follow-up (see TODO.md / roadmap concerns).
  reflectionReminder?: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour)
  };

  // Monthly money recap push (F-MONEY-06). Sent server-side on the 1st of the
  // month ~09:00 in the member's timezone; a bare toggle like weeklyRecap.
  // Optional so legacy docs deserialize — treat absent as enabled (default ON).
  monthlyMoneyRecap?: {
    enabled: boolean;
  };

  // Digest mode (F-NOTIF-03): one consolidated push at `time` instead of the
  // separate habitReminders/actionQueueReminders/streakWarnings/billReminders
  // pushes. When enabled, the four hourly jobs skip their per-type send for
  // this member and `senddigest` aggregates across whichever of those four
  // categories the member still has individually enabled. Optional so legacy
  // docs deserialize — absent/undefined means digest mode is off (fail-closed,
  // matching the per-type toggles' own default-off spirit).
  digestMode?: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour)
  };

  // AI daily briefing push (F-DASH-02). A proactive one/two-sentence morning
  // summary (bills due, pending review, habits left, streaks at risk) sent
  // server-side at `time` in the member's timezone. Unlike the recaps this
  // defaults OFF — a new, higher-frequency channel the user opts into.
  dailyBriefing?: {
    enabled: boolean;
    time: string; // HH:MM format (24-hour) — member-local send time
  };

  // F-TODO-14 (timed to-do reminders): per-member opt-out for per-task pushes
  // at (dueTime − reminderMinutesBefore). Absent/undefined is treated as
  // enabled (fail-open, like weeklyRecap) — only an explicit `enabled: false`
  // suppresses them. Deliberately NOT suppressed by digestMode: a
  // time-specific reminder is an alarm, not a briefing, so batching it into a
  // morning digest would defeat its purpose.
  todoReminders?: {
    enabled: boolean;
  };

  // Nightly bank-email sync summary push (bank-email-sync groundwork). Sent
  // server-side after the nightly sync run finishes. Optional so legacy docs
  // deserialize — absent is treated as enabled (default ON, fail-open like
  // weeklyRecap) since it's opt-out.
  bankEmailSync?: {
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

  // Plan 06 (notification fan-out cost): denormalized "could this member ever
  // receive a push" flag — true iff any notification category is enabled AND
  // fcmTokens is non-empty. Maintained by the pref-save and FCM-token writers
  // (see utils/notificationFlags.ts) so the four hourly scheduled Cloud
  // Functions can query via a collection-group index instead of scanning
  // every household/member (see functions/src/shared/notifications.ts).
  anyNotificationsEnabled?: boolean;

  // F-HABITS-03: SERVER-OWNED once-per-day claim for per-habit reminders —
  // habit id → the member-local yyyy-MM-dd that habit's reminder was last sent
  // on. Written only by the `sendperhabitreminders` Cloud Function; no client
  // path reads or writes it. Declared here so the member converter's
  // spread-through is documented rather than accidental.
  habitReminderSentDates?: Record<string, string>;

  // F-XCUT-02: per-member Dashboard widget customization. `dashboardLayout`
  // is the widget-id order (see utils/dashboardLayout.ts DASHBOARD_WIDGET_IDS
  // for valid ids); missing/unknown ids fall back to the default order.
  // `dashboardHidden` lists widget ids the member has hidden. Both are
  // optional — an un-customized member renders every widget in the default
  // order.
  dashboardLayout?: string[];
  /**
   * @deprecated 2F.1 — superseded by `hiddenKeys`, which covers Home widgets
   * AND nav leaves in one list. Still READ as a fallback so members who
   * customized their widgets before 2F.1 keep those choices; never written
   * again. See `resolveHiddenKeys` in utils/moduleVisibility.ts.
   */
  dashboardHidden?: string[];

  /**
   * 2F.1 (per-member visibility): the visibility keys this member has turned
   * off — Home widgets AND nav leaves (Money/Habits sub-views, Lists tabs) in
   * one flat list. See `VISIBILITY_KEYS` in utils/moduleVisibility.ts.
   *
   * Composed with the HOUSEHOLD layer (`Household.moduleVisibility`) via `&&`:
   * the household decides "does this household use it at all", the member
   * decides "do I want it in my nav". An admin editing a member edits THIS
   * same field — there is no third precedence layer.
   *
   * Absent means "never customized": resolution falls back to
   * `dashboardHidden` and then to `MEMBER_DEFAULT_HIDDEN_KEYS` (the five
   * default-hidden Home widgets), so PAGES fail open and WIDGETS stay hidden
   * exactly as they were before 2F.1. No migration runs.
   */
  hiddenKeys?: string[];

  /**
   * 2F.2 (per-member landing screen): which screen this member lands on when
   * opening the app — a `LandingScreenKey` ('home' or a `NavPageKey'), or (for
   * a value written by a future/foreign caller) a `NavLeafKey`, resolved to
   * its owning page. A short string, capped at 64 chars by `firestore.rules`.
   *
   * Absent means "never chosen": `resolveLandingRoute` (utils/moduleVisibility.ts)
   * falls back to the first enabled nav destination, so an un-customized
   * member keeps landing on Home exactly as before this field existed. The
   * same resolver also covers a stored value that now names a page the
   * member has since hidden, or one the household has since disabled — it
   * never leaves the member on a dead route, worst case landing on Settings
   * (structurally un-hideable) once every page is off.
   */
  homeScreen?: string;
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
  /** Newer multi-card form of the above (Wells Fargo nightly bank-email sync
   *  groundwork): a checking account can have several debit cards attached.
   *  Readers should treat the legacy `cardLast4` as an extra (deduped) entry
   *  of this list rather than a separate value — see `accountMatch.ts`. */
  cardLast4s?: string[];
  /** Last 4 digits of the bank ACCOUNT number itself (distinct from a card),
   *  e.g. parsed from a bank email header like "for account ...5581". Used to
   *  route nightly bank-email sync rows to the right account. */
  accountLast4?: string;
  /** Advisory balance from a linked Plaid account (server-written by
   *  `plaidsynctransactions`; see CLAUDE.md Atomicity notes). NEVER overwrites
   *  `balance` — the manual field stays authoritative; these three fields only
   *  power the "Update to bank balance" chip in the budget account cards.
   *  Absent for accounts with no linked Plaid mapping. */
  plaidBalanceCurrent?: number;
  plaidBalanceAvailable?: number;
  /** ISO timestamp of the last successful balance read for this account. */
  plaidBalanceUpdatedAt?: string;
  /** Soft-delete flag (F-MONEY-08). An archived account is hidden from active
   *  lists, net worth, and Safe-to-Spend eligibility, but historical
   *  transactions keep resolving to it correctly (unlike a hard delete, which
   *  falls back to the checking account via `resolveTargetAccount`). */
  archived?: boolean;
  /** yyyy-MM-dd "balance as-of" date for the LAST bank-email sync that
   *  actually overwrote `balance` (the email's own "As of" footer date when
   *  present, else the latest withdrawal date in that email, else the sync's
   *  `today`). Set only by the server-side nightly `bankEmailSync` Cloud
   *  Function's only-if-newer overwrite guard (Firestore rules reject client
   *  writes) — informational, not read by any client formula. */
  balanceAsOf?: string;
}

/**
 * Plan 24 (savings goals / sinking funds): a tracked "save toward" intention,
 * deliberately DECOUPLED from account balances and transactions. Buckets cap
 * what you spend; goals track what you're saving toward.
 *
 * v1 = manual contributions only — `contributeToGoal` does a single doc
 * `savedAmount += x` update. No account linkage, no automatic transfers, no
 * transaction coupling. HARD INVARIANT: nothing about goals feeds
 * `utils/safeToSpendCalculator.ts`.
 *
 * Amounts are decimal dollars (repo storage convention); math is done in
 * integer cents via `utils/money.ts`.
 *
 * `ownerId`, when set to a managed (kid) member's uid, renders this goal as a
 * progress "jar" over that kid's allowance IOU on `components/kid/KidDashboard.tsx`.
 */
export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  dueDate?: string; // yyyy-MM-dd
  /** Member uid this goal belongs to (enables kid jars). Undefined = shared household goal. */
  ownerId?: string;
  color?: string;
  createdAt: string; // ISO timestamp
  /** ISO timestamp set when savedAmount first reaches targetAmount. */
  completedAt?: string;
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
  // 'camera-scan'/'file-upload' are the historical values written by the two
  // now-merged CaptureModal entry points (paper-cut 2G.3) — kept here so
  // existing rows still type-check and filter correctly; 'file-upload' is
  // also still written by CSV import (see CsvImportDrawer.tsx). New
  // CaptureModal "Add from image" captures write 'image-capture'.
  source: 'manual' | 'camera-scan' | 'file-upload' | 'image-capture' | 'recurring' | 'shortcut' | 'plaid' | 'bank-sync';
  autoCategorized: boolean;
  payPeriodId?: string; // Pay period ID (YYYY-MM-DD of period start), empty string if no period tracking
  relatedHabitIds?: string[];
  /** Habit Automations (PRD #1065): habit ids this transaction has ALREADY
   *  fired (incremented) at least once. The per-(transaction, habit) dedup
   *  ledger — `updateTransactionCategory` skips firing any habit already listed
   *  here and appends newly-fired ids (via arrayUnion), so re-editing or
   *  re-approving the same transaction can never double-log a habit. Cleared
   *  when an approval is reversed (`reverseTransactionApproval`) so an undo →
   *  re-approve can legitimately fire again. Absent on transactions that have
   *  never fired a habit. */
  firedHabitIds?: string[];
  store?: string;
  accountId?: string;
  /** When the transaction is tagged to a CREDIT account, marks it as a PAYMENT
   *  toward the card (reduces the credit balance) rather than a charge (which
   *  increases it). Meaningless / ignored for checking & savings accounts.
   *  Absent ⇒ treated as a charge. Never represents income or bucket spend. */
  creditPayment?: boolean;
  /** For a credit-card PAYMENT (`creditPayment === true` on a credit account):
   *  the asset (non-credit) account the payment is funded FROM. When present on
   *  a verified payment, `addTransaction` debits this account by the payment
   *  amount in the SAME writeBatch that credits the card — a full transfer.
   *  Absent ⇒ legacy behavior: only the card's balance moves. Never meaningful
   *  on charges or asset-account transactions. */
  fundingAccountId?: string;
  notes?: string;
  createdAt?: string; // ISO timestamp
  /** Apple Pay $0 pre-authorization stub (created by the quickAddExpense Cloud
   *  Function): the merchant + date are known but the real charge amount is not
   *  yet entered, so `amount` is a placeholder 0. Cleared (set false) once the
   *  user supplies the amount during review. Absent on normal transactions. */
  needsAmount?: boolean;
  /** Nightly Wells Fargo bank-email sync (bankEmailSync Cloud Function): the
   *  bank's reference token for a withdrawal line (card ref like "P0000..." or a
   *  deterministic "synth:<hash>" for ACH lines). Used as the sync's idempotency
   *  key — a re-run skips any withdrawal whose bankRef already exists on a
   *  transaction, and it is stamped onto rows the sync fills/confirms/pays/creates.
   *  Absent on non-bank-sync transactions. */
  bankRef?: string;
  /** The account whose balance is currently AUTHORITATIVE for a bank-sync row
   *  (see `bankRef`/`isBankSyncTransaction`) — the account the nightly sync's
   *  ending-balance write applies to. Stamped once, client-side, the first
   *  time a bank-sync row is edited (backfill-on-write) to whatever account
   *  it is tagged to AT THAT MOMENT — for a row never yet re-tagged that is
   *  the bank account itself. Re-tagging a bank-sync row to a DIFFERENT
   *  (manual) account moves its balance impact onto that account like an
   *  ordinary transaction; this field keeps tracking the ORIGINAL bank
   *  account regardless, so a later re-tag back to it — or a delete/merge
   *  while re-tagged away — reverses/applies on the correct side. See
   *  `utils/accountImpact.ts` `bankSyncHomeAccountId`/`shouldSkipBankSyncDelta`.
   *  Absent on non-bank-sync transactions and on bank-sync rows never edited
   *  since creation (falls back to the row's current `accountId`). */
  bankSyncAccountId?: string;
  /** Nightly bank-email sync: a row CREATED from a withdrawal line that matched
   *  no stub/pending/bill. It is born `verified` (the account balance is
   *  authoritative from the email's ending balance), so this flag marks it as
   *  still needing a budget category. Client categorization of such a row is a
   *  bucket-assignment only — it applies NO balance delta (the row is already
   *  verified). Cleared when the user assigns a category. Absent otherwise. */
  needsCategory?: boolean;
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
  /** Plan 23: denormalized count of `TransactionComment` docs in the
   *  `comments` subcollection, bumped in the SAME batch as each comment
   *  add/delete so it can never drift. Absent/0 ⇒ no comments. Read-only
   *  display field — never derived client-side from a fetched list, since
   *  comments are loaded on demand (no standing listener). */
  commentCount?: number;
  /** F-DASH-04: itemized receipt line-item split. When one physical receipt is
   *  split into several categorized transactions (e.g. a Target run → a
   *  Groceries row + a Household row), every resulting transaction shares this
   *  generated id so the list UI can visually group them back into one purchase.
   *  Purely a display/grouping key — it never affects balances or Safe-to-Spend.
   *  Absent on ordinary single-transaction captures. */
  receiptGroupId?: string;
  /** uid of the member who created (and, for splitting, PAID FOR) this
   *  transaction. Written server-authoritatively by `addTransaction`
   *  (`createdBy: user.uid`); the converter passes it through. Used by the
   *  F-MONEY-13 Settle-Up math as the "payer" each split share is owed to. */
  createdBy?: string;
  /** 2H(a): the PAID calendar-item doc this transaction settled — written by
   *  `settleBillWithTransaction` when the user says "this charge IS that planned
   *  bill", and by `payCalendarItem` on the transaction it creates for an
   *  EXPENSE (never for a paycheck). Always a REAL Firestore doc id: for a
   *  recurring occurrence it is the paid-instance doc that path creates (never
   *  the synthetic `templateId_instance_yyyy-MM-dd` id, which is derived and goes
   *  stale when a template's anchor or frequency is edited); for a one-off bill
   *  it is that item's own id. Its presence is also the "already settled" guard:
   *  the merge refuses a second settle, and — while the referenced bill is still
   *  marked paid — `deleteTransaction`, `mergeTransactions` (on the dupe),
   *  `splitTransaction`, `updateTransaction` (money fields only) and
   *  `reverseTransactionApproval` all refuse, because each would leave the bill
   *  marked paid with this doc orphaned. See `utils/settledBillGuard.ts`; undo
   *  from the bill on the calendar instead. Absent on every transaction that has
   *  never settled a bill. */
  paidCalendarItemId?: string;
  /** F-MONEY-13: shared-expense splitting overlay. A bookkeeping-only list of
   *  the OTHER people's shares of this expense (the payer keeps the remainder).
   *  It NEVER alters the payer's account balance — splitting is a display/
   *  tracking overlay exactly like budget buckets, so `utils/accountImpact.ts`
   *  ignores it entirely. Settle-Up (`utils/settlement.ts`) nets the unsettled
   *  shares into a who-owes-whom balance. Absent ⇒ not a split expense. */
  splitWith?: SplitParticipant[];
}

/**
 * SplitParticipant — F-MONEY-13. One person's share of a split transaction.
 * A participant is EITHER a household member (`memberId` set) or an external
 * person without an account (`email` set — the owner-note invite path). The
 * `shareAmount` is what this person owes the payer (the transaction's
 * `createdBy`), in decimal dollars. `settled` toggles when they pay it back —
 * a pure overlay flag with NO balance effect.
 */
export interface SplitParticipant {
  /** Household member uid this share belongs to (in-household split). */
  memberId?: string;
  /** Email of a non-member the expense is split with (external invite path). */
  email?: string;
  /** Optional display label for an external (non-member) participant. */
  name?: string;
  /** Decimal-dollar amount this participant owes the payer. */
  shareAmount: number;
  /** True once this share has been paid back / settled up. No balance effect. */
  settled?: boolean;
  /** ISO timestamp when a split-invite email was (stub-)dispatched to `email`.
   *  Present only for external participants that have been invited. */
  invitedAt?: string;
}

/**
 * TransactionComment — Plan 23. A single message in a transaction's comment
 * thread, stored in the subcollection `households/{hid}/transactions/{txnId}/comments`.
 * Loaded ON DEMAND (a `getDocs` fetch when the transaction's detail view
 * opens) — never via a standing listener (this repo bounds listener count
 * deliberately). No per-user read-tracking in v1; `Transaction.commentCount`
 * is the only "how many" signal. Firestore rules (separate PR) enforce
 * `authorUid == request.auth.uid` on create and delete; there is no update
 * path in v1 (edits are out of scope — simpler rules).
 */
export interface TransactionComment {
  id: string;
  authorUid: string;
  /** Free-text comment body, capped at 500 chars (enforced client-side here
   *  and in the rules draft — see advisor-plans/23-transaction-comments-spike.md). */
  text: string;
  createdAt: string; // ISO timestamp
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
  /** Optional: user-marked subscription flag. Recurring alone does NOT make a
   *  bill a subscription (mortgage, car payment, daycare are recurring but not
   *  subscriptions) — the Subscriptions tab groups by this explicit flag. */
  isSubscription?: boolean;
  /** Bank-descriptor strings previously learned to map to this bill, e.g. a
   *  statement descriptor like "XCEL ENERGY WEB PYMT" mapped to an "Electric
   *  Bill" calendar item. On a recurring bill these live on the TEMPLATE, not on
   *  an expanded occurrence.
   *
   *  WRITTEN by two paths, both `arrayUnion`: the nightly bank-email sync when
   *  it pays a bill it found by title token-overlap
   *  (`functions/src/quickAdd/bankEmailSync.ts`), and the manual "Link to bill"
   *  reconcile in the transaction review drawer
   *  (`contexts/household/mutations/calendarMutations.ts`'s
   *  `linkBankTransactionToBill`) — which is how a household TEACHES the link.
   *
   *  READ by the matcher on both sides of the workspace boundary:
   *  `functions/src/quickAdd/bankSyncMatch.ts` (nightly sync) and its client
   *  twin `utils/billDescriptorMatch.ts` (the Action Queue's bill↔transaction
   *  recognition for screenshot imports). Alias comparison is EXACT normalized
   *  equality — never fuzzy — so a learned alias can only ever re-match the same
   *  descriptor. */
  bankDescriptorAliases?: string[];
}

/**
 * MerchantRule — household-authored cleanup for ugly bank descriptors
 * ("APPLE.COM/BILL 866-712-7753 CA" → "Apple"). A rule maps a descriptor
 * PATTERN to a friendly name plus optional side-effects (budget category, an
 * auto-pay bill link, a no-spend-day exemption).
 *
 * Renaming is DISPLAY-TIME ONLY: the stored `Transaction.merchant` keeps the
 * bank's original text forever, and every surface resolves the label through
 * `utils/merchantRules.ts` at render time. That is what makes a rule instantly
 * retroactive (it relabels history the moment it is saved, with no backfill
 * write) and instantly reversible (deleting the rule restores the raw text).
 * It also keeps the bank's descriptor as the stable IDENTITY key for dedup —
 * `utils/transactionIdentity.ts` deliberately does NOT consult rules, because a
 * user-editable label must never decide whether two rows are the same purchase.
 */
export interface MerchantRule {
  /** Client-generated stable key (also the React list key and the editor's
   *  self-exclusion handle in `findShadowingRule`). */
  id: string;
  /** Case-insensitive CONTAINS match against the raw bank descriptor.
   *  Punctuation is significant — "APPLE.COM" does not match "APPLECOM". An
   *  empty/whitespace-only pattern never matches anything. */
  pattern: string;
  /** Optional cent-exact qualifier in decimal dollars (never cents — same
   *  convention as `Transaction.amount`). Present ⇒ the rule fires only for a
   *  descriptor match AT this amount, which is how one merchant's $2.99
   *  subscription is told apart from a $79 one-off. `0` is a legitimate value
   *  (the Apple Pay pre-auth stub), so presence is tested, never truthiness. */
  amount?: number;
  /** Friendly display name. Optional: a category/bill-only rule leaves the
   *  merchant text alone and still applies its other effects. */
  name?: string;
  /** Budget category auto-assigned to matching transactions. */
  category?: string;
  /** Calendar item / recurring template id this descriptor should auto-pay. */
  billId?: string;
  /** Matching charges don't break a no-spend day (see `HabitTriggers.noSpend`)
   *  — the escape hatch for a charge the household considers planned. */
  exempt?: boolean;
  /** ISO timestamp. Also the deterministic tie-breaker when two rules are
   *  exactly as specific: the older rule wins. */
  createdAt: string;
  /**
   * UNUSED bookkeeping fields, kept only so an already-stored value survives an
   * edit (see `contexts/household/mutations/merchantRuleMutations.ts`). NOTHING
   * writes them — not the client, not the nightly sync — and nothing should.
   *
   * They were specified as server-stamped counters. They are not, for two
   * reasons. First, the editor's "is this rule dead?" signal is DERIVED
   * client-side instead: `MerchantRulesCard` runs the household's own
   * transactions through `pickMerchantRule`, which is retroactive (a rule saved
   * today reports the history it renames), attributed to the ONE rule that
   * actually wins each row, and structurally incapable of drifting from what the
   * user sees. A stored counter is none of those things. Second, stamping them
   * server-side would mean a read-modify-write of the whole `merchantRules`
   * array inside a non-transactional batch — precisely the whole-array clobber
   * that cost this repo real habit history on 2026-07-15.
   *
   * Prefer deriving. If a genuinely server-only statistic is ever needed, give
   * it its own document rather than resurrecting these.
   */
  lastMatchedAt?: string;
  /** @see lastMatchedAt — unused; counts are derived client-side. */
  matchCount?: number;
}

/** Upper bound on `Household.merchantRules`, keeping the bounded array well
 *  clear of Firestore's 1 MiB document ceiling. */
export const MAX_MERCHANT_RULES = 200;

export type EffortLevel = 'easy' | 'medium' | 'hard' | 'very_hard';

// Habit Automations (PRD #1065): a single saved geolocation that can fire a
// habit when the member arrives within `radiusMeters` of it. Captured via
// "Use my location" (current-position snapshot — no maps SDK / geocoding).
// `id` is a stable client-generated key used for per-day dedup of geo prompts.
export interface HabitLocationTrigger {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

// The no-spend automation scope (F-HABITS-14). `'day'` fires the habit for any
// day with no unplanned spending; `'weekend'` fires it only when BOTH Saturday
// and Sunday of the same weekend were clean (credited to the Sunday, which keeps
// the completion in the right Mon-Sun ISO week for a weekly habit's streak).
export type NoSpendScope = 'day' | 'weekend';

// Habit Automations (PRD #1065): the optional trigger configuration on a habit.
// Absent on every existing habit — no migration; the Firestore converter passes
// it through untouched. `keywords` are matched against approved transactions
// (see utils/habitKeywordMatch.ts); `locations` drive the geo prompt (see
// utils/habitGeoTrigger.ts).
export interface HabitTriggers {
  keywords?: string[];
  locations?: HabitLocationTrigger[];
  /** F-HABITS-14: fire this habit from the nightly bank sync's no-spend verdict.
   *  Absent ⇒ not wired up. Unlike `keywords`/`locations`, this trigger is
   *  evaluated and fired SERVER-side by the bankEmailSync Cloud Function (see
   *  functions/src/quickAdd/noSpendDay.ts), so it works with the app closed —
   *  which is the point, since the email arrives around 3am. */
  noSpend?: NoSpendScope;
}

// Default geolocation trigger radius in meters (~150 m) — a comfortable
// store-sized bubble that tolerates GPS drift without covering neighbours.
export const DEFAULT_LOCATION_RADIUS_METERS = 150;

/**
 * Per-member habit completion attribution: date (yyyy-MM-dd) → member uid →
 * how many completions that member logged that day. Absent/partial by design —
 * see `Habit.completedBy`.
 */
export type HabitCompletedBy = Record<string, Record<string, number>>;

/**
 * Per-member freeze attribution: date (yyyy-MM-dd) → the member uids whose own
 * streak chain that date's freeze bridges. Only written when the household runs
 * `freezeMode: 'per_member'` — see `Habit.frozenDatesBy`.
 */
export type HabitFrozenDatesBy = Record<string, string[]>;

export interface Habit {
  id: string;
  title: string;
  category: string;
  type: 'positive' | 'negative';

  // Denormalized lowercased/trimmed `title` (utils/habitLogic.ts's
  // `normalizeHabitTitle`), written by client addHabit/updateHabit. Lets the
  // quickAddHabit Cloud Function do an indexed exact-match `where('titleLower',
  // '==', ...)` query instead of a full-collection scan on every iOS Shortcut
  // request. Optional/absent on legacy docs until utils/migrations/titleLowerMigration.ts
  // backfills them; quickAddHabit falls back to its existing fuzzy full-scan
  // when the indexed lookup misses.
  titleLower?: string;

  // Scoring & Frequency
  basePoints: number;
  scoringType: 'incremental' | 'threshold';
  period: 'daily' | 'weekly';
  targetCount: number;

  // State
  count: number;
  totalCount: number; // Lifetime count
  completedDates: string[]; // YYYY-MM-DD
  // Per-member habit points (stage 1): who completed this habit, on which date,
  // how many times. `completedBy[yyyy-MM-dd][memberUid] = count`. This is an
  // ADDITIVE overlay on `completedDates` — the flat date list keeps its exact
  // existing meaning (the habit was completed that day, by anyone) and every
  // household-level number is still derived from it alone. A date present in
  // `completedDates` with NO `completedBy` entry is a pre-feature ("grandfathered")
  // completion: it still counts for the household and is deliberately attributed
  // to nobody.
  //
  // SEMANTIC: the uid is WHO THE COMPLETION BELONGS TO, never "which device
  // operator tapped". An ASSIGNED habit (a kid chore) is attributed to
  // `assignedTo`, because a managed kid has no auth session of their own and
  // every Kid-Mode completion is physically performed by a parent — recording
  // the signed-in adult there would credit the wrong person for every chore.
  // This mirrors how the habit's POINTS are already routed to the assignee.
  //
  // 🛡️ WRITE DISCIPLINE: this map is only ever written via dot-path
  // `increment()` at `completedBy.<date>.<uid>` (or a `deleteField()` on the
  // whole `completedBy.<date>` node when a day is cleared for everyone) — NEVER
  // as a whole-map write, and never a per-member `deleteField()` decided from a
  // client-cached prior count. A whole-map write (or a delete-at-zero chosen off
  // a stale cache) from a device holding a stale offline cache would wipe other
  // days'/members' attribution, the exact class of bug that erased completion
  // history on 2026-07-15. Consequently a member's count may legitimately sit at
  // 0 (or, after concurrent decrements, below it); readers treat `count <= 0` as
  // ABSENT and the converter drops such nodes on read. See
  // utils/habitAttribution.ts.
  completedBy?: HabitCompletedBy;
  streakDays: number;
  lastUpdated: string; // To handle resets

  // Plan 25 (auto-applied freeze protection): dates whose miss was absorbed by
  // a freeze token (YYYY-MM-DD). A frozen date preserves streak CONTINUITY but
  // is NOT a completion — it never appears in completedDates, never credits
  // points, and never counts for challenges or points recalculation. Written
  // only by the midnight/login auto-apply path. Mirrored in
  // functions/src/quickAdd/habitProcessor.ts.
  frozenDates?: string[];

  // Per-member habit points (stage 6, `Household.freezeMode === 'per_member'`):
  // WHICH MEMBERS a freeze token was spent for, per date —
  // `frozenDatesBy[yyyy-MM-dd] = [uid, …]`. A uid listed here bridges ONLY that
  // member's own streak chain; `frozenDates` above stays the household-wide
  // bridge (it bridges everyone, which is exactly what the 'shared' /
  // 'freeze_both' modes and ALL legacy data want).
  //
  // 🛡️ WRITE DISCIPLINE — identical to `completedBy`: only ever written via a
  // dot-path `arrayUnion()` at `frozenDatesBy.<date>` so a device holding a
  // stale offline cache can never wipe another date's (or another member's)
  // freeze. NEVER a whole-map write. Absent on every habit until an admin picks
  // the per-member freeze mode, and inert when absent — see
  // utils/habitAttribution.ts `memberFrozenDates`.
  frozenDatesBy?: HabitFrozenDatesBy;

  // F-HABITS-01 (habit pause / vacation mode): a planned break end date
  // (YYYY-MM-DD, local). While `pausedUntil >= today` the habit is excluded from
  // the auto-reset-to-0 penalty AND from freeze-token consumption, and the paused
  // range BRIDGES streak continuity the same way `frozenDates` does — so the
  // streak resumes cleanly when the break ends. The bridge is synthesized at read
  // time from `completedDates` + `pausedUntil` (utils/habitLogic.ts
  // `pauseBridgeDates`), so no per-day docs are written. Absent on a habit that
  // has never been paused. Mirrored in functions/src/quickAdd/habitProcessor.ts.
  pausedUntil?: string;

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

  // Submission Tracking
  hasSubmissionTracking?: boolean; // true = uses submissions subcollection

  // F-HABITS-05: ISO timestamp when the habit was archived (soft-retire —
  // hides it from the Track tab / reminders while keeping streak/points
  // history intact for Insights/export). Undefined/absent = active.
  archivedAt?: string;

  // Habit Automations (PRD #1065): optional trigger configuration (transaction
  // keywords + saved geolocations). Absent on every existing habit — no
  // migration; converter passes it through. See utils/habitTriggers.ts.
  triggers?: HabitTriggers;
}

// F-HABITS-06: quick mood tag attachable to a habit completion submission.
export type HabitMood = 'great' | 'good' | 'meh' | 'rough';

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
  /**
   * Per-member habit points (stage 1): a SNAPSHOT of the uid this submission's
   * completion was credited to, taken at add time.
   *
   * `createdBy` is who pressed the button; this is who the completion belongs
   * to — the two differ for an assigned chore (a managed kid never taps for
   * themselves). It is snapshotted rather than re-derived on read because
   * `Habit.assignedTo` can be REASSIGNED between an add and its delete/edit:
   * re-deriving would debit whoever holds the chore today for points the
   * previous assignee actually earned. Absent on every submission written
   * before this field shipped — readers fall back to `createdBy` and then, per
   * `resolveReversalSources`, to whatever `Habit.completedBy` actually records.
   */
  attributedTo?: string;
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp if edited
  // F-HABITS-06: optional lightweight journal attached to a completion.
  note?: string; // Free-text reflection, capped ~280 chars
  mood?: HabitMood;
  // Habit Automations (PRD #1065): set when this submission was written by a
  // TRANSACTION approval firing a keyword-matched habit, rather than by a hand
  // log. Two jobs: (1) it makes the fire self-describing, so the transaction's
  // undo can reverse the EXACT points this submission credited instead of
  // recomputing a historical multiplier that intervening completions may have
  // shifted; (2) it distinguishes automated from manual units on a date.
  // Absent on every hand-entered submission.
  sourceTransactionId?: string;
  // F-HABITS-14: set when this submission was written by the nightly bank sync's
  // no-spend verdict, to the yyyy-MM-dd date judged clean (which equals `date`).
  // Doubles as the per-(habit, day) idempotency key: the sync refuses to fire a
  // habit for a date that already has a submission carrying this field, so a
  // second email on the same morning — or a second account's email — cannot
  // double-credit the day. Absent on every other submission.
  sourceNoSpendDate?: string;
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
  // F-HABITS-02 (streak milestone celebrations): an optional milestone gate on
  // this reward. When present, the reward renders locked in the store until a
  // habit's streak crosses `streakDays` (one of utils/habitMilestones.ts's
  // MILESTONES) — either a SPECIFIC habit (`habitId` set) or ANY habit
  // (`habitId` absent). Unlocking is tracked separately via
  // `Household.unlockedRewardIds` (crossing is a one-time event; a later streak
  // reset must not re-lock an already-unlocked reward). Absent = no gate
  // (always available, subject only to the existing point-cost affordability
  // check).
  unlockRequirement?: {
    streakDays: number;
    habitId?: string;
  };
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
  tokens: number; // Current balance (0-2 after the Plan 25 refill-to-2 rollover)
  maxTokens: number; // 2 (legacy docs may hold 3 until their first rollover)
  lastRolloverDate: string; // YYYY-MM-DD
  lastRolloverMonth: string; // YYYY-MM for tracking
  history: FreezeBankHistoryEntry[]; // Audit trail
}

/**
 * Per-member habit points (stage 6) — how a household spends freeze tokens.
 * ABSENT means `'shared'`, which is byte-for-byte the pre-setting behaviour, so
 * an untouched household is unaffected. See utils/freezeSettings.ts (the single
 * source of truth for resolution + copy).
 *
 * - `'shared'`      — one household bank; a freeze bridges EVERY member's chain.
 * - `'freeze_both'` — the same mechanics, pinned deliberately rather than by
 *                     default, so "one token covers us both" is a stated choice.
 * - `'per_member'`  — each adult holds their own bank (`Household
 *                     .freezeBanksByMember`) and their own frozen dates
 *                     (`Habit.frozenDatesBy`); a freeze bridges only its owner.
 */
export type FreezeMode = 'shared' | 'freeze_both' | 'per_member';

/**
 * Per-member habit points (stage 6) — how the weekly ceremony frames the week.
 * ABSENT means `'household_first'` (the Ivers default). Stage 5 (the ceremony)
 * is the only consumer; this stage ships the field, the resolution helper and
 * the admin control so the setting exists before the surface that reads it.
 *
 * - `'podium'`          — lead with the head-to-head standings.
 * - `'household_first'` — lead with the together-total, standings underneath.
 * - `'adaptive'`        — pick per week from how close the scores were.
 */
export type CeremonyTone = 'podium' | 'household_first' | 'adaptive';

export interface MealIngredient {
  name: string;
  quantity?: string; // Amount needed
}

/**
 * F-MEALS-03: standing household dietary constraints. `allergens` are hard
 * exclusions (never propose in any form) fed to `suggestMeal`/`generateWeeklyPlan`
 * and matched against recipe ingredients for the warning badge; `restrictions`
 * are softer preferences (e.g. "vegetarian") passed only to the AI, not badge-checked.
 */
export interface DietaryProfile {
  restrictions: string[];
  allergens: string[];
}

export interface Meal {
  id: string;
  name: string;
  description?: string;
  ingredients: MealIngredient[];
  instructions?: string[]; // Step-by-step cooking instructions
  recipeUrl?: string; // Link to external recipe
  servings?: number; // Base servings this recipe's ingredient quantities are written for; defaults to 1 when unset
  estimatedCost?: number; // Decimal dollars; optional, manually entered (F-MEALS-01)
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
  source?: 'manual' | 'voice' | 'shortcut' | 'photo'; // How the item was captured (mirrors ToDo.source)
  // Held-for-review capture (the household's captureReview setting routed
  // 'shopping' to 'review'): hidden from the shopping list until approved.
  // Absent/false = visible as normal. See utils/captureReview.ts.
  needsReview?: boolean;
}

export interface Store {
  id: string;
  name: string;
  icon?: string; // Lucide icon name
  color?: string; // Key from STORE_COLORS
  order?: number; // Household's visit order, used by 'store' shopping sort mode (mirrors Account.order/Habit.order)
}

export interface QuickStockList {
  id: string;
  name: string;
  items: string[]; // List of catalog item IDs (reference to GroceryCatalogItem.id)
  icon?: string;
  color?: string;
}

export interface TaskTemplateItem {
  text: string; // The to-do text created for this item
  assignedTo?: string; // uid of household member; falls back to the applying user when absent
  points?: number; // Optional override for the created to-do's point value (kid-mode allowance-style credit)
  category?: string; // F-TODO-16: to-dos spawned from this item inherit this category
}

export interface TaskTemplate {
  id: string;
  name: string; // e.g. "Trash day", "Guest prep"
  items: TaskTemplateItem[];
  icon?: string; // Lucide icon name (see data/templateIcons.ts)
  color?: string; // Key from STORE_COLORS (reused for visual consistency with QuickStockList)
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
  habitCategories?: string[]; // Custom habit categories
  todoCategories?: string[]; // Custom to-do categories (F-TODO-16)
  stores?: Store[]; // User-defined stores
  quickStockLists?: QuickStockList[]; // User-defined shopping templates
  taskTemplates?: TaskTemplate[]; // User-defined task-bundle templates ("Quick Task Lists", F-TODO-03)
  members: HouseholdMember[];
  points?: { daily: number; weekly: number; total: number }; // Shared household points
  lastDailyPointsReset?: string; // YYYY-MM-DD format
  lastWeeklyPointsReset?: string; // YYYY-MM-DD format
  freezeBank: FreezeBank | { current: number; accrued: number; lastMonth: string }; // Support both old and new format

  // Per-member habit points (stage 6) — household admin settings. BOTH are
  // absent on every existing household and absent means "exactly what happens
  // today" (see utils/freezeSettings.ts), so this stage is provably inert until
  // an admin picks a mode in Settings → Habits.
  freezeMode?: FreezeMode;
  ceremonyTone?: CeremonyTone;

  // Per-member freeze banks, keyed by member uid. Only read/written while
  // `freezeMode === 'per_member'`; the shared `freezeBank` above is untouched by
  // that mode so flipping back restores the old behaviour with the old balance.
  // 🛡️ Written ONLY via dot paths under `freezeBanksByMember.<uid>` (tokens
  // absolute, history via arrayUnion) so one member's spend can never clobber
  // another's — see utils/freezeSettings.ts `memberFreezeBankPatch`.
  freezeBanksByMember?: Record<string, FreezeBank>;
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
  moduleVisibility?: ModuleVisibilityMap;

  // Per-household per-capture-type routing for quick-add-API / iOS Shortcut
  // captures: whether a capture of this type is added automatically ('auto')
  // or held for manual review ('review'). Absent map/key falls back to the
  // DEFAULTS in utils/captureReview.ts (expense→'review', shopping→'auto',
  // todo→'auto'), which preserve legacy behavior — expense captures have
  // always landed as `pending_review` transactions awaiting categorization,
  // while shopping/todo captures have always been added directly. Read
  // through utils/captureReview.ts — the single source of truth (server twin:
  // functions/src/quickAdd/captureReview.ts, kept in sync deliberately).
  captureReview?: Partial<Record<CaptureType, CaptureReviewMode>>;

  // F-MEALS-03: standing household dietary restrictions/allergies. Absent means
  // no constraints are recorded — AI meal calls (suggestMeal, generateWeeklyPlan)
  // and the recipe allergen badge treat an absent/empty profile as "no restrictions".
  dietaryProfile?: DietaryProfile;

  // Plan 080 (Kid Mode): salted hash of the parent PIN required to EXIT a kid
  // profile view back to a parent view (Netflix-Kids pattern). Absent until a
  // parent sets one; when absent, exiting requires no PIN. Dormant until the
  // app_config/global.kidModeEnabled flag is on.
  kidModePinHash?: string;

  // F-MEALS-04: id of the habit auto-credited when a meal-plan item is marked
  // `isCooked: true` (e.g. "Cooked dinner at home"). Absent means no linked
  // habit — marking a meal cooked stays a meals-only action. Set via the
  // "Cook habit" picker in MealPlanTab's overflow menu.
  mealCookedHabitId?: string;

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

  // F-HABITS-02 (streak milestone celebrations): reward ids that have been
  // permanently unlocked by crossing their `RewardItem.unlockRequirement`
  // streak milestone (see hooks/useHabitActions.tsx's toggleHabit, which
  // arrayUnion-appends here in the SAME writeBatch as the triggering habit
  // toggle). Once unlocked a reward stays unlocked even if the streak later
  // resets. Absent on legacy/non-gated households (treat absent as empty).
  // Rides on the same field-permissive household-doc update rule as
  // pendingRedemptions/redemptionHistory — no rules change needed.
  unlockedRewardIds?: string[];

  // Household-authored merchant rules (descriptor → friendly name / category /
  // bill link / no-spend exemption). A BOUNDED array on the household doc —
  // deliberately NOT a subcollection, matching the redemptionHistory /
  // pendingRedemptions precedent — capped at MAX_MERCHANT_RULES. Two payoffs:
  // the client needs no new listener (rules arrive with the household doc every
  // surface already subscribes to, so display-time renaming costs zero reads),
  // and the bankEmailSync Cloud Function gets them free from the household doc
  // it already loads. Rides the field-permissive household-doc update rule, so
  // no firestore.rules change. Absent on legacy households (treat as empty).
  merchantRules?: MerchantRule[];

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

  // Plan 22 (calendar ICS feed): a capability-URL token for the read-only
  // `calendarfeed` HTTP Cloud Function subscription (`webcal://…/calendarfeed
  // ?hid=…&token=…`). Written ONLY by the `generatecalendarfeedtoken` callable
  // (Admin SDK — bypasses rules, matching the field-permissive household-doc
  // update rule anyway). Absent until a member first enables the feed;
  // regenerating rotates the token, invalidating prior subscription URLs.
  // Never log this value — it grants read access to the household's bills.
  calendarFeedToken?: string;

  // One-time repair marker (utils/migrations/negativePointsRepair.ts): ISO
  // timestamp written after the client fixes wrongly-signed pointsEarned on
  // negative-habit submissions and corrects the points triple. Its presence
  // stops the repair from ever running again (submissions have no standing
  // listener, so the needs-check can't be derived from in-memory data).
  negativePointsRepairedAt?: string;

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

/**
 * A single step within a to-do's optional subtask checklist (F-TODO-08).
 * Stored as a plain array field on the parent `ToDo` document — no subcollection.
 */
export interface Subtask {
  id: string; // stable client-generated id (see utils/subtasks.ts)
  text: string; // short step description
  isDone: boolean; // completion state
  // Optional per-step assignee — a household member's uid, or absent for
  // "unassigned". Purely informational (like the parent's assignedTo); no
  // migration needed since it's absent on every existing subtask.
  assigneeId?: string;
}

export interface ToDo {
  id: string;
  text: string;
  completeByDate: string; // Due date for task completion (YYYY-MM-DD format)
  // uid of household member, or absent for "whole household" (no single
  // assignee). Absent on a to-do means every member can see it as shared —
  // it is not an error state.
  assignedTo?: string;
  isCompleted: boolean;
  completedAt?: string; // ISO timestamp
  createdBy: string; // uid
  createdAt: string; // ISO timestamp

  // New fields for natural language support
  priority?: 'low' | 'medium' | 'high'; // Priority level (defaults to 'medium')
  notes?: string; // Additional task details
  source?: 'manual' | 'voice' | 'shortcut' | 'photo'; // How the todo was created

  // Held-for-review capture (the household's captureReview setting routed
  // 'todo' to 'review'): hidden from the to-do list until approved. Absent/
  // false = visible as normal. See utils/captureReview.ts.
  needsReview?: boolean;

  // Plan 080c (Kid Mode): points credited to a MANAGED-KID assignee on completion
  // (defaults to DEFAULT_TODO_POINTS, see utils/todoPoints.ts). Absent on every
  // existing todo. Dormant for normal households: a non-managed assignee earns
  // nothing, so this field is inert unless the assignee is a managed kid.
  points?: number;

  // Eisenhower matrix: human judgment of importance, set via the star toggle.
  // Absent/false = not important — no migration needed. Urgency is NOT stored;
  // it is derived from completeByDate (utils/eisenhower.ts).
  isImportant?: boolean;

  // F-TODO-08: optional lightweight checklist of steps inside this task. A plain
  // array field (no subcollection); the row shows an "n/m done" progress chip and
  // an expandable checkable list. Absent on every existing todo — no migration.
  subtasks?: Subtask[];

  // F-TODO-01: Recurring / repeating to-dos. Mirrors CalendarItem's
  // frequency/parentRecurringId model. When present, completing the task
  // auto-spawns the next instance (completeByDate advanced by `frequency`)
  // in the SAME writeBatch as the completion (see makeCompleteToDo). Absent on
  // every existing todo — non-recurring behavior is unchanged.
  // F-TODO-14 (timed reminders): optional due TIME-OF-DAY on completeByDate,
  // HH:mm 24-hour wall-clock in the ASSIGNEE's timezone (interpreted at send
  // time via their notificationPreferences.timezone, matching every scheduled
  // job). Display/sort only unless a reminder is also set. Absent on every
  // existing todo — no migration.
  dueTime?: string;

  // F-TODO-14: minutes of lead time before dueTime at which the assignee gets
  // a push (0 = at the due time). Only meaningful when dueTime is set — the UI
  // enforces that. Absent = no reminder.
  reminderMinutesBefore?: number;

  // F-TODO-14: set (ISO timestamp) by the server job once the reminder push is
  // sent, so the 15-minute scan never double-sends. Client writes null to
  // RE-ARM when the date/time/offset is edited; null and absent both mean
  // "not sent yet".
  reminderSentAt?: string | null;

  recurrence?: {
    frequency: 'weekly' | 'bi-weekly' | 'monthly';
    // Stable id of the FIRST todo in the recurring chain (denormalized onto each
    // spawned instance, matching CalendarItem.parentRecurringId). Lets a household
    // group / manage a chain of occurrences later without a separate parent doc.
    parentRecurringId?: string;
  };

  // "Auto-reschedule": a repeating chore that is never really *overdue* — when
  // its due date passes unfinished, it rolls forward to the next occurrence of
  // its cadence (and any checked subtasks reset, so a fresh period starts
  // clean) instead of piling up in the overdue bucket. Only meaningful
  // together with `recurrence.frequency`; absent/false = today's behaviour
  // (the instance goes overdue). See utils/todoRecurrence.ts
  // (`computeExpiredTodoRoll`) and hooks/useTodoAutoReschedule.ts.
  resetWhenExpired?: boolean;

  // Habit Automations (PRD #1065): the habit this to-do is linked to. Completing
  // the to-do fires the habit exactly like one manual tap (same batch); restoring
  // reverses it. Authored on the to-do form ("Counts toward habit" picker). Absent
  // on every existing to-do — no migration; converter passes it through.
  linkedHabitId?: string;

  // F-TODO-16: a single optional category ("Home", "Work"...) chosen from the
  // household's `todoCategories` vocabulary. ABSENT OR NULL both mean
  // "Uncategorized" — that is the invariant every consumer relies on (see
  // utils/todoCategoryColor.ts and the 'category' sort mode in utils/todoSort.ts),
  // so every reader must treat the two representations identically (the
  // standard guard is `(x ?? '')`). Both occur in practice: the dedicated
  // "clear category" action (deleteTodoCategory) deletes the field, but the
  // generic form-edit path writes `category: undefined`, which
  // `utils/firestoreSanitizer.ts` converts to `null` before the write lands —
  // the same pattern `linkedHabitId` follows. Absent on every existing to-do —
  // no migration needed. `todoConverter` now normalizes that stored `null` back
  // to `undefined` on read, so the runtime value matches this declared type;
  // the `(x ?? '')` guard is still the rule, because a doc read outside the
  // converter (or written by the server) can still carry the raw `null`.
  category?: string;
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
  // F-DASH-11 — quality signal on this specific insight. Undefined = unrated.
  // Fed back into the next `generateInsight` prompt (see `rateInsight` /
  // `makeRefreshInsight`) so disliked insights steer future generations away
  // from the same style/topic, and liked ones reinforce it.
  feedback?: 'up' | 'down';
  feedbackAt?: string; // ISO timestamp of the rating, if any
}

/**
 * F-DASH-03 — Habit Coach card. Single ephemeral/regenerable doc at
 * `households/{id}/habitInsights/current` (not a growing collection) holding
 * the latest `analyzeHabitPatterns()` output. `HabitPatternInsight` itself
 * lives in services/geminiService.types.ts (the AI response schema) and is
 * imported here as a type-only reference so this file stays free of runtime
 * AI-SDK coupling.
 */
export interface HabitInsightsDoc {
  patterns: import('@/services/geminiService.types').HabitPatternInsight[];
  generatedAt: string; // ISO timestamp
}

/**
 * Weekly recap (Plan 02) — one doc per ISO week at
 * `households/{id}/recaps/{isoWeek}`, written server-side Sundays by the
 * scheduled recap function (Admin SDK; clients only read). The synthetic `id`
 * equals the doc id, which equals `isoWeek`. Money fields are decimal dollars.
 */
/**
 * One member's ceremony facts for a recap week (per-member points, stage 5).
 * Mirrors `functions/src/recap/types.ts` — functions/ is a separate pnpm
 * package, so the shape is duplicated rather than imported; change both.
 */
export interface RecapMemberFacts {
  memberId: string;
  /** Display name at generation time (the recap is a snapshot, not a join). */
  name: string;
  /** Signed points this member earned during the recap week. */
  points: number;
  /** Attributed habit completions (units) this member logged during the week. */
  completions: number;
  /** The member's highest-scoring day, or null when they scored none. */
  bestDay: { date: string; points: number } | null;
  /** The member's longest live streak at week end, in the habit's own cadence. */
  topStreak: { habitTitle: string; days: number; period: 'daily' | 'weekly' } | null;
  /** Titles of DAILY habits this member completed on all 7 days of the week. */
  perfectHabits: string[];
}

/**
 * One day of the ceremony's 7-day stacked chart (Monday-first).
 * `total = Σ byMember + unattributed`; `unattributed` is the grandfathering
 * series (completions recorded before attribution shipped belong to nobody).
 */
export interface RecapDayPoints {
  date: string; // yyyy-MM-dd
  /** memberId → signed points that member earned that day. */
  byMember: Record<string, number>;
  /** Signed points that day that no member holds attribution for. */
  unattributed: number;
  /** Signed household points for the day. */
  total: number;
}

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

  // --- Ceremony fields (per-member points, stage 5) -----------------------
  // ALL OPTIONAL: absent on every recap written before the ceremony shipped.
  // The drawer falls back to its pre-deck layout when they are missing, so a
  // household's older recaps stay readable forever — never make these required.

  /** Per-member ceremony facts, one entry per household member. */
  memberFacts?: RecapMemberFacts[];
  /** Exactly 7 entries, Monday → Sunday of the recap week. */
  dailyPoints?: RecapDayPoints[];
  /** Signed household points for the recap week (`Σ dailyPoints[].total`). */
  totalPoints?: number;
  /** Signed household points for the week BEFORE the recap week (trend base). */
  priorWeekPoints?: number;
  /** The household's ceremony tone at generation time (drives the deck order). */
  ceremonyTone?: CeremonyTone;
}

/**
 * Monthly money recap (F-MONEY-06) — the Weekly Recap's money-focused sibling.
 * One doc per calendar month at `households/{id}/moneyRecaps/{month}`, written
 * server-side on the 1st by the scheduled `sendmonthlymoneyrecap` function
 * (Admin SDK; clients only read). The synthetic `id` equals the doc id, which
 * equals `month` (yyyy-MM). Money fields are decimal dollars (per house
 * convention — summed in integer cents internally, stored as dollars).
 */
export interface MonthlyMoneyRecap {
  id: string;
  month: string; // e.g. '2026-06' (calendar month the recap covers)
  generatedAt: string; // ISO timestamp
  totalIncome: number; // decimal dollars — verified income for the month
  totalSpend: number; // decimal dollars — verified, non-income spend for the month
  priorMonthSpend: number; // decimal dollars — verified, non-income spend for the prior month
  /** Per-bucket over/under close-out, grouped from BucketPeriodSnapshot docs. */
  bucketResults: Array<{
    bucketId: string;
    bucketName: string;
    limit: number; // decimal dollars — total limit across the month's periods
    spent: number; // decimal dollars — total verified spend across the month's periods
    overUnder: number; // decimal dollars — spent - limit (positive = over budget)
  }>;
  /** The single biggest verified, non-income expense of the month (or null). */
  topExpense: { merchant: string; amount: number; category: string; date: string } | null;
  /** Change in net worth over the month (decimal dollars), or null when the
   *  Net Worth History feature (F-MONEY-07 family) has not populated snapshots. */
  netWorthDelta: number | null;
  /** 2-3 sentence warm summary, either AI-generated or a deterministic template. */
  narrative: string;
  narrativeSource: 'ai' | 'template';
  /** Whether this household saw the premium experience (AI narrative + push). */
  premium: boolean;
}

/** Coarse category for a logged push notification (F-NOTIF-02 inbox). */
export type NotificationLogType =
  | 'habit_reminder'
  | 'action_queue_reminder'
  | 'streak_warning'
  | 'bill_reminder'
  | 'budget_alert'
  | 'weekly_recap'
  | 'monthly_money_recap'
  | 'todo_reminder';

/**
 * In-app notification inbox entry (F-NOTIF-02) — one doc per push sent, at
 * `households/{id}/notificationLog/{id}`, written server-side by
 * `sendNotificationToUser` (Admin SDK) alongside the FCM send. This is a
 * FLAT household-level subcollection (not nested under the member doc) so it
 * degrades gracefully under today's generic member-write Firestore rule
 * without a rules change; each entry carries `recipientUid` and the client
 * filters to the signed-in member's own entries. `readBy` accumulates member
 * uids that have opened the inbox item (a household-wide log entry can in
 * principle be marked read by multiple viewers, though in practice only
 * `recipientUid` ever sees it in their own feed).
 */
export interface NotificationLogEntry {
  id: string;
  type: NotificationLogType;
  recipientUid: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  createdAt: string; // ISO timestamp
  readBy: string[];
}

/**
 * Net worth snapshot (F-MONEY-09) — one doc per calendar day at
 * `households/{id}/netWorthSnapshots/{yyyy-MM-dd}`, written server-side once
 * daily by the scheduled `snapshotnetworth` function (Admin SDK; clients only
 * read). The synthetic `id` equals the doc id, which equals `date`. Money
 * fields are decimal dollars (see `utils/netWorth.ts`).
 */
export interface NetWorthSnapshot {
  id: string;
  date: string; // yyyy-MM-dd, local to the server's daily run
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * Household activity log / audit trail (F-XCUT-01) — an append-only,
 * cross-domain "who did what when" feed at
 * `households/{id}/activityLog/{autoId}`. Written client-side by piggybacking
 * on the same `writeBatch` each mutation family already commits, so an entry
 * can never diverge from the mutation it describes. The live listener is
 * bounded (ACTIVITY_LOG_LIMIT) to avoid an unbounded collection. Read
 * visibility is gated to admins in the UI to respect member privacy.
 *
 * Deliberately EXCLUDES AI/quota-sensitive events to avoid clutter.
 */
export type ActivityDomain =
  | 'habit'
  | 'money'
  | 'todo'
  | 'shopping'
  | 'meal'
  | 'member';

export interface ActivityLogEntry {
  id: string;
  actorUid: string;
  actorName: string;
  domain: ActivityDomain;
  /** Machine-readable action slug, e.g. 'habit_completed', 'bill_paid'. */
  action: string;
  /** Human-readable one-liner, e.g. 'Paul paid Electric Bill ($142)'. */
  summary: string;
  timestamp: string; // ISO timestamp (normalised from a serverTimestamp on read)
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
  bills?: boolean;  // Pay/mark a calendar bill via the quickAddBillPay endpoint (F-MONEY-11). Optional for backward-compat with keys minted before it existed.
  todos?: boolean;  // Create a to-do via the quickAddTodo endpoint (F-TODO-07). Optional for backward-compat with keys minted before it existed.
  read?: boolean;  // Generic read/export scope for GET endpoints (e.g. getTodos). Separate from the write-only scopes so a capture-only key can't exfiltrate data. Optional for backward-compat with keys minted before it existed.
  bankSync?: boolean;  // Nightly Wells Fargo bank-email sync scope, gating the (not-yet-built) bankEmailSync endpoint. Separate scope so a capture-only key can't ingest bank data unless explicitly enabled. Optional for backward-compat with keys minted before it existed.
  receiptScanning: boolean;  // Unused — receipt endpoint removed; kept for stored-doc shape
}

export interface HouseholdApiKey {
  id: string;
  hashedKey: string;           // SHA-256 hash of the actual key (never store plain text)
  keyPrefix: string;           // First 16 chars for display (e.g., "lb_abc123_7f4e9a")
  encryptedKey?: string;       // Server-managed AES-256-GCM ciphertext of the key, enabling
                               // admin "reveal & copy" (opt-in). Written only by the
                               // attachapikeyencryption Cloud Function; never by the client.
  name: string;                // User-provided name (e.g., "iPhone Shortcut")
  createdAt: string;           // ISO timestamp
  createdBy: string;           // uid of creator
  lastUsedAt?: string;         // ISO timestamp of last API call
  usageCount: number;          // Total API calls made with this key
  status: 'active' | 'revoked';
  permissions: ApiKeyPermissions;
}
