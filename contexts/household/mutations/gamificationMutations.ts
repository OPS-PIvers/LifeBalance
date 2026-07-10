import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  increment,
  writeBatch,
  runTransaction,
  serverTimestamp,
  type FieldValue,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { parseISO, format, subDays } from 'date-fns';
import {
  Challenge,
  RewardItem,
  RewardRedemption,
  RewardRedemptionRecord,
  HouseholdMember,
  YearlyGoal,
  FreezeBank,
  FreezeBankHistoryEntry,
  Habit,
} from '@/types/schema';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { FREEZE_MAX_TOKENS, selectAutoFreezeCandidates } from '@/utils/freezeBank';
import { calculateStreak } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { redemptionMemberDelta, REDEMPTION_HISTORY_LIMIT } from '@/utils/redemption';
import { track } from '@/services/analytics';
import type { User } from 'firebase/auth';

// Pure-ish factories for the gamification mutation families (yearly goals,
// challenges, rewards + redemption, freeze bank), moved verbatim out of
// FirebaseHouseholdContext. Habit CRUD (addHabit/updateHabit/toggleHabit/...)
// already lives in hooks/useHabitActions.tsx and is NOT duplicated here — see
// advisor-plans/08-context-decomposition.md.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * createYearlyGoal — original closure captured `householdId`, `user`.
 */
export function makeCreateYearlyGoal(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
}) {
  const { db, householdId, user } = deps;

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

  return { createYearlyGoal };
}

/**
 * updateYearlyGoal / deleteYearlyGoal — original closures captured only
 * `householdId`.
 */
export function makeYearlyGoalCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const updateYearlyGoal = async (goalId: string, updates: Partial<YearlyGoal>) => {
    if (!householdId) return;

    await updateDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId), updates);
    toast.success('Yearly goal updated');
  };

  const deleteYearlyGoal = async (goalId: string) => {
    if (!householdId) return;

    await deleteDoc(doc(db, `households/${householdId}/yearlyGoals`, goalId));
    toast.success('Yearly goal deleted');
  };

  return { updateYearlyGoal, deleteYearlyGoal };
}

/**
 * updateYearlyGoalProgress — original closure captured `householdId`,
 * `yearlyGoals`.
 */
export function makeUpdateYearlyGoalProgress(deps: {
  db: Firestore;
  householdId: string | null;
  yearlyGoals: YearlyGoal[];
}) {
  const { db, householdId, yearlyGoals } = deps;

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

    // achievedAt is a string on read, but we write a server timestamp; type the
    // write object to accept a FieldValue for that field instead of casting.
    const updates: Partial<Omit<YearlyGoal, 'achievedAt'>> & { achievedAt?: string | FieldValue } = {
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

  return { updateYearlyGoalProgress };
}

/**
 * updateChallenge — original closure captured `householdId`, `habits`,
 * `activeChallenge`, `user`.
 */
export function makeUpdateChallenge(deps: {
  db: Firestore;
  householdId: string | null;
  habits: Habit[];
  activeChallenge: Challenge | null;
  user: User | null;
}) {
  const { db, householdId, habits, activeChallenge, user } = deps;

  const updateChallenge = async (challenge: Challenge) => {
    if (!householdId) return;

    // Calculate currentValue from linked habits
    const linkedHabits = habits.filter(h => challenge.relatedHabitIds.includes(h.id));

    const { currentValue } = calculateChallengeProgress(challenge, linkedHabits);

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
      const { id: _id, ...newChallengeData } = updatedChallenge;

      await addDoc(collection(db, `households/${householdId}/challenges`), {
        ...newChallengeData,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });
    }
    toast.success('Challenge Updated');
  };

  return { updateChallenge };
}

