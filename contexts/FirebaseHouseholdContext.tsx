import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
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
} from 'firebase/firestore';
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
} from '@/types/schema';
import { calculateSafeToSpend } from '@/utils/safeToSpendCalculator';
import { processToggleHabit, calculateResetPoints, calculateStreak } from '@/utils/habitLogic';
import toast from 'react-hot-toast';
import { isSameDay, isSameWeek, parseISO } from 'date-fns';

interface HouseholdContextType {
  // State
  safeToSpend: number;
  dailyPoints: number;
  weeklyPoints: number;
  totalPoints: number;
  currentUser: HouseholdMember | null;
  accounts: Account[];
  buckets: BudgetBucket[];
  calendarItems: CalendarItem[];
  transactions: Transaction[];
  habits: Habit[];
  activeChallenge: Challenge | null;
  rewardsInventory: RewardItem[];
  freezeBank: { current: number; accrued: number; lastMonth: string };
  insight: string;

  // Account Actions
  addAccount: (account: Account) => Promise<void>;
  updateAccountBalance: (id: string, newBalance: number) => Promise<void>;
  setAccountGoal: (id: string, goal: number) => Promise<void>;

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

  // Transaction Actions
  addTransaction: (tx: Transaction) => Promise<void>;
  updateTransactionCategory: (id: string, category: string) => Promise<void>;

  // Habit Actions
  addHabit: (habit: Habit) => Promise<void>;
  updateHabit: (habit: Habit) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  toggleHabit: (id: string, direction: 'up' | 'down') => Promise<void>;
  resetHabit: (id: string) => Promise<void>;

  // Challenge & Reward Actions
  updateChallenge: (challenge: Challenge) => Promise<void>;
  redeemReward: (rewardId: string) => Promise<void>;
  refreshInsight: () => void;
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
  const [freezeBank] = useState({ current: 2, accrued: 4, lastMonth: '2023-10' });

