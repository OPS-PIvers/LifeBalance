import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from 'react';
import {
  collection,
  query,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
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
} from '@/types/schema';
import { calculateSafeToSpend } from '@/utils/safeToSpendCalculator';
import { processToggleHabit, calculateResetPoints, calculateStreak, calculatePointsForDate, calculatePointsForDateRange, isHabitStale, getMultiplier } from '@/utils/habitLogic';
import { getPayPeriodForTransaction } from '@/utils/paycheckPeriodCalculator';
import { calculateBucketSpent, getTransactionsForBucket, type BucketSpent } from '@/utils/bucketSpentCalculator';
import { migrateTransactionsToPeriods, migrateBucketsToPeriods, needsMigration, migrateToPaycheckPeriods, needsPaycheckMigration } from '@/utils/migrations/payPeriodMigration';
import { migrateFreezeBankToEnhanced, needsFreezeBankMigration } from '@/utils/migrations/freezeBankMigration';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { canUseFreezeBankToken } from '@/utils/freezeBankValidator';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';
import toast from 'react-hot-toast';
import { isSameDay, isSameWeek, parseISO, format, subDays, startOfWeek } from 'date-fns';

interface HouseholdContextType {
  // State
  safeToSpend: number;
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

  // Pay Period Tracking State
  currentPeriodId: string;
  bucketSpentMap: Map<string, BucketSpent>;
  householdSettings: Household | null;

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

  // Habit Actions
  addHabit: (habit: Habit) => Promise<void>;
  updateHabit: (habit: Habit) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
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
  refreshInsight: () => void;

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
}

const FirebaseHouseholdContext = createContext<HouseholdContextType | undefined>(undefined);