/**
 * addChallenge — original closure captured `householdId`, `user`.
 *
 * Plan 080e — create a NEW family challenge. Unlike the legacy inline-create
 * path inside `updateChallenge`, this is DECOUPLED from yearly goals: it never
 * sets `yearlyGoalId`. It is the write behind the dormant "New family
 * challenge" form (gated on kidModeEnabled at the call site), so this method is
 * inert for every non-kid-mode surface — nothing calls it while Kid Mode is off.
 *
 * Firestore-rules note (no rules change per Plan 080e): the existing
 * /challenges create rule requires a non-empty `yearlyRewardLabel`
 * (isValidString) and its `hasOnly` allowlist does NOT include
 * `isFamilyChallenge`. So we (a) write a sensible default label to stay
 * rules-valid, and (b) deliberately do NOT persist `isFamilyChallenge` — the
 * kid surfaces key off the *active* challenge, not that flag, so persistence
 * isn't needed. createdAt is an ISO string (the rule expects a string, not a
 * serverTimestamp sentinel).
 */
export function makeAddChallenge(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
}) {
  const { db, householdId, user } = deps;

  const addChallenge = async (input: {
    title: string;
    description?: string;
    relatedHabitIds: string[];
    targetValue?: number;
    month?: string;
  }): Promise<void> => {
    if (!householdId) return;
    const title = input.title.trim();
    if (!title) return;

    try {
      // Build with Object.fromEntries so an absent description/targetValue is
      // omitted entirely (Firestore rejects `undefined`).
      const data = Object.fromEntries(
        Object.entries({
          month: input.month ?? format(new Date(), 'yyyy-MM'),
          title,
          description: input.description?.trim() || undefined,
          relatedHabitIds: input.relatedHabitIds,
          targetType: 'count' as const,
          // Defensive: only persist a positive target; 0/negative are dropped
          // (omitted via the undefined filter below) rather than written.
          targetValue: input.targetValue != null && input.targetValue > 0 ? input.targetValue : undefined,
          status: 'active' as const,
          // Default reward label — keeps the write within the existing /challenges
          // create rule (which requires a non-empty yearlyRewardLabel). The family
          // challenge has no yearly-goal coupling; this is just a display label.
          yearlyRewardLabel: 'Family goal',
          createdBy: user?.uid,
          createdAt: new Date().toISOString(),
        }).filter(([, value]) => value !== undefined)
      );

      await addDoc(collection(db, `households/${householdId}/challenges`), data);
      toast.success('Family challenge created');
    } catch (error) {
      console.error('[addChallenge] Failed:', error);
      toast.error('Failed to create challenge');
      throw error;
    }
  };

  return { addChallenge };
}

/**
 * markChallengeComplete — original closure captured `householdId`,
 * `challenges`, `updateYearlyGoalProgress`.
 */
export function makeMarkChallengeComplete(deps: {
  db: Firestore;
  householdId: string | null;
  challenges: Challenge[];
  updateYearlyGoalProgress: (goalId: string, month: string, success: boolean) => Promise<void>;
}) {
  const { db, householdId, challenges, updateYearlyGoalProgress } = deps;

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

  return { markChallengeComplete };
}

/**
 * redeemReward — original closure captured `householdId`, `rewards`, and read
 * `userRef` (ref, not reactive) inside.
 */
