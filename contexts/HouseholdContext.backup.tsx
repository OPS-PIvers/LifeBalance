
import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect } from 'react';
import { Transaction, HouseholdMember, Habit, Account, BudgetBucket, CalendarItem, Challenge, RewardItem } from '../types/schema';
import { format, subDays, parseISO, isAfter, isBefore, endOfMonth, startOfToday, isSameWeek, isSameDay } from 'date-fns';
import toast from 'react-hot-toast';

interface HouseholdContextType {
  // Finance
  safeToSpend: number;
  
  // Accounts
  accounts: Account[];
  addAccount: (account: Account) => void;
  updateAccountBalance: (id: string, newBalance: number) => void;
  setAccountGoal: (id: string, goal: number) => void;
  
  // Buckets
  buckets: BudgetBucket[];
  addBucket: (bucket: BudgetBucket) => void;
  updateBucket: (bucket: BudgetBucket) => void;
  deleteBucket: (id: string) => void;
  updateBucketLimit: (id: string, newLimit: number) => void;
  reallocateBucket: (sourceId: string, targetId: string, amount: number) => void;
  
  // Calendar
  calendarItems: CalendarItem[];
  addCalendarItem: (item: CalendarItem) => void;
  updateCalendarItem: (item: CalendarItem) => void;
  deleteCalendarItem: (id: string) => void;
  payCalendarItem: (itemId: string, accountId: string) => void;
  
  // Transactions
  transactions: Transaction[];
  addTransaction: (tx: Transaction) => void;
  updateTransactionCategory: (id: string, category: string) => void;
  
  // Gamification
  dailyPoints: number;
  weeklyPoints: number;
  totalPoints: number;
  currentUser: HouseholdMember;
  habits: Habit[];
  addHabit: (habit: Habit) => void;
  updateHabit: (habit: Habit) => void;
  deleteHabit: (id: string) => void;
  toggleHabit: (id: string, direction: 'up' | 'down') => void;
  resetHabit: (id: string) => void;
  freezeBank: { current: number; accrued: number; lastMonth: string };
  
  // New Phase 2 Data
  activeChallenge: Challenge;
  updateChallenge: (challenge: Challenge) => void;
  rewardsInventory: RewardItem[];
  redeemReward: (rewardId: string) => void;
  insight: string;
  refreshInsight: () => void;
}

const HouseholdContext = createContext<HouseholdContextType | undefined>(undefined);

// --- MOCK DATA ---

const INITIAL_USER: HouseholdMember = {
  uid: 'user_1',
  displayName: 'Alex',
  role: 'admin',
  points: { daily: 15, weekly: 120, total: 4500 }
};

const INITIAL_HABITS: Habit[] = [
  {
    id: 'h1',
    title: 'Morning Jog',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 45,
    completedDates: [format(subDays(new Date(), 1), 'yyyy-MM-dd'), format(subDays(new Date(), 2), 'yyyy-MM-dd')],
    streakDays: 2,
    lastUpdated: new Date().toISOString(),
    weatherSensitive: true,
    telegramAlias: 'run'
  },
  {
    id: 'h2',
    title: 'Read 30 Mins',
    category: 'Personal',
    type: 'positive',
    basePoints: 5,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 12,
    completedDates: [format(subDays(new Date(), 1), 'yyyy-MM-dd')],
    streakDays: 1,
    lastUpdated: new Date().toISOString(),
    weatherSensitive: false
  },
  {
    id: 'h3',
    title: 'No Spending',
    category: 'Finance',
    type: 'positive',
    basePoints: 20,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 1, 
    totalCount: 5,
    completedDates: [format(new Date(), 'yyyy-MM-dd'), format(subDays(new Date(), 2), 'yyyy-MM-dd')],
    streakDays: 1,
    lastUpdated: new Date().toISOString(),
    weatherSensitive: false
  },
  {
    id: 'h4',
    title: 'Late Night Snack',
    category: 'Health',
    type: 'negative',
    basePoints: -10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 0, // No target, immediate penalty
    count: 0,
    totalCount: 3,
    completedDates: [],
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
    weatherSensitive: false
  }
];

