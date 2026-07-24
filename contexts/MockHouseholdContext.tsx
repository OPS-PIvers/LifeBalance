import React, { useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { Info, PartyPopper, Gift, Sparkles } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { format, addDays, subDays } from 'date-fns';
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
import { processToggleHabit, processStaleDownToggle, isHabitStale, calculateResetPoints, streakForHabit } from '@/utils/habitLogic';
import { computeHabitTriggerFire, computeHabitTriggerReverse } from '@/utils/habitTriggerFire';
import { evaluateTodoSubtaskGate, TodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { setSubtaskDone, subtaskProgress } from '@/utils/subtasks';
import type { TodoSubtaskToggleResult, TodoCompletionOptions } from '@/contexts/household/mutations/todoMutations';
import { crossedMilestone, rewardMilestoneSatisfied } from '@/utils/habitMilestones';
import { attributionString, type TriggerSource } from '@/utils/habitTriggers';
import { selectAutoFreezeCandidates } from '@/utils/freezeBank';
import { accountImpactOf, effectiveAccountImpact, isBankSyncTransaction, resolveTargetAccount } from '@/utils/accountImpact';
import { mergeTransactions as buildMergeUpdates } from '@/utils/transactionMerge';
import { selectHabitsToFire } from '@/utils/transactionHabitFiring';
import { MAX_COMMENT_LENGTH } from '@/contexts/household/mutations/commentMutations';
import { roundMoney } from '@/utils/money';
import { splitParticipantKey } from '@/utils/settlement';
import { trashDocId, type TrashDomain, type TrashedItem } from '@/utils/trash';
import { computeNetWorth } from '@/utils/netWorth';
import { track } from '@/services/analytics';
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
  CaptureType,
  CaptureReviewMode,
  DietaryProfile,
  WeeklyRecap,
  MonthlyMoneyRecap,
  NotificationLogEntry,
  NetWorthSnapshot,
  ActivityLogEntry,
  SavingsGoal,
  TransactionComment
} from '@/types/schema';
import toast from 'react-hot-toast';

// Helper to generate unique IDs
const generateId = () => `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
 * Absent/unknown values leave the default seeds untouched.
 */
const readTestSeedVariant = (): 'fresh' | 'stub' | null => {
  try {
    const v = window.sessionStorage.getItem('LIFEBALANCE_TEST_SEED');
    return v === 'fresh' || v === 'stub' ? v : null;
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
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
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

const SEED_MEMBERS: HouseholdMember[] = [
  {
    uid: 'test-user-id', displayName: 'Test User', email: 'test@example.com',
    role: 'admin', points: { daily: 30, weekly: 150, total: 500 }
  },
  // Second adult so the F-MONEY-13 Settle-Up view is walkable in Test Mode
  // (who-owes-whom needs 2+ adults). The seed transaction 't1' is split with
  // this member below.
  {
    uid: 'test-partner-id', displayName: 'Jordan', email: 'jordan@example.com',
    role: 'member', points: { daily: 0, weekly: 0, total: 0 }
  },
  // Plan 080 (Kid Mode) Test-Mode harness: one managed kid so the dormant kid
  // surfaces are walkable in Test Mode. Mirrors the EXACT object shape the mock's
  // own addKidProfile builds (login-less, isManaged, managedByUid, no email), so
  // the kid dashboard, the parent KidsChoresWidget, and the +pts todo badge all
  // show live data without a real backend.
  {
    uid: 'kid_leo', displayName: 'Leo', role: 'kid',
    isManaged: true, managedByUid: 'test-user-id',
    avatarColor: '#9f5618', avatarEmoji: '🦊', // terracotta from utils/avatarColor AVATAR_COLORS
    points: { daily: 15, weekly: 60, total: 220 }, allowanceCents: 0
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
    isFresh ? [] : TEST_SEED_VARIANT === 'stub' ? [...SEED_TRANSACTIONS, STUB_TRANSACTION] : SEED_TRANSACTIONS
  );
  // Plan 23 — transaction comments, keyed by transaction id. Mirrors the real
  // context's on-demand fetch model (no listener); the "fetch" here is just a
  // synchronous in-memory read wrapped in a resolved Promise.
  const [transactionComments, setTransactionComments] = useState<Record<string, TransactionComment[]>>(
    isFresh ? {} : SEED_TRANSACTION_COMMENTS
  );
  const [habits, setHabits] = useState<Habit[]>(isFresh ? [] : SEED_HABITS);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
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
  // One canned weekly recap (Plan 02) so Test Mode renders the Dashboard recap
  // card + drawer. Anchored to the CURRENT ISO week with a fresh generatedAt so
  // the card's 4-day freshness window always passes. Numbers stay consistent
  // with the seed data (checking spend, 2 seeded members, the Read habit).
  const [recaps] = useState<WeeklyRecap[]>(() => [{
    id: format(new Date(), "RRRR-'W'II"),
    isoWeek: format(new Date(), "RRRR-'W'II"),
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
      { memberId: 'kid_leo', name: 'Leo', points: 35 },
    ],
    upcomingBills: [
      { title: 'Rent', amount: 1200, date: getLocalDateString(new Date(Date.now() + 3 * 86400000)) },
      { title: 'Internet', amount: 65, date: getLocalDateString(new Date(Date.now() + 5 * 86400000)) },
    ],
    narrative:
      'Test Mode: You spent 23% less than last week — groceries did the heavy lifting. Keep the exercise streak alive tonight to lock in your multiplier.',
    narrativeSource: 'template',
    premium: true,
  }]);
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
  const [quickStockLists, setQuickStockLists] = useState<QuickStockList[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [currency, setCurrency] = useState<string>('USD');
  const [kidModePinHash, setKidModePinHash] = useState<string | undefined>(undefined);
  // Plan 090 — module visibility starts empty (fail-open => all-on), mirroring a
  // legacy household. Toggling a module mutates this in-memory map so the dynamic
  // footer / route guards / Plan-tab fallback are all walkable in Test Mode.
  const [moduleVisibility, setModuleVisibilityState] = useState<Partial<Record<ModuleKey, boolean>>>({});
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
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    toast.success('Mock: Transaction updated');
  }, []);

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
      setHabits(prev => prev.map(h => {
        if (!habitIdsToFire.includes(h.id)) return h;
        // PRD #1065 parity with makeUpdateTransactionCategory: an archived
        // habit must never fire (skip entirely — no count/points change).
        if (h.archivedAt) return h;
        // Lazy-reset parity: a stale habit (counter belongs to a previous
        // period) fires as if count were 0, so it ends at exactly the delta
        // (here always +1) instead of incrementing the prior-period value.
        // totalCount still increments normally regardless of staleness.
        const stale = isHabitStale(h);
        return {
          ...h,
          count: stale ? 1 : h.count + 1,
          totalCount: h.totalCount + 1,
        };
      }));
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
  }, []);

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
    setTransactions(prev => {
      const target = prev.find(t => t.id === id);
      // F-XCUT-03 parity: deleted transactions land in Recently Deleted too.
      if (target) pushToTrash('transaction', target as unknown as { id: string } & Record<string, unknown>);
      return prev.filter(t => t.id !== id);
    });
    toast.success('Mock: Transaction deleted');
  }, [pushToTrash]);

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
  }, [transactions, accounts]);

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
  }, []);

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

  // Credit (or debit, negative delta) the test user's points across all three
  // windows plus the redeemable lifetime total — the same three-window update
  // the real context's habit writeBatch applies to household points.
  const creditPoints = useCallback((delta: number) => {
    if (delta === 0) return;
    setMembers(prev => prev.map(m => m.uid === 'test-user-id'
      ? { ...m, points: { daily: m.points.daily + delta, weekly: m.points.weekly + delta, total: m.points.total + delta } }
      : m));
    setTotalPoints(prev => prev + delta);
  }, []);

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
    if (delta.pointsChange !== 0) {
      if (habit.assignedTo) {
        setMembers(prev => prev.map(m => m.uid === habit.assignedTo
          ? { ...m, points: {
              daily: m.points.daily + delta.pointsChange,
              weekly: m.points.weekly + delta.pointsChange,
              total: m.points.total + delta.pointsChange,
            } }
          : m));
      } else {
        creditPoints(delta.pointsChange);
      }
    }
    return habit.title;
  }, [creditPoints]);

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
        setHabits(prev => prev.map(h => h.id === id
          ? {
              ...h,
              count: 0,
              totalCount: staleResult.datesToRemove.length > 0
                ? Math.max(0, h.totalCount - h.count)
                : h.totalCount,
              completedDates: staleResult.completedDates,
              streakDays: staleResult.streakDays,
              lastUpdated: new Date().toISOString(),
            }
          : h));
        const { daily, weekly, total } = staleResult.pointsDelta;
        if (daily !== 0 || weekly !== 0 || total !== 0) {
          setMembers(prev => prev.map(m => m.uid === 'test-user-id'
            ? { ...m, points: { daily: m.points.daily + daily, weekly: m.points.weekly + weekly, total: m.points.total + total } }
            : m));
          setTotalPoints(prev => prev + total);
        }
        toast.success('Mock: previous period completion undone');
        return;
      }
      effectiveHabit = { ...habit, count: 0, lastUpdated: new Date().toISOString() };
    }

    const result = processToggleHabit(effectiveHabit, direction);
    if (!result) return; // e.g. decrement below 0
    setHabits(prev => prev.map(h => h.id === id ? { ...h, ...result.updatedHabit } : h));
    creditPoints(result.pointsChange);
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
  }, [habits, creditPoints, rewards, unlockedRewardIds]);

  // Manual reset (the card's X button): zero the period counter, drop today
  // from completedDates, and reverse today's awarded points — mirroring the
  // real context's atomic habit+points reset.
  const resetHabit = useCallback(async (id: string) => {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const pointsToRemove = calculateResetPoints(habit);
    const newCompletedDates = habit.completedDates.filter(d => d !== getLocalDateString());
    setHabits(prev => prev.map(h => h.id === id
      ? {
          ...h,
          count: 0,
          completedDates: newCompletedDates,
          streakDays: streakForHabit({ period: h.period, completedDates: newCompletedDates, frozenDates: h.frozenDates }),
          lastUpdated: new Date().toISOString(),
        }
      : h));
    creditPoints(-pointsToRemove);
    toast.success('Mock: Habit reset');
  }, [habits, creditPoints]);

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
  // Derived from the test user's member points so habit toggles/resets move
  // the toolbar figures exactly like the real context (seeded 30/150).
  const dailyPoints = members[0]?.points.daily ?? 0;
  const weeklyPoints = members[0]?.points.weekly ?? 0;
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
    accounts: accounts,
    rewardsInventory: rewards,
    coreTemplates: { expenses: [], buckets: [] },
    stores: stores,
    groceryCategories: groceryCategories,
    habitCategories: habitCategories,
    currency,
    kidModePinHash,
    pendingRedemptions,
    redemptionHistory,
    unlockedRewardIds,
    moduleVisibility,
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
    freezeBank,
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
    autoApplyFreezes: useCallback(async () => {
      if (freezeBank.tokens <= 0) return;
      const today = getLocalDateString();
      const yesterday = getLocalDateString(subDays(new Date(), 1));
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
    }, [habits, freezeBank.tokens]),
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