export function makeRedeemReward(deps: {
  db: Firestore;
  householdId: string | null;
  rewards: RewardItem[];
  userRef: { current: User | null };
}) {
  const { db, householdId, rewards, userRef } = deps;

  const redeemReward = async (rewardId: string) => {
    if (!householdId) return;

    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return;

    // Use transaction to atomically check points, deduct them, AND append the
    // redemption-history record in one write — so the shared point total and the
    // "Recently redeemed" log can never diverge (and concurrent redemptions can't
    // race past the affordability check). History is a bounded, most-recent-first
    // array on the household doc (rules-free, like pendingRedemptions); we read the
    // current array inside the txn and prepend + slice to the cap.
    try {
      await runTransaction(db, async (transaction) => {
        const householdRef = doc(db, `households/${householdId}`);
        const householdDoc = await transaction.get(householdRef);

        if (!householdDoc.exists()) {
          throw new Error('Household not found');
        }

        const data = householdDoc.data();
        const currentTotalPoints = data.points?.total || 0;

        if (currentTotalPoints < reward.cost) {
          throw new Error('Not enough points');
        }

        const record: RewardRedemptionRecord = {
          id: crypto.randomUUID(),
          rewardId: reward.id,
          rewardTitle: reward.title,
          icon: reward.icon,
          cost: reward.cost,
          // userRef (not the `user` closure) so the callback isn't recreated when
          // Firebase refreshes the auth token hourly.
          redeemedByUid: userRef.current?.uid ?? '',
          redeemedAt: new Date().toISOString(),
        };
        // Defensive: guard against a corrupted/legacy non-array redemptionHistory
        // so the spread below can't throw.
        const existingHistory = Array.isArray(data.redemptionHistory)
          ? (data.redemptionHistory as RewardRedemptionRecord[])
          : [];
        const nextHistory = [record, ...existingHistory].slice(0, REDEMPTION_HISTORY_LIMIT);

        // Atomically deduct points and log the redemption.
        transaction.update(householdRef, {
          'points.total': increment(-reward.cost),
          redemptionHistory: nextHistory,
        });
      });

      track('reward_redeemed', { via: 'self' });
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

  return { redeemReward };
}

/**
 * addReward — original closure captured `householdId`, `user`.
 *
 * Writes to the households/{hid}/rewards subcollection (the live store). The
 * deprecated Household.rewardsInventory array is NOT touched. createdBy is set
 * from the authenticated user so it satisfies the rules' ownership check.
 */
export function makeAddReward(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
}) {
  const { db, householdId, user } = deps;

  const addReward = async (input: Omit<RewardItem, 'id' | 'createdBy'>) => {
    if (!householdId || !user) return;

    try {
      await addDoc(collection(db, `households/${householdId}/rewards`), {
        ...input,
        createdBy: user.uid,
      });
      toast.success('Reward added');
    } catch (error) {
      console.error('[addReward] Failed:', error);
      toast.error('Failed to add reward');
      throw error;
    }
  };

  return { addReward };
}

/**
 * updateReward / deleteReward — original closures captured only `householdId`.
 */
export function makeRewardCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const updateReward = async (reward: RewardItem) => {
    if (!householdId) return;

    // Build the FULL desired state so a type/target switch can't leave orphaned
    // data behind. Strip the synthetic id and the immutable createdBy (the rules
    // block createdBy changes, and id is not a Firestore field). Optional kid
    // fields that no longer apply are removed with deleteField() rather than left
    // stale — e.g. switching 'allowance' → 'realWorld' drops allowanceCents, and
    // clearing the target kid drops targetMemberId. Deleting optional keys still
    // satisfies the rule's hasOnly()/isValidReward() (title/cost/icon stay present).
    const updates = {
      title: reward.title,
      cost: reward.cost,
      icon: reward.icon,
      type: reward.type,
      active: reward.active,
      allowanceCents: reward.type === 'allowance' ? reward.allowanceCents : deleteField(),
      targetMemberId: reward.targetMemberId ? reward.targetMemberId : deleteField(),
    };

    try {
      await updateDoc(doc(db, `households/${householdId}/rewards`, reward.id), updates);
      toast.success('Reward updated');
    } catch (error) {
      console.error('[updateReward] Failed:', error);
      toast.error('Failed to update reward');
      throw error;
    }
  };

  const deleteReward = async (id: string) => {
    if (!householdId) return;

    try {
      await deleteDoc(doc(db, `households/${householdId}/rewards`, id));
      toast.success('Reward deleted');
    } catch (error) {
      console.error('[deleteReward] Failed:', error);
      toast.error('Failed to delete reward');
      throw error;
    }
  };

  return { updateReward, deleteReward };
}