  // Derived state
  const activeChallenge = challenges.find(c => c.status === 'active') || null;
  const safeToSpend = useMemo(
    () => calculateSafeToSpend(accounts, calendarItems, buckets, transactions),
    [accounts, calendarItems, buckets, transactions]
  );
  const dailyPoints = currentUser?.points.daily || 0;
  const weeklyPoints = currentUser?.points.weekly || 0;
  const totalPoints = currentUser?.points.total || 0;

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

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [householdId, user]);

  // Habit auto-reset logic
  useEffect(() => {
    if (!householdId || habits.length === 0) return;

    const checkResets = async () => {
      const now = new Date();
      const habitsToReset: string[] = [];

      habits.forEach(habit => {
        const lastUpdate = parseISO(habit.lastUpdated);
        let shouldReset = false;

        if (habit.period === 'daily') {
          shouldReset = !isSameDay(now, lastUpdate);
        } else if (habit.period === 'weekly') {
          shouldReset = !isSameWeek(now, lastUpdate);
        }

        if (shouldReset) {
          habitsToReset.push(habit.id);
        }
      });

      // Batch update all habits that need reset
      for (const habitId of habitsToReset) {
        await updateDoc(doc(db, `households/${householdId}/habits`, habitId), {
          count: 0,
          lastUpdated: serverTimestamp(),
        });
      }
    };

    checkResets();
  }, [habits, householdId]);

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
      spent: bucket.spent,
      color: bucket.color,
      isVariable: bucket.isVariable,
      isCore: bucket.isCore,
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

  const deleteCalendarItem = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/calendarItems`, id));
    toast.success('Event deleted');
  };

  const payCalendarItem = async (itemId: string, accountId: string) => {
    if (!householdId || !user) return;

    const item = calendarItems.find(i => i.id === itemId);
    const account = accounts.find(a => a.id === accountId);

    if (!item || !account || item.isPaid) return;

    // 1. Mark as paid
    await updateDoc(doc(db, `households/${householdId}/calendarItems`, itemId), {
      isPaid: true,
    });

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
    await addDoc(collection(db, `households/${householdId}/transactions`), {
      amount: item.amount,
      merchant: item.title,
      category: category,
      date: new Date().toISOString().split('T')[0],
      status: 'verified',
      isRecurring: !!item.isRecurring,
      source: 'recurring',
      autoCategorized: true,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });

    // Update bucket if applicable
    if (item.type === 'expense' && category !== 'Bills' && category !== 'Income') {
      const bucket = buckets.find(b => b.name.toLowerCase() === category.toLowerCase());
      if (bucket) {
        await updateDoc(doc(db, `households/${householdId}/buckets`, bucket.id), {
          spent: bucket.spent + item.amount,
        });
      }
    }

    toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');
  };

  // --- ACTIONS: TRANSACTIONS ---

  const addTransaction = async (tx: Transaction) => {
    if (!householdId || !user) return;

    await addDoc(collection(db, `households/${householdId}/transactions`), {
      ...tx,
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

    // Update bucket if categorized and verified
    if (tx.category && tx.status === 'verified') {
      const bucket = buckets.find(b => b.name.toLowerCase() === tx.category.toLowerCase());
      if (bucket) {
        await updateDoc(doc(db, `households/${householdId}/buckets`, bucket.id), {
          spent: bucket.spent + tx.amount,
        });
      }
    }
  };

  const updateTransactionCategory = async (id: string, category: string) => {
    if (!householdId) return;

    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    await updateDoc(doc(db, `households/${householdId}/transactions`, id), {
      category,
      status: 'verified',
    });

    // Update bucket spent
    const bucket = buckets.find(b => b.name.toLowerCase() === category.toLowerCase());
    if (bucket) {
      await updateDoc(doc(db, `households/${householdId}/buckets`, bucket.id), {
        spent: bucket.spent + tx.amount,
      });
    }

    toast.success('Categorized!');
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
    if (!householdId || !currentUser) return;

    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    // Use extracted business logic
    const result = processToggleHabit(habit, direction, currentUser);
    if (!result) return;

    // Update habit in Firestore
    await updateDoc(doc(db, `households/${householdId}/habits`, id), {
      count: result.updatedHabit.count,
      totalCount: result.updatedHabit.totalCount,
      completedDates: result.updatedHabit.completedDates,
      streakDays: result.updatedHabit.streakDays,
      lastUpdated: serverTimestamp(),
    });

    // Update user points
    if (result.pointsChange !== 0) {
      await updateDoc(doc(db, `households/${householdId}/members`, currentUser.uid), {
        'points.daily': currentUser.points.daily + result.pointsChange,
        'points.weekly': currentUser.points.weekly + result.pointsChange,
        'points.total': currentUser.points.total + result.pointsChange,
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
    if (!householdId || !currentUser) return;

    const habit = habits.find(h => h.id === id);
    if (!habit || habit.count === 0) return;

    const pointsToRemove = calculateResetPoints(habit);

    await updateDoc(doc(db, `households/${householdId}/habits`, id), {
      count: 0,
      completedDates: habit.completedDates.filter(d => d !== new Date().toISOString().split('T')[0]),
      streakDays: calculateStreak(habit.completedDates.filter(d => d !== new Date().toISOString().split('T')[0])),
      lastUpdated: serverTimestamp(),
    });

    if (pointsToRemove > 0) {
      await updateDoc(doc(db, `households/${householdId}/members`, currentUser.uid), {
        'points.daily': currentUser.points.daily - pointsToRemove,
        'points.weekly': currentUser.points.weekly - pointsToRemove,
        'points.total': currentUser.points.total - pointsToRemove,
      });
    }

    toast('Reset', { icon: '↺' });
  };

  // --- ACTIONS: CHALLENGES & REWARDS ---

  const updateChallenge = async (challenge: Challenge) => {
    if (!householdId) return;
    if (activeChallenge) {
      await updateDoc(doc(db, `households/${householdId}/challenges`, activeChallenge.id), {
        month: challenge.month,
        title: challenge.title,
        relatedHabitIds: challenge.relatedHabitIds,
        targetTotalCount: challenge.targetTotalCount,
        yearlyRewardLabel: challenge.yearlyRewardLabel,
        status: challenge.status,
      });
    } else {
      await addDoc(collection(db, `households/${householdId}/challenges`), challenge);
    }
    toast.success('Challenge Updated');
  };

  const redeemReward = async (rewardId: string) => {
    if (!householdId || !currentUser) return;

    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return;

    if (currentUser.points.total < reward.cost) {
      toast.error('Not enough points');
      return;
    }

    await updateDoc(doc(db, `households/${householdId}/members`, currentUser.uid), {
      'points.total': currentUser.points.total - reward.cost,
    });

    toast.success(`Redeemed: ${reward.title}`);
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

  return (
    <FirebaseHouseholdContext.Provider
      value={{
        safeToSpend,
        dailyPoints,
        weeklyPoints,
        totalPoints,
        currentUser,
        accounts,
        buckets,
        calendarItems,
        transactions,
        habits,
        activeChallenge,
        rewardsInventory: rewards,
        freezeBank,
        insight,
        addAccount,
        updateAccountBalance,
        setAccountGoal,
        addBucket,
        updateBucket,
        deleteBucket,
        updateBucketLimit,
        reallocateBucket,
        addCalendarItem,
        updateCalendarItem,
        deleteCalendarItem,
        payCalendarItem,
        addTransaction,
        updateTransactionCategory,
        addHabit,
        updateHabit,
        deleteHabit,
        toggleHabit,
        resetHabit,
        updateChallenge,
        redeemReward,
        refreshInsight,
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
