/**
 * Typed Firestore data converters for all major collections.
 *
 * Design constraints (backlog item #15):
 * - fromFirestore reproduces the CURRENT behaviour exactly:
 *     { ...snapshot.data(), id: snapshot.id }
 *   for every collection except HouseholdMember (uid: snapshot.id).
 * - The ONE intentional data transform: BudgetBucket.spent is dropped
 *   (deprecated field, annotated in schema.ts).
 * - Transaction.createdAt and ToDo.createdAt/completedAt Timestamp→ISO
 *   normalisation is preserved (mirrors mapTransactionDoc/mapTodoDoc).
 * - Habit.scoringType defaults to 'threshold' when absent (mirrors the
 *   existing listener that already applies this default before setting state).
 * - Account.lastUpdated and HouseholdApiKey.createdAt/lastUsedAt
 *   Timestamp→ISO normalisation is preserved (mirrors the existing listeners).
 * - toFirestore strips the synthetic id/uid key so it is never written back
 *   as a Firestore field, mirroring how all current writes exclude it.
 * - No other coercions, renames, or field additions.
 *
 * Collections NOT converted here (intentionally left as-is):
 * - utils/migrations/* — one-off scripts; risk not worth the reward.
 * - geminiService.ts Household reads — used only inside runTransaction where
 *   withConverter cannot be attached to a transactional doc ref without
 *   refactoring the call sites; left as `snap.data() as Household`.
 * - useHabitActions.tsx HabitSubmission getDoc calls — straightforward cast;
 *   converter is exported here for future adoption but the call sites are left
 *   to avoid touching atomic writeBatch sequences unnecessarily.
 */

import { format } from 'date-fns';
import {
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type DocumentData,
  Timestamp,
} from 'firebase/firestore';
import { normalizeBucketColorKey } from '@/data/bucketColors';
import type {
  Account,
  BudgetBucket,
  BucketPeriodSnapshot,
  CalendarItem,
  Habit,
  HabitSubmission,
  Challenge,
  YearlyGoal,
  RewardItem,
  HouseholdMember,
  Meal,
  ShoppingItem,
  GroceryCatalogItem,
  MealPlanItem,
  PendingItem,
  HouseholdApiKey,
  Insight,
  Transaction,
  TransactionComment,
  ToDo,
  WeeklyRecap,
  MonthlyMoneyRecap,
  NetWorthSnapshot,
  SavingsGoal,
  ActivityLogEntry,
} from '@/types/schema';

