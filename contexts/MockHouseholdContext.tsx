import React, { useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { Info, PartyPopper, Gift, Sparkles } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { format, addDays, subDays, startOfWeek } from 'date-fns';
import { HouseholdContextType, HouseholdSliceProviders } from './FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { rollRecurringAnchorForward, isRecurringId, parseRecurringId } from '@/utils/calendarRecurrence';
import { BUDGETED_IN_CALENDAR } from '@/utils/categories';
import { hashKidPin } from '@/utils/kidPin';
import { computeTodoCompletionCredit, buildUncompleteCreditReversal } from '@/utils/todoPoints';
import { buildNextRecurringTodo, isTodoFrequency } from '@/utils/todoRecurrence';
import { buildToDosFromTemplate } from '@/utils/taskTemplates';
import { redemptionMemberDelta, REDEMPTION_HISTORY_LIMIT } from '@/utils/redemption';
import { calculateSafeToSpendBreakdown, type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { calculateBucketSpent } from '@/utils/bucketSpentCalculator';
import { processToggleHabit, processStaleDownToggle, isHabitStale, calculateResetPoints, streakForHabit, habitPeriodStart } from '@/utils/habitLogic';
import {
  attributedUnitsOnDate,
  attributionReversalForDates,
  habitFeedsMemberAttribution,
  householdPeriodPointsDelta,
  legacyPeriodPoints,
  memberCompletionCount,
  memberPeriodPointsDelta,
  resolveReversalSources,
  wholePeriodClearDates,
  withAttributionDelta,
  withDatesUnattributed,
  type PointsBuckets,
} from '@/utils/habitAttribution';
import { computeBackdatedHabitFire, computeHabitTriggerFire, computeHabitTriggerReverse } from '@/utils/habitTriggerFire';
import { evaluateTodoSubtaskGate, TodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { setSubtaskDone, subtaskProgress } from '@/utils/subtasks';
import type { TodoSubtaskToggleResult, TodoCompletionOptions } from '@/contexts/household/mutations/todoMutations';
import { crossedMilestone, rewardMilestoneSatisfied } from '@/utils/habitMilestones';
import { attributionString, type TriggerSource } from '@/utils/habitTriggers';
import { selectAutoFreezeCandidates, selectMemberAutoFreezeCandidates } from '@/utils/freezeBank';
import {
  freezeBankMemberIds,
  isPerMemberFreeze,
  newMemberFreezeBank,
  resolveFreezeMode,
  visibleFreezeBank,
} from '@/utils/freezeSettings';
import { accountImpactOf, effectiveAccountImpact, isBankSyncTransaction, resolveTargetAccount, shouldSkipBankSyncDelta } from '@/utils/accountImpact';
import { findSettledBill, settledBillRefusal, touchesSettledBillFields } from '@/utils/settledBillGuard';
import { mergeTransactions as buildMergeUpdates } from '@/utils/transactionMerge';
import { selectHabitsToFire } from '@/utils/transactionHabitFiring';
import { MAX_COMMENT_LENGTH } from '@/contexts/household/mutations/commentMutations';
import { buildMerchantRuleFields, type MerchantRuleDraft } from '@/contexts/household/mutations/merchantRuleMutations';
import { roundMoney } from '@/utils/money';
import { splitParticipantKey } from '@/utils/settlement';
import { trashDocId, type TrashDomain, type TrashedItem } from '@/utils/trash';
import { computeNetWorth } from '@/utils/netWorth';
import { track } from '@/services/analytics';
import { DEFAULT_HIDDEN_DASHBOARD_WIDGETS } from '@/utils/dashboardLayout';
import {
  Account,
  BudgetBucket,
  Transaction,
  SplitParticipant,
  CalendarItem,
  Habit,
  HabitSubmission,
  Challenge,
  RewardItem,
  RewardRedemption,
  RewardRedemptionRecord,
  HouseholdMember,
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
  YearlyGoal,
  BucketPeriodSnapshot,
  Household,
  FreezeBank,
  ModuleKey,
  ModuleVisibilityMap,
  CaptureType,
  CaptureReviewMode,
  CeremonyTone,
  DietaryProfile,
  FreezeMode,
  WeeklyRecap,
  MonthlyMoneyRecap,
  NotificationLogEntry,
  NetWorthSnapshot,
  ActivityLogEntry,
  SavingsGoal,
  TransactionComment,
  MerchantRule,
  MAX_MERCHANT_RULES,
  INCOME_CATEGORY
} from '@/types/schema';
import toast from 'react-hot-toast';

// Helper to generate unique IDs
const generateId = () => `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// F-TODO-16 — category comparison key ('' for absent/blank), matching the real
// mutations' case-insensitive matching. Module-scope so the category callbacks
// below don't need it as a dependency.
const normalizeCategory = (value: string | undefined) => (value ?? '').trim().toLowerCase();

/**
 * Optional Test-Mode seed variant, set by the e2e suite BEFORE the app boots
 * (via sessionStorage, same transport as the LIFEBALANCE_TEST_MODE flag):
 *   - 'fresh' — boot with an EMPTY household (no accounts/buckets/transactions/
 *     habits) so the onboarding wizard's "from nothing" path is walkable.
 *   - 'stub'  — additionally seed one Apple Pay $0 `needsAmount` pending stub so
 *     the review drawer's add-amount-inline path is walkable. Not seeded by
 *     default because a pending_review row changes the Money nav link's
 *     accessible name (", N pending review"), which the smoke spec matches
 *     exactly.
 *   - 'merchant-rules' — additionally seed three rows carrying RAW bank
 *     descriptors that the household's `merchantRules` rename on display, so
 *     the descriptor → friendly-name layer is walkable. Not seeded by default
 *     because several tests assert on the default seeds' merchant text.
 *   - 'bill-merge' — additionally seed the reported TODO.md 2H duplicate: a
 *     hand-entered recurring utility bill PLUS the screenshot-imported charge
 *     that actually paid it, at a different amount. The only variant that seeds
 *     `calendarItems` at all, and the only way to exercise
 *     `settleBillWithTransaction` in Test Mode. Not seeded by default for the
 *     same reason as 'stub' (its `pending_review` row changes the Money nav
 *     link's accessible name).
 * Absent/unknown values leave the default seeds untouched.
 */
const readTestSeedVariant = (): 'fresh' | 'stub' | 'merchant-rules' | 'bill-merge' | null => {
  try {
    const v = window.sessionStorage.getItem('LIFEBALANCE_TEST_SEED');
    return v === 'fresh' || v === 'stub' || v === 'merchant-rules' || v === 'bill-merge' ? v : null;
  } catch {
    return null;
  }
};
const TEST_SEED_VARIANT = readTestSeedVariant();

// The mock's single tracked pay period. Seeded transactions, newly added
// transactions, and the exposed `currentPeriodId` must all share this value —
// `sumPendingSpend`/`calculateBucketSpent` filter by `payPeriodId === currentPeriodId`,
// so a mismatch silently drops transactions from Safe-to-Spend and bucket progress.
const MOCK_PAY_PERIOD_ID = '2024-01-01';

// Seed data with realistic examples
const SEED_ACCOUNTS: Account[] = [
  // Diverging Plaid balance (plan 04) so Test Mode shows the "Update to bank
  // balance" advisory chip (utils/plaidBalance.ts) without needing a real link.
  {
    id: 'acc1',
    name: 'Main Checking',
    type: 'checking',
    balance: 5420.50,
    lastUpdated: new Date().toISOString(),
    plaidBalanceCurrent: 5389.12,
    plaidBalanceAvailable: 5350.00,
    plaidBalanceUpdatedAt: new Date().toISOString(),
  },
  { id: 'acc2', name: 'Savings Account', type: 'savings', balance: 12000, lastUpdated: new Date().toISOString() },
  // Credit debt is stored POSITIVE (see utils/accountImpact.ts) — a charge
  // increments it, a payment decrements it.
  { id: 'acc3', name: 'Credit Card', type: 'credit', balance: 850.25, lastUpdated: new Date().toISOString() },
];

// Plan 24 (savings goals / sinking funds) Test-Mode harness: one shared
// household goal (Money → Accounts tab) plus one kid-owned goal (ownerId:
// 'kid_leo') so the KidDashboard jar renders live data without a real backend.
const SEED_SAVINGS_GOALS: SavingsGoal[] = [
  {
    id: 'goal1',
    name: 'Christmas',
    targetAmount: 1200,
    savedAmount: 300,
    dueDate: '2026-12-01',
    color: 'emerald',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'goal2',
    name: 'New Bike',
    targetAmount: 150,
    savedAmount: 90,
    ownerId: 'kid_leo',
    color: 'purple',
    createdAt: new Date().toISOString(),
  },
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
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
    // Plan 23: seeded with one comment (see SEED_TRANSACTION_COMMENTS below)
    // so the thread + row count-badge are visible without any user action.
    commentCount: 1,
    // F-MONEY-13: paid by the test user and split evenly with Jordan, so the
    // Settle-Up view shows "Jordan owes you $22.75" out of the box in Test Mode.
    createdBy: 'test-user-id',
    splitWith: [{ memberId: 'test-partner-id', shareAmount: 22.75 }],
  },
  {
    id: 'tx2', amount: 120.00, merchant: 'PG&E', category: 'Utilities',
    date: getLocalDateString(),
    status: 'verified', isRecurring: true, source: 'manual',
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
    // Attributed to the OTHER adult (Jordan) with a fresh timestamp so the
    // "Since you were here" partner-activity card has real data to show in Test
    // Mode once a prior visit baseline exists (see utils/partnerActivity).
    createdBy: 'test-partner-id',
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  // NOTE: intentionally no seeded Apple Pay $0 "awaiting amount" stub in the
  // DEFAULT seeds. A pending_review transaction adds a "pending review" badge
  // to the Money nav link (changing its accessible name) and the e2e smoke
  // test matches the nav link by exact name "Money"; a stub here breaks that.
  // The e2e stub spec opts in via the 'stub' seed variant below; the unit-level
  // flow is covered by ReviewPendingDrawer.test.tsx + the quickAdd tests.
];

// 'stub' seed variant: one Apple Pay $0 pre-auth awaiting its real amount, the
// exact shape the quickAdd endpoint writes (amount 0 + needsAmount), so the e2e
// suite can walk the review drawer's inline add-amount path.
const STUB_TRANSACTION: Transaction = {
  id: 'tx_stub', amount: 0, merchant: 'Apple Pay', category: '',
  date: getLocalDateString(),
  status: 'pending_review', isRecurring: false, source: 'shortcut',
  autoCategorized: false, needsAmount: true, payPeriodId: MOCK_PAY_PERIOD_ID,
};

/**
 * 'bill-merge' seed variant (TODO.md 2H) — the reported duplicate, reproduced:
 * a recurring natural-gas bill entered BY HAND at its typical $142, and the
 * screenshot-imported charge that actually paid it at $37.91 under the bank's
 * own descriptor. The amounts deliberately sit far outside the matcher's
 * ±10%/±$25 tolerance, so nothing auto-collapses them — which is precisely the
 * case `settleBillWithTransaction` exists for. A second, one-off unpaid bill
 * makes the non-recurring branch of the merge walkable too.
 *
 * NOTE the row is `pending_review` with NO `bankRef`: that is what the capture
 * pipeline writes, and it is why the sibling `linkBankTransactionToBill`
 * affordance correctly refuses to appear for it.
 */
const BILL_MERGE_CALENDAR_ITEMS: CalendarItem[] = [
  {
    id: 'cal_gas_template',
    title: 'Centerpoint Energy (Natural Gas)',
    amount: 142,
    // The 5th of the current month, recurring monthly — inside every window the
    // calendar and the review drawer expand.
    date: `${getLocalDateString().slice(0, 7)}-05`,
    type: 'expense',
    isPaid: false,
    isRecurring: true,
    frequency: 'monthly',
  },
  {
    id: 'cal_dentist_oneoff',
    title: 'Dentist copay',
    amount: 85,
    date: getLocalDateString(),
    type: 'expense',
    isPaid: false,
  },
];

const BILL_MERGE_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx_cpenergy', amount: 37.91, merchant: 'Cpenergy Mngco', category: 'Uncategorized',
    date: getLocalDateString(),
    status: 'pending_review', isRecurring: false, source: 'image-capture',
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
  },
];

/**
 * Merchant rules for Test Mode — the descriptor → friendly-name layer
 * (`utils/merchantRules.ts`). Seeded in EVERY variant: rules are inert until a
 * descriptor matches one, and none of these patterns match the default seeds'
 * merchants, so they change nothing unless the 'merchant-rules' rows below are
 * also seeded.
 *
 * Deliberately shaped to demonstrate the three behaviours that are easy to get
 * wrong, so they're walkable rather than only unit-tested:
 *  - most-specific-wins: the amount-qualified Apple rule beats the bare one on
 *    a $2.99 charge, and ONLY on that amount;
 *  - the catch-all fallback that keeps an exact-amount rule from degrading back
 *    to a raw descriptor when the price changes;
 *  - `exempt`, on a variable-amount card payment that must not break a no-spend
 *    day (see functions/src/quickAdd/noSpendDay.ts).
 */
const MOCK_MERCHANT_RULES: MerchantRule[] = [
  {
    id: 'rule-icloud', pattern: 'APPLE.COM', amount: 2.99,
    name: 'iCloud storage', category: 'Entertainment',
    createdAt: new Date('2026-07-01T12:00:00Z').toISOString(),
  },
  {
    id: 'rule-apple', pattern: 'APPLE.COM', name: 'Apple',
    createdAt: new Date('2026-07-01T12:01:00Z').toISOString(),
  },
  {
    id: 'rule-amex', pattern: 'AMERICAN EXPRESS', name: 'AmEx payment',
    exempt: true,
    createdAt: new Date('2026-07-01T12:02:00Z').toISOString(),
  },
];

/**
 * 'merchant-rules' seed variant: rows carrying the RAW descriptor text a bank
 * actually sends, each renamed on display by one of MOCK_MERCHANT_RULES. All
 * `verified` on purpose — a pending_review row would change the Money nav
 * link's accessible name and break the e2e smoke spec.
 */
const BANK_DESCRIPTOR_TRANSACTIONS: Transaction[] = [
  {
    // Hits the amount-qualified rule → displays "iCloud storage".
    id: 'tx_desc_icloud', amount: 2.99, merchant: 'APPLE.COM/BILL 866-712-7753 CA',
    category: 'Entertainment', date: getLocalDateString(),
    status: 'verified', isRecurring: true, source: 'bank-sync',
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
  },
  {
    // Same pattern, different amount → falls through to the bare rule → "Apple".
    id: 'tx_desc_apple', amount: 39.99, merchant: 'APPLE.COM/US 866-712-7753 CA',
    category: 'Entertainment', date: getLocalDateString(),
    status: 'verified', isRecurring: false, source: 'bank-sync',
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
  },
  {
    // Variable-amount card payment → "AmEx payment", and `exempt`.
    id: 'tx_desc_amex', amount: 912.44, merchant: 'AMERICAN EXPRESS ACH PMT 240725',
    category: 'Utilities', date: getLocalDateString(),
    status: 'verified', isRecurring: true, source: 'bank-sync',
    autoCategorized: false, payPeriodId: MOCK_PAY_PERIOD_ID,
  },
];

// Plan 23: seed thread for tx1 so the comment section renders content in
// Test Mode without requiring any interaction first (visual verification).
const SEED_TRANSACTION_COMMENTS: Record<string, TransactionComment[]> = {
  tx1: [
    {
      id: 'comment-1',
      authorUid: 'test-user-id',
      text: 'Bigger than usual — stocked up for the week.',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
  ],
};

const SEED_HABITS: Habit[] = [
  {
    id: 'h1', title: 'Drink 8 Glasses of Water', category: 'Health', type: 'positive',
    basePoints: 10, scoringType: 'threshold', period: 'daily', targetCount: 8,
    // Per-member points (stage 2) Test-Mode harness: a genuinely multi-member
    // day, so the row's pie counter renders 2 : 1 in two member colors and the
    // badge row shows both credited avatars — one with an ember flame ring
    // (three consecutive attributed days), one without — without needing any
    // interaction first. `completedDates` stays EMPTY on purpose: this is a
    // threshold habit at 3 of 8, and the subsystem's invariant is "a date in
    // completedDates ⟹ that day's target was met", which is exactly what
    // production's per-tap attribution writes look like mid-progress.
    totalCount: 3, count: 3, completedDates: [], streakDays: 0,
    completedBy: {
      [getLocalDateString()]: { 'test-user-id': 2, 'test-partner-id': 1 },
      [getLocalDateString(subDays(new Date(), 1))]: { 'test-user-id': 1 },
      [getLocalDateString(subDays(new Date(), 2))]: { 'test-user-id': 1 },
    },
    createdBy: 'test-user-id', lastUpdated: new Date().toISOString()
  },
  {
    id: 'h2', title: 'Exercise 30min', category: 'Fitness', type: 'positive',
    basePoints: 20, scoringType: 'threshold', period: 'daily', targetCount: 1,
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
    createdBy: 'test-user-id', lastUpdated: new Date().toISOString(),
    // Habit Automations (PRD #1065): seeded transaction keywords so the
    // habit-editor Automations section AND the review-card "Also logs" chips are
    // walkable in Test Mode — capture a transaction from "Planet Fitness" (or a
    // "gym" note) and it fires this habit on approve.
    triggers: { keywords: ['gym', 'planet fitness'] },
  },
  // Plan 080c-3 Test-Mode harness: one kid-assigned chore so the kid dashboard
  // chore list and the parent read-only KidChoresGroup both render live data.
  // assignedTo targets the seeded managed kid; isShared:false marks it a per-kid
  // chore (not a shared household habit). Dormant for normal households.
  {
    id: 'h3', title: 'Clear the Dinner Table', category: 'Chores', type: 'positive',
    basePoints: 5, scoringType: 'threshold', period: 'daily', targetCount: 1,
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
    assignedTo: 'kid_leo', isShared: false,
    createdBy: 'test-user-id', lastUpdated: new Date().toISOString()
  },
];

/** The signed-in principal in Test Mode (mirrors MockAuthContext). */
const MOCK_USER_UID = 'test-user-id';

const SEED_MEMBERS: HouseholdMember[] = [
  {
    uid: 'test-user-id', displayName: 'Test User', email: 'test@example.com',
    role: 'admin', points: { daily: 30, weekly: 150, total: 500 }
  },
  // Second adult so the F-MONEY-13 Settle-Up view is walkable in Test Mode
  // (who-owes-whom needs 2+ adults). The seed transaction 't1' is split with
  // this member below. 2F.3: also gives the admin per-member visibility matrix
  // a member whose `hiddenKeys` genuinely differs from the others — hides two
  // Money leaves this partner doesn't use — so per-member independence is
  // actually observable in Test Mode (previously all seeded members resolved
  // to the identical `MEMBER_DEFAULT_HIDDEN_KEYS` default).
  {
    uid: 'test-partner-id', displayName: 'Jordan', email: 'jordan@example.com',
    role: 'member',
    // Non-zero and DISTINCT from the admin's own points (stage 3 PR: the Points
    // Breakdown drawer's adults-only standings need two members with different
    // figures to be worth looking at in Test Mode). Post-flip (stage 1.5) the
    // household `dailyPoints`/`weeklyPoints` are derived as the Σ of the ADULT
    // members' scores, so Jordan's points DO feed the toolbar figures
    // (30+18=48 / 150+95=245) — the drawer's "together" number and the member
    // standings must agree, that Σ being the whole point of the model. The
    // per-member scoreboard widget (PR 4/6) also demos off this pair: Test
    // User stays the leader (30/150 > 18/95).
    points: { daily: 18, weekly: 95, total: 310 },
    hiddenKeys: [...DEFAULT_HIDDEN_DASHBOARD_WIDGETS, 'trends', 'subscriptions']
  },
  // Plan 080 (Kid Mode) Test-Mode harness: one managed kid so the dormant kid
  // surfaces are walkable in Test Mode. Mirrors the EXACT object shape the mock's
  // own addKidProfile builds (login-less, isManaged, managedByUid, no email), so
  // the kid dashboard, the parent KidsChoresWidget, and the +pts todo badge all
  // show live data without a real backend. 2F.3: a second, DIFFERENT `hiddenKeys`
  // (a kid has no budget-management reason to see Buckets/Accounts) so the matrix
  // shows three genuinely distinct per-member states, not one shared default.
  {
    uid: 'kid_leo', displayName: 'Leo', role: 'kid',
    isManaged: true, managedByUid: 'test-user-id',
    avatarColor: '#9f5618', avatarEmoji: '🦊', // terracotta from utils/avatarColor AVATAR_COLORS
    points: { daily: 15, weekly: 60, total: 220 }, allowanceCents: 0,
    hiddenKeys: [...DEFAULT_HIDDEN_DASHBOARD_WIDGETS, 'buckets', 'accounts']
  }
];

const SEED_STORES: Store[] = [
  { id: 's1', name: 'Safeway', icon: 'Store' },
  { id: 's2', name: 'Costco', icon: 'Store' },
];

// Plan 080e Test-Mode harness: ONE active family challenge so the dormant
// "Family Challenge" card on the kid dashboard renders live data and the
// addChallenge creation flow has something to add alongside. Linked to the two
// seeded shared habits (h1, h2) so calculateChallengeProgress has inputs.
// Decoupled from yearly goals (no yearlyGoalId); isFamilyChallenge marks it.
const SEED_CHALLENGES: Challenge[] = [
  {
    id: 'fc1',
    month: getLocalDateString().slice(0, 7), // current YYYY-MM, local
    title: 'Family Fitness Month',
    description: 'Everyone moves every day!',
    relatedHabitIds: ['h1', 'h2'],
    targetType: 'count',
    targetValue: 60,
    status: 'active',
    isFamilyChallenge: true,
    yearlyRewardLabel: 'Family goal',
    createdBy: 'test-user-id',
    createdAt: new Date().toISOString(),
  },
];

const SEED_GROCERY_CATALOG: GroceryCatalogItem[] = [
  { id: 'gc1', name: 'Milk', category: 'Dairy', defaultQuantity: '1', defaultStore: 'Safeway', purchaseCount: 10, lastPurchased: new Date().toISOString() },
  { id: 'gc2', name: 'Eggs', category: 'Dairy', defaultQuantity: '12', defaultStore: 'Costco', purchaseCount: 5, lastPurchased: new Date().toISOString() },
  { id: 'gc3', name: 'Bread', category: 'Bakery', defaultQuantity: '1', defaultStore: 'Safeway', purchaseCount: 8, lastPurchased: new Date().toISOString() },
];

// Test-Mode harness: two rewards so the store + the (now all-households) "Manage
// rewards" UI in the Rewards tab are walkable. One realWorld, one allowance reward
// (allowanceCents in integer cents — the allowance kind only surfaces in Kid Mode).
const SEED_REWARDS: RewardItem[] = [
  { id: 'rw1', title: 'Movie Night', cost: 50, icon: '🎬', type: 'realWorld', active: true, createdBy: 'test-user-id' },
  { id: 'rw2', title: '$5 Allowance', cost: 100, icon: '💵', type: 'allowance', allowanceCents: 500, active: true, createdBy: 'test-user-id' },
];

// Plan 080d-2 Test-Mode harness: one PENDING redemption request from the seeded
// kid so the parent review queue (in the Rewards tab) is walkable in Test Mode. It
// targets the allowance reward so approving it exercises BOTH the point deduction
// and the allowance IOU credit. Dormant for normal households — the queue is gated
// on Kid Mode being on.
const SEED_PENDING_REDEMPTIONS: RewardRedemption[] = [
  {
    id: 'redemption_seed_1',
    rewardId: 'rw2',
    rewardTitle: '$5 Allowance',
    memberId: 'kid_leo',
    cost: 100,
    type: 'allowance',
    allowanceCents: 500,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    requestedByUid: 'test-user-id',
  },
];

// Rewards center Test-Mode harness: one past redemption so the "Recently redeemed"
// history section renders (and is walkable) without first redeeming. Instant
// redemptions append to this most-recent-first list in the mock redeemReward.
const SEED_REDEMPTION_HISTORY: RewardRedemptionRecord[] = [
  {
    id: 'redemption_history_seed_1',
    rewardId: 'rw1',
    rewardTitle: 'Movie Night',
    icon: '🎬',
    cost: 50,
    redeemedByUid: 'test-user-id',
    redeemedAt: new Date().toISOString(),
  },
];

export const MockHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // State management with in-memory persistence. The 'fresh' seed variant
  // empties the money/habit collections (onboarding e2e); 'stub' appends the
  // Apple Pay $0 stub to the default seeds (review-drawer e2e).
  const isFresh = TEST_SEED_VARIANT === 'fresh';
  const [accounts, setAccounts] = useState<Account[]>(isFresh ? [] : SEED_ACCOUNTS);
  const [buckets, setBuckets] = useState<BudgetBucket[]>(isFresh ? [] : SEED_BUCKETS);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>(isFresh ? [] : SEED_SAVINGS_GOALS);
  const [transactions, setTransactions] = useState<Transaction[]>(
    isFresh
      ? []
      : TEST_SEED_VARIANT === 'stub'
        ? [...SEED_TRANSACTIONS, STUB_TRANSACTION]
        : TEST_SEED_VARIANT === 'merchant-rules'
          ? [...SEED_TRANSACTIONS, ...BANK_DESCRIPTOR_TRANSACTIONS]
          : TEST_SEED_VARIANT === 'bill-merge'
            ? [...SEED_TRANSACTIONS, ...BILL_MERGE_TRANSACTIONS]
            : SEED_TRANSACTIONS
  );
  // Plan 23 — transaction comments, keyed by transaction id. Mirrors the real
  // context's on-demand fetch model (no listener); the "fetch" here is just a
  // synchronous in-memory read wrapped in a resolved Promise.
  const [transactionComments, setTransactionComments] = useState<Record<string, TransactionComment[]>>(
    isFresh ? {} : SEED_TRANSACTION_COMMENTS
  );
  const [habits, setHabits] = useState<Habit[]>(isFresh ? [] : SEED_HABITS);
  // Empty by default (several specs count Action-Queue rows); the 'bill-merge'
  // variant is the one that seeds bills, so the 2H merge is walkable.
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>(
    TEST_SEED_VARIANT === 'bill-merge' ? BILL_MERGE_CALENDAR_ITEMS : []
  );
  const [challenges, setChallenges] = useState<Challenge[]>(isFresh ? [] : SEED_CHALLENGES);
  const [yearlyGoals] = useState<YearlyGoal[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>(SEED_REWARDS);
  const [pendingRedemptions, setPendingRedemptions] = useState<RewardRedemption[]>(SEED_PENDING_REDEMPTIONS);
  const [redemptionHistory, setRedemptionHistory] = useState<RewardRedemptionRecord[]>(SEED_REDEMPTION_HISTORY);
  // F-HABITS-02 (streak milestone celebrations): mirrors Household.unlockedRewardIds.
  const [unlockedRewardIds, setUnlockedRewardIds] = useState<string[]>([]);
  // Stateful so an instant redeem in Test Mode actually deducts the shared total
  // (production deducts household.points.total). dailyPoints/weeklyPoints stay
  // fixed — only the redeemable lifetime total moves.
  const [totalPoints, setTotalPoints] = useState(500);
  const [members, setMembers] = useState<HouseholdMember[]>(SEED_MEMBERS);
  // Mirror the latest members so approveRedemption can read the kid's current
  // points.total for the affordability check deterministically, without coupling
  // to the execution order of two separate setState updaters. Updated during
  // render, which is safe for a plain mirror ref (no state change, no effect).
  const membersRef = useRef(members);
  membersRef.current = members;
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  // Test Mode seeds no held-for-review shopping captures by default: an
  // auto-opening review drawer would intercept pointer events and break the e2e
  // suite. The visible/awaiting-review split is covered by unit tests.
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  // Plan 080c-5 Test-Mode harness: one kid-assigned todo so the +pts badge and
  // the completeToDo → kid-points credit path are walkable. assignedTo targets the
  // seeded managed kid and points:5 is the explicit chore reward. Inert (credits
  // nothing) for a normal, non-managed assignee — see utils/todoPoints.ts.
  const [todos, setTodos] = useState<ToDo[]>(() => [
    {
      id: 'todo_kid_1',
      text: 'Make your bed',
      completeByDate: getLocalDateString(),
      assignedTo: 'kid_leo',
      isCompleted: false,
      points: 5,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
      category: 'Home',
    },
    // Eisenhower matrix seeds: one per non-empty quadrant so the matrix
    // arrangement is walkable in Test Mode (todo_kid_1 above lands in
    // Delegate: urgent, not important).
    {
      id: 'todo_important_1',
      text: 'Renew car insurance',
      completeByDate: getLocalDateString(), // urgent + important → Do First
      assignedTo: 'test-user-id',
      isCompleted: false,
      isImportant: true,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
      // F-TODO-16: seeded categories on a few todos so the chips, the
      // 'Category' sort mode, and the grouped headers all have something to
      // show. `todo_later_1` deliberately stays uncategorized.
      category: 'Errands',
    },
    {
      id: 'todo_schedule_1',
      text: 'Plan summer vacation',
      // ~3 weeks out: not urgent + important → Schedule
      completeByDate: format(addDays(new Date(), 21), 'yyyy-MM-dd'),
      assignedTo: 'test-user-id',
      isCompleted: false,
      isImportant: true,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
      // F-TODO-08: seed a subtask checklist so the progress chip + expandable
      // list are walkable in Test Mode.
      subtasks: [
        { id: 'st_vac_1', text: 'Pick destination', isDone: true },
        { id: 'st_vac_2', text: 'Book flights', isDone: false },
        { id: 'st_vac_3', text: 'Reserve hotel', isDone: false },
      ],
      category: 'Home',
    },
    {
      id: 'todo_later_1',
      text: 'Organize the garage',
      // ~2 weeks out, unstarred: not urgent + not important → Later
      completeByDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
      assignedTo: 'test-user-id',
      isCompleted: false,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
    },
    // Habit Automations (PRD #1065): a to-do LINKED to the 'Exercise 30min'
    // habit (h2). Completing it fires the habit like one manual tap; the
    // "Counts toward habit" picker + the habit editor's Automations listing are
    // both walkable in Test Mode. No subtasks, so it completes immediately.
    {
      id: 'todo_linked_1',
      text: 'Go for a 30 minute run',
      completeByDate: getLocalDateString(),
      assignedTo: 'test-user-id',
      isCompleted: false,
      linkedHabitId: 'h2',
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
    },
  ]);
  // Keep a ref in sync with the latest todos so completeToDo can resolve the
  // completed to-do DETERMINISTICALLY (for the points credit) without depending on
  // the execution order of two separate setState updaters. Updated during render,
  // which is safe for a plain mirror ref (no state change, no effect needed).
  const todosRef = useRef(todos);
  todosRef.current = todos;
  // Habit Automations (PRD #1065): mirror habits so completeToDo/uncompleteToDo
  // can fire/reverse a linked habit off the latest state without depending on
  // updater execution order (same pattern as todosRef above).
  const habitsFireRef = useRef(habits);
  habitsFireRef.current = habits;
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>(SEED_GROCERY_CATALOG);
  const [bucketHistory] = useState<BucketPeriodSnapshot[]>([]); // Mock empty history
  // Net worth history (F-MONEY-09) — 30 deterministic daily snapshots ending
  // at today's live SEED_ACCOUNTS total, drifting backward by a small fixed
  // step per day so the Trends chart has a visible (non-flat) trend line in
  // Test Mode without depending on Math.random (deterministic test seed).
  const [netWorthHistory] = useState<NetWorthSnapshot[]>(() => {
    if (isFresh) return [];
    const { totalAssets, totalLiabilities, netWorth } = computeNetWorth(SEED_ACCOUNTS);
    const days = 30;
    const dailyDrift = 18.32; // decimal dollars/day, arbitrary but fixed
    return Array.from({ length: days }, (_, i) => {
      const daysAgo = days - 1 - i;
      const date = getLocalDateString(new Date(Date.now() - daysAgo * 86400000));
      const drift = dailyDrift * daysAgo;
      return {
        id: date,
        date,
        totalAssets: roundMoney(totalAssets - drift),
        totalLiabilities,
        netWorth: roundMoney(netWorth - drift),
      };
    });
  });
  // One canned weekly recap (Plan 02, ceremony stage 5) so Test Mode renders
  // the Dashboard recap card AND the full 4-card story deck. Anchored to the
  // PREVIOUS ISO week — which is what the server now writes, since generation
  // moved to Monday morning and the recap describes the week that just CLOSED
  // — with a fresh `generatedAt` so the card's 4-day freshness window passes.
  //
  // The per-member numbers are deliberately coherent — and deliberately BELOW
  // the live week. `SEED_MEMBERS`' two adults hold 150 / 95 = 245 for the
  // IN-PROGRESS week; this closed week seeds 120 / 76 = 196, so the scoreboard
  // widget's trend chip actually renders (+25%) instead of computing a 0% delta
  // and hiding itself. The internal invariants still hold for the recap's own
  // week: household `totalPoints` = Σ adults, `pointsByMember` = `memberFacts`
  // points, and the day split sums to each member's weekly figure.
  const [recaps] = useState<WeeklyRecap[]>(() => {
    const closedWeek = new Date(Date.now() - 7 * 86400000);
    const isoWeek = format(closedWeek, "RRRR-'W'II");
    const monday = startOfWeek(closedWeek, { weekStartsOn: 1 });
    const day = (i: number) => getLocalDateString(new Date(monday.getTime() + i * 86400000));
    // Mon–Sun, Test User then Jordan: sums to 120 / 76 (196 together).
    const split: Array<[number, number]> = [
      [20, 8],
      [16, 16],
      [12, 4],
      [20, 12],
      [16, 8],
      [24, 20],
      [12, 8],
    ];
    return [{
      id: isoWeek,
      isoWeek,
      generatedAt: new Date().toISOString(),
      totalSpend: 187.45,
      priorWeekSpend: 243.1,
      topCategoryDeltas: [
        { category: 'Groceries', current: 92.5, prior: 128.2 },
        { category: 'Entertainment', current: 45.0, prior: 62.4 },
        { category: 'Gas', current: 49.95, prior: 52.5 },
      ],
      habitCompletions: 9,
      streaksAtRisk: [{ habitTitle: 'Exercise 30min', streakDays: 5 }],
      pointsByMember: [
        { memberId: 'test-user-id', name: 'Test User', points: 120 },
        { memberId: 'test-partner-id', name: 'Jordan', points: 76 },
      ],
      upcomingBills: [
        { title: 'Rent', amount: 1200, date: getLocalDateString(new Date(Date.now() + 3 * 86400000)) },
        { title: 'Internet', amount: 65, date: getLocalDateString(new Date(Date.now() + 5 * 86400000)) },
      ],
      narrative:
        'Test Mode: You spent 23% less than last week — groceries did the heavy lifting. Keep the exercise streak alive tonight to lock in your multiplier.',
      narrativeSource: 'template',
      premium: true,
      // --- Ceremony fields (stage 5) ---
      memberFacts: [
        {
          memberId: 'test-user-id',
          name: 'Test User',
          points: 120,
          completions: 12,
          bestDay: { date: day(5), points: 24 },
          topStreak: { habitTitle: 'Read 30 minutes', days: 9, period: 'daily' },
          perfectHabits: ['Read 30 minutes'],
        },
        {
          memberId: 'test-partner-id',
          name: 'Jordan',
          points: 76,
          completions: 8,
          bestDay: { date: day(5), points: 20 },
          topStreak: { habitTitle: 'Exercise 30min', days: 4, period: 'daily' },
          perfectHabits: [],
        },
      ],
      dailyPoints: split.map(([mine, theirs], i) => ({
        date: day(i),
        byMember: { 'test-user-id': mine, 'test-partner-id': theirs },
        unattributed: 0,
        total: mine + theirs,
      })),
      totalPoints: 196,
      // 196 vs 175 → the deck's own trend band reads +12%.
      priorWeekPoints: 175,
      ceremonyTone: 'household_first',
    }];
  });
  // F-NOTIF-02 (in-app notification inbox) — a few canned entries, mixed
  // read/unread, so Test Mode renders the bell badge + inbox drawer. Mirrors
  // the real provider's shape: newest first, `readBy` accumulates member uids.
  const [notificationLog, setNotificationLog] = useState<NotificationLogEntry[]>(() => [
    {
      id: 'notif-1',
      type: 'bill_reminder',
      recipientUid: 'test-user-id',
      title: 'Bills due in 3 days',
      body: '2 bills totaling $1,265.00 coming up',
      data: { url: '/budget' },
      createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      readBy: [],
    },
    {
      id: 'notif-2',
      type: 'streak_warning',
      recipientUid: 'test-user-id',
      title: "Don't break your streak!",
      body: 'You have 1 habit with an active streak that needs attention today.',
      data: { url: '/habits' },
      createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
      readBy: [],
    },
    {
      id: 'notif-3',
      type: 'weekly_recap',
      recipientUid: 'test-user-id',
      title: 'Your weekly recap is ready',
      body: 'See how your spending, habits, and points stacked up this week.',
      data: { url: '/?recap=test' },
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      readBy: ['test-user-id'],
    },
  ]);
  const unreadNotificationCount = notificationLog.filter((entry) => !entry.readBy.includes('test-user-id')).length;
  const markNotificationRead = async (entryId: string) => {
    setNotificationLog((prev) =>
      prev.map((entry) =>
        entry.id === entryId && !entry.readBy.includes('test-user-id')
          ? { ...entry, readBy: [...entry.readBy, 'test-user-id'] }
          : entry
      )
    );
  };
  const markAllNotificationsRead = async () => {
    setNotificationLog((prev) =>
      prev.map((entry) =>
        entry.readBy.includes('test-user-id') ? entry : { ...entry, readBy: [...entry.readBy, 'test-user-id'] }
      )
    );
  };
  // One canned monthly money recap (F-MONEY-06) so Test Mode renders the
  // Dashboard money-recap card + drawer. Anchored to the PRIOR calendar month
  // with a fresh generatedAt so the card's freshness window always passes.
  const [moneyRecaps] = useState<MonthlyMoneyRecap[]>(() => {
    const priorMonth = new Date();
    priorMonth.setDate(1);
    priorMonth.setMonth(priorMonth.getMonth() - 1);
    const month = format(priorMonth, 'yyyy-MM');
    return [{
      id: month,
      month,
      generatedAt: new Date().toISOString(),
      totalIncome: 5200,
      totalSpend: 3480.25,
      priorMonthSpend: 3120.5,
      bucketResults: [
        { bucketId: 'groceries', bucketName: 'Groceries', limit: 600, spent: 645.1, overUnder: 45.1 },
        { bucketId: 'dining', bucketName: 'Dining Out', limit: 250, spent: 198.4, overUnder: -51.6 },
        { bucketId: 'gas', bucketName: 'Gas', limit: 200, spent: 210.0, overUnder: 10.0 },
      ],
      topExpense: { merchant: 'Costco', amount: 312.4, category: 'Groceries', date: `${month}-14` },
      netWorthDelta: null,
      narrative:
        'Test Mode: You spent about 12% more than last month, with groceries running just over budget. Nice work keeping dining out well under — trim groceries next month and you\'ll land comfortably in the black.',
      narrativeSource: 'template',
      premium: true,
    }];
  });
  // A few canned activity-log entries (F-XCUT-01) so Test Mode renders the
  // admin-only Settings → Activity Log feed with cross-domain content.
  const [activityLog] = useState<ActivityLogEntry[]>(() => [
    {
      id: 'act_1',
      actorUid: 'test-user-id',
      actorName: 'Test User',
      domain: 'money',
      action: 'bill_paid',
      summary: 'Test User paid Internet ($65)',
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
    {
      id: 'act_2',
      actorUid: 'kid_leo',
      actorName: 'Leo',
      domain: 'habit',
      action: 'habit_completed',
      summary: 'Leo completed Make your bed',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'act_3',
      actorUid: 'test-user-id',
      actorName: 'Test User',
      domain: 'habit',
      action: 'habit_completed',
      summary: 'Test User completed Exercise 30min',
      timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    },
  ]);
  // F-DASH-11 — seeded with one entry so the thumbs up/down feedback UI is
  // walkable in Test Mode; rateInsight below mutates it in-memory like the
  // real household context.
  const [insightsHistory, setInsightsHistory] = useState<Insight[]>([{
    id: 'mock-insight-1',
    text: 'Test Mode: This is mock data for AI testing',
    generatedAt: new Date().toISOString(),
    type: 'general',
  }]);
  const [insight] = useState("Test Mode: This is mock data for AI testing");
  // F-XCUT-03: unified trash mirror (in-memory parity for the real listener).
  const [trashedItems, setTrashedItems] = useState<TrashedItem[]>([]);
  const [stores, setStores] = useState<Store[]>(SEED_STORES);
  const [groceryCategories, setGroceryCategories] = useState<string[]>([]);
  // Sample custom habit categories so Test Mode demonstrates the reusable-chip
  // behavior in the habit form (merged after the UI-only defaults).
  const [habitCategories, setHabitCategories] = useState<string[]>(['Fitness', 'Learning']);
  // F-TODO-16: a small seeded to-do vocabulary so the category chips, the
  // 'Category' sort mode, and the grouped headers are walkable in Test Mode.
  const [todoCategories, setTodoCategories] = useState<string[]>(['Home', 'Errands']);
  const [quickStockLists, setQuickStockLists] = useState<QuickStockList[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [currency, setCurrency] = useState<string>('USD');
  const [kidModePinHash, setKidModePinHash] = useState<string | undefined>(undefined);
  // Plan 090 — module visibility starts empty (fail-open => all-on), mirroring a
  // legacy household. Toggling a module mutates this in-memory map so the dynamic
  // footer / route guards / Lists-tab fallback are all walkable in Test Mode.
  // Typed as ModuleVisibilityMap so the legacy 'plan' read-alias (2F.1) is
  // representable here exactly as it is on a real household doc.
  const [moduleVisibility, setModuleVisibilityState] = useState<ModuleVisibilityMap>({});
  // captureReview (F-CAPTURE-01 foundation) — starts empty, mirroring a legacy
  // household (absent map falls back to the per-type defaults in
  // utils/captureReview.ts). Overriding a type mutates this in-memory map so
  // the settings UI is walkable in Test Mode.
  const [captureReview, setCaptureReviewState] = useState<Partial<Record<CaptureType, CaptureReviewMode>>>({});
  // F-MEALS-03 — standing household dietary profile, undefined until set (mirrors
  // a legacy household with no restrictions recorded).
  const [dietaryProfile, setDietaryProfileState] = useState<DietaryProfile | undefined>(undefined);
  // F-MEALS-04 — habit auto-credited when a meal-plan item is marked cooked.
  const [mealCookedHabitId, setMealCookedHabitIdState] = useState<string | undefined>(undefined);
  // Per-member habit points (stage 6) — both household settings start ABSENT,
  // mirroring a legacy household: `resolveFreezeMode`/`resolveCeremonyTone` then
  // report 'shared'/'household_first', which is exactly what shipped before, so
  // Test Mode reproduces the inert default before anything is picked.
  const [freezeMode, setFreezeModeState] = useState<FreezeMode | undefined>(undefined);
  const [ceremonyTone, setCeremonyToneState] = useState<CeremonyTone | undefined>(undefined);
  // Per-member freeze banks, only touched while freezeMode === 'per_member'.
  const [freezeBanksByMember, setFreezeBanksByMember] = useState<Record<string, FreezeBank>>({});
  // F-MONEY-14 — merchant rules are STATE (not the frozen MOCK_MERCHANT_RULES
  // constant) so the Settings editor's add/edit/delete round-trip is walkable in
  // Test Mode and the display-time renaming visibly follows it.
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>(MOCK_MERCHANT_RULES);

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

  const archiveAccount = useCallback(async (id: string) => {
    setAccounts(prev => prev.map(a => (a.id === id ? { ...a, archived: true } : a)));
    toast.success('Mock: Account archived');
  }, []);

  const unarchiveAccount = useCallback(async (id: string) => {
    setAccounts(prev => prev.map(a => (a.id === id ? { ...a, archived: false } : a)));
    toast.success('Mock: Account unarchived');
  }, []);

  // Savings goal operations (Plan 24) — v1 manual contributions only, mirrors
  // savingsGoalMutations.ts's cents-safe math and completedAt transition.
  const addSavingsGoal = useCallback(async (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'completedAt'>) => {
    const newGoal: SavingsGoal = {
      ...goal,
      id: generateId(),
      savedAmount: roundMoney(goal.savedAmount),
      targetAmount: roundMoney(goal.targetAmount),
      createdAt: new Date().toISOString(),
    };
    setSavingsGoals(prev => [...prev, newGoal]);
    toast.success('Mock: Savings goal created');
  }, []);

  const updateSavingsGoal = useCallback(async (id: string, updates: Partial<Pick<SavingsGoal, 'name' | 'targetAmount' | 'dueDate' | 'ownerId' | 'color'>>) => {
    setSavingsGoals(prev => prev.map(g => g.id === id
      ? { ...g, ...updates, ...(typeof updates.targetAmount === 'number' ? { targetAmount: roundMoney(updates.targetAmount) } : {}) }
      : g));
    toast.success('Mock: Savings goal updated');
  }, []);

  const deleteSavingsGoal = useCallback(async (id: string) => {
    setSavingsGoals(prev => prev.filter(g => g.id !== id));
    toast.success('Mock: Savings goal deleted');
  }, []);

  const contributeToGoal = useCallback(async (id: string, amount: number) => {
    const rounded = roundMoney(amount);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      toast.error('Enter an amount greater than zero to contribute.');
      return;
    }
    setSavingsGoals(prev => prev.map(g => {
      if (g.id !== id) return g;
      const newSaved = roundMoney(g.savedAmount + rounded);
      return {
        ...g,
        savedAmount: newSaved,
        ...(!g.completedAt && newSaved >= g.targetAmount ? { completedAt: new Date().toISOString() } : {}),
      };
    }));
    toast.success('Mock: Contribution added');
  }, []);

  const deleteHousehold = useCallback(async () => {
    toast.success('Mock: Household deleted');
  }, []);

  const completeOnboarding = useCallback(async () => {
    toast.success('Mock: Onboarding complete');
  }, []);

  const setHouseholdCurrency = useCallback(async (newCurrency: string) => {
    setCurrency(newCurrency);
    toast.success('Mock: Currency updated');
  }, []);

  const setModuleVisibility = useCallback(async (key: ModuleKey, value: boolean) => {
    setModuleVisibilityState(prev => ({ ...prev, [key]: value }));
    toast.success(`Mock: ${key} ${value ? 'enabled' : 'disabled'}`);
  }, []);

  const setCaptureReviewMode = useCallback(async (type: CaptureType, mode: CaptureReviewMode) => {
    setCaptureReviewState(prev => ({ ...prev, [type]: mode }));
    toast.success(`Mock: ${type} captures set to ${mode}`);
  }, []);

  const setDietaryProfile = useCallback(async (profile: DietaryProfile) => {
    setDietaryProfileState(profile);
    toast.success('Mock: Dietary profile updated');
  }, []);

  // Per-member habit points (stage 6) — the two household admin settings.
  const setFreezeMode = useCallback(async (mode: FreezeMode) => {
    setFreezeModeState(mode);
    toast.success(`Mock: freeze mode set to ${mode}`);
  }, []);

  const setCeremonyTone = useCallback(async (tone: CeremonyTone) => {
    setCeremonyToneState(tone);
    toast.success(`Mock: wrap-up tone set to ${tone}`);
  }, []);

  const updateModuleVisibility = useCallback(async (patch: Partial<Record<ModuleKey, boolean>>) => {
    setModuleVisibilityState(prev => ({ ...prev, ...patch }));
    toast.success('Mock: modules updated');
  }, []);

  const setKidModePin = useCallback(async (pin: string | null) => {
    if (pin === null) {
      setKidModePinHash(undefined);
      toast.success('Mock: Kid Mode PIN removed');
      return;
    }
    // Hash for real so the Test-Mode exit-PIN flow verifies like production.
    setKidModePinHash(await hashKidPin(pin));
    toast.success('Mock: Kid Mode PIN set');
  }, []);

  const setMealCookedHabitId = useCallback(async (habitId: string | null) => {
    setMealCookedHabitIdState(habitId ?? undefined);
    toast.success(habitId ? 'Mock: Cook habit linked' : 'Mock: Cook habit unlinked');
  }, []);

  // F-MONEY-14 merchant rules. In-memory twins of
  // contexts/household/mutations/merchantRuleMutations.ts: same validation, same
  // cap, the same rebuild-don't-merge semantics (so clearing a field in Test
  // Mode really clears it), and the same "toast then THROW" contract on every
  // failure so an editor form behaves identically here and in production.
  const addMerchantRule = useCallback(async (draft: MerchantRuleDraft) => {
    if (!draft.pattern.trim()) {
      toast.error('Enter some descriptor text for this rule to match.');
      throw new Error('blank-pattern');
    }
    if (merchantRules.length >= MAX_MERCHANT_RULES) {
      toast.error(`You've reached the limit of ${MAX_MERCHANT_RULES} merchant rules. Delete one to add another.`);
      throw new Error('rule-cap-reached');
    }
    const rule: MerchantRule = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      ...buildMerchantRuleFields(draft),
    };
    setMerchantRules(prev => [...prev, rule]);
    toast.success('Mock: Merchant rule saved');
  }, [merchantRules.length]);

  const updateMerchantRule = useCallback(async (id: string, draft: MerchantRuleDraft) => {
    if (!draft.pattern.trim()) {
      toast.error('Enter some descriptor text for this rule to match.');
      throw new Error('blank-pattern');
    }
    if (!merchantRules.some(rule => rule.id === id)) {
      toast.error('That merchant rule no longer exists.');
      throw new Error('missing-rule');
    }
    setMerchantRules(prev => prev.map(rule => (
      rule.id === id
        // Rebuilt from id/createdAt + the draft (bookkeeping carried across), so
        // an emptied field is genuinely dropped rather than spread-merged back.
        ? {
            id: rule.id,
            createdAt: rule.createdAt,
            ...buildMerchantRuleFields(draft),
            ...(rule.lastMatchedAt !== undefined ? { lastMatchedAt: rule.lastMatchedAt } : {}),
            ...(rule.matchCount !== undefined ? { matchCount: rule.matchCount } : {}),
          }
        : rule
    )));
    toast.success('Mock: Merchant rule updated');
  }, [merchantRules]);

  const deleteMerchantRule = useCallback(async (id: string) => {
    setMerchantRules(prev => prev.filter(rule => rule.id !== id));
    toast.success('Mock: Merchant rule deleted');
  }, []);

  const updateAccountBalance = useCallback(async (id: string, newBalance: number) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, balance: newBalance, lastUpdated: new Date().toISOString() } : a));
    toast.success('Mock: Balance updated');
  }, []);

  // Pay-period ceremony save (bucket budgets + account balance true-ups) —
  // functional so the ceremony's combined Save is walkable in Test Mode.
  // Mirrors the Firestore batch rules: limits must be finite and >= 0,
  // balances only finite (negative = overdrawn is allowed), and balance
  // updates stamp lastUpdated like updateAccountBalance.
  const saveCeremonyChanges = useCallback(async (updates: {
    bucketLimits: { id: string; limit: number }[];
    accountBalances: { id: string; balance: number }[];
  }) => {
    setBuckets(prev => prev.map(b => {
      const update = updates.bucketLimits.find(u => u.id === b.id);
      return update && Number.isFinite(update.limit) && update.limit >= 0
        ? { ...b, limit: roundMoney(update.limit) }
        : b;
    }));
    setAccounts(prev => prev.map(a => {
      const update = updates.accountBalances.find(u => u.id === a.id);
      return update && Number.isFinite(update.balance)
        ? { ...a, balance: roundMoney(update.balance), lastUpdated: new Date().toISOString() }
        : a;
    }));
    toast.success('Mock: Changes saved');
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

  // Pay-period ceremony save — functional so "Save budgets" is walkable in
  // Test Mode (limits are decimal dollars; roundMoney only, never cents).
  const setBucketLimits = useCallback(async (updates: { id: string; limit: number }[]) => {
    setBuckets(prev => prev.map(b => {
      const update = updates.find(u => u.id === b.id);
      return update && Number.isFinite(update.limit) && update.limit >= 0
        ? { ...b, limit: roundMoney(update.limit) }
        : b;
    }));
    toast.success('Mock: Bucket budgets set');
  }, []);

  const deleteBucket = useCallback(async (id: string) => {
    setBuckets(prev => prev.filter(b => b.id !== id));
    toast.success('Mock: Bucket deleted');
  }, []);

  // Bucket-to-bucket limit transfer with the real context's validations
  // (distinct buckets, positive amount, bounded by the source's limit) so the
  // "Fix Overspending" drawer is fully walkable in Test Mode and totals
  // conserve across the two limits.
  const reallocateBucket = useCallback(async (sourceId: string, targetId: string, amount: number) => {
    const sourceBucket = buckets.find(b => b.id === sourceId);
    const targetBucket = buckets.find(b => b.id === targetId);
    if (!sourceBucket || !targetBucket) return;
    const roundedAmount = roundMoney(amount);
    if (sourceId === targetId) {
      toast.error('Pick two different buckets to move funds between.');
      return;
    }
    if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
      toast.error('Enter an amount greater than zero to reallocate.');
      return;
    }
    if (Math.round(roundedAmount * 100) > Math.round(sourceBucket.limit * 100)) {
      toast.error(`${sourceBucket.name} doesn't have that much to reallocate.`);
      return;
    }
    setBuckets(prev => prev.map(b => {
      if (b.id === sourceId) return { ...b, limit: roundMoney(b.limit - roundedAmount) };
      if (b.id === targetId) return { ...b, limit: roundMoney(b.limit + roundedAmount) };
      return b;
    }));
    toast.success('Funds reallocated');
  }, [buckets]);

  // Transaction operations
  const addTransaction = useCallback(async (tx: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>) => {
    // Assign the mock pay period (the real context derives one via
    // getPayPeriodForTransaction) so pending spend / bucket progress see the tx.
    const newTx = { ...tx, id: generateId(), payPeriodId: MOCK_PAY_PERIOD_ID } as Transaction;
    // Verified-only, account-routed balance parity with the real context: a
    // transaction created `verified` moves its tagged account's balance
    // (falling back to checking); a `pending_review` capture moves nothing —
    // it reaches Safe-to-Spend only via the calculator's pendingSpend term.
    // Computed OUTSIDE the setState updaters (StrictMode double-invokes them).
    const target = resolveTargetAccount(newTx.accountId, accounts);
    const balanceDelta = effectiveAccountImpact(
      { amount: newTx.amount, category: newTx.category, creditPayment: newTx.creditPayment, status: newTx.status },
      target
    );
    // Credit-card payment as a transfer (parity with makeAddTransaction): a
    // VERIFIED payment on a credit account that names a non-credit funding
    // account also debits that account by the payment amount.
    const fundingTarget =
      newTx.creditPayment === true &&
      target?.type === 'credit' &&
      newTx.status === 'verified' &&
      newTx.fundingAccountId
        ? accounts.find(a => a.id === newTx.fundingAccountId && a.type !== 'credit' && a.id !== target.id)
        : undefined;
    setTransactions(prev => [...prev, newTx]);
    if ((balanceDelta !== 0 && target) || fundingTarget) {
      setAccounts(prev => prev.map(a => {
        let delta = 0;
        if (target && a.id === target.id) delta += balanceDelta;
        if (fundingTarget && a.id === fundingTarget.id) delta -= newTx.amount;
        return delta !== 0
          ? { ...a, balance: roundMoney(a.balance + delta), lastUpdated: new Date().toISOString() }
          : a;
      }));
    }
    toast.success('Mock: Transaction added');
  }, [accounts]);

  // F-DASH-04 parity: add several transactions (e.g. a receipt split into
  // category transactions) with their combined verified-only balance effects.
  const addTransactions = useCallback(async (
    txs: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[],
  ) => {
    if (txs.length === 0) return;
    const newTxs = txs.map(tx => ({ ...tx, id: generateId(), payPeriodId: MOCK_PAY_PERIOD_ID } as Transaction));
    // Accumulate per-account balance deltas (verified-only, account-routed),
    // computed OUTSIDE the setState updaters (StrictMode double-invokes them).
    const deltas = new Map<string, number>();
    for (const tx of newTxs) {
      const target = resolveTargetAccount(tx.accountId, accounts);
      const delta = effectiveAccountImpact(
        { amount: tx.amount, category: tx.category, creditPayment: tx.creditPayment, status: tx.status },
        target,
      );
      if (delta !== 0 && target) deltas.set(target.id, (deltas.get(target.id) ?? 0) + delta);
    }
    setTransactions(prev => [...prev, ...newTxs]);
    if (deltas.size > 0) {
      setAccounts(prev => prev.map(a => deltas.has(a.id)
        ? { ...a, balance: roundMoney(a.balance + (deltas.get(a.id) ?? 0)), lastUpdated: new Date().toISOString() }
        : a));
    }
    toast.success(`Mock: ${newTxs.length} transaction(s) added`);
  }, [accounts]);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {
    // Settled-bill guard parity (utils/settledBillGuard.ts): re-pricing or
    // re-tagging a row that settled a bill would desync it from the calendar doc
    // it marked paid. Metadata-only edits stay allowed.
    const existing = transactions.find(t => t.id === id);
    if (existing && touchesSettledBillFields(updates, existing)) {
      const settledBill = findSettledBill(existing, calendarItems);
      if (settledBill) {
        toast.error(settledBillRefusal('edit', settledBill.title));
        return;
      }
    }
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    toast.success('Mock: Transaction updated');
  }, [transactions, calendarItems]);

  // Test-Mode parity for the verify action: mark the transaction verified under
  // `category`, optionally (re)tag the account, and co-apply the same inline
  // `overrides` (amount/merchant/date + clearing the needsAmount stub flag) the
  // real context accepts. On the pending → verified transition the account
  // balance moves (verified-only model), with `overrides.amount` driving the
  // delta so a $0 stub debits the entered amount exactly once. Related habits
  // get a simple count bump (mirrors the mock's toggleHabit).
  const updateTransactionCategory = useCallback(async (
    id: string,
    category: string,
    relatedHabitIds?: string[],
    accountId?: string | null,
    overrides?: { amount?: number; merchant?: string; date?: string; notes?: string; clearNeedsAmount?: boolean; creditPayment?: boolean; isRecurring?: boolean },
  ) => {
    const clearAccount = accountId === null;
    // Balance parity (computed OUTSIDE the setState updaters — StrictMode
    // double-invokes them): only the pending_review → verified transition
    // applies an impact; the pending row never touched any balance.
    const existing = transactions.find(t => t.id === id);
    if (existing && existing.status === 'pending_review') {
      const effectiveAccountId = clearAccount ? undefined : (accountId ?? existing.accountId);
      const target = resolveTargetAccount(effectiveAccountId, accounts);
      const balanceDelta = accountImpactOf(
        { amount: overrides?.amount ?? existing.amount, category, creditPayment: overrides?.creditPayment ?? existing.creditPayment },
        target
      );
      if (balanceDelta !== 0 && target) {
        setAccounts(prev => prev.map(a => a.id === target.id
          ? { ...a, balance: roundMoney(a.balance + balanceDelta), lastUpdated: new Date().toISOString() }
          : a));
      }
    }
    // Habit Automations (PRD #1065): dedup the fire set — a transaction fires a
    // given habit at most once (parity with makeUpdateTransactionCategory).
    const { toFire: habitIdsToFire, nextFired } = selectHabitsToFire(
      relatedHabitIds ?? [],
      existing?.firedHabitIds ?? [],
    );
    setTransactions(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next: Transaction = {
        ...t,
        category,
        status: 'verified' as const,
        relatedHabitIds: relatedHabitIds ?? [],
        ...(habitIdsToFire.length > 0 ? { firedHabitIds: nextFired } : {}),
        ...(accountId ? { accountId } : {}),
        ...(overrides?.amount !== undefined ? { amount: overrides.amount } : {}),
        ...(overrides?.merchant !== undefined ? { merchant: overrides.merchant } : {}),
        ...(overrides?.date ? { date: overrides.date } : {}),
        ...(overrides?.clearNeedsAmount ? { needsAmount: false } : {}),
        ...(overrides?.isRecurring ? { isRecurring: true } : {}),
      };
      // `null` explicitly clears a previously-tagged account.
      if (clearAccount) delete next.accountId;
      // Notes parity: persist-only-when-non-empty — '' clears stored notes.
      if (overrides?.notes !== undefined) {
        if (overrides.notes.trim()) next.notes = overrides.notes.trim();
        else delete next.notes;
      }
      // Persist-only-when-true parity with the Firestore mutation: an explicit
      // false override removes a stored Charge/Payment flag.
      if (overrides?.creditPayment !== undefined) {
        if (overrides.creditPayment) next.creditPayment = true;
        else delete next.creditPayment;
      }
      return next;
    }));
    if (habitIdsToFire.length > 0) {
      // PRD #1065 parity with makeUpdateTransactionCategory: the fire is
      // BACK-DATED to the transaction's date, not to today — a habit logged from
      // an overnight-synced charge belongs to the day the money moved. Archived
      // habits and out-of-window dates return null and never fire.
      const fireDate = overrides?.date ?? existing?.date ?? getLocalDateString();
      const today = getLocalDateString();
      let pointsChange = 0;
      setHabits(prev => prev.map(h => {
        if (!habitIdsToFire.includes(h.id)) return h;
        const fire = computeBackdatedHabitFire(h, fireDate, today);
        if (!fire) return h;
        pointsChange += fire.pointsDelta.total;
        return {
          ...h,
          count: fire.resetCount ? fire.count : h.count + fire.countDelta,
          totalCount: h.totalCount + fire.totalCountDelta,
          ...(fire.addedDate ? { completedDates: [...h.completedDates, fire.addedDate] } : {}),
          ...(fire.unfrozenDate
            ? { frozenDates: (h.frozenDates ?? []).filter(d => d !== fire.unfrozenDate) }
            : {}),
          streakDays: fire.streakDays,
          hasSubmissionTracking: true,
          lastUpdated: new Date().toISOString(),
        };
      }));
      // Only the lifetime total is mirrored here: pointsDelta.total is the
      // bucket a back-dated fire always credits, while daily/weekly are gated by
      // date and would be 0 for the common overnight-sync case anyway.
      if (pointsChange !== 0) setTotalPoints(prev => prev + pointsChange);
    }
    toast.success('Mock: Verified & Categorized!');
  }, [transactions, accounts]);

  // Habit Automations (PRD #1065): mock parity for the atomic undo. Reverses the
  // transaction to pending_review, restores prior category/account/relatedHabitIds,
  // clears the fired ledger, and decrements each fired habit.
  const reverseTransactionApproval = useCallback(async (
    id: string,
    prior: { category: string; accountId?: string; relatedHabitIds?: string[] },
    firedHabitIds: string[],
  ) => {
    // Settled-bill guard parity (utils/settledBillGuard.ts): this undo knows
    // nothing about bills, so reversing a row that settled one would credit the
    // balance back while the calendar doc stays paid and orphaned.
    const existing = transactions.find(t => t.id === id);
    const settledBill = existing ? findSettledBill(existing, calendarItems) : undefined;
    if (settledBill) {
      toast.error(settledBillRefusal('undo', settledBill.title));
      return;
    }
    setTransactions(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next: Transaction = {
        ...t,
        status: 'pending_review' as const,
        category: prior.category,
        relatedHabitIds: prior.relatedHabitIds ?? [],
      };
      delete next.firedHabitIds;
      if (prior.accountId) next.accountId = prior.accountId;
      else delete next.accountId;
      return next;
    }));
    if (firedHabitIds.length > 0) {
      setHabits(prev => prev.map(h => firedHabitIds.includes(h.id)
        ? { ...h, count: Math.max(0, h.count - 1), totalCount: Math.max(0, h.totalCount - 1) }
        : h));
    }
  }, [transactions, calendarItems]);

  // F-XCUT-03: push a soft-deleted record into the in-memory trash mirror so
  // Test Mode exercises the same restore/purge flow as the real listener.
  // (Declared before the earliest deleter that uses it — deleteTransaction.)
  const pushToTrash = useCallback((domain: TrashDomain, item: { id: string } & Record<string, unknown>) => {
    setTrashedItems(prev => [
      {
        id: trashDocId(domain, item.id),
        domain,
        originalId: item.id,
        data: { ...item },
        deletedAt: new Date().toISOString(),
        deletedBy: 'test-user-id',
      },
      ...prev.filter(t => t.id !== trashDocId(domain, item.id)),
    ]);
  }, []);

  const deleteTransaction = useCallback(async (id: string) => {
    // Settled-bill guard parity (utils/settledBillGuard.ts): deleting a row that
    // paid a bill would leave the calendar doc marked paid and orphaned.
    const existing = transactions.find(t => t.id === id);
    const settledBill = existing ? findSettledBill(existing, calendarItems) : undefined;
    if (settledBill) {
      toast.error(settledBillRefusal('delete', settledBill.title));
      return;
    }
    setTransactions(prev => {
      const target = prev.find(t => t.id === id);
      // F-XCUT-03 parity: deleted transactions land in Recently Deleted too.
      if (target) pushToTrash('transaction', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(t => t.id !== id);
    });
    toast.success('Mock: Transaction deleted');
  }, [pushToTrash, transactions, calendarItems]);

  // Test-Mode parity for the Merge action (plan 03 PR-3): applies the same
  // field-level winner set as the real context, deletes the dupe, and
  // reverses the dupe's balance impact if it was verified — mirroring the
  // REAL `mergeTransactions`' balance-reversal rule (transactionMutations.ts).
  // NOT a mirror of the mock `deleteTransaction` above, which never reverses
  // a balance at all (see the parity note near its real-context counterpart
  // further down this file).
  const mergeTransactions = useCallback(async (keeperId: string, dupeId: string) => {
    const keeperTx = transactions.find(t => t.id === keeperId);
    const dupeTx = transactions.find(t => t.id === dupeId);
    if (!keeperTx || !dupeTx) {
      // Match the real context: throw so callers' catch paths run instead of
      // treating the merge as a success.
      toast.error('Transaction not found');
      throw new Error('Transaction not found');
    }

    // Settled-bill guard parity (utils/settledBillGuard.ts): the DUPE is deleted
    // by this merge, so a dupe that settled a bill orphans the paid calendar doc.
    const dupeSettledBill = findSettledBill(dupeTx, calendarItems);
    if (dupeSettledBill) {
      toast.error(settledBillRefusal('merge away', dupeSettledBill.title));
      return;
    }

    const updates = buildMergeUpdates(keeperTx, dupeTx);

    // Bank-sync exception (parity with the real mergeTransactions): a bank-sync
    // dupe's balance came from the bank email's ending balance, so deleting it
    // reverses nothing.
    const dupeTarget = resolveTargetAccount(dupeTx.accountId, accounts);
    const dupeBalanceDelta = isBankSyncTransaction(dupeTx)
      ? 0
      : -effectiveAccountImpact(dupeTx, dupeTarget);
    if (dupeBalanceDelta !== 0 && dupeTarget) {
      setAccounts(prev => prev.map(a => a.id === dupeTarget.id
        ? { ...a, balance: roundMoney(a.balance + dupeBalanceDelta), lastUpdated: new Date().toISOString() }
        : a));
    }

    setTransactions(prev => {
      const withoutDupe = prev.filter(t => t.id !== dupeId);
      return withoutDupe.map(t => {
        if (t.id !== keeperId) return t;
        const merged: Transaction = { ...t, ...updates };
        delete merged.possibleDuplicateOf;
        return merged;
      });
    });

    track('duplicate_merged', { source: dupeTx.source });
    toast.success('Mock: Transactions merged');
  }, [transactions, accounts, calendarItems]);

  const keepBothTransactions = useCallback(async (txnId: string) => {
    setTransactions(prev => prev.map(t => {
      if (t.id !== txnId) return t;
      const next = { ...t };
      delete next.possibleDuplicateOf;
      return next;
    }));
    track('duplicate_kept_both');
  }, []);

  const splitTransaction = useCallback(async (originalTransactionId: string, newTransactions: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'>[]) => {
    // Settled-bill guard parity (utils/settledBillGuard.ts): a split DELETES the
    // original, orphaning the calendar doc it settled.
    const original = transactions.find(t => t.id === originalTransactionId);
    const settledBill = original ? findSettledBill(original, calendarItems) : undefined;
    if (settledBill) {
      toast.error(settledBillRefusal('split', settledBill.title));
      return;
    }
    setTransactions(prev => {
      // Filter out original transaction
      const filtered = prev.filter(t => t.id !== originalTransactionId);

      // Create full Transaction objects for new splits
      const newTxs = newTransactions.map(t => ({
        ...t,
        id: generateId(),
        createdAt: new Date().toISOString(),
        payPeriodId: MOCK_PAY_PERIOD_ID,
        createdBy: 'test-user-id',
      } as Transaction));

      return [...filtered, ...newTxs];
    });
    toast.success('Mock: Transaction split');
  }, [transactions, calendarItems]);

  const setTransactionSplit = useCallback(async (transactionId: string, split: SplitParticipant[] | null) => {
    setTransactions(prev => prev.map(t => {
      if (t.id !== transactionId) return t;
      const cleaned = (split ?? []).filter(p => p.shareAmount > 0);
      const next = { ...t };
      if (cleaned.length > 0) {
        next.splitWith = cleaned;
      } else {
        delete next.splitWith;
      }
      return next;
    }));
    toast.success('Mock: Split saved');
  }, []);

  const markSplitSettled = useCallback(async (transactionId: string, participantKey: string, settled: boolean = true) => {
    setTransactions(prev => prev.map(t => {
      if (t.id !== transactionId || !t.splitWith) return t;
      return {
        ...t,
        splitWith: t.splitWith.map(p =>
          splitParticipantKey(p) === participantKey ? { ...p, settled } : p,
        ),
      };
    }));
  }, []);

  // Plan 23 — transaction comments (Test-Mode parity, in-memory). Unlike prod
  // (where the comments subcollection has no firestore.rules entry yet), Test
  // Mode never touches Firestore, so these work fully today — the orchestrator
  // can visually verify the whole feature without the rules PR.
  const getTransactionComments = useCallback(async (transactionId: string): Promise<TransactionComment[]> => {
    return transactionComments[transactionId] ?? [];
  }, [transactionComments]);

  const addTransactionComment = useCallback(async (transactionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Comment cannot be empty');
      return;
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      toast.error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
      return;
    }
    const comment: TransactionComment = {
      id: generateId(),
      authorUid: 'test-user-id',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setTransactionComments(prev => ({
      ...prev,
      [transactionId]: [...(prev[transactionId] ?? []), comment],
    }));
    setTransactions(prev => prev.map(t => t.id === transactionId
      ? { ...t, commentCount: (t.commentCount ?? 0) + 1 }
      : t));
  }, []);

  const deleteTransactionComment = useCallback(async (transactionId: string, commentId: string) => {
    setTransactionComments(prev => ({
      ...prev,
      [transactionId]: (prev[transactionId] ?? []).filter(c => c.id !== commentId),
    }));
    setTransactions(prev => prev.map(t => t.id === transactionId
      ? { ...t, commentCount: Math.max(0, (t.commentCount ?? 0) - 1) }
      : t));
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
    // Merge rather than wholesale-replace, mirroring the real Firestore
    // updateDoc path (which only touches the fields it's explicitly given):
    // spreading the incoming `habit` OVER the existing doc preserves any
    // field the caller's payload omits entirely (e.g. HabitFormModal editing
    // basePoints doesn't carry `triggers` at all) while still honoring an
    // explicit overwrite/clear for any key the caller DID include (even with
    // value `undefined`, since object spread only overwrites keys actually
    // present on the source object).
    setHabits(prev => prev.map(h => (h.id === habit.id ? { ...h, ...habit } : h)));
    toast.success('Mock: Habit updated');
  }, []);

  // Plan 080e — mock the family-challenge creation path so the dormant "New
  // family challenge" form is walkable in Test Mode. Mirrors the real
  // addChallenge: a new active challenge, decoupled from yearly goals.
  const addChallenge = useCallback(async (input: {
    title: string;
    description?: string;
    relatedHabitIds: string[];
    targetValue?: number;
    month?: string;
  }) => {
    const newChallenge: Challenge = {
      id: generateId(),
      month: input.month ?? getLocalDateString().slice(0, 7),
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      relatedHabitIds: input.relatedHabitIds,
      targetType: 'count',
      targetValue: input.targetValue,
      status: 'active',
      isFamilyChallenge: true,
      yearlyRewardLabel: 'Family goal',
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
    };
    setChallenges(prev => [...prev, newChallenge]);
    toast.success('Mock: Family challenge created');
  }, []);

  const deleteHabit = useCallback(async (id: string) => {
    setHabits(prev => {
      const target = prev.find(h => h.id === id);
      if (target) pushToTrash('habit', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(h => h.id !== id);
    });
    toast.success('Mock: Habit deleted');
  }, [pushToTrash]);

  // F-HABITS-01: mock pause/resume so the "Pause until" field and paused badge
  // are walkable in Test Mode. Passing null strips pausedUntil (resume).
  const setHabitPause = useCallback(async (id: string, pausedUntil: string | null) => {
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      if (pausedUntil) return { ...h, pausedUntil };
      const { pausedUntil: _dropped, ...rest } = h;
      return rest;
    }));
    toast.success(pausedUntil ? 'Mock: Habit paused' : 'Mock: Habit resumed');
  }, []);

  const archiveHabit = useCallback(async (id: string) => {
    setHabits(prev => prev.map(h => h.id === id ? { ...h, archivedAt: getLocalDateString() } : h));
    toast.success('Mock: Habit archived');
  }, []);

  const unarchiveHabit = useCallback(async (id: string) => {
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const { archivedAt: _archivedAt, ...rest } = h;
      return rest;
    }));
    toast.success('Mock: Habit restored');
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

  // Credit (or debit, negative delta) the HOUSEHOLD pool: the redeemable
  // lifetime total plus — by this mock's deliberate conflation, which Stage 2
  // untangles — the test user's own three point windows. The same three-window
  // update the real context's habit writeBatch applies to household points.
  const creditHouseholdPool = useCallback((
    delta: { daily: number; weekly: number; total: number },
  ) => {
    if (delta.daily === 0 && delta.weekly === 0 && delta.total === 0) return;
    setMembers(prev => prev.map(m => m.uid === MOCK_USER_UID
      ? { ...m, points: {
          daily: m.points.daily + delta.daily,
          weekly: m.points.weekly + delta.weekly,
          total: m.points.total + delta.total,
        } }
      : m));
    setTotalPoints(prev => prev + delta.total);
  }, []);

  /**
   * Per-member points (stage 1): move ONE member's own score, without touching
   * the household pool — the member half of the two-layer model. Buckets are
   * pre-gated by the caller (a back-dated credit moves total only).
   */
  const creditMemberPoints = useCallback((
    memberId: string,
    delta: { daily: number; weekly: number; total: number },
  ) => {
    if (delta.daily === 0 && delta.weekly === 0 && delta.total === 0) return;
    setMembers(prev => prev.map(m => m.uid === memberId
      ? { ...m, points: {
          daily: m.points.daily + delta.daily,
          weekly: m.points.weekly + delta.weekly,
          total: m.points.total + delta.total,
        } }
      : m));
  }, []);

  /**
   * Route a habit's POOL points exactly as production's `habitPointsTargets`
   * does (Plan 080c): an ASSIGNED chore credits its assignee's own member doc
   * and the shared household pool receives nothing; a shared habit credits the
   * pool. Test Mode previously sent every habit — assigned chores included — to
   * `creditPoints`, so a kid's chore silently paid the test user and inflated
   * the redeemable pool, which production never does.
   */
  const creditHabitPool = useCallback((
    habit: Pick<Habit, 'assignedTo'>,
    delta: { daily: number; weekly: number; total: number },
  ) => {
    if (habit.assignedTo) creditMemberPoints(habit.assignedTo, delta);
    else creditHouseholdPool(delta);
  }, [creditHouseholdPool, creditMemberPoints]);

  // Habit Automations (PRD #1065): fire (or reverse) the habit a to-do is linked
  // to, mirroring the real fireLinkedHabitInBatch — same pure scoring helper
  // (computeHabitTriggerFire) the interactive toggle uses. Returns the fired
  // habit's title for the attribution toast, or null when nothing fired.
  const fireLinkedHabitMock = useCallback((todo: ToDo, direction: 'up' | 'down'): string | null => {
    const habitId = todo.linkedHabitId;
    if (!habitId) return null;
    const habit = habitsFireRef.current.find(h => h.id === habitId);
    if (!habit) return null;
    // Archived linked habit never fires (parity with fireLinkedHabitInBatch).
    if (direction === 'up' && habit.archivedAt) return null;
    // 'down' reverses the EXACT date the fire added (from the to-do's
    // completedAt), so a prior-day restore doesn't corrupt today's counter.
    const delta =
      direction === 'up'
        ? computeHabitTriggerFire(habit, 'up')
        : computeHabitTriggerReverse(
            habit,
            todo.completedAt
              ? getLocalDateString(new Date(todo.completedAt))
              : getLocalDateString(),
          );
    if (!delta) return null;
    setHabits(prev => prev.map(h => {
      if (h.id !== habitId) return h;
      const completedDates = delta.addedDate
        ? [...h.completedDates.filter(d => d !== delta.addedDate), delta.addedDate]
        : delta.removedDate
          ? h.completedDates.filter(d => d !== delta.removedDate)
          : h.completedDates;
      return {
        ...h,
        count: delta.count,
        totalCount: delta.totalCount,
        completedDates,
        streakDays: delta.streakDays,
        lastUpdated: new Date().toISOString(),
      };
    }));
    creditHabitPool(habit, {
      daily: delta.pointsChange,
      weekly: delta.pointsChange,
      total: delta.pointsChange,
    });
    return habit.title;
  }, [creditHabitPool]);

  // Full scoring parity with the real toggle path: reuse the SAME pure,
  // unit-tested logic (streaks, period-aware multiplier, threshold vs
  // incremental scoring, completedDates upkeep) instead of a bare count bump,
  // so Test Mode's points/streak behavior matches production exactly.
  const toggleHabit = useCallback(async (id: string, direction: 'up' | 'down', source?: TriggerSource) => {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    // Archived-habit guard parity with the real toggle path (useHabitActions):
    // an archived habit never fires forward; a 'down' reverse is still allowed.
    if (direction === 'up' && habit.archivedAt) return;

    const attribution = source ? attributionString(source) : null;

    // Lazy-reset parity with the real toggle path (useHabitActions): a stale
    // habit's counter belongs to a previous period. 'down' undoes that prior
    // period's completion with date-aware point deltas (never today's daily);
    // 'up' proceeds as if the counter were already reset to 0.
    let effectiveHabit = habit;
    if (isHabitStale(habit)) {
      if (direction === 'down') {
        const staleResult = processStaleDownToggle(habit);
        // Per-member points (stage 1) parity: the prior period's completion
        // dates are being erased, so their attribution goes with them — the
        // production stale-down branch clears `completedBy` for exactly those
        // dates in the SAME batch, and leaving them behind here would break the
        // "completedDates and completedBy always agree" invariant in Test Mode.
        const staleReversal = habitFeedsMemberAttribution(habit)
          ? attributionReversalForDates(
              habit, staleResult.datesToRemove, getLocalDateString(), 0,
            )
          : null;
        // Stage 1.5 parity: an attributed stale deselect debits the pool the
        // competition figure those dates carried; a grandfathered one keeps
        // `processStaleDownToggle`'s own date-gated figure.
        const stalePoolDelta: PointsBuckets =
          staleReversal && staleReversal.clearPaths.length > 0
            ? staleReversal.household
            : staleResult.pointsDelta;
        setHabits(prev => prev.map(h => h.id === id
          ? {
              // The reversal owns the scope: on a threshold habit it also
              // clears the period's progress days, which never entered
              // `completedDates` (see attributionReversalForDates).
              ...withDatesUnattributed(h, staleReversal?.clearedDates ?? []),
              count: 0,
              totalCount: staleResult.datesToRemove.length > 0
                ? Math.max(0, h.totalCount - h.count)
                : h.totalCount,
              completedDates: staleResult.completedDates,
              streakDays: staleResult.streakDays,
              lastUpdated: new Date().toISOString(),
            }
          : h));
        // Pool routing parity: an assigned chore reverses on the ASSIGNEE's doc,
        // a shared habit on the household pool (creditHabitPool).
        creditHabitPool(habit, stalePoolDelta);
        // The test user's own score already moved with the pool above (this
        // mock deliberately conflates the two — see the toggle note below), so
        // only OTHER members' reversals are applied here, exactly as resetHabit
        // does.
        for (const [memberId, delta] of staleReversal?.perMember ?? new Map<string, PointsBuckets>()) {
          if (memberId !== MOCK_USER_UID) creditMemberPoints(memberId, delta);
        }
        toast.success('Mock: previous period completion undone');
        return;
      }
      effectiveHabit = { ...habit, count: 0, lastUpdated: new Date().toISOString() };
    }

    const result = processToggleHabit(effectiveHabit, direction);
    if (!result) return; // e.g. decrement below 0

    // Per-member points (stage 1) parity: a tap attributes one unit to the
    // member the completion BELONGS to — the signed-in member, or the ASSIGNEE
    // for an assigned chore (a managed kid never taps for themselves) — or
    // withdraws one on a 'down', so Test Mode carries the same `completedBy`
    // shape production does.
    //
    // NOTE: no SEPARATE member-points credit is applied here, because this mock
    // derives the household `dailyPoints`/`weeklyPoints` as the Σ of adult
    // member scores — `creditHabitPool` below already moves the credited
    // member's own score, and the derived household figure follows (the Σ
    // model, stage 1.5). The credit/un-credit mutations below keep per-member
    // scores separate the same way.
    //
    // 🛡️ Reversal parity with production: a 'down' takes its unit back from
    // whoever STORED attribution records (`resolveReversalSources`), not from
    // whoever `assignedTo` names today — a reassignment between the up-tap and
    // the down-tap would otherwise leave the original credit stranded.
    const toggleDate = getLocalDateString();
    const attributedTo = habit.assignedTo ?? MOCK_USER_UID;
    const attributionMoves: { memberId: string; delta: number }[] =
      direction === 'up'
        ? [{ memberId: attributedTo, delta: 1 }]
        : resolveReversalSources(effectiveHabit, attributedTo, toggleDate, 1)
            .map(source => ({ memberId: source.memberId, delta: -source.units }));
    let habitAfter: Habit = { ...effectiveHabit, ...result.updatedHabit };
    for (const move of attributionMoves) {
      habitAfter = withAttributionDelta(habitAfter, toggleDate, move.memberId, move.delta);
    }
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      let next: Habit = { ...h, ...result.updatedHabit };
      for (const move of attributionMoves) {
        next = withAttributionDelta(next, toggleDate, move.memberId, move.delta);
      }
      return next;
    }));
    // Stage 1.5 parity: a SHARED habit pays the pool `Σ member awards + the
    // unattributed remainder` — the credited member's own streak multiplier,
    // not the habit's. An assigned chore (Plan 080c parity: pays its ASSIGNEE,
    // never the pool) and a grandfathered down-toggle keep `result.pointsChange`.
    const togglePoolDelta =
      attributionMoves.length > 0 && habitFeedsMemberAttribution(habit)
        ? householdPeriodPointsDelta(effectiveHabit, habitAfter, toggleDate, toggleDate)
        : result.pointsChange;
    creditHabitPool(habit, {
      daily: togglePoolDelta,
      weekly: togglePoolDelta,
      total: togglePoolDelta,
    });
    toast.success(
      `Mock: Habit ${direction === 'up' ? 'incremented' : 'decremented'}${attribution ? ` (${attribution})` : ''}`
    );

    // F-HABITS-02 (streak milestone celebrations): mirrors the real
    // toggleHabit's presentation-only milestone toast + reward unlock.
    const nextStreakDays = result.updatedHabit.streakDays ?? habit.streakDays;
    const milestone = direction === 'up'
      ? crossedMilestone(habit.streakDays, nextStreakDays)
      : null;
    if (milestone !== null) {
      toast(`${milestone}-day streak! ${habit.title}`, { icon: toastIcon(PartyPopper, 'text-habit-streak') });
      const newlyUnlocked = rewards.filter(
        (reward) =>
          !unlockedRewardIds.includes(reward.id) &&
          reward.unlockRequirement &&
          rewardMilestoneSatisfied(reward, id, nextStreakDays)
      );
      if (newlyUnlocked.length > 0) {
        setUnlockedRewardIds(prev => [...prev, ...newlyUnlocked.map(r => r.id)]);
        newlyUnlocked.forEach((reward) => {
          toast(`Reward unlocked! ${reward.title}`, { icon: toastIcon(Gift, 'text-warm-600') });
        });
      }
    }
  }, [habits, creditHabitPool, creditMemberPoints, rewards, unlockedRewardIds]);

  // Manual reset (the card's X button): zero the period counter, drop today
  // from completedDates, and reverse today's awarded points — mirroring the
  // real context's atomic habit+points reset.
  const resetHabit = useCallback(async (id: string) => {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = getLocalDateString();
    const pointsToRemove = calculateResetPoints(habit);
    const newCompletedDates = habit.completedDates.filter(d => d !== today);
    // Per-member points (stage 1) parity: a reset clears the day for everyone,
    // so today's attribution goes with the completion date, and each credited
    // member has exactly their own earned points reversed.
    //
    // 🛡️ Gated on `habitFeedsMemberAttribution` exactly as production's
    // resetHabit is: an ASSIGNED chore's points already reverse on the
    // assignee's doc through `creditHabitPool` above, so also applying the
    // per-member reversal would debit them twice.
    // `wholePeriodClearDates` parity: an INCREMENTAL habit with `targetCount > 1`
    // records attribution (and credits points) on every tap while only entering
    // `completedDates` at target, so today alone can leave the period's orphaned
    // attributed days — and the member points hanging off them — behind.
    const reversal = habitFeedsMemberAttribution(habit)
      ? attributionReversalForDates(
          habit, wholePeriodClearDates(habit, [today], today), today, 0,
        )
      : null;
    // Stage 1.5 parity (see production resetHabit): an attributed reset debits
    // the competition figure, a grandfathered one `calculateResetPoints`.
    const resetPoolDelta: PointsBuckets =
      reversal && reversal.clearPaths.length > 0
        ? reversal.household
        : { daily: -pointsToRemove, weekly: -pointsToRemove, total: -pointsToRemove };
    setHabits(prev => prev.map(h => h.id === id
      ? {
          // Threshold habits clear the whole period's attribution, not just
          // today's (see attributionReversalForDates).
          ...(reversal && reversal.clearedDates.length > 0
            ? withDatesUnattributed(h, reversal.clearedDates)
            : h),
          count: 0,
          completedDates: newCompletedDates,
          streakDays: streakForHabit({ period: h.period, completedDates: newCompletedDates, frozenDates: h.frozenDates }),
          lastUpdated: new Date().toISOString(),
        }
      : h));
    // Plan 080c parity: an assigned chore's reset debits the ASSIGNEE, not the
    // shared pool (creditHabitPool).
    creditHabitPool(habit, resetPoolDelta);
    for (const [memberId, delta] of reversal?.perMember ?? new Map<string, PointsBuckets>()) {
      if (memberId !== MOCK_USER_UID) creditMemberPoints(memberId, delta);
    }
    toast.success('Mock: Habit reset');
  }, [habits, creditHabitPool, creditMemberPoints]);

  /**
   * Per-member points (stage 1) parity — credit ONE completion of `habitId` to
   * each of `memberIds`. Mirrors `useHabitActions.creditHabitCompletion`: the
   * habit's counters move one unit per member, each member is credited at their
   * OWN streak multiplier, and the pool delta is a before/after difference of
   * the unchanged household scorer.
   */
  const creditHabitCompletion = useCallback(async (
    habitId: string,
    memberIds: string[],
    date?: string,
  ) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || memberIds.length === 0 || habit.archivedAt) return;

    const today = getLocalDateString();
    const targetDate = date ?? today;
    const isStale = isHabitStale(habit);
    const inLivePeriod =
      habitPeriodStart(habit.period, targetDate) === habitPeriodStart(habit.period, today);
    const liveCount = isStale ? 0 : habit.count;
    const addedUnits = memberIds.length;
    const target = Math.max(habit.targetCount, 1);
    const periodUnits = inLivePeriod
      ? liveCount
      : habit.completedDates
          .filter(d => habitPeriodStart(habit.period, d) === habitPeriodStart(habit.period, targetDate))
          .reduce((sum, d) => sum + attributedUnitsOnDate(habit, d), 0);
    const marksComplete =
      habit.scoringType === 'incremental' || periodUnits + addedUnits >= target;
    const dateNewlyCompleted = marksComplete && !habit.completedDates.includes(targetDate);
    const nextCompletedDates = dateNewlyCompleted
      ? [...habit.completedDates, targetDate]
      : habit.completedDates;

    let after: Habit = {
      ...habit,
      count: inLivePeriod ? liveCount + addedUnits : liveCount,
      totalCount: habit.totalCount + addedUnits,
      completedDates: nextCompletedDates,
      streakDays: streakForHabit({
        period: habit.period,
        completedDates: nextCompletedDates,
        frozenDates: habit.frozenDates,
        pausedUntil: habit.pausedUntil,
      }),
      lastUpdated: new Date().toISOString(),
    };
    for (const memberId of memberIds) {
      after = withAttributionDelta(after, targetDate, memberId, 1);
    }

    const isToday = targetDate === today;
    const gate = (amount: number) => ({
      daily: isToday ? amount : 0,
      weekly: habitPeriodStart('weekly', targetDate) === habitPeriodStart('weekly', today) ? amount : 0,
      total: amount,
    });

    setHabits(prev => prev.map(h => (h.id === habitId ? after : h)));
    // Stage 1.5 parity: a "Both of us" credit pays the pool BOTH member awards.
    const poolDelta = habitFeedsMemberAttribution(habit)
      ? householdPeriodPointsDelta(habit, after, targetDate, today)
      : legacyPeriodPoints(after, targetDate, today) -
        legacyPeriodPoints(habit, targetDate, today);
    if (poolDelta !== 0) setTotalPoints(prev => prev + poolDelta);
    if (habitFeedsMemberAttribution(habit)) {
      for (const memberId of memberIds) {
        creditMemberPoints(
          memberId,
          gate(memberPeriodPointsDelta(habit, after, memberId, targetDate, today)),
        );
      }
    }
    toast.success('Mock: Completion credited');
  }, [habits, creditMemberPoints]);

  /**
   * Per-member points (stage 1) parity — un-credit ONE of `memberId`'s
   * completions. A no-op on an unattributed (pre-feature) completion.
   */
  const uncreditHabitCompletion = useCallback(async (
    habitId: string,
    memberId: string,
    date?: string,
  ) => {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    const today = getLocalDateString();
    const targetDate = date ?? today;
    if (memberCompletionCount(habit, memberId, targetDate) <= 0) return;

    const inLivePeriod =
      habitPeriodStart(habit.period, targetDate) === habitPeriodStart(habit.period, today) &&
      !isHabitStale(habit);
    const target = Math.max(habit.targetCount, 1);
    const stripped = withAttributionDelta(habit, targetDate, memberId, -1);
    const nextCount = inLivePeriod ? Math.max(0, habit.count - 1) : habit.count;
    const stillCompleted = inLivePeriod
      ? habit.scoringType === 'incremental'
        ? nextCount >= 1
        : nextCount >= target
      : attributedUnitsOnDate(stripped, targetDate) > 0;
    const nextCompletedDates =
      habit.completedDates.includes(targetDate) && !stillCompleted
        ? habit.completedDates.filter(d => d !== targetDate)
        : habit.completedDates;

    const after: Habit = {
      ...stripped,
      count: nextCount,
      totalCount: Math.max(0, habit.totalCount - 1),
      completedDates: nextCompletedDates,
      streakDays: streakForHabit({
        period: habit.period,
        completedDates: nextCompletedDates,
        frozenDates: habit.frozenDates,
        pausedUntil: habit.pausedUntil,
      }),
      lastUpdated: new Date().toISOString(),
    };

    const isToday = targetDate === today;
    const gate = (amount: number) => ({
      daily: isToday ? amount : 0,
      weekly: habitPeriodStart('weekly', targetDate) === habitPeriodStart('weekly', today) ? amount : 0,
      total: amount,
    });

    setHabits(prev => prev.map(h => (h.id === habitId ? after : h)));
    // Stage 1.5 parity: the pool loses exactly the member award being reversed.
    const poolDelta = habitFeedsMemberAttribution(habit)
      ? householdPeriodPointsDelta(habit, after, targetDate, today)
      : legacyPeriodPoints(after, targetDate, today) -
        legacyPeriodPoints(habit, targetDate, today);
    if (poolDelta !== 0) setTotalPoints(prev => prev + poolDelta);
    if (habitFeedsMemberAttribution(habit)) {
      creditMemberPoints(
        memberId,
        gate(memberPeriodPointsDelta(habit, after, memberId, targetDate, today)),
      );
    }
    toast.success('Mock: Completion un-credited');
  }, [habits, creditMemberPoints]);

  // Calendar operations
  const addCalendarItem = useCallback(async (item: Omit<CalendarItem, 'id'>) => {
    const newItem = { ...item, id: generateId() } as CalendarItem;
    setCalendarItems(prev => [...prev, newItem]);
    toast.success('Mock: Calendar item added');
  }, []);

  const updateCalendarItem = useCallback(async (item: CalendarItem) => {
    // Mirror Firestore behavior: schedule edits on recurring templates are
    // forward-only (see makeUpdateCalendarItem in calendarMutations.ts).
    setCalendarItems(prev => prev.map(i => {
      if (i.id !== item.id) return i;
      if (item.isRecurring && item.frequency &&
          (!i.isRecurring || i.date !== item.date || i.frequency !== item.frequency)) {
        return { ...item, date: rollRecurringAnchorForward(item.date, item.frequency, getLocalDateString()) };
      }
      return item;
    }));
    toast.success('Mock: Calendar item updated');
  }, []);

  const deleteCalendarItem = useCallback(async (id: string) => {
    setCalendarItems(prev => prev.filter(i => i.id !== id));
    toast.success('Mock: Calendar item deleted');
  }, []);

  // Mirrors makeLinkBankTransactionToBill in calendarMutations.ts — marks the
  // bill paid at the txn's actual amount (NO account-balance write), files the
  // transaction as Budgeted in Calendar, and learns the descriptor alias.
  const linkBankTransactionToBill = useCallback(async (transactionId: string, calendarItemId: string): Promise<boolean> => {
    const tx = transactions.find(t => t.id === transactionId);
    if (!tx || !tx.bankRef || tx.status !== 'verified') return false;
    const descriptor = (tx.merchant || '').trim();
    if (!descriptor) return false;

    const paidAmount = roundMoney(tx.amount);
    const isRecurringInstance = isRecurringId(calendarItemId);

    if (isRecurringInstance) {
      const parsed = parseRecurringId(calendarItemId);
      if (!parsed) return false;
      const { templateId, date: specificDate } = parsed;
      const template = calendarItems.find(i => i.id === templateId);
      if (!template || template.type !== 'expense') return false;
      const alreadyPaid = calendarItems.find(
        i => i.parentRecurringId === templateId && i.date === specificDate && i.isPaid,
      );
      if (alreadyPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }

      const paidInstance: CalendarItem = {
        ...template,
        id: generateId(),
        amount: paidAmount,
        date: specificDate,
        isPaid: true,
        isRecurring: false,
        parentRecurringId: templateId,
      };
      setCalendarItems(prev => [
        ...prev.map(i => i.id === templateId
          ? { ...i, bankDescriptorAliases: [...(i.bankDescriptorAliases ?? []), descriptor] }
          : i),
        paidInstance,
      ]);
    } else {
      const item = calendarItems.find(i => i.id === calendarItemId);
      if (!item || item.type !== 'expense') return false;
      if (item.isPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
      setCalendarItems(prev => prev.map(i => i.id === calendarItemId
        ? { ...i, isPaid: true, amount: paidAmount, bankDescriptorAliases: [...(i.bankDescriptorAliases ?? []), descriptor] }
        : i));
    }

    setTransactions(prev => prev.map(t => t.id === transactionId
      ? { ...t, category: BUDGETED_IN_CALENDAR, needsCategory: undefined }
      : t));
    toast.success('Linked to bill — future syncs will match automatically');
    return true;
  }, [transactions, calendarItems]);

  // Mirrors makeSettleBillWithTransaction in calendarMutations.ts (TODO.md
  // 2H(a)) — "this charge IS that planned bill". Unlike the mock above it DOES
  // move the balance: a pending_review row has not touched any account yet.
  // Creates NO new transaction, and never touches the recurring template's own
  // amount.
  const settleBillWithTransaction = useCallback(async (
    transactionId: string,
    calendarItemId: string,
    accountId?: string,
    amount?: number,
  ): Promise<boolean> => {
    const tx = transactions.find(t => t.id === transactionId);
    if (!tx) return false;
    // Parity guard: a credit cannot pay an expense — filing income as
    // `Budgeted in Calendar` would flip its balance sign.
    if (tx.category === INCOME_CATEGORY) return false;
    if (tx.paidCalendarItemId) {
      toast.error('That transaction is already linked to a bill');
      return false;
    }
    // The caller's LIVE amount wins over the stored one (parity with the real
    // mutation) and is co-committed onto the row below.
    const paidAmount = roundMoney(amount ?? tx.amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      toast.error('Add the real amount before linking this to a bill');
      return false;
    }
    const descriptor = (tx.merchant || '').trim();

    let paidCalendarItemId: string;
    let billTitle: string;

    if (isRecurringId(calendarItemId)) {
      const parsed = parseRecurringId(calendarItemId);
      if (!parsed) return false;
      const { templateId, date: specificDate } = parsed;
      const template = calendarItems.find(i => i.id === templateId);
      if (!template || template.type !== 'expense') return false;
      if (calendarItems.some(i => i.parentRecurringId === templateId && i.date === specificDate && i.isPaid)) {
        toast.error('That bill is already marked paid');
        return false;
      }
      paidCalendarItemId = generateId();
      billTitle = template.title;
      const paidInstance: CalendarItem = {
        ...template,
        id: paidCalendarItemId,
        amount: paidAmount,
        // The OCCURRENCE's due date — expandCalendarItems keys suppression on it.
        date: specificDate,
        isPaid: true,
        isRecurring: false,
        parentRecurringId: templateId,
      };
      setCalendarItems(prev => [
        ...prev.map(i => i.id === templateId
          ? { ...i, bankDescriptorAliases: [...(i.bankDescriptorAliases ?? []), descriptor] }
          : i),
        paidInstance,
      ]);
    } else {
      const item = calendarItems.find(i => i.id === calendarItemId);
      if (!item || item.type !== 'expense') return false;
      // Parity with the real mutation: a recurring TEMPLATE's own doc id would
      // rewrite the whole series' budgeted amount here.
      if (item.isRecurring) return false;
      if (item.isPaid) {
        toast.error('That bill is already marked paid');
        return false;
      }
      paidCalendarItemId = calendarItemId;
      billTitle = item.title;
      setCalendarItems(prev => prev.map(i => i.id === calendarItemId
        ? {
            ...i,
            isPaid: true,
            amount: paidAmount,
            bankDescriptorAliases: [...(i.bankDescriptorAliases ?? []), descriptor],
          }
        : i));
    }

    // Balance parity with the real mutation, computed OUTSIDE the setState
    // updaters (StrictMode double-invokes them): the SAME reverse/apply pair
    // updateTransactionCategory uses, not a one-sided "only if not yet verified"
    // shortcut. A pending row reverses 0 and applies −amount; an ALREADY-VERIFIED
    // row re-tagged to a different account moves the money off the old one and
    // onto the new (the shortcut silently left it on the old); a bank-sync row's
    // authoritative account is skipped on both sides.
    const oldTarget = resolveTargetAccount(tx.accountId, accounts);
    const newTarget = resolveTargetAccount(accountId ?? tx.accountId, accounts);
    const reverseDelta = shouldSkipBankSyncDelta(tx, oldTarget?.id, oldTarget?.id)
      ? 0
      : -effectiveAccountImpact(tx, oldTarget);
    const applyDelta = shouldSkipBankSyncDelta(tx, newTarget?.id, oldTarget?.id)
      ? 0
      : accountImpactOf(
          { amount: paidAmount, category: BUDGETED_IN_CALENDAR, creditPayment: tx.creditPayment },
          newTarget,
        );
    const settleDeltas = new Map<string, number>();
    if (oldTarget) settleDeltas.set(oldTarget.id, (settleDeltas.get(oldTarget.id) ?? 0) + reverseDelta);
    if (newTarget) settleDeltas.set(newTarget.id, (settleDeltas.get(newTarget.id) ?? 0) + applyDelta);
    if (settleDeltas.size > 0) {
      setAccounts(prev => prev.map(a => settleDeltas.has(a.id) && roundMoney(settleDeltas.get(a.id) ?? 0) !== 0
        ? { ...a, balance: roundMoney(a.balance + (settleDeltas.get(a.id) ?? 0)), lastUpdated: new Date().toISOString() }
        : a));
    }

    setTransactions(prev => prev.map(t => t.id === transactionId
      ? {
          ...t,
          status: 'verified' as const,
          category: BUDGETED_IN_CALENDAR,
          amount: paidAmount,
          paidCalendarItemId,
          needsCategory: undefined,
          reviewSnoozedUntil: undefined,
          ...(t.needsAmount ? { needsAmount: false } : {}),
          ...(accountId ? { accountId } : {}),
        }
      : t));
    toast.success(`Linked to ${billTitle} — one record, not two`);
    return true;
  }, [transactions, calendarItems, accounts]);

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
    setMeals(prev => {
      const target = prev.find(m => m.id === id);
      if (target) pushToTrash('meal', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(m => m.id !== id);
    });
    toast.success('Mock: Meal deleted');
  }, [pushToTrash]);

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
    setShoppingList(prev => {
      const target = prev.find(s => s.id === id);
      if (target) pushToTrash('shoppingItem', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(s => s.id !== id);
    });
    toast.success('Mock: Shopping item deleted');
  }, [pushToTrash]);

  // F-CAPTURE-01 (Layer 3a): approve a held-for-review shopping capture —
  // apply any edited overrides AND clear needsReview in one in-memory update.
  const approveShoppingItem = useCallback(async (
    id: string,
    overrides?: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'category' | 'store'>>
  ) => {
    setShoppingList(prev => prev.map(s => s.id === id ? { ...s, ...overrides, needsReview: false } : s));
    toast.success('Mock: Added to shopping list');
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
    setMealPlan(prev => {
      const target = prev.find(p => p.id === id);
      if (target) pushToTrash('mealPlanItem', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(p => p.id !== id);
    });
    toast.success('Mock: Meal plan deleted');
  }, [pushToTrash]);

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

  // Mock parity with makeCompleteToDo — named so `toggleTodoSubtask` can DELEGATE
  // its escalation here (rather than reimplementing recurrence spawn + credit +
  // habit fire, which would let the two drift). An inline subtask auto-complete
  // hands a by-id `subtaskToggle` descriptor applied to the mock's OWN fresh ref
  // read, mirroring the real mutation's clobber-safe merge contract.
  const completeToDoMock = useCallback(async (id: string, options?: TodoCompletionOptions) => {
    const found = todosRef.current.find(t => t.id === id);
    if (!found) {
      toast.error('Mock: ToDo not found');
      return;
    }
    if (found.isCompleted) {
      return; // already completed — avoid duplicate points
    }
    const subtaskToggle = options?.subtaskToggle;
    const effectiveSubtasks = subtaskToggle
      ? setSubtaskDone(found.subtasks, subtaskToggle.subtaskId, subtaskToggle.done)
      : undefined;
    const completedTodo: ToDo = effectiveSubtasks
      ? { ...found, subtasks: effectiveSubtasks }
      : found;
    // Subtask gate parity (PRD #1065): refuse a habit-linked to-do with
    // unfinished subtasks with the SAME typed error the real mutation throws.
    const gate = evaluateTodoSubtaskGate(completedTodo);
    if (gate.blocked) {
      throw new TodoSubtasksIncompleteError(completedTodo.id, completedTodo.text, gate.stepsLeft);
    }
    // F-TODO-01: recurring todos spawn their next instance on completion,
    // mirroring the atomic completion+spawn in makeCompleteToDo.
    const nextInstance = buildNextRecurringTodo(completedTodo, getLocalDateString());
    setTodos(prev => {
      const updated = prev.map(t =>
        t.id === id
          ? { ...t, isCompleted: true, completedAt: new Date().toISOString(), ...(effectiveSubtasks ? { subtasks: effectiveSubtasks } : {}) }
          : t,
      );
      if (!nextInstance) return updated;
      return [...updated, {
        ...nextInstance,
        id: generateId(),
        createdAt: new Date().toISOString(),
        createdBy: completedTodo.createdBy,
      } as ToDo];
    });
    setMembers(prev => {
      const credit = computeTodoCompletionCredit(completedTodo, prev);
      if (!credit) return prev;
      return prev.map(m => m.uid === credit.memberUid
        ? { ...m, points: {
            daily: m.points.daily + credit.points,
            weekly: m.points.weekly + credit.points,
            total: m.points.total + credit.points,
          } }
        : m);
    });
    // Habit Automations (PRD #1065): fire the linked habit like one manual tap.
    const firedTitle = fireLinkedHabitMock(completedTodo, 'up');
    toast.success(firedTitle ? `Mock: logged "${firedTitle}" via to-do` : 'Mock: ToDo completed');
  }, [fireLinkedHabitMock]);

  // Inline subtask access (owner-approved) — parity with makeToggleTodoSubtask.
  // Checking the last step escalates by DELEGATING to completeToDoMock (single
  // completion implementation, no divergence); every other toggle is a plain
  // by-id subtasks update.
  const toggleTodoSubtask = useCallback(async (todoId: string, subtaskId: string): Promise<TodoSubtaskToggleResult> => {
    const todo = todosRef.current.find(t => t.id === todoId);
    if (!todo) {
      toast.error('Mock: ToDo not found');
      return { autoCompleted: false, toggledSubtaskId: subtaskId };
    }
    const current = (todo.subtasks ?? []).find(s => s.id === subtaskId);
    if (!current) {
      return { autoCompleted: false, toggledSubtaskId: subtaskId };
    }
    const targetDone = !current.isDone;
    const nextSubtasks = setSubtaskDone(todo.subtasks, subtaskId, targetDone);
    const { allDone } = subtaskProgress(nextSubtasks);

    if (!todo.isCompleted && targetDone && allDone) {
      await completeToDoMock(todoId, { subtaskToggle: { subtaskId, done: true } });
      return { autoCompleted: true, toggledSubtaskId: subtaskId };
    }

    setTodos(prev => prev.map(t => t.id === todoId ? { ...t, subtasks: nextSubtasks } : t));
    return { autoCompleted: false, toggledSubtaskId: subtaskId };
  }, [completeToDoMock]);

  const deleteToDo = useCallback(async (id: string) => {
    setTodos(prev => {
      const target = prev.find(t => t.id === id);
      if (target) pushToTrash('todo', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(t => t.id !== id);
    });
    toast.success('Mock: ToDo deleted');
  }, [pushToTrash]);

  // F-CAPTURE-01 (Layer 3a): approve a held-for-review to-do capture — apply
  // any edited overrides AND clear needsReview in one in-memory update.
  const approveTodo = useCallback(async (
    id: string,
    overrides?: Partial<Pick<ToDo, 'text' | 'completeByDate' | 'assignedTo' | 'isImportant'>>
  ) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...overrides, needsReview: false } : t));
    toast.success('Mock: Added to list');
  }, []);

  // F-XCUT-03: restore/purge for the in-memory trash mirror.
  const restoreTrashedItem = useCallback(async (item: TrashedItem) => {
    const data = { ...item.data, id: item.originalId };
    switch (item.domain) {
      case 'todo': setTodos(prev => [...prev.filter(t => t.id !== item.originalId), data as unknown as ToDo]); break;
      case 'shoppingItem': setShoppingList(prev => [...prev.filter(s => s.id !== item.originalId), data as unknown as ShoppingItem]); break;
      case 'meal': setMeals(prev => [...prev.filter(m => m.id !== item.originalId), data as unknown as Meal]); break;
      case 'mealPlanItem': setMealPlan(prev => [...prev.filter(p => p.id !== item.originalId), data as unknown as MealPlanItem]); break;
      case 'habit': setHabits(prev => [...prev.filter(h => h.id !== item.originalId), data as unknown as Habit]); break;
      // Balance parity note: the mock deleteTransaction doesn't reverse a
      // balance, so its restore doesn't re-apply one either (the real context
      // does both — see trashMutations.restoreTrashedItem).
      case 'transaction': setTransactions(prev => [...prev.filter(t => t.id !== item.originalId), data as unknown as Transaction]); break;
    }
    setTrashedItems(prev => prev.filter(t => t.id !== item.id));
    toast.success('Mock: Item restored');
  }, []);

  const purgeTrashedItem = useCallback(async (item: TrashedItem) => {
    setTrashedItems(prev => prev.filter(t => t.id !== item.id));
    toast.success('Mock: Permanently deleted');
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

  const reorderStores = useCallback(async (orderedIds: string[]) => {
    setStores(prev => {
      const orderById = new Map(orderedIds.map((id, index) => [id, index]));
      return prev.map(s => {
        const order = orderById.get(s.id);
        return order === undefined ? s : { ...s, order };
      });
    });
  }, []);

  // Grocery categories
  const updateGroceryCategories = useCallback(async (categories: string[]) => {
    setGroceryCategories(categories);
    toast.success('Mock: Categories updated');
  }, []);

  // Habit categories — mutate in-memory so newly added chips appear immediately.
  const updateHabitCategories = useCallback(async (categories: string[]) => {
    setHabitCategories(categories);
    toast.success('Mock: Categories updated');
  }, []);

  // F-TODO-16 — to-do categories. In-memory equivalents of the real mutations
  // (makeUpdateTodoCategories / makeTodoCategoryEditMutations): same
  // case-insensitive matching, same merge-on-collision rule, and the same
  // "clearing a category REMOVES the field" invariant, so Test Mode exercises
  // the real semantics. Deliberately silent, matching the real mutations'
  // "callers own the toast" contract — the manage-categories drawer reports
  // the outcome itself, so toasting here would double every message (and
  // would announce a plain rename on the merge path).
  const updateTodoCategories = useCallback(async (categories: string[]) => {
    setTodoCategories(categories);
  }, []);

  const renameTodoCategory = useCallback(async (oldName: string, newName: string) => {
    const trimmedNew = newName.trim();
    if (!trimmedNew || trimmedNew === oldName) return;
    const oldKey = normalizeCategory(oldName);
    if (!oldKey) return;

    // Resolve the target OUTSIDE the state updaters (updaters must stay pure —
    // React may invoke them twice in StrictMode) so both writes agree on it.
    const mergeTarget = todoCategories.find(
      c => normalizeCategory(c) === normalizeCategory(trimmedNew) && normalizeCategory(c) !== oldKey,
    );
    const targetName = mergeTarget ?? trimmedNew;

    const next: string[] = [];
    const seen = new Set<string>();
    for (const category of todoCategories) {
      const value = normalizeCategory(category) === oldKey ? targetName : category;
      const key = normalizeCategory(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      next.push(value);
    }
    if (!seen.has(normalizeCategory(targetName))) next.push(targetName);

    setTodos(prev => prev.map(t =>
      normalizeCategory(t.category) === oldKey ? { ...t, category: targetName } : t,
    ));
    setTodoCategories(next);
  }, [todoCategories]);

  const deleteTodoCategory = useCallback(async (name: string) => {
    const key = normalizeCategory(name);
    if (!key) return;
    setTodoCategories(prev => prev.filter(c => normalizeCategory(c) !== key));
    setTodos(prev => prev.map(t => {
      if (normalizeCategory(t.category) !== key) return t;
      // Delete the field (not '') — "absent means Uncategorized" is the invariant.
      const { category: _removed, ...rest } = t;
      return rest as ToDo;
    }));
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

  const updateQuickStockLists = useCallback(async (lists: QuickStockList[]) => {
    setQuickStockLists(() => lists);
  }, []);

  const deleteQuickStockList = useCallback(async (id: string) => {
    setQuickStockLists(prev => prev.filter(l => l.id !== id));
    toast.success('Mock: Template deleted');
  }, []);

  // Task Templates (F-TODO-03 — "Quick Task Lists")
  const addTaskTemplate = useCallback(async (template: Omit<TaskTemplate, 'id'>) => {
    const newTemplate = { ...template, id: generateId() } as TaskTemplate;
    setTaskTemplates(prev => [...prev, newTemplate]);
    toast.success('Mock: Template created');
  }, []);

  const updateTaskTemplate = useCallback(async (template: TaskTemplate) => {
    setTaskTemplates(prev => prev.map(t => t.id === template.id ? template : t));
    toast.success('Mock: Template updated');
  }, []);

  const deleteTaskTemplate = useCallback(async (id: string) => {
    setTaskTemplates(prev => prev.filter(t => t.id !== id));
    toast.success('Mock: Template deleted');
  }, []);

  const applyTaskTemplate = useCallback(async (template: TaskTemplate): Promise<number> => {
    const todosToCreate = buildToDosFromTemplate(template, getLocalDateString(), 'test-user-id');
    const newTodos: ToDo[] = todosToCreate.map(todo => ({
      ...todo,
      id: generateId(),
      createdAt: new Date().toISOString(),
      createdBy: 'test-user-id',
    }));
    setTodos(prev => [...prev, ...newTodos]);
    toast.success(`Mock: Added ${newTodos.length} tasks from ${template.name}`);
    return newTodos.length;
  }, []);

  const addGroceryCatalogItem = useCallback(async (item: Omit<GroceryCatalogItem, 'id'>): Promise<string> => {
    const id = generateId();
    const newItem = { ...item, id } as GroceryCatalogItem;
    setGroceryCatalog(prev => [...prev, newItem]);
    toast.success('Mock: Item added to history');
    return id;
  }, []);

  // Kid profile operations (Plan 080a-2)
  const addKidProfile = useCallback(async (input: { displayName: string; avatarColor?: string; avatarEmoji?: string }) => {
    const newMember: HouseholdMember = {
      uid: `kid_${crypto.randomUUID()}`,
      displayName: input.displayName.trim() || 'Kid',
      role: 'kid',
      isManaged: true,
      managedByUid: 'test-user-id',
      avatarColor: input.avatarColor,
      avatarEmoji: input.avatarEmoji,
      points: { daily: 0, weekly: 0, total: 0 },
      allowanceCents: 0,
    };
    setMembers(prev => [...prev, newMember]);
    toast.success('Mock: Kid profile added');
  }, []);

  const updateKidProfile = useCallback(async (memberId: string, updates: { displayName?: string; avatarColor?: string; avatarEmoji?: string }) => {
    setMembers(prev => prev.map(m => m.uid === memberId ? { ...m, ...updates } : m));
    toast.success('Mock: Kid profile updated');
  }, []);

  const removeKidProfile = useCallback(async (memberId: string) => {
    setMembers(prev => prev.filter(m => m.uid !== memberId));
    setActiveMemberId(prev => (prev === memberId ? null : prev));
    toast.success('Mock: Kid profile removed');
  }, []);

  // Instant redemption (the adult flow) — deduct from the shared lifetime total
  // and append a most-recent-first history record (capped), mirroring the live
  // context's atomic redeemReward so the rewards center is fully walkable in Test
  // Mode (the previous noOp left points + history untouched).
  const redeemReward = useCallback(async (rewardId: string) => {
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) {
      toast.error('Mock: Reward not found');
      return;
    }
    if (totalPoints < reward.cost) {
      toast.error('Mock: Not enough points');
      return;
    }
    if (reward.unlockRequirement && !unlockedRewardIds.includes(reward.id)) {
      toast.error('Mock: Reward is still locked');
      return;
    }
    const record: RewardRedemptionRecord = {
      id: generateId(),
      rewardId: reward.id,
      rewardTitle: reward.title,
      icon: reward.icon,
      cost: reward.cost,
      redeemedByUid: 'test-user-id',
      redeemedAt: new Date().toISOString(),
    };
    setTotalPoints(prev => prev - reward.cost);
    setRedemptionHistory(prev => [record, ...prev].slice(0, REDEMPTION_HISTORY_LIMIT));
    toast.success(`Mock: Redeemed ${reward.title}`);
  }, [rewards, totalPoints, unlockedRewardIds]);

  // Reward CRUD operations (Plan 080d) — mutate the stateful rewards store so the
  // parent-facing "Manage rewards" UI is walkable in Test Mode.
  const addReward = useCallback(async (input: Omit<RewardItem, 'id' | 'createdBy'>) => {
    const newReward = { ...input, id: generateId(), createdBy: 'test-user-id' } as RewardItem;
    setRewards(prev => [...prev, newReward]);
    toast.success('Mock: Reward added');
  }, []);

  const updateReward = useCallback(async (reward: RewardItem) => {
    setRewards(prev => prev.map(r => r.id === reward.id ? reward : r));
    toast.success('Mock: Reward updated');
  }, []);

  const deleteReward = useCallback(async (id: string) => {
    setRewards(prev => prev.filter(r => r.id !== id));
    toast.success('Mock: Reward deleted');
  }, []);

  // Reward REDEMPTION (Plan 080d-2) — the mock actually mutates so the kid request
  // → parent approve/deny flow (queue + badge) is walkable in Test Mode. Approval
  // uses the SAME redemptionMemberDelta helper as production for parity: it
  // deducts the kid's points.total and credits allowanceCents for allowance rewards.
  const requestRedemption = useCallback(async (rewardId: string, memberId: string) => {
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) {
      toast.error('Mock: Reward not found');
      return;
    }
    const redemption: RewardRedemption = {
      id: generateId(),
      rewardId: reward.id,
      rewardTitle: reward.title,
      memberId,
      cost: reward.cost,
      type: reward.type ?? 'realWorld',
      ...(reward.type === 'allowance' && reward.allowanceCents !== undefined
        ? { allowanceCents: reward.allowanceCents }
        : {}),
      status: 'pending',
      requestedAt: new Date().toISOString(),
      requestedByUid: 'test-user-id',
    };
    // Mirror the live-context dedup: skip if a pending entry for the same
    // (memberId, rewardId) already exists, so a double-tap can't queue two.
    let alreadyPending = false;
    setPendingRedemptions(prev => {
      if (prev.some(p => p.memberId === memberId && p.rewardId === rewardId)) {
        alreadyPending = true;
        return prev;
      }
      return [...prev, redemption];
    });
    toast.success(alreadyPending ? 'Mock: Already requested' : 'Mock: Redemption requested');
  }, [rewards]);

  const approveRedemption = useCallback(async (redemptionId: string) => {
    // Resolve the request and read the kid's CURRENT points.total from the mirror
    // ref so neither the affordability check nor the member credit depends on
    // setState ordering. Idempotent: if it's already gone, this is a no-op.
    const resolved = pendingRedemptions.find(r => r.id === redemptionId);
    if (!resolved) {
      toast.success('Mock: Redemption approved');
      return;
    }

    // AFFORDABILITY: reject (leave pending, no member mutation) when the kid can no
    // longer afford it — mirrors the live context; kids' rewards carry no debt.
    const currentTotal = membersRef.current.find(m => m.uid === resolved.memberId)?.points.total ?? 0;
    if (currentTotal < resolved.cost) {
      toast.error('Mock: Not enough points');
      return;
    }

    const delta = redemptionMemberDelta(resolved);
    // Strip ALL entries for this (memberId, rewardId) so a stray duplicate can't be
    // approved twice; the member is still credited exactly once (one delta below).
    setPendingRedemptions(prev =>
      prev.filter(r => !(r.memberId === resolved.memberId && r.rewardId === resolved.rewardId))
    );
    setMembers(prev => prev.map(m => m.uid === resolved.memberId
      ? {
          ...m,
          points: { ...m.points, total: m.points.total + delta.pointsDelta },
          allowanceCents: (m.allowanceCents ?? 0) + delta.allowanceDelta,
        }
      : m));
    toast.success('Mock: Redemption approved');
  }, [pendingRedemptions]);

  const denyRedemption = useCallback(async (redemptionId: string) => {
    // Remove the request with no points/allowance change. Idempotent.
    setPendingRedemptions(prev => prev.filter(r => r.id !== redemptionId));
    toast.success('Mock: Redemption denied');
  }, []);

  const actAs = useCallback((memberId: string) => {
    setActiveMemberId(memberId);
  }, []);

  const exitToParent = useCallback(() => {
    setActiveMemberId(null);
  }, []);

  // No-op functions for features not critical to testing

  const noOp = useCallback(async <T,>(..._args: unknown[]): Promise<T | void> => {
    // toast.info doesn't exist, use toast with custom styling instead
    toast('Mock: Operation not implemented in test mode', {
      icon: toastIcon(Info),
      duration: 2000
    });
  }, []);

  // Special no-op that returns empty array (for getHabitSubmissions)

  const getHabitSubmissions = useCallback(async (_habitId: string, _startDate?: string, _endDate?: string): Promise<HabitSubmission[]> => {
    return [];
  }, []);

  // Computed/derived state to match interface
  const currentPeriodId = MOCK_PAY_PERIOD_ID;
  // Derive the safe-to-spend breakdown from the SAME pure calculator the real
  // Firebase context uses, so Test Mode exposes a well-formed, internally
  // consistent SafeToSpendBreakdown (incl. checkingBalance/unpaidBills/
  // pendingSpend) rather than a hardcoded number. This keeps the mock's
  // useFinance() slice in parity with production — a consumer reading
  // `safeToSpendBreakdown` no longer gets `undefined` in Test Mode.
  const safeToSpendBreakdown: SafeToSpendBreakdown = useMemo(
    () => calculateSafeToSpendBreakdown(accounts, calendarItems, currentPeriodId, transactions),
    [accounts, calendarItems, currentPeriodId, transactions]
  );
  const safeToSpend = safeToSpendBreakdown.safeToSpend;
  // Post-flip (stage 1.5): household daily/weekly = Σ the ADULT members' own
  // scores, exactly like production's competition model (managed kids' chore
  // points route to the kid alone and never the household). Seeded
  // 30+18=48 / 150+95=245, and a habit toggle crediting any adult's member
  // score moves these derived figures just like the real context.
  const dailyPoints = members.reduce((sum, m) => (m.isManaged ? sum : sum + m.points.daily), 0);
  const weeklyPoints = members.reduce((sum, m) => (m.isManaged ? sum : sum + m.points.weekly), 0);
  const currentUser = members[0] || null;
  const activeChallenge = challenges[0] || null;
  const activeYearlyGoals: YearlyGoal[] = [];
  const primaryYearlyGoal: YearlyGoal | null = null;
  const rewardsInventory = rewards;
  // Plan 25: live in-memory freeze bank (2/2) so Test Mode can walk the
  // auto-apply flow (seed a habit with a missed yesterday, call
  // autoApplyFreezes, watch the streak survive with zero points granted).
  const [freezeBank, setFreezeBank] = useState<FreezeBank>({
    tokens: 2,
    maxTokens: 2,
    lastRolloverDate: getLocalDateString(),
    lastRolloverMonth: format(new Date(), 'yyyy-MM'),
    history: [],
  });
  const isGeneratingInsight = false;
  // F-DASH-03 — Habit Coach: simulate the generate/store round-trip in memory
  // so Test Mode can exercise the widget's loading + populated states without
  // hitting Firestore or Gemini.
  const [habitPatterns, setHabitPatterns] = useState<HabitInsightsDoc | null>(null);
  const [isGeneratingHabitPatterns, setIsGeneratingHabitPatterns] = useState(false);
  const refreshHabitPatterns = useCallback(async () => {
    if (habits.length === 0) {
      toast.error('Add some habits first to get coaching insights.');
      return;
    }
    setIsGeneratingHabitPatterns(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setHabitPatterns({
      patterns: [
        {
          title: 'On Fire!',
          description: `${habits[0]?.title ?? 'Your top habit'} has a strong recent streak — keep the momentum going.`,
          type: 'praise',
          relatedHabitId: habits[0]?.id,
        },
        {
          title: 'Weekend Slump Detected',
          description: 'Completions tend to drop off on Saturdays and Sundays — consider a lighter weekend target.',
          type: 'suggestion',
        },
      ],
      generatedAt: new Date().toISOString(),
    });
    setIsGeneratingHabitPatterns(false);
    toast.success('Habit coach updated!', { icon: toastIcon(Sparkles) });
  }, [habits]);
  const householdSettings = {
    id: 'test-household-id',
    name: 'Test Household',
    inviteCode: 'TEST-1234',
    members: members,
    freezeBank,
    // Stage 6: both undefined until picked, so the household doc shape matches
    // a legacy household exactly (absent, not explicitly defaulted).
    freezeMode,
    ceremonyTone,
    freezeBanksByMember,
    accounts: accounts,
    rewardsInventory: rewards,
    coreTemplates: { expenses: [], buckets: [] },
    stores: stores,
    groceryCategories: groceryCategories,
    habitCategories: habitCategories,
    todoCategories: todoCategories,
    currency,
    kidModePinHash,
    pendingRedemptions,
    redemptionHistory,
    unlockedRewardIds,
    moduleVisibility,
    merchantRules,
    captureReview,
    dietaryProfile,
    mealCookedHabitId,
    // F-DASH-06: seed a nonzero today's usage so the InsightWidget AI-usage
    // caption is visible/walkable in Test Mode.
    aiUsage: { dailyCount: 1, lastResetDate: getLocalDateString() },

  } as unknown as Household;
  // Same derivation as the real Firebase context, so Test Mode's Budget page
  // shows real spent-vs-limit progress instead of a permanently empty map.
  const bucketSpentMap = useMemo(
    () => calculateBucketSpent(buckets, transactions, currentPeriodId),
    [buckets, transactions, currentPeriodId]
  );

  // captureReview (F-CAPTURE-01 foundation): mirror the real context's
  // visible/awaiting-review split so the settings UI + list views behave
  // identically in Test Mode.
  const visibleShoppingList = useMemo(
    () => shoppingList.filter((item) => item.needsReview !== true),
    [shoppingList]
  );
  const shoppingAwaitingReview = useMemo(
    () => shoppingList.filter((item) => item.needsReview === true),
    [shoppingList]
  );
  const visibleTodos = useMemo(
    () => todos.filter((t) => t.needsReview !== true),
    [todos]
  );
  const todosAwaitingReview = useMemo(
    () => todos.filter((t) => t.needsReview === true),
    [todos]
  );

  const contextValue: HouseholdContextType = {
    // Mock data is available synchronously — never in a loading state.
    isLoading: false,
    // Computed State
    safeToSpend,
    safeToSpendBreakdown,
    dailyPoints,
    weeklyPoints,
    totalPoints,
    currentUser,
    activeChallenge,
    activeYearlyGoals,
    primaryYearlyGoal,
    rewardsInventory,
    // Stage 6 parity: the SURFACES see the household bank in every shared mode
    // (the absent default included) and the acting member's own bank under
    // 'per_member' — same swap the real provider makes.
    freezeBank: visibleFreezeBank(householdSettings, freezeBank, currentUser?.uid) ?? freezeBank,
    habitPatterns,
    isGeneratingHabitPatterns,
    refreshHabitPatterns,
    isGeneratingInsight,
    householdId: 'test-household-id',
    currentPeriodId,
    bucketSpentMap,
    householdSettings,
    household: householdSettings,

    // Data
    accounts,
    buckets,
    savingsGoals,
    netWorthHistory,
    transactions,
    calendarItems,
    habits,
    habitCategories,
    challenges,
    yearlyGoals,
    members,
    meals,
    shoppingList: visibleShoppingList,
    shoppingAwaitingReview,
    mealPlan,
    todos: visibleTodos,
    todosAwaitingReview,
    todoCategories,
    groceryCatalog,
    bucketHistory,
    recaps,
    moneyRecaps,
    trashedItems,
    restoreTrashedItem,
    purgeTrashedItem,
    activityLog,
    notificationLog,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    insightsHistory,
    insight,
    stores,
    groceryCategories,
    quickStockLists,
    taskTemplates,
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
    loadAllMeals: async () => meals,
    loadFullGroceryCatalog: async () => {},

    // Operations
    addAccount,
    deleteAccount,
    archiveAccount,
    unarchiveAccount,
    updateAccountBalance,
    setAccountGoal: noOp,
    setAccountCardLast4: noOp,
    setAccountCardDetails: noOp,
    updateAccountOrder: noOp,
    reorderAccounts: noOp,
    addSavingsGoal,
    updateSavingsGoal,
    deleteSavingsGoal,
    contributeToGoal,
    addBucket,
    updateBucket,
    deleteBucket,
    updateBucketLimit: noOp,
    setBucketLimits,
    saveCeremonyChanges,
    reallocateBucket,
    addTransaction,
    addTransactions,
    updateTransaction,
    updateTransactionCategory,
    reverseTransactionApproval,
    deleteTransaction,
    splitTransaction,
    setTransactionSplit,
    markSplitSettled,
    mergeTransactions,
    keepBothTransactions,
    getTransactionComments,
    addTransactionComment,
    deleteTransactionComment,
    addCalendarItem,
    updateCalendarItem,
    deleteCalendarItem,
    payCalendarItem: noOp,
    deferCalendarItem: noOp,
    linkBankTransactionToBill,
    settleBillWithTransaction,
    addHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    unarchiveHabit,
    reorderHabits,
    toggleHabit,
    resetHabit,
    setHabitPause,
    updateHabitCategories,
    addHabitSubmission: noOp,
    resetHabitDay: noOp,
    creditHabitCompletion,
    uncreditHabitCompletion,
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
    approveShoppingItem,
    toggleShoppingItemPurchased: noOp,
    clearPurchasedShoppingItems: noOp,
    addMealPlanItem: addMealPlan,
    updateMealPlanItem: updateMealPlan,
    deleteMealPlanItem: deleteMealPlan,
    addToDo,
    updateToDo,
    toggleTodoSubtask,
    updateTodoCategories,
    renameTodoCategory,
    deleteTodoCategory,
    deleteToDo,
    approveTodo,
    completeToDo: completeToDoMock,
    uncompleteToDo: useCallback(async (id: string, options?: TodoCompletionOptions) => {
      // Counterpart of completeToDo (see makeUncompleteToDo in the real
      // context): restores the to-do AND reverses the managed-kid points
      // credit through the SAME dormancy gate, so Test Mode mirrors the
      // atomic restore+debit. Idempotent: an already-active todo is a no-op,
      // so restoring twice can never double-reverse.
      const todo = todosRef.current.find(t => t.id === id);
      if (!todo) {
        toast.error('Mock: ToDo not found');
        return;
      }
      if (!todo.isCompleted) {
        return; // already active — no double reversal
      }
      // F-TODO-01 counterpart (mirrors makeUncompleteToDo in the real
      // context): completing a recurring to-do spawns the next instance, so
      // restoring must reconcile it or the household ends up with two active
      // copies. Identify the spawn the way buildNextRecurringTodo links it —
      // same chain root (`recurrence.parentRecurringId`, or this todo's own
      // id when it IS the root) and same text, still active — and delete
      // ONLY when exactly one such candidate exists; ambiguous (0 or 2+)
      // matches leave every candidate untouched rather than guessing.
      let spawnIdToDelete: string | null = null;
      if (todo.recurrence && isTodoFrequency(todo.recurrence.frequency)) {
        const chainRootId = todo.recurrence.parentRecurringId ?? todo.id;
        const matches = todosRef.current.filter(t =>
          !t.isCompleted &&
          t.id !== todo.id &&
          t.recurrence?.parentRecurringId === chainRootId &&
          t.text === todo.text,
        );
        if (matches.length === 1) {
          spawnIdToDelete = matches[0]?.id ?? null;
        }
      }
      const subtaskToggle = options?.subtaskToggle;
      const effectiveSubtasks = subtaskToggle
        ? setSubtaskDone(todo.subtasks, subtaskToggle.subtaskId, subtaskToggle.done)
        : undefined;
      setTodos(prev => prev
        .map(t => t.id === id ? { ...t, isCompleted: false, completedAt: undefined, ...(effectiveSubtasks ? { subtasks: effectiveSubtasks } : {}) } : t)
        .filter(t => t.id !== spawnIdToDelete));
      setMembers(prev => {
        const credit = computeTodoCompletionCredit(todo, prev);
        if (!credit) return prev;
        const deltas = buildUncompleteCreditReversal(credit.points, todo.completedAt);
        return prev.map(m => m.uid === credit.memberUid
          ? { ...m, points: {
              daily: m.points.daily + (deltas['points.daily'] ?? 0),
              weekly: m.points.weekly + (deltas['points.weekly'] ?? 0),
              total: m.points.total + (deltas['points.total'] ?? 0),
            } }
          : m);
      });
      // Habit Automations (PRD #1065): reverse the linked habit fire atomically
      // with the restore (mirrors makeUncompleteToDo).
      const reversedTitle = fireLinkedHabitMock(todo, 'down');
      toast.success(reversedTitle ? `Mock: reversed "${reversedTitle}"` : 'Mock: ToDo restored');
    }, [fireLinkedHabitMock]),
    addTaskTemplate,
    updateTaskTemplate,
    deleteTaskTemplate,
    applyTaskTemplate,
    addStore,
    updateStore,
    deleteStore,
    reorderStores,
    updateGroceryCategories,
    addQuickStockList,
    updateQuickStockList,
    updateQuickStockLists,
    deleteQuickStockList,
    addGroceryCatalogItem,
    updateGroceryCatalogItem: noOp,
    deleteGroceryCatalogItem: noOp,
    updateChallenge: noOp,
    addChallenge,
    markChallengeComplete: noOp,
    redeemReward,
    addReward,
    updateReward,
    deleteReward,
    requestRedemption,
    approveRedemption,
    denyRedemption,
    refreshInsight: noOp,
    // F-DASH-11 — mirrors makeRateInsight's shape (updates the doc + a
    // feedbackAt timestamp) but in-memory.
    rateInsight: useCallback(async (insightId: string, feedback: 'up' | 'down') => {
      setInsightsHistory(prev => prev.map(i =>
        i.id === insightId ? { ...i, feedback, feedbackAt: new Date().toISOString() } : i
      ));
      track('insight_rated', { feedback });
      toast.success(`Mock: Insight marked ${feedback === 'up' ? 'helpful' : 'not helpful'}`);
    }, []),
    createYearlyGoal: noOp,
    updateYearlyGoal: noOp,
    updateYearlyGoalProgress: noOp,
    deleteYearlyGoal: noOp,
    // Plan 25: in-memory auto-apply mirroring the real mutation — consumes one
    // token per protected habit (highest streak first), records yesterday in
    // frozenDates, recomputes the frozen-aware streak, and NEVER credits points.
    //
    // Stage 6: the same mode dispatch as production. 'per_member' spends each
    // adult's OWN in-memory bank and records the uid in `frozenDatesBy` (which
    // bridges only that member's chain); every other mode — including the absent
    // default — runs the shared path below unchanged.
    autoApplyFreezes: useCallback(async () => {
      const today = getLocalDateString();
      const yesterday = getLocalDateString(subDays(new Date(), 1));

      if (isPerMemberFreeze(resolveFreezeMode({ freezeMode }))) {
        const memberIds = freezeBankMemberIds(members);
        const banks = new Map<string, FreezeBank>(
          memberIds.map(uid => [uid, freezeBanksByMember[uid] ?? newMemberFreezeBank()]),
        );
        const applied = selectMemberAutoFreezeCandidates(habits, memberIds, today).filter(c => {
          const bank = banks.get(c.memberId);
          if (!bank || bank.tokens <= 0) return false;
          banks.set(c.memberId, { ...bank, tokens: bank.tokens - 1 });
          return true;
        });
        if (applied.length === 0) return;

        setHabits(prev => prev.map(h => {
          const uids = applied.filter(c => c.habit.id === h.id).map(c => c.memberId);
          if (uids.length === 0) return h;
          const day = h.frozenDatesBy?.[yesterday] ?? [];
          return {
            ...h,
            frozenDatesBy: {
              ...(h.frozenDatesBy ?? {}),
              [yesterday]: [...new Set([...day, ...uids])],
            },
          };
        }));
        setFreezeBanksByMember(prev => {
          const next = { ...prev };
          for (const c of applied) {
            const bank = banks.get(c.memberId);
            if (!bank) continue;
            // Accumulate from `next`, not `prev`: two candidates can target the
            // SAME member in one run (two habits, two tokens), and reading from
            // `prev` on every iteration would let the second write clobber the
            // first history entry this very loop just added.
            next[c.memberId] = {
              ...bank,
              history: [
                ...(next[c.memberId]?.history ?? prev[c.memberId]?.history ?? []),
                {
                  id: generateId(),
                  type: 'used' as const,
                  amount: -1,
                  date: today,
                  habitId: c.habit.id,
                  habitDate: yesterday,
                  notes: `Freeze auto-applied: protected the ${c.protectedStreak}-day streak on ${c.habit.title} (${yesterday})`,
                  createdAt: new Date().toISOString(),
                },
              ],
            };
          }
          return next;
        });
        toast.success(`Mock: ${applied.length} per-member freeze(s) auto-applied`);
        return;
      }

      if (freezeBank.tokens <= 0) return;
      const toApply = selectAutoFreezeCandidates(habits, today).slice(0, freezeBank.tokens);
      if (toApply.length === 0) return;
      const idSet = new Set(toApply.map(c => c.habit.id));
      setHabits(prev => prev.map(h => {
        if (!idSet.has(h.id)) return h;
        const frozenDates = [...(h.frozenDates ?? []), yesterday].sort();
        return {
          ...h,
          frozenDates,
          streakDays: streakForHabit({ period: h.period, completedDates: h.completedDates, frozenDates }),
        };
      }));
      setFreezeBank(prev => ({
        ...prev,
        tokens: Math.max(0, prev.tokens - toApply.length),
        history: [
          ...prev.history,
          ...toApply.map(c => ({
            id: generateId(),
            type: 'used' as const,
            amount: -1,
            date: today,
            habitId: c.habit.id,
            habitDate: yesterday,
            notes: `Freeze auto-applied: protected the ${c.protectedStreak}-day streak on ${c.habit.title} (${yesterday})`,
            createdAt: new Date().toISOString(),
          })),
        ],
      }));
      toast.success(`Mock: ${toApply.length} freeze(s) auto-applied`);
    }, [habits, freezeBank.tokens, freezeMode, members, freezeBanksByMember]),
    rolloverFreezeBankTokens: noOp,
    addMember: noOp,
    updateMember: useCallback(async (memberId: string, updates: Partial<HouseholdMember>) => {
      setMembers(prev => prev.map(m => (m.uid === memberId ? { ...m, ...updates } : m)));
    }, []),
    removeMember: noOp,
    deleteHousehold,
    completeOnboarding,
    setHouseholdCurrency,
    setModuleVisibility,
    updateModuleVisibility,
    setCaptureReviewMode,
    setKidModePin,
    setDietaryProfile,
    setMealCookedHabitId,
    setFreezeMode,
    setCeremonyTone,
    addMerchantRule,
    updateMerchantRule,
    deleteMerchantRule,
    addKidProfile,
    updateKidProfile,
    removeKidProfile,
    activeMemberId,
    actAs,
    exitToParent,
  };

  // Test Mode does not need render isolation, so every slice receives the same
  // composed value object. `HouseholdContextType` satisfies each slice type, so
  // the granular hooks (`useFinance`, `useMealPlan`, `useShopping`, `useMeals`,
  // …) and the `useHousehold` shim all resolve against this mock data
  // identically to production.
  return (
    <HouseholdSliceProviders
      finance={contextValue}
      gamification={contextValue}
      mealPlan={contextValue}
      shopping={contextValue}
      todos={contextValue}
      core={contextValue}
    >
      {children}
    </HouseholdSliceProviders>
  );
};