const INITIAL_ACCOUNTS: Account[] = [
  { id: 'a1', name: 'Chase Checking', type: 'checking', balance: 2450.50, lastUpdated: new Date().toISOString() },
  { id: 'a2', name: 'Ally Savings', type: 'savings', balance: 12000.00, lastUpdated: new Date().toISOString(), monthlyGoal: 15000 },
  { id: 'a3', name: 'Amex Gold', type: 'credit', balance: 450.20, lastUpdated: new Date().toISOString() },
];

const INITIAL_BUCKETS: BudgetBucket[] = [
  { id: 'b1', name: 'Groceries', limit: 600, spent: 320, color: 'bg-emerald-500', isVariable: true, isCore: true },
  { id: 'b2', name: 'Dining', limit: 200, spent: 245, color: 'bg-orange-500', isVariable: true, isCore: true }, 
  { id: 'b3', name: 'Gas', limit: 150, spent: 80, color: 'bg-blue-500', isVariable: true, isCore: true },
  { id: 'b4', name: 'Entertainment', limit: 100, spent: 40, color: 'bg-purple-500', isVariable: true, isCore: true },
  { id: 'b5', name: 'Shopping', limit: 300, spent: 120, color: 'bg-pink-500', isVariable: true, isCore: false },
];

const INITIAL_CALENDAR: CalendarItem[] = [
  { id: 'c1', title: 'Paycheck', amount: 3200, date: format(new Date(), 'yyyy-MM-15'), type: 'income', isPaid: true, isRecurring: true, frequency: 'monthly' },
  { id: 'c2', title: 'Rent', amount: 1800, date: format(new Date(), 'yyyy-MM-01'), type: 'expense', isPaid: true, isRecurring: true, frequency: 'monthly' },
  { id: 'c3', title: 'Electric Bill', amount: 145, date: format(new Date(), 'yyyy-MM-25'), type: 'expense', isPaid: false }, 
  { id: 'c4', title: 'Internet', amount: 80, date: format(new Date(), 'yyyy-MM-20'), type: 'expense', isPaid: false, isRecurring: true, frequency: 'monthly' },
];

const INITIAL_REWARDS: RewardItem[] = [
  { id: 'r1', title: 'Pizza Night', cost: 500, icon: '🍕', createdBy: 'admin' },
  { id: 'r2', title: 'Movie Rental', cost: 200, icon: '🎬', createdBy: 'admin' },
  { id: 'r3', title: 'Skip Chores', cost: 1000, icon: '🧹', createdBy: 'admin' },
  { id: 'r4', title: 'Coffee Treat', cost: 150, icon: '☕', createdBy: 'admin' },
];

const INITIAL_CHALLENGE: Challenge = {
  id: 'ch1',
  month: '2023-11',
  title: 'No Spend November',
  relatedHabitIds: ['h3'],
  targetTotalCount: 30,
  yearlyRewardLabel: 'Yearly Bonus',
  status: 'active'
};

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 't1', amount: 45.20, merchant: 'Target', category: 'Shopping', date: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
    status: 'verified', isRecurring: false, source: 'manual', autoCategorized: true
  },
  {
    id: 't2', amount: 12.50, merchant: 'Uber', category: 'Transport', date: format(subDays(new Date(), 2), 'yyyy-MM-dd'),
    status: 'pending_review', isRecurring: false, source: 'manual', autoCategorized: false
  }
];

// --- LOGIC HELPERS ---

const calculateStreak = (dates: string[]): number => {
  if (dates.length === 0) return 0;
  const sortedDates = [...dates].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  let currentStreak = 0;
  let checkDate = sortedDates[0] === today ? today : yesterday;
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) return 0;
  for (const dateStr of sortedDates) {
    if (dateStr === checkDate) {
      currentStreak++;
      checkDate = format(subDays(parseISO(checkDate), 1), 'yyyy-MM-dd');
    } else {
      break;
    }
  }
  return currentStreak;
};

const getMultiplier = (streak: number, isPositive: boolean, weatherSensitive: boolean) => {
  let multiplier = 1.0;
  if (isPositive) {
    if (streak >= 7) multiplier = 2.0;
    else if (streak >= 3) multiplier = 1.5;
  }
  const isNiceDay = true;
  if (weatherSensitive && isNiceDay) multiplier += 1.0; 
  return multiplier;
};

// --- PROVIDER ---