export const FirebaseHouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, householdId } = useAuth();

  // Real-time state from Firestore
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [buckets, setBuckets] = useState<BudgetBucket[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currentUser, setCurrentUser] = useState<HouseholdMember | null>(null);
  const [insight, setInsight] = useState("You spend 20% less on days you exercise.");
  const [yearlyGoals, setYearlyGoals] = useState<YearlyGoal[]>([]);
  const [freezeBank, setFreezeBank] = useState<FreezeBank | null>(null);

  // Pay Period Tracking State
  const [householdSettings, setHouseholdSettings] = useState<Household | null>(null);
  const [currentPeriodId, setCurrentPeriodId] = useState<string>('');
  const [bucketSpentMap, setBucketSpentMap] = useState<Map<string, BucketSpent>>(new Map());

  // Derived state
  const activeChallenge = challenges.find(c => c.status === 'active') || null;
  const activeYearlyGoals = useMemo(() => yearlyGoals.filter(g => g.status === 'in_progress'), [yearlyGoals]);
  const primaryYearlyGoal = activeYearlyGoals[0] || null;
  const safeToSpend = useMemo(
    () => calculateSafeToSpend(accounts, calendarItems, buckets, transactions, currentPeriodId),
    [accounts, calendarItems, buckets, transactions, currentPeriodId]
  );
  const dailyPoints = householdSettings?.points?.daily || 0;
  const weeklyPoints = householdSettings?.points?.weekly || 0;
  const totalPoints = householdSettings?.points?.total || 0;

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

    // Transactions listener
    const txQuery = query(collection(db, `households/${householdId}/transactions`));
    unsubscribers.push(
      onSnapshot(txQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Transaction));
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
      onSnapshot(membersQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as HouseholdMember));
        setMembers(data);

        // Set current user
        const current = data.find(m => m.uid === user?.uid);
        setCurrentUser(current || null);
      })
    );

    // Household settings listener (for pay period tracking and freeze bank)
    const householdDocRef = doc(db, `households/${householdId}`);
    unsubscribers.push(
      onSnapshot(householdDocRef, async (snapshot) => {
        const data = snapshot.data() as Household | undefined;
        setHouseholdSettings(data || null);

        // Extract and set freezeBank
        if (data?.freezeBank) {
          // Check if migration is needed
          if (needsFreezeBankMigration(data.freezeBank)) {
            try {
              await migrateFreezeBankToEnhanced(householdId, data.freezeBank as any);
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
      })
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [householdId, user]);

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
      console.log(`[checkPointsReset] Daily reset: recalculated ${todayPoints} pts from today's habits`);
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
      console.log(`[checkPointsReset] Weekly reset: recalculated ${weeklyPoints} pts from ${weekStartStr} to ${today}`);
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

  // Sync current period ID from household settings (paycheck-based tracking)
  useEffect(() => {
    setCurrentPeriodId(householdSettings?.lastPaycheckDate || '');
  }, [householdSettings?.lastPaycheckDate]);

  // Calculate bucket spent amounts whenever transactions, buckets, or period changes
  useEffect(() => {
    const spentMap = calculateBucketSpent(buckets, transactions, currentPeriodId);
    setBucketSpentMap(spentMap);
  }, [buckets, transactions, currentPeriodId]);

  // Run data migration if needed
  useEffect(() => {
    if (!householdId || !householdSettings?.startDate || !currentPeriodId) return;
    if (transactions.length === 0 && buckets.length === 0) return; // No data to migrate

    const runMigrations = async () => {
      if (needsMigration(transactions, buckets)) {
        console.log('[Migration] Starting pay period migration...');
        try {
          await migrateTransactionsToPeriods(householdId, householdSettings.startDate!);
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

  // Sync daily/weekly/total points from actual habit completions
  // This ensures points accurately reflect completed habits, fixing any desync issues
  // ALWAYS recalculates and updates if values don't match - no complex conditional logic
  useEffect(() => {
    if (!householdId || !householdSettings || habits.length === 0) return;

    const syncHouseholdPoints = async () => {
      const now = new Date();
      const today = format(now, 'yyyy-MM-dd');
      const currentPoints = householdSettings.points || { daily: 0, weekly: 0, total: 0 };

      // Calculate what points SHOULD be based on actual habit completions
      const correctDailyPoints = calculatePointsForDate(habits, today);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const correctWeeklyPoints = calculatePointsForDateRange(habits, weekStartStr, today);

      // Total should be at least as much as weekly (it's cumulative and never resets)
      // If total < weekly, something is wrong - fix it
      const correctTotalPoints = Math.max(currentPoints.total, correctWeeklyPoints);

      // Check if ANY value needs fixing
      const needsUpdate =
        currentPoints.daily !== correctDailyPoints ||
        currentPoints.weekly !== correctWeeklyPoints ||
        currentPoints.total !== correctTotalPoints;

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
  }, [householdId, householdSettings?.points, habits]);

  // --- ACTIONS: ACCOUNTS ---

  const addAccount = async (account: Account) => {
    if (!householdId || !user) return;
    await addDoc(collection(db, `households/${householdId}/accounts`), {
      ...account,
      createdBy: user.uid,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account added');
  };

  const updateAccountBalance = async (id: string, newBalance: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      balance: newBalance,
      lastUpdated: serverTimestamp(),
    });
    toast.success('Account updated');
  };

  const setAccountGoal = async (id: string, goal: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, id), {
      monthlyGoal: goal,
    });
    toast.success('Goal set');
  };

  const deleteAccount = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/accounts`, id));
    toast.success('Account deleted');
  };

  const updateAccountOrder = async (accountId: string, newOrder: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/accounts`, accountId), {
      order: newOrder,
    });
  };

  const reorderAccounts = async (orderedIds: string[]) => {
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
  };

  // --- ACTIONS: BUCKETS ---

  const addBucket = async (bucket: BudgetBucket) => {
    if (!householdId || !user) return;
    await addDoc(collection(db, `households/${householdId}/buckets`), {
      ...bucket,
      createdBy: user.uid,
    });
    toast.success('Bucket added');
  };

  const updateBucket = async (bucket: BudgetBucket) => {
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
  };

  const deleteBucket = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/buckets`, id));
    toast.success('Bucket deleted');
  };

  const updateBucketLimit = async (id: string, newLimit: number) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/buckets`, id), {
      limit: newLimit,
    });
    toast.success('Limit updated');
  };

  const reallocateBucket = async (sourceId: string, targetId: string, amount: number) => {
    if (!householdId) return;

    const sourceBucket = buckets.find(b => b.id === sourceId);
    const targetBucket = buckets.find(b => b.id === targetId);

    if (!sourceBucket || !targetBucket) return;

    await updateDoc(doc(db, `households/${householdId}/buckets`, sourceId), {
      limit: sourceBucket.limit - amount,
    });

    await updateDoc(doc(db, `households/${householdId}/buckets`, targetId), {
      limit: targetBucket.limit + amount,
    });

    toast.success('Funds reallocated');
  };

  // --- ACTIONS: CALENDAR ---

  const addCalendarItem = async (item: CalendarItem) => {
    if (!householdId || !user) return;
    await addDoc(collection(db, `households/${householdId}/calendarItems`), {
      ...item,
      createdBy: user.uid,
    });
    toast.success('Event added');
  };

  const updateCalendarItem = async (item: CalendarItem) => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/calendarItems`, item.id), {
      title: item.title,
      amount: item.amount,
      date: item.date,
      type: item.type,
      isPaid: item.isPaid,
      isRecurring: item.isRecurring,
      frequency: item.frequency,
    });
    toast.success('Event updated');
  };

  const deleteRecurringInstance = async (syntheticId: string) => {
    if (!householdId || !user) return;

    // Parse synthetic ID to get template ID and date
    const parts = syntheticId.split('-202');
    const parentRecurringId = parts[0];
    const specificDate = '202' + parts[1];

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
  };

  const deleteCalendarItem = async (id: string) => {
    if (!householdId) return;

    // Check if this is a recurring instance (synthetic ID with date suffix)
    const isRecurringInstance = id.includes('-202');

    if (isRecurringInstance) {
      // Delete only this instance, not the entire series
      await deleteRecurringInstance(id);
    } else {
      // Direct deletion for non-recurring items or templates
      await deleteDoc(doc(db, `households/${householdId}/calendarItems`, id));
      toast.success('Event deleted');
    }
  };

  const payCalendarItem = async (itemId: string, accountId: string) => {
    if (!householdId || !user) return;

    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    // Check if this is a recurring instance (synthetic ID like "originalId-2024-01-15")
    const isRecurringInstance = itemId.includes('-202');

    let item: CalendarItem | undefined;
    let parentRecurringId: string | undefined;
    let specificDate: string;

    if (isRecurringInstance) {
      // Parse synthetic ID to get original template ID and date
      const parts = itemId.split('-202');
      parentRecurringId = parts[0];
      specificDate = '202' + parts[1]; // Reconstruct the date part

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

    // 2. Update account balance
    const newBalance = item.type === 'expense' ? account.balance - item.amount : account.balance + item.amount;

    await updateDoc(doc(db, `households/${householdId}/accounts`, accountId), {
      balance: newBalance,
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
    const transactionDate = new Date().toISOString().split('T')[0];
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
  };

  const deferCalendarItem = async (itemId: string) => {
    if (!householdId || !user) return;

    // Check if this is a recurring instance (synthetic ID like "originalId-2024-01-15")
    const isRecurringInstance = itemId.includes('-202');

    if (isRecurringInstance) {
      // For recurring instances, create a one-time reminder for tomorrow
      const parts = itemId.split('-202');
      const parentRecurringId = parts[0];
      const specificDate = '202' + parts[1];

      // Find the recurring template
      const template = calendarItems.find(i => i.id === parentRecurringId);
      if (!template) return;

      // Calculate tomorrow's date from the specific instance date
      const currentDate = parseISO(specificDate);
      const newDate = format(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

      // Create a one-time non-recurring item for tomorrow
      await addDoc(collection(db, `households/${householdId}/calendarItems`), {
        title: template.title,
        amount: template.amount,
        date: newDate,
        type: template.type,
        isPaid: false,
        isRecurring: false,
        createdBy: user.uid,
      });

      toast.success('Deferred to tomorrow (one-time)');
    } else {
      // Non-recurring item - just move the date
      const item = calendarItems.find(i => i.id === itemId);
      if (!item) return;

      const currentDate = parseISO(item.date);
      const newDate = format(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

      await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
        date: newDate,
      });

      toast.success('Deferred to tomorrow');
    }
  };

  // --- ACTIONS: TRANSACTIONS ---

  const addTransaction = async (tx: Transaction) => {
    if (!householdId || !user) return;

    // Assign pay period ID based on paycheck approval
    const payPeriodId = getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate);

    await addDoc(collection(db, `households/${householdId}/transactions`), {
      ...tx,
      payPeriodId,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });

    // Update checking account balance
    const checkingAcc = accounts.find(a => a.type === 'checking');
    if (checkingAcc) {
      await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
        balance: checkingAcc.balance - tx.amount,
        lastUpdated: serverTimestamp(),
      });
    }

    // DO NOT update bucket.spent - it's now calculated in real-time from transactions
    // The bucketSpentMap effect will automatically recalculate when transactions change
  };

  const updateTransactionCategory = async (id: string, category: string, relatedHabitIds?: string[]) => {
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
          const result = processToggleHabit(habit, 'up', currentUser);
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
  };

  const updateTransaction = async (id: string, updates: Partial<Transaction>) => {
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

      // Update transaction in Firestore
      await updateDoc(doc(db, `households/${householdId}/transactions`, id), {
        ...updates,
        payPeriodId,
      });

      // Update checking account balance if amount changed
      if (amountDifference !== 0) {
        const checkingAcc = accounts.find(a => a.type === 'checking');
        if (checkingAcc) {
          await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
            balance: checkingAcc.balance - amountDifference,
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
  };

  const deleteTransaction = async (id: string) => {
    if (!householdId) return;

    try {
      const transaction = transactions.find(tx => tx.id === id);
      if (!transaction) {
        toast.error('Transaction not found');
        return;
      }

      // Restore checking account balance
      const checkingAcc = accounts.find(a => a.type === 'checking');
      if (checkingAcc) {
        await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
          balance: checkingAcc.balance + transaction.amount,
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
  };

  // --- ACTIONS: HABITS ---

  const addHabit = async (habit: Habit) => {
    if (!householdId || !user) return;
    try {
      await addDoc(collection(db, `households/${householdId}/habits`), {
        ...habit,
        createdBy: user.uid,
        isShared: habit.isShared ?? true,
        ownerId: habit.isShared ? null : user.uid,
        lastUpdated: serverTimestamp(),
      });
      toast.success('Habit created');
    } catch (error) {
      console.error('[addHabit] Failed to create habit:', error);
      toast.error('Failed to create habit. Please try again.');
      throw error;
    }
  };

  const updateHabit = async (habit: Habit) => {
    if (!householdId) return;
    console.log('[updateHabit] Updating habit with scoringType:', habit.scoringType, 'full habit:', habit);
    try {
      // Build update object, filtering out undefined values (Firestore rejects undefined)
      const updateData = Object.fromEntries(
        Object.entries({
          title: habit.title,
          category: habit.category,
          type: habit.type,
          basePoints: habit.basePoints,
          scoringType: habit.scoringType,
          period: habit.period,
          targetCount: habit.targetCount,
          weatherSensitive: habit.weatherSensitive ?? false,
          telegramAlias: habit.telegramAlias,
          isShared: habit.isShared,
          ownerId: habit.ownerId,
          isCustom: habit.isCustom,
          effortLevel: habit.effortLevel,
          presetId: habit.presetId,
        }).filter(([, value]) => value !== undefined)
      );

      await updateDoc(doc(db, `households/${householdId}/habits`, habit.id), {
        ...updateData,
        lastUpdated: serverTimestamp(),
      });
      console.log('[updateHabit] Update complete');
    } catch (error) {
      console.error('[updateHabit] Failed to update habit:', error);
      throw error;
    }
  };

  const deleteHabit = async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/habits`, id));
    } catch (error) {
      console.error('[deleteHabit] Failed to delete habit:', error);
      throw error;
    }
  };

  const toggleHabit = async (id: string, direction: 'up' | 'down') => {
    if (!householdId || !currentUser || !householdSettings) return;

    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    // LAZY RESET CHECK
    // If habit is stale (last updated yesterday/last week), reset it first in memory
    // This prevents negative points if user toggles 'down' on a stale habit
    // and ensures 'up' starts from 0 for the new day
    const isStale = isHabitStale(habit);
    let effectiveHabit = habit;

    // Use Firestore's serverTimestamp() in all writes here to ensure a consistent server-side
    // notion of "now" across this operation and to stay aligned with the rest of the codebase.
    // The isHabitStale helper handles Firestore Timestamp objects correctly.

    if (isStale) {
      // If toggling down on a stale habit, just perform a reset (0 points)
      if (direction === 'down') {
        // Intentionally only resetting `count` here:
        // - We want to prevent negative points when the previous period's progress is stale.
        // - We do NOT call `resetHabit` or clear `completedDates` / `streakDays` because the user
        //   has not taken a new action that should break their historical streak.
        // - This mirrors `checkHabitResets`, which also only resets `count` on a new day/week.
        // Full resets that affect streak history should continue to go through `resetHabit`.
        await updateDoc(doc(db, `households/${householdId}/habits`, id), {
          count: 0,
          lastUpdated: serverTimestamp(),
        });

        // No points change for stale reset; this syncs the habit to today without undoing past points.
        toast("Habit reset to 0 for today. Previous points preserved.", { icon: '📅' });
        return;
      }

      // If toggling up, proceed as if count was 0.
      // We skip the explicit reset write here to avoid a double-write race condition.
      // The final write below will handle the update atomically from the user's perspective.
      effectiveHabit = {
        ...habit,
        count: 0,
        // Use current time string for local logic consistency
        lastUpdated: new Date().toISOString(),
      };
    }

    // Use extracted business logic
    const result = processToggleHabit(effectiveHabit, direction, currentUser);
    if (!result) return;

    // Update habit in Firestore
    await updateDoc(doc(db, `households/${householdId}/habits`, id), {
      count: result.updatedHabit.count,
      totalCount: result.updatedHabit.totalCount,
      completedDates: result.updatedHabit.completedDates,
      streakDays: result.updatedHabit.streakDays,
      lastUpdated: serverTimestamp(),
    });

    // Update household points (shared across all members)
    // Use increment() for atomic server-side calculation to avoid race conditions
    if (result.pointsChange !== 0) {
      await updateDoc(doc(db, `households/${householdId}`), {
        'points.daily': increment(result.pointsChange),
        'points.weekly': increment(result.pointsChange),
        'points.total': increment(result.pointsChange),
      });

      // Toast feedback
      const sign = result.pointsChange > 0 ? '+' : '';
      toast(
        <div className="flex items-center gap-2">
          <span className="font-bold">{sign}{result.pointsChange} pts</span>
          <span className="text-sm opacity-80">({result.multiplier}x)</span>
        </div>,
        {
          duration: 1500,
          icon: result.pointsChange > 0 ? '🌟' : '📉',
          style: {
            background: result.pointsChange > 0 ? '#ECFDF5' : '#FFF1F2',
            color: result.pointsChange > 0 ? '#065F46' : '#9F1239',
            border: result.pointsChange > 0 ? '1px solid #A7F3D0' : '1px solid #FECDD3',
          },
        }
      );
    }
  };

  const resetHabit = async (id: string) => {
    if (!householdId || !householdSettings) return;

    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    // Check if habit is stale (from yesterday)
    const isStale = isHabitStale(habit);

    // Optimization: If habit count is 0 and it's not stale, there's nothing to reset.
    if (habit.count === 0 && !isStale) return;

    // If it's stale, we shouldn't subtract points because we didn't earn them today
    const pointsToRemove = isStale ? 0 : calculateResetPoints(habit);

    // If it's stale and already 0, we just need to update the timestamp to prevent further "stale" checks today
    if (isStale && habit.count === 0) {
      await updateDoc(doc(db, `households/${householdId}/habits`, id), {
        lastUpdated: serverTimestamp(),
      });
      toast('Reset', { icon: '↺' });
      return; // No point deduction or streak recalculation needed for 0 -> 0 reset
    }

    // Filter out today's date if present (handling both stale and non-stale cases)
    const today = format(new Date(), 'yyyy-MM-dd');
    const newCompletedDates = habit.completedDates.filter(d => d !== today);

    await updateDoc(doc(db, `households/${householdId}/habits`, id), {
      count: 0,
      completedDates: newCompletedDates,
      streakDays: calculateStreak(newCompletedDates),
      lastUpdated: serverTimestamp(),
    });

    // Use increment() with negative value for atomic server-side calculation
    if (pointsToRemove > 0) {
      await updateDoc(doc(db, `households/${householdId}`), {
        'points.daily': increment(-pointsToRemove),
        'points.weekly': increment(-pointsToRemove),
        'points.total': increment(-pointsToRemove),
      });
    }

    toast('Reset', { icon: '↺' });
  };

  // --- ACTIONS: HABIT SUBMISSIONS ---

  const addHabitSubmission = async (habitId: string, count: number, timestamp?: string) => {
    if (!householdId || !currentUser) return;

    const habit = habits.find(h => h.id === habitId);
    if (!habit) {
      toast.error('Habit not found');
      return;
    }

    // Use provided timestamp or current time
    const submissionTimestamp = timestamp || new Date().toISOString();
    const submissionDate = format(parseISO(submissionTimestamp), 'yyyy-MM-dd');

    // Calculate points based on current state
    const currentStreak = calculateStreak(habit.completedDates);
    const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

    let pointsEarned = 0;
    if (habit.scoringType === 'incremental') {
      pointsEarned = count * Math.floor(habit.basePoints * multiplier);
    } else {
      // Threshold: check if this submission hits target
      const newCount = habit.count + count;
      if (newCount >= habit.targetCount && habit.count < habit.targetCount) {
        pointsEarned = Math.floor(habit.basePoints * multiplier);
      }
    }

    try {
      // Create submission document
      const submission: Omit<HabitSubmission, 'id'> = {
        habitId,
        habitTitle: habit.title,
        timestamp: submissionTimestamp,
        date: submissionDate,
        count,
        pointsEarned,
        streakDaysAtTime: currentStreak,
        multiplierApplied: multiplier,
        createdBy: currentUser.uid,
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, `households/${householdId}/habits/${habitId}/submissions`), submission);

      // Update habit's completedDates and count (maintain backwards compatibility)
      const updatedCompletedDates = [...habit.completedDates];
      if (!updatedCompletedDates.includes(submissionDate)) {
        updatedCompletedDates.push(submissionDate);
        updatedCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      }

      await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
        count: habit.count + count,
        totalCount: habit.totalCount + count,
        completedDates: updatedCompletedDates,
        streakDays: calculateStreak(updatedCompletedDates),
        hasSubmissionTracking: true,
        lastUpdated: serverTimestamp(),
      });

      // Update household points
      if (pointsEarned !== 0) {
        await updateDoc(doc(db, `households/${householdId}`), {
          'points.daily': increment(pointsEarned),
          'points.weekly': increment(pointsEarned),
          'points.total': increment(pointsEarned),
        });
      }

      toast.success(`Logged +${count} submission(s)`);
    } catch (error) {
      console.error('[addHabitSubmission] Failed:', error);
      toast.error('Failed to add submission');
    }
  };

  const getHabitSubmissions = async (
    habitId: string,
    startDate?: string,
    endDate?: string
  ): Promise<HabitSubmission[]> => {
    if (!householdId) return [];

    try {
      let submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        orderBy('timestamp', 'desc')
      );

      // Add date range filters if provided
      if (startDate) {
        submissionsQuery = query(submissionsQuery, where('date', '>=', startDate));
      }
      if (endDate) {
        submissionsQuery = query(submissionsQuery, where('date', '<=', endDate));
      }

      const snapshot = await getDocs(submissionsQuery);
      return snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      } as HabitSubmission));
    } catch (error) {
      console.error('[getHabitSubmissions] Failed:', error);
      return [];
    }
  };

  const deleteHabitSubmission = async (habitId: string, submissionId: string) => {
    if (!householdId) return;

    try {
      // Step 1: Get submission to calculate point reversal
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const submission = submissionSnap.data() as HabitSubmission;
      const habit = habits.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Check if this is the last submission for this date
      const submissionsQuery = query(
        collection(db, `households/${householdId}/habits/${habitId}/submissions`),
        where('date', '==', submission.date)
      );
      const submissionsSnap = await getDocs(submissionsQuery);
      const isLastForDate = submissionsSnap.size === 1;

      // Step 3: Update habit's completedDates if removing last submission for date
      const updates: any = {
        count: Math.max(0, habit.count - submission.count),
        totalCount: Math.max(0, habit.totalCount - submission.count),
        lastUpdated: serverTimestamp(),
      };

      if (isLastForDate) {
        const updatedCompletedDates = habit.completedDates.filter(d => d !== submission.date);
        updates.completedDates = updatedCompletedDates;
        updates.streakDays = calculateStreak(updatedCompletedDates);
      }

      await updateDoc(doc(db, `households/${householdId}/habits`, habitId), updates);

      // Step 4: Delete submission document
      await deleteDoc(submissionRef);

      // Step 5: Reverse points
      const today = format(new Date(), 'yyyy-MM-dd');
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

      const pointUpdates: any = {
        'points.total': increment(-submission.pointsEarned),
      };

      if (submission.date === today) {
        pointUpdates['points.daily'] = increment(-submission.pointsEarned);
      }

      if (submission.date >= weekStart && submission.date <= today) {
        pointUpdates['points.weekly'] = increment(-submission.pointsEarned);
      }

      await updateDoc(doc(db, `households/${householdId}`), pointUpdates);

      toast.success('Submission deleted');
    } catch (error) {
      console.error('[deleteHabitSubmission] Failed:', error);
      toast.error('Failed to delete submission');
    }
  };

  const updateHabitSubmission = async (
    habitId: string,
    submissionId: string,
    updates: Partial<HabitSubmission>
  ) => {
    if (!householdId) return;

    try {
      // Step 1: Get original submission to calculate point difference
      const submissionRef = doc(db, `households/${householdId}/habits/${habitId}/submissions`, submissionId);
      const submissionSnap = await getDoc(submissionRef);

      if (!submissionSnap.exists()) {
        toast.error('Submission not found');
        return;
      }

      const originalSubmission = submissionSnap.data() as HabitSubmission;
      const habit = habits.find(h => h.id === habitId);
      if (!habit) return;

      // Step 2: Calculate new points if count changed
      let pointsDelta = 0;
      if (updates.count !== undefined && updates.count !== originalSubmission.count) {
        const countDelta = updates.count - originalSubmission.count;

        if (habit.scoringType === 'incremental') {
          pointsDelta = countDelta * Math.floor(habit.basePoints * originalSubmission.multiplierApplied);
        } else {
          // For threshold, disallow count edits (too complex to recalculate)
          toast.error('Cannot edit count for threshold habits. Delete and re-add instead.');
          return;
        }
      }

      // Step 3: Update submission document
      await updateDoc(submissionRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });

      // Step 4: Update habit aggregate counts
      if (updates.count !== undefined) {
        const countDelta = updates.count - originalSubmission.count;
        await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
          count: habit.count + countDelta,
          totalCount: habit.totalCount + countDelta,
          lastUpdated: serverTimestamp(),
        });
      }

      // Step 5: Update household points
      if (pointsDelta !== 0) {
        const submissionDate = updates.date || originalSubmission.date;
        const today = format(new Date(), 'yyyy-MM-dd');
        const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

        const pointUpdates: any = {
          'points.total': increment(pointsDelta),
        };

        // Only update daily if edited submission is from today
        if (submissionDate === today) {
          pointUpdates['points.daily'] = increment(pointsDelta);
        }

        // Only update weekly if edited submission is from this week
        if (submissionDate >= weekStart && submissionDate <= today) {
          pointUpdates['points.weekly'] = increment(pointsDelta);
        }

        await updateDoc(doc(db, `households/${householdId}`), pointUpdates);
      }

      toast.success('Submission updated');
    } catch (error) {
      console.error('[updateHabitSubmission] Failed:', error);
      toast.error('Failed to update submission');
    }
  };

  // --- ACTIONS: CHALLENGES & REWARDS ---

  const updateChallenge = async (challenge: Challenge) => {
    if (!householdId) return;

    // Calculate currentValue from linked habits
    const linkedHabits = habits.filter(h => challenge.relatedHabitIds.includes(h.id));
    const { currentValue, progress } = calculateChallengeProgress(challenge, linkedHabits);

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...newChallengeData } = updatedChallenge;

      await addDoc(collection(db, `households/${householdId}/challenges`), {
        ...newChallengeData,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });
    }
    toast.success('Challenge Updated');
  };

  const markChallengeComplete = async (challengeId: string, success: boolean) => {
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
  };

  const redeemReward = async (rewardId: string) => {
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
  };

  // --- ACTIONS: YEARLY GOALS ---

  const createYearlyGoal = async (goal: Omit<YearlyGoal, 'id'>) => {
    if (!householdId || !user) return;

    await addDoc(collection(db, `households/${householdId}/yearlyGoals`), {
      ...goal,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      status: 'in_progress',
      successfulMonths: [],
    });

    toast.success('Yearly goal created!');
  };

  const updateYearlyGoal = async (goalId: string, updates: Partial<YearlyGoal>) => {
    if (!householdId) return;

    await updateDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId), updates);
    toast.success('Yearly goal updated');
  };

  const updateYearlyGoalProgress = async (goalId: string, month: string, success: boolean) => {
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

    const updates: any = {
      successfulMonths: updatedMonths,
    };

    if (isAchieved && goal.status !== 'achieved') {
      updates.status = 'achieved';
      updates.achievedAt = serverTimestamp();
    }

    await updateDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId), updates);

    if (isAchieved) {
      toast.success(`🎉 Yearly goal achieved: ${goal.title}!`, { duration: 5000 });
    }
  };

  const deleteYearlyGoal = async (goalId: string) => {
    if (!householdId) return;

    await deleteDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId));
    toast.success('Yearly goal deleted');
  };

  // --- ACTIONS: FREEZE BANK ---

  const useFreezeBankToken = async (habitId: string, targetDate: string) => {
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
  };

  const rolloverFreezeBankTokens = async () => {
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
  };

  // --- ACTIONS: MEMBER MANAGEMENT ---

  const addMember = async (memberData: Partial<HouseholdMember>) => {
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
  };

  const updateMember = async (memberId: string, updates: Partial<HouseholdMember>) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, `households/${householdId}/members`, memberId), updates);
      toast.success('Member updated successfully');
    } catch (error) {
      console.error('[updateMember] Failed:', error);
      toast.error('Failed to update member');
      throw error;
    }
  };

  const removeMember = async (memberId: string) => {
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
  };

  // --- ACTIONS: PAY PERIOD MANAGEMENT ---

  const resetBucketsForNewPeriod = async (newPeriodId: string) => {
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

      // Commit all changes atomically
      await batch.commit();
      toast.success('Buckets reset for new pay period');
    } catch (error) {
      console.error('[resetBucketsForNewPeriod] Failed:', error);
      toast.error('Failed to reset period. Please try again.');
    }
  };

  const handlePaycheckApproval = async (paycheckDate: string) => {
    if (!householdId || !user) return;

    if (!currentPeriodId) {
      // First paycheck ever - initialize period tracking
      await initializeFirstPeriod(paycheckDate);
      return;
    }

    // Reset buckets for the period that just ended
    await resetBucketsForNewPeriod(paycheckDate);

    // Update household's last paycheck date
    const householdRef = doc(db, `households/${householdId}`);
    await updateDoc(householdRef, {
      lastPaycheckDate: paycheckDate,
    });
  };

  const initializeFirstPeriod = async (paycheckDate: string) => {
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
    }
  };

  const refreshInsight = () => {
    const insights = [
      "You spend 20% less on days you exercise.",
      "Your grocery spending is highest on Sundays.",
      "Great job maintaining your reading streak!",
      "You've saved $50 more this week than last week.",
    ];
    const random = insights[Math.floor(Math.random() * insights.length)];
    setInsight(random);
    toast('Insight refreshed', { icon: '✨' });
  };

  // Check for freeze bank rollover on 1st of month (or first login)
  const checkFreezeBankRollover = useCallback(async () => {
    if (!householdId || !freezeBank) return;

    const currentMonth = format(new Date(), 'yyyy-MM');

    // Check if we're in a new month
    if (freezeBank.lastRolloverMonth !== currentMonth) {
      await rolloverFreezeBankTokens();
    }
  }, [householdId, freezeBank]);

  // Use midnight scheduler to check for rollover with a delay to avoid conflicts
  useMidnightScheduler(checkFreezeBankRollover, !!(householdId && freezeBank), { initialDelayMs: 500 });

  return (
    <FirebaseHouseholdContext.Provider
      value={{
        safeToSpend,
        dailyPoints,
        weeklyPoints,
        totalPoints,
        currentUser,
        members,
        accounts,
        buckets,
        calendarItems,
        transactions,
        habits,
        activeChallenge,
        challenges,
        yearlyGoals,
        activeYearlyGoals,
        primaryYearlyGoal,
        rewardsInventory: rewards,
        freezeBank,
        insight,
        currentPeriodId,
        bucketSpentMap,
        householdSettings,
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
        addHabit,
        updateHabit,
        deleteHabit,
        toggleHabit,
        resetHabit,
        addHabitSubmission,
        updateHabitSubmission,
        deleteHabitSubmission,
        getHabitSubmissions,
        updateChallenge,
        markChallengeComplete,
        redeemReward,
        refreshInsight,
        createYearlyGoal,
        updateYearlyGoal,
        updateYearlyGoalProgress,
        deleteYearlyGoal,
        useFreezeBankToken,
        rolloverFreezeBankTokens,
        addMember,
        updateMember,
        removeMember,
      }}
    >
      {children}
    </FirebaseHouseholdContext.Provider>
  );
};

export const useHousehold = () => {
  const context = useContext(FirebaseHouseholdContext);
  if (!context) {
    throw new Error('useHousehold must be used within FirebaseHouseholdProvider');
  }
  return context;
};
