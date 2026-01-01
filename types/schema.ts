
export type Role = 'admin' | 'member';

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
  spent?: number; // DEPRECATED: Now calculated in real-time from transactions. Will be removed after migration.
  color: string;
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
  source: 'manual' | 'camera-scan' | 'file-upload' | 'telegram' | 'recurring';
  autoCategorized: boolean;
  payPeriodId?: string; // Pay period ID (YYYY-MM-DD of period start), empty string if no period tracking
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
  yearlyRewardLabel: string;

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

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  members: HouseholdMember[];
  points: { daily: number; weekly: number; total: number }; // Shared household points
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
}