export const HouseholdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<HouseholdMember>(INITIAL_USER);
  const [habits, setHabits] = useState<Habit[]>(INITIAL_HABITS);
  const [freezeBank] = useState({ current: 2, accrued: 4, lastMonth: '2023-10' });
  
  // Finance State
  const [accounts, setAccounts] = useState<Account[]>(INITIAL_ACCOUNTS);
  const [buckets, setBuckets] = useState<BudgetBucket[]>(INITIAL_BUCKETS);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>(INITIAL_CALENDAR);
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  
  // Dashboard State
  const [activeChallenge, setActiveChallenge] = useState<Challenge>(INITIAL_CHALLENGE);
  const [rewardsInventory] = useState<RewardItem[]>(INITIAL_REWARDS);
  const [insight, setInsight] = useState("You spend 20% less on days you exercise.");

  // Check for Habit Period Resets
  useEffect(() => {
    setHabits(prev => prev.map(habit => {
      const now = new Date();
      const lastUpdate = parseISO(habit.lastUpdated);
      let shouldReset = false;

      if (habit.period === 'daily') {
        shouldReset = !isSameDay(now, lastUpdate);
      } else if (habit.period === 'weekly') {
        shouldReset = !isSameWeek(now, lastUpdate);
      }

      if (shouldReset) {
        return { ...habit, count: 0, lastUpdated: now.toISOString() };
      }
      return habit;
    }));
  }, []); // Run on mount

  // Safe-to-Spend Logic
  const safeToSpend = useMemo(() => {
    // 1. Available Checking Balance (Assets)
    // STRICT: Only Checking. No Savings, No Credit.
    const checkingBalance = accounts
      .filter(a => a.type === 'checking')
      .reduce((sum, a) => sum + a.balance, 0);

    // 2. Liabilities (Unpaid Bills for rest of month)
    const today = startOfToday();
    const endOfMonthDate = endOfMonth(today);
    
    const unpaidBills = calendarItems
      .filter(item => {
        const itemDate = parseISO(item.date);
        
        // Exclude bills likely covered by buckets to avoid double-counting liability
        const isCoveredByBucket = buckets.some(b => 
            item.title.toLowerCase().includes(b.name.toLowerCase()) || 
            b.name.toLowerCase().includes(item.title.toLowerCase())
        );

        return (
          item.type === 'expense' &&
          !item.isPaid &&
          (isAfter(itemDate, today) || itemDate.getTime() === today.getTime()) && // Future or today
          (isBefore(itemDate, endOfMonthDate) || itemDate.getTime() === endOfMonthDate.getTime()) && // Within this month
          !isCoveredByBucket // EXCLUDE IF COVERED
        );
      })
      .reduce((sum, item) => sum + item.amount, 0);

    // 3. Bucket Liabilities (Remaining Limit)
    // This represents money "earmarked" for specific categories.
    const bucketLiabilities = buckets.reduce((sum, bucket) => {
      const remaining = Math.max(0, bucket.limit - bucket.spent);
      return sum + remaining;
    }, 0);
    
    // 4. Pending Spending Adjustment
    // Pending transactions have already reduced 'checkingBalance' (via account balance update in addTransaction)
    // but haven't reduced 'bucketLiabilities' yet (bucket.spent isn't verified).
    // To prevent S2S from dropping "twice", we offset the liability.
    const pendingSpend = transactions
      .filter(t => t.status === 'pending_review')
      .reduce((sum, t) => sum + t.amount, 0);

    const adjustedBucketLiabilities = Math.max(0, bucketLiabilities - pendingSpend);

    // Final Calculation: Checking - Bills - Buckets
    return checkingBalance - (unpaidBills + adjustedBucketLiabilities);
  }, [accounts, calendarItems, buckets, transactions]);

  // --- ACTIONS: ACCOUNTS ---

  const addAccount = (account: Account) => {
    setAccounts(prev => [...prev, account]);
    toast.success('Account added');
  };

  const updateAccountBalance = (id: string, newBalance: number) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, balance: newBalance, lastUpdated: new Date().toISOString() } : a));
    toast.success('Account updated');
  };

  const setAccountGoal = (id: string, goal: number) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, monthlyGoal: goal } : a));
    toast.success('Goal set');
  };

  // --- ACTIONS: BUCKETS ---

  const addBucket = (bucket: BudgetBucket) => {
    setBuckets(prev => [...prev, bucket]);
    toast.success('Bucket added');
  };

  const updateBucket = (bucket: BudgetBucket) => {
    setBuckets(prev => prev.map(b => b.id === bucket.id ? bucket : b));
    toast.success('Bucket updated');
  };

  const deleteBucket = (id: string) => {
    setBuckets(prev => prev.filter(b => b.id !== id));
    toast.success('Bucket deleted');
  };

  const updateBucketLimit = (id: string, newLimit: number) => {
    setBuckets(prev => prev.map(b => b.id === id ? { ...b, limit: newLimit } : b));
    toast.success('Limit updated');
  };

  const reallocateBucket = (sourceId: string, targetId: string, amount: number) => {
    setBuckets(prev => prev.map(b => {
      if (b.id === sourceId) return { ...b, limit: b.limit - amount };
      if (b.id === targetId) return { ...b, limit: b.limit + amount };
      return b;
    }));
    toast.success('Funds reallocated');
  };

  // --- ACTIONS: CALENDAR ---

  const addCalendarItem = (item: CalendarItem) => {
    setCalendarItems(prev => [...prev, item]);
    toast.success('Event added');
  };

  const updateCalendarItem = (item: CalendarItem) => {
    setCalendarItems(prev => prev.map(i => i.id === item.id ? item : i));
    toast.success('Event updated');
  };

  const deleteCalendarItem = (id: string) => {
    setCalendarItems(prev => prev.filter(i => i.id !== id));
    toast.success('Event deleted');
  };

  const payCalendarItem = (itemId: string, accountId: string) => {
    const item = calendarItems.find(i => i.id === itemId);
    const account = accounts.find(a => a.id === accountId);
    
    if (!item || !account) return;
    if (item.isPaid) return;

    // 1. Mark as Paid
    setCalendarItems(prev => prev.map(i => i.id === itemId ? { ...i, isPaid: true } : i));

    // 2. Deduct/Add to Account
    if (item.type === 'expense') {
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, balance: a.balance - item.amount, lastUpdated: new Date().toISOString() } : a));
    } else {
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, balance: a.balance + item.amount, lastUpdated: new Date().toISOString() } : a));
    }

    // 3. Auto-match Bucket/Category
    let category = 'Bills';
    if (item.type === 'expense') {
      const matchedBucket = buckets.find(b => item.title.toLowerCase().includes(b.name.toLowerCase()));
      if (matchedBucket) category = matchedBucket.name;
    } else {
      category = 'Income';
    }

    // 4. Create Transaction Record
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      amount: item.amount,
      merchant: item.title,
      category: category,
      date: new Date().toISOString().split('T')[0],
      status: 'verified',
      isRecurring: !!item.isRecurring,
      source: 'recurring',
      autoCategorized: true
    };
    
    // Add Transaction and Update Bucket if applicable
    setTransactions(prev => [newTx, ...prev]);
    
    if (item.type === 'expense' && category !== 'Bills' && category !== 'Income') {
       setBuckets(prev => prev.map(b => 
         b.name.toLowerCase() === category.toLowerCase() 
           ? { ...b, spent: b.spent + item.amount } 
           : b
       ));
    }

    toast.success(item.type === 'expense' ? 'Bill Paid' : 'Income Received');
  };

  // --- ACTIONS: TRANSACTIONS ---

  const addTransaction = (tx: Transaction) => {
    setTransactions(prev => [tx, ...prev]);
    // Also update account balance immediately for demo purposes
    // Naively assume checking for now if source is manual/scan
    const checkingAcc = accounts.find(a => a.type === 'checking');
    if (checkingAcc) {
       setAccounts(prev => prev.map(a => a.id === checkingAcc.id ? { ...a, balance: a.balance - tx.amount } : a));
    }
    
    // Naive bucket update if categorized
    if (tx.category && tx.status === 'verified') {
       setBuckets(prev => prev.map(b => 
         b.name.toLowerCase() === tx.category.toLowerCase() 
           ? { ...b, spent: b.spent + tx.amount } 
           : b
       ));
    }
  };

  const updateTransactionCategory = (id: string, category: string) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;

    setTransactions(prev => prev.map(t => t.id === id ? { ...t, category, status: 'verified' } : t));
    
    // Update bucket spent
    setBuckets(prev => prev.map(b => 
      b.name.toLowerCase() === category.toLowerCase() 
        ? { ...b, spent: b.spent + tx.amount } 
        : b
    ));
    toast.success('Categorized!');
  };

  // --- ACTIONS: REWARDS & INSIGHTS ---

  const redeemReward = (rewardId: string) => {
    const reward = rewardsInventory.find(r => r.id === rewardId);
    if (!reward) return;
    
    if (currentUser.points.total < reward.cost) {
      toast.error('Not enough points');
      return;
    }

    setCurrentUser(prev => ({
      ...prev,
      points: {
        ...prev.points,
        total: prev.points.total - reward.cost
      }
    }));
    toast.success(`Redeemed: ${reward.title}`);
  };

  const refreshInsight = () => {
    const insights = [
      "You spend 20% less on days you exercise.",
      "Your grocery spending is highest on Sundays.",
      "Great job maintaining your reading streak!",
      "You've saved $50 more this week than last week."
    ];
    const random = insights[Math.floor(Math.random() * insights.length)];
    setInsight(random);
    toast('Insight refreshed', { icon: '✨' });
  };

  // --- ACTIONS: HABITS & CHALLENGES ---
  
  const addHabit = (habit: Habit) => {
    setHabits(prev => [...prev, habit]);
    toast.success('Habit created');
  };

  const updateHabit = (habit: Habit) => {
    setHabits(prev => prev.map(h => h.id === habit.id ? habit : h));
    toast.success('Habit updated');
  };

  const deleteHabit = (id: string) => {
    setHabits(prev => prev.filter(h => h.id !== id));
    toast.success('Habit deleted');
  };

  const updateChallenge = (challenge: Challenge) => {
    setActiveChallenge(challenge);
    toast.success('Challenge Updated');
  };

  const toggleHabit = (id: string, direction: 'up' | 'down') => {
    setHabits(prevHabits => {
      const habitIndex = prevHabits.findIndex(h => h.id === id);
      if (habitIndex === -1) return prevHabits;
      
      const habit = prevHabits[habitIndex];
      const today = format(new Date(), 'yyyy-MM-dd');
      
      let newCount = habit.count;
      let newTotalCount = habit.totalCount;
      let newCompletedDates = [...habit.completedDates];
      let pointsChange = 0;

      // 1. Update Counts
      if (direction === 'up') {
        newCount++;
        newTotalCount++;
      } else {
        if (newCount > 0) newCount--;
        if (newTotalCount > 0) newTotalCount--;
        if (newCount === 0 && direction === 'down') {
           // Can't go below 0
           return prevHabits; 
        }
      }

      // 2. Determine if Scorable (Points + Completion)
      const currentStreak = calculateStreak(habit.completedDates);
      const multiplier = getMultiplier(currentStreak, habit.type === 'positive', habit.weatherSensitive);
      
      let isCompletedNow = false;
      let wasCompletedBefore = false;

      // Logic Split by Scoring Type
      if (habit.scoringType === 'incremental') {
        // Incremental: Points on every action
        if (direction === 'up') {
          pointsChange = Math.floor(habit.basePoints * multiplier);
        } else {
          pointsChange = -Math.floor(habit.basePoints * multiplier);
        }
        // Completion: Hit target (or 1 if 0)
        const target = habit.targetCount > 0 ? habit.targetCount : 1;
        isCompletedNow = newCount >= target;
        wasCompletedBefore = habit.count >= target;

      } else {
        // Threshold: Points only when target hit
        const target = habit.targetCount;
        isCompletedNow = newCount >= target;
        wasCompletedBefore = habit.count >= target;

        if (isCompletedNow && !wasCompletedBefore) {
          // Just hit target -> Award Points
          pointsChange = Math.floor(habit.basePoints * multiplier);
        } else if (!isCompletedNow && wasCompletedBefore) {
          // Just lost target -> Remove Points
          pointsChange = -Math.floor(habit.basePoints * multiplier);
        }
      }

      // 3. Update Completion History (for streaks)
      if (isCompletedNow) {
        if (!newCompletedDates.includes(today)) {
          newCompletedDates.push(today);
          newCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        }
      } else {
        // Only remove if we fell below threshold
         newCompletedDates = newCompletedDates.filter(d => d !== today);
      }

      // 4. Apply Points to User
      if (pointsChange !== 0) {
        setCurrentUser(prevUser => ({
          ...prevUser,
          points: {
            daily: prevUser.points.daily + pointsChange,
            weekly: prevUser.points.weekly + pointsChange,
            total: prevUser.points.total + pointsChange
          }
        }));
        
        // Toast Feedback
        const sign = pointsChange > 0 ? '+' : '';
        toast(
          <div className="flex items-center gap-2">
            <span className="font-bold">{sign}{pointsChange} pts</span>
            <span className="text-sm opacity-80">({multiplier}x)</span>
          </div>,
          { 
            duration: 1500,
            icon: pointsChange > 0 ? '🌟' : '📉',
            style: { 
              background: pointsChange > 0 ? '#ECFDF5' : '#FFF1F2',
              color: pointsChange > 0 ? '#065F46' : '#9F1239',
              border: pointsChange > 0 ? '1px solid #A7F3D0' : '1px solid #FECDD3'
            }
          }
        );
      }

      // 5. Update Habit State
      const newHabits = [...prevHabits];
      newHabits[habitIndex] = {
        ...habit,
        count: newCount,
        totalCount: newTotalCount,
        completedDates: newCompletedDates,
        streakDays: calculateStreak(newCompletedDates),
        lastUpdated: new Date().toISOString()
      };
      return newHabits;
    });
  };

  const resetHabit = (id: string) => {
    const habit = habits.find(h => h.id === id);
    if (!habit || habit.count === 0) return;
    
    setHabits(prevHabits => {
      const habitIndex = prevHabits.findIndex(h => h.id === id);
      if (habitIndex === -1) return prevHabits;
      const h = prevHabits[habitIndex];
      
      let pointsToRemove = 0;
      const currentStreak = calculateStreak(h.completedDates);
      const multiplier = getMultiplier(currentStreak, h.type === 'positive', h.weatherSensitive);
      
      if (h.scoringType === 'incremental') {
        pointsToRemove = h.count * Math.floor(h.basePoints * multiplier);
      } else {
        if (h.count >= h.targetCount) {
          pointsToRemove = Math.floor(h.basePoints * multiplier);
        }
      }

      setCurrentUser(prevUser => ({
        ...prevUser,
        points: {
          daily: prevUser.points.daily - pointsToRemove,
          weekly: prevUser.points.weekly - pointsToRemove,
          total: prevUser.points.total - pointsToRemove
        }
      }));

      const today = format(new Date(), 'yyyy-MM-dd');
      const newCompletedDates = h.completedDates.filter(d => d !== today);

      const newHabits = [...prevHabits];
      newHabits[habitIndex] = {
        ...h,
        count: 0,
        completedDates: newCompletedDates,
        streakDays: calculateStreak(newCompletedDates),
        lastUpdated: new Date().toISOString()
      };
      return newHabits;
    });
    toast('Reset', { icon: '↺' });
  };

  return (
    <HouseholdContext.Provider value={{
      safeToSpend,
      accounts,
      addAccount,
      updateAccountBalance,
      setAccountGoal,
      buckets,
      addBucket,
      updateBucket,
      deleteBucket,
      updateBucketLimit,
      reallocateBucket,
      calendarItems,
      addCalendarItem,
      updateCalendarItem,
      deleteCalendarItem,
      payCalendarItem,
      transactions,
      addTransaction,
      updateTransactionCategory,
      dailyPoints: currentUser.points.daily,
      weeklyPoints: currentUser.points.weekly,
      totalPoints: currentUser.points.total,
      currentUser,
      habits,
      addHabit,
      updateHabit,
      deleteHabit,
      toggleHabit,
      resetHabit,
      freezeBank,
      activeChallenge,
      updateChallenge,
      rewardsInventory,
      redeemReward,
      insight,
      refreshInsight
    }}>
      {children}
    </HouseholdContext.Provider>
  );
};

export const useHousehold = () => {
  const context = useContext(HouseholdContext);
  if (context === undefined) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return context;
};
