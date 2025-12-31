
export type Role = 'admin' | 'member';

export interface HouseholdMember {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  role: Role;
  telegramChatId?: string;
  points: { daily: number; weekly: number; total: number };
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit';
  balance: number;
  lastUpdated: string;
  monthlyGoal?: number;
}

export interface BudgetBucket {
  id: string;
  name: string;
  limit: number;
  spent: number;
  color: string;
  isVariable: boolean;
  isCore: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  merchant: string;
  category: string;
  date: string;
  status: 'verified' | 'pending_review';
  isRecurring: boolean;
  source: 'manual' | 'telegram' | 'recurring';
  autoCategorized: boolean;
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

  // Preset vs Custom tracking
  presetId?: string; // If from a preset, stores the preset ID
  isCustom?: boolean; // true = user-created, false/undefined = from preset
  effortLevel?: EffortLevel; // Effort level for the habit

  // Legacy/Optional
  weatherSensitive: boolean;
  telegramAlias?: string;
}

export interface RewardItem {
  id: string;
  title: string;
  cost: number;
  icon: string;
  createdBy: string;
}

export interface Challenge {
  id: string;
  month: string;
  title: string;
  relatedHabitIds: string[];
  targetTotalCount: number; // Replaced goalPercent
  yearlyRewardLabel: string;
  status: 'active' | 'success' | 'failed';
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  members: HouseholdMember[];
  freezeBank: { current: number; accrued: number; lastMonth: string };
  accounts: Account[];
  rewardsInventory: RewardItem[];
  coreTemplates: {
    expenses: Transaction[];
    buckets: BudgetBucket[];
  };
  location?: { lat: number; lon: number };
}