/**
 * requestRedemption — original closure captured `householdId`, `user`,
 * `rewards`.
 *
 * A kid requests a reward → a parent approves (deduct points + credit allowance
 * IOU) or denies. Pending requests live in the household doc's bounded
 * `pendingRedemptions` array (removed on resolve). The kid never has a
 * credential — every write here runs in the acting-as parent's session
 * (Principle 2), so member/household rules pass. The household-doc update rule
 * is field-permissive, so this needs no firestore.rules change.
 */
export function makeRequestRedemption(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
  rewards: RewardItem[];
}) {
  const { db, householdId, user, rewards } = deps;

  const requestRedemption = async (rewardId: string, memberId: string) => {
    if (!householdId || !user) return;

    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) {
      toast.error('That reward is no longer available');
      return;
    }

    // Capture a SNAPSHOT of the reward's redemption-relevant fields so a later
    // edit/delete of the reward can't change what was requested. allowanceCents
    // is only carried for allowance rewards (omit the key otherwise — Firestore
    // rejects undefined). type defaults to 'realWorld' when absent on a legacy reward.
    const redemption: RewardRedemption = {
      id: crypto.randomUUID(),
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
      requestedByUid: user.uid,
    };

    try {
      // Append to the household doc's pendingRedemptions inside a transaction so a
      // fast double-tap / two tabs can't create TWO pending entries for the same
      // (memberId, rewardId) — which would let a parent approve both and
      // double-deduct points / double-credit allowance. We read the current queue
      // and skip the write when a matching pending entry already exists, rather
      // than arrayUnion-ing a fresh unique-id entry blindly.
      let alreadyPending = false;
      await runTransaction(db, async (transaction) => {
        const householdRef = doc(db, `households/${householdId}`);
        const householdDoc = await transaction.get(householdRef);
        if (!householdDoc.exists()) throw new Error('Household not found');

        const pending = (householdDoc.data().pendingRedemptions as RewardRedemption[] | undefined) ?? [];
        if (pending.some(p => p.memberId === memberId && p.rewardId === rewardId)) {
          // A request for this reward by this member is already queued — no-op.
          alreadyPending = true;
          return;
        }
        transaction.update(householdRef, { pendingRedemptions: [...pending, redemption] });
      });

      if (alreadyPending) {
        toast.success('Already requested!');
      } else {
        toast.success(`Sent! A grown-up will review "${reward.title}" 🎁`);
      }
    } catch (error) {
      console.error('[requestRedemption] Failed:', error);
      toast.error('Could not send your request. Try again.');
      throw error;
    }
  };

  return { requestRedemption };
}

/**
 * approveRedemption / denyRedemption — original closures captured only
 * `householdId`.
 */