// ---------------------------------------------------------------------------
// Internal helper — strips one key from a typed object without the `as` cast.
// ---------------------------------------------------------------------------
function omitKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = obj;
  return rest as Omit<T, K>;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export const accountConverter: FirestoreDataConverter<Account> = {
  toFirestore(account: Account): DocumentData {
    return omitKey(account, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Account {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      lastUpdated:
        d['lastUpdated'] instanceof Timestamp
          ? d['lastUpdated'].toDate().toISOString()
          : d['lastUpdated'],
    } as Account;
  },
};

// ---------------------------------------------------------------------------
// BudgetBucket — drops the deprecated `spent` field on read and normalizes the
// legacy raw-Tailwind `color` ("bg-emerald-500") to its semantic key ("emerald").
// ---------------------------------------------------------------------------
export const budgetBucketConverter: FirestoreDataConverter<BudgetBucket> = {
  toFirestore(bucket: BudgetBucket): DocumentData {
    // Strip id; also drop spent from writes (it is deprecated).
    const { id: _id, spent: _spent, ...rest } = bucket;
    return rest;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): BudgetBucket {
    const d = snapshot.data();
    // Drop the deprecated `spent` field so downstream consumers never see it.
    const { spent: _dropped, ...rest } = d;
    // Backfill-on-read: legacy docs store color as a raw class; surface the key.
    return { ...rest, id: snapshot.id, color: normalizeBucketColorKey(d.color) } as BudgetBucket;
  },
};

// ---------------------------------------------------------------------------
// BucketPeriodSnapshot
// ---------------------------------------------------------------------------
export const bucketPeriodSnapshotConverter: FirestoreDataConverter<BucketPeriodSnapshot> = {
  toFirestore(snap: BucketPeriodSnapshot): DocumentData {
    return omitKey(snap, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): BucketPeriodSnapshot {
    return { ...snapshot.data(), id: snapshot.id } as BucketPeriodSnapshot;
  },
};

// ---------------------------------------------------------------------------
// CalendarItem — normalizes legacy Timestamp `date` to a local yyyy-MM-dd string.
// ---------------------------------------------------------------------------
export const calendarItemConverter: FirestoreDataConverter<CalendarItem> = {
  toFirestore(item: CalendarItem): DocumentData {
    return omitKey(item, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): CalendarItem {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      date: d['date'] instanceof Timestamp ? format(d['date'].toDate(), 'yyyy-MM-dd') : d['date'],
    } as CalendarItem;
  },
};

// ---------------------------------------------------------------------------
// Habit — preserves existing default: scoringType defaults to 'threshold'
//          and lastUpdated Timestamp→ISO normalisation.
// ---------------------------------------------------------------------------
export const habitConverter: FirestoreDataConverter<Habit> = {
  toFirestore(habit: Habit): DocumentData {
    return omitKey(habit, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Habit {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      scoringType: d['scoringType'] || 'threshold',
      lastUpdated:
        d['lastUpdated'] instanceof Timestamp
          ? d['lastUpdated'].toDate().toISOString()
          : d['lastUpdated'],
    } as Habit;
  },
};

// ---------------------------------------------------------------------------
// HabitSubmission
// ---------------------------------------------------------------------------
export const habitSubmissionConverter: FirestoreDataConverter<HabitSubmission> = {
  toFirestore(sub: HabitSubmission): DocumentData {
    return omitKey(sub, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): HabitSubmission {
    return { ...snapshot.data(), id: snapshot.id } as HabitSubmission;
  },
};

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------
export const challengeConverter: FirestoreDataConverter<Challenge> = {
  toFirestore(challenge: Challenge): DocumentData {
    return omitKey(challenge, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Challenge {
    return { ...snapshot.data(), id: snapshot.id } as Challenge;
  },
};

// ---------------------------------------------------------------------------
// YearlyGoal
// ---------------------------------------------------------------------------
export const yearlyGoalConverter: FirestoreDataConverter<YearlyGoal> = {
  toFirestore(goal: YearlyGoal): DocumentData {
    return omitKey(goal, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): YearlyGoal {
    return { ...snapshot.data(), id: snapshot.id } as YearlyGoal;
  },
};

// ---------------------------------------------------------------------------
// RewardItem
// The spread-all behaviour passes the optional Plan 080d Kid-Mode fields
// (type, allowanceCents, targetMemberId, active) straight through in both
// directions — no field is dropped — while still only stripping the synthetic id.
// ---------------------------------------------------------------------------
export const rewardItemConverter: FirestoreDataConverter<RewardItem> = {
  toFirestore(reward: RewardItem): DocumentData {
    return omitKey(reward, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): RewardItem {
    return { ...snapshot.data(), id: snapshot.id } as RewardItem;
  },
};

// ---------------------------------------------------------------------------
// HouseholdMember — uses `uid` instead of `id` as the synthetic key.
// ---------------------------------------------------------------------------
export const householdMemberConverter: FirestoreDataConverter<HouseholdMember> = {
  toFirestore(member: HouseholdMember): DocumentData {
    return omitKey(member, 'uid');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): HouseholdMember {
    return { ...snapshot.data(), uid: snapshot.id } as HouseholdMember;
  },
};

// ---------------------------------------------------------------------------
// Meal
// ---------------------------------------------------------------------------
export const mealConverter: FirestoreDataConverter<Meal> = {
  toFirestore(meal: Meal): DocumentData {
    return omitKey(meal, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Meal {
    return { ...snapshot.data(), id: snapshot.id } as Meal;
  },
};

// ---------------------------------------------------------------------------
// ShoppingItem
// ---------------------------------------------------------------------------
export const shoppingItemConverter: FirestoreDataConverter<ShoppingItem> = {
  toFirestore(item: ShoppingItem): DocumentData {
    return omitKey(item, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): ShoppingItem {
    return { ...snapshot.data(), id: snapshot.id } as ShoppingItem;
  },
};

// ---------------------------------------------------------------------------
// GroceryCatalogItem
// ---------------------------------------------------------------------------
export const groceryCatalogItemConverter: FirestoreDataConverter<GroceryCatalogItem> = {
  toFirestore(item: GroceryCatalogItem): DocumentData {
    return omitKey(item, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): GroceryCatalogItem {
    // Default `purchaseCount` for legacy docs written before the field was
    // required — the bounded catalog listener orders by it.
    return { purchaseCount: 0, ...snapshot.data(), id: snapshot.id } as GroceryCatalogItem;
  },
};

// ---------------------------------------------------------------------------
// MealPlanItem
// ---------------------------------------------------------------------------
export const mealPlanItemConverter: FirestoreDataConverter<MealPlanItem> = {
  toFirestore(item: MealPlanItem): DocumentData {
    return omitKey(item, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): MealPlanItem {
    return { ...snapshot.data(), id: snapshot.id } as MealPlanItem;
  },
};

// ---------------------------------------------------------------------------
// PendingItem
// ---------------------------------------------------------------------------
export const pendingItemConverter: FirestoreDataConverter<PendingItem> = {
  toFirestore(item: PendingItem): DocumentData {
    return omitKey(item, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): PendingItem {
    return { ...snapshot.data(), id: snapshot.id } as PendingItem;
  },
};

// ---------------------------------------------------------------------------
// HouseholdApiKey — preserves Timestamp→ISO normalisation for createdAt/lastUsedAt.
// ---------------------------------------------------------------------------
export const householdApiKeyConverter: FirestoreDataConverter<HouseholdApiKey> = {
  toFirestore(key: HouseholdApiKey): DocumentData {
    return omitKey(key, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): HouseholdApiKey {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      createdAt:
        d['createdAt'] instanceof Timestamp
          ? d['createdAt'].toDate().toISOString()
          : d['createdAt'],
      lastUsedAt:
        d['lastUsedAt'] instanceof Timestamp
          ? d['lastUsedAt'].toDate().toISOString()
          : d['lastUsedAt'],
    } as HouseholdApiKey;
  },
};

// ---------------------------------------------------------------------------
// Insight
// ---------------------------------------------------------------------------
export const insightConverter: FirestoreDataConverter<Insight> = {
  toFirestore(insight: Insight): DocumentData {
    return omitKey(insight, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Insight {
    return { ...snapshot.data(), id: snapshot.id } as Insight;
  },
};

// ---------------------------------------------------------------------------
// WeeklyRecap — doc id IS the ISO week; preserves Timestamp→ISO normalisation
// for generatedAt. Server-written (Admin SDK) but the converter still strips
// the synthetic id defensively on any client write path.
// ---------------------------------------------------------------------------
export const weeklyRecapConverter: FirestoreDataConverter<WeeklyRecap> = {
  toFirestore(recap: WeeklyRecap): DocumentData {
    return omitKey(recap, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): WeeklyRecap {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      generatedAt:
        d['generatedAt'] instanceof Timestamp
          ? d['generatedAt'].toDate().toISOString()
          : d['generatedAt'],
    } as WeeklyRecap;
  },
};

// ---------------------------------------------------------------------------
// MonthlyMoneyRecap (F-MONEY-06) — doc id IS the calendar month (yyyy-MM);
// preserves Timestamp→ISO normalisation for generatedAt. Server-written (Admin
// SDK) but the converter still strips the synthetic id defensively on any
// client write path (mirrors weeklyRecapConverter).
// ---------------------------------------------------------------------------
export const monthlyMoneyRecapConverter: FirestoreDataConverter<MonthlyMoneyRecap> = {
  toFirestore(recap: MonthlyMoneyRecap): DocumentData {
    return omitKey(recap, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): MonthlyMoneyRecap {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      generatedAt:
        d['generatedAt'] instanceof Timestamp
          ? d['generatedAt'].toDate().toISOString()
          : d['generatedAt'],
    } as MonthlyMoneyRecap;
  },
};

// ---------------------------------------------------------------------------
// NetWorthSnapshot (F-MONEY-09) — doc id IS the date (yyyy-MM-dd); no
// Timestamp fields to normalise. Server-written (Admin SDK) but the
// converter still strips the synthetic id defensively on any client write path.
// ---------------------------------------------------------------------------
export const netWorthSnapshotConverter: FirestoreDataConverter<NetWorthSnapshot> = {
  toFirestore(snapshot: NetWorthSnapshot): DocumentData {
    return omitKey(snapshot, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): NetWorthSnapshot {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
    } as NetWorthSnapshot;
  },
};

// ---------------------------------------------------------------------------
// ActivityLogEntry (F-XCUT-01) — append-only household audit trail. The
// synthetic `id` equals the auto-generated doc id. `timestamp` is written as a
// serverTimestamp and normalised to ISO on read (mirrors the recap converters).
// ---------------------------------------------------------------------------
export const activityLogConverter: FirestoreDataConverter<ActivityLogEntry> = {
  toFirestore(entry: ActivityLogEntry): DocumentData {
    return omitKey(entry, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): ActivityLogEntry {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      timestamp:
        d['timestamp'] instanceof Timestamp
          ? d['timestamp'].toDate().toISOString()
          : d['timestamp'],
    } as ActivityLogEntry;
  },
};

// ---------------------------------------------------------------------------
// SavingsGoal (Plan 24) — preserves Timestamp→ISO normalisation for
// createdAt/completedAt (mirrors the Account.lastUpdated pattern).
// ---------------------------------------------------------------------------
export const savingsGoalConverter: FirestoreDataConverter<SavingsGoal> = {
  toFirestore(goal: SavingsGoal): DocumentData {
    return omitKey(goal, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): SavingsGoal {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      createdAt:
        d['createdAt'] instanceof Timestamp
          ? d['createdAt'].toDate().toISOString()
          : d['createdAt'],
      completedAt:
        d['completedAt'] instanceof Timestamp
          ? d['completedAt'].toDate().toISOString()
          : d['completedAt'],
    } as SavingsGoal;
  },
};

// ---------------------------------------------------------------------------
// Transaction — preserves Timestamp→ISO normalisation for createdAt.
// ---------------------------------------------------------------------------
export const transactionConverter: FirestoreDataConverter<Transaction> = {
  toFirestore(tx: Transaction): DocumentData {
    return omitKey(tx, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Transaction {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      createdAt:
        d['createdAt'] instanceof Timestamp
          ? d['createdAt'].toDate().toISOString()
          : d['createdAt'],
    } as Transaction;
  },
};

// ---------------------------------------------------------------------------
// TransactionComment (Plan 23) — subcollection under a transaction; no
// Timestamp fields (createdAt is always written as an ISO string client-side).
// ---------------------------------------------------------------------------
export const transactionCommentConverter: FirestoreDataConverter<TransactionComment> = {
  toFirestore(comment: TransactionComment): DocumentData {
    return omitKey(comment, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): TransactionComment {
    return { ...snapshot.data(), id: snapshot.id } as TransactionComment;
  },
};

// ---------------------------------------------------------------------------
// ToDo — preserves Timestamp→ISO normalisation for createdAt/completedAt.
// ---------------------------------------------------------------------------
export const todoConverter: FirestoreDataConverter<ToDo> = {
  toFirestore(todo: ToDo): DocumentData {
    return omitKey(todo, 'id');
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): ToDo {
    const d = snapshot.data();
    return {
      ...d,
      id: snapshot.id,
      createdAt:
        d['createdAt'] instanceof Timestamp
          ? d['createdAt'].toDate().toISOString()
          : d['createdAt'],
      completedAt: d['completedAt']
        ? d['completedAt'] instanceof Timestamp
          ? d['completedAt'].toDate().toISOString()
          : d['completedAt']
        : undefined,
    } as ToDo;
  },
};