export function makeRedemptionResolutionMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const approveRedemption = async (redemptionId: string) => {
    if (!householdId) return;

    try {
      // `notEnough` short-circuits approval when the kid can no longer afford the
      // reward (their points.total fell below the cost between request and
      // approval). We leave the request pending so the parent can retry later, and
      // surface a distinct toast after the transaction resolves.
      let notEnough = false;
      await runTransaction(db, async (transaction) => {
        const householdRef = doc(db, `households/${householdId}`);
        // ALL reads first (Firestore requires reads before writes): household doc,
        // then — once we know the target member — the kid's member doc.
        const householdDoc = await transaction.get(householdRef);
        if (!householdDoc.exists()) throw new Error('Household not found');

        const pending = (householdDoc.data().pendingRedemptions as RewardRedemption[] | undefined) ?? [];
        const redemption = pending.find(r => r.id === redemptionId);
        // IDEMPOTENT: already resolved (removed by a prior approve/deny) → no-op,
        // so a double-tap can't deduct points twice.
        if (!redemption) return;

        const memberRef = doc(db, `households/${householdId}/members`, redemption.memberId);
        const memberDoc = await transaction.get(memberRef);
        const currentTotal = (memberDoc.data() as HouseholdMember | undefined)?.points?.total ?? 0;

        // AFFORDABILITY: never let approval drive the kid's points negative. If they
        // can't afford it now, reject (leave pending) — kids' rewards carry no debt.
        if (currentTotal < redemption.cost) {
          notEnough = true;
          return;
        }

        const delta = redemptionMemberDelta(redemption);
        // DEFENSE-IN-DEPTH: strip ALL entries for this (memberId, rewardId), not
        // just the matched id, so a stray duplicate that slipped past the request
        // dedup can never be approved a second time. The member is still credited
        // exactly ONCE (one delta below).
        const remaining = pending.filter(
          r => !(r.memberId === redemption.memberId && r.rewardId === redemption.rewardId)
        );

        // Remove the request(s) from the queue AND apply the member delta in ONE
        // transaction, so the kid's points/allowance can never diverge from the
        // resolved queue.
        transaction.update(householdRef, { pendingRedemptions: remaining });
        transaction.update(memberRef, {
          'points.total': increment(delta.pointsDelta),
          ...(delta.allowanceDelta ? { allowanceCents: increment(delta.allowanceDelta) } : {}),
        });
      });

      if (notEnough) {
        toast.error('Not enough points');
      } else {
        track('reward_redeemed', { via: 'parent_approval' });
        toast.success('Approved! 🎉');
      }
    } catch (error) {
      console.error('[approveRedemption] Failed:', error);
      toast.error('Could not approve the request. Try again.');
      throw error;
    }
  };

  const denyRedemption = async (redemptionId: string) => {
    if (!householdId) return;

    try {
      await runTransaction(db, async (transaction) => {
        const householdRef = doc(db, `households/${householdId}`);
        const householdDoc = await transaction.get(householdRef);
        if (!householdDoc.exists()) throw new Error('Household not found');

        const pending = (householdDoc.data().pendingRedemptions as RewardRedemption[] | undefined) ?? [];
        const redemption = pending.find(r => r.id === redemptionId);
        // IDEMPOTENT: already resolved → no-op. Deny touches no points/allowance.
        if (!redemption) return;

        transaction.update(householdRef, {
          pendingRedemptions: pending.filter(r => r.id !== redemptionId),
        });
      });
      toast.success('Request dismissed');
    } catch (error) {
      console.error('[denyRedemption] Failed:', error);
      toast.error('Could not dismiss the request. Try again.');
      throw error;
    }
  };

  return { approveRedemption, denyRedemption };
}

/**
 * autoApplyFreezes — Plan 25. Duolingo-style auto-applied streak protection:
 * for each positive DAILY habit whose streak (>= 3 completed days) would break
 * because yesterday was missed, consume one freeze token and record yesterday
 * in the habit's `frozenDates`.
 *
 * Central invariant: a frozen date preserves streak CONTINUITY but earns ZERO
 * points — this path never touches any points field, never writes to
 * completedDates, and never counts the day for challenges (frozen dates live
 * outside completedDates, which every points/challenge path scores from).
 *
 * Atomicity: ONE writeBatch per application (habit doc + freeze bank), so a
 * date can never be frozen without a token being consumed or vice versa.
 *
 * Idempotency: a habit whose `frozenDates` already contains yesterday is not
 * a candidate, so re-running (same device, or a second device after the write
 * syncs) is a no-op. Residual multi-device race: two devices whose snapshots
 * both predate each other's commits can each apply a freeze computed from the
 * same starting balance; the absolute `tokens` write converges last-writer-
 * wins and is floored at 0 via Math.max — it can never go negative.
 */
export function makeAutoApplyFreezes(deps: {
  db: Firestore;
  householdId: string | null;
  freezeBank: FreezeBank | null;
  habits: Habit[];
}) {
  const { db, householdId, freezeBank, habits } = deps;

  const autoApplyFreezes = async () => {
    if (!householdId || !freezeBank || freezeBank.tokens <= 0) return;

    const today = getLocalDateString();
    const yesterday = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');

    // Deterministic candidate order (highest protected streak first, then id)
    // so two devices racing at midnight converge on the same applications.
    const candidates = selectAutoFreezeCandidates(habits, today);
    if (candidates.length === 0) return;

    let tokens = freezeBank.tokens;
    let history = freezeBank.history;
    let applied = 0;

    for (const { habit, protectedStreak } of candidates) {
      if (tokens <= 0) break;

      const frozenDates = [...(habit.frozenDates ?? []), yesterday].sort();
      // Frozen-aware streak: yesterday's freeze bridges the chain, so the
      // streak the user sees survives the miss (without counting the frozen day).
      const streakDays = calculateStreak(habit.completedDates, today, frozenDates);

      const historyEntry: FreezeBankHistoryEntry = {
        id: crypto.randomUUID(),
        type: 'used',
        amount: -1,
        date: today,
        habitId: habit.id,
        habitDate: yesterday,
        notes: `Freeze auto-applied: protected the ${protectedStreak}-day streak on ${habit.title} (${yesterday})`,
        createdAt: new Date().toISOString(),
      };

      tokens = Math.max(0, tokens - 1);
      history = [...history, historyEntry];

      // ONE batch per application: the habit's frozen date + the token spend
      // commit together or not at all. NO points writes — frozen days earn 0.
      const batch = writeBatch(db);
      batch.update(doc(db, `households/${householdId}/habits`, habit.id), {
        frozenDates,
        streakDays,
      });
      batch.update(doc(db, `households/${householdId}`), {
        freezeBank: { ...freezeBank, tokens, history },
      });
      await batch.commit();
      applied++;
    }

    if (applied > 0) {
      toast(`Streak protected — ${applied} freeze${applied === 1 ? '' : 's'} auto-applied`, { icon: '❄️' });
    }
  };

  return { autoApplyFreezes };
}

/**
 * rolloverFreezeBankTokens — original closure captured `householdId`,
 * `freezeBank`.
 *
 * Plan 25: the monthly rollover is now a simple REFILL to the fixed max
 * (FREEZE_MAX_TOKENS = 2). The old 2-new + 1-carryover math, expiry, and
 * carryover concepts are gone. A legacy 3-token bank is clamped down to the
 * new max on its first rollover; maxTokens is rewritten to 2 at the same time.
 */
export function makeRolloverFreezeBankTokens(deps: {
  db: Firestore;
  householdId: string | null;
  freezeBank: FreezeBank | null;
}) {
  const { db, householdId, freezeBank } = deps;

  const rolloverFreezeBankTokens = async () => {
    if (!householdId || !freezeBank) return;

    const now = new Date();
    const currentMonth = format(now, 'yyyy-MM');

    // Only rollover if we're in a new month
    if (freezeBank.lastRolloverMonth === currentMonth) return;

    const newBalance = FREEZE_MAX_TOKENS;
    // Negative when clamping a legacy 3-token bank down to the new max.
    const tokensAdded = newBalance - freezeBank.tokens;

    const refilled: FreezeBank = {
      ...freezeBank,
      tokens: newBalance,
      maxTokens: FREEZE_MAX_TOKENS,
      lastRolloverDate: getLocalDateString(),
      lastRolloverMonth: currentMonth,
    };

    // Bank already at the max: just record the month guard — no history entry,
    // no toast.
    if (tokensAdded === 0) {
      await updateDoc(doc(db, `households/${householdId}`), { freezeBank: refilled });
      return;
    }

    const historyEntry: FreezeBankHistoryEntry = {
      id: crypto.randomUUID(),
      type: 'rollover',
      amount: tokensAdded,
      date: getLocalDateString(),
      notes: `Monthly refill to ${newBalance} freezes`,
      createdAt: new Date().toISOString(),
    };

    await updateDoc(doc(db, `households/${householdId}`), {
      freezeBank: { ...refilled, history: [...freezeBank.history, historyEntry] },
    });

    if (tokensAdded > 0) {
      toast.success(`❄️ Freeze bank refilled: ${newBalance} freezes ready`);
    }
  };

  return { rolloverFreezeBankTokens };
}
