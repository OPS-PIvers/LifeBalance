import {
  collection,
  query,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  habitConverter,
  challengeConverter,
  yearlyGoalConverter,
  rewardItemConverter,
} from '@/utils/firestoreConverters';
import { Habit, Challenge, YearlyGoal, RewardItem } from '@/types/schema';

/**
 * Attaches the four gamification listeners (verbatim move from
 * FirebaseHouseholdContext's main listener effect): habits, challenges,
 * yearly goals, and rewards. Each is a simple, self-contained onSnapshot —
 * no cross-family logic — so they're safe to extract as one function called
 * inline from the existing effect, leaving that effect's other listeners
 * (members, household doc, pending items, etc.) untouched.
 */
export function attachGamificationListeners({
  db,
  householdId,
  setHabits,
  setChallenges,
  setYearlyGoals,
  setRewards,
}: {
  db: Firestore;
  householdId: string;
  setHabits: (habits: Habit[]) => void;
  setChallenges: (challenges: Challenge[]) => void;
  setYearlyGoals: (goals: YearlyGoal[]) => void;
  setRewards: (rewards: RewardItem[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Habits listener
  const habitsQuery = query(collection(db, `households/${householdId}/habits`).withConverter(habitConverter));
  unsubscribers.push(
    onSnapshot(habitsQuery, (snapshot) => {
      setHabits(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[habits] listener failed:', error);
    })
  );

  // Challenges listener
  const challengesQuery = query(collection(db, `households/${householdId}/challenges`).withConverter(challengeConverter));
  unsubscribers.push(
    onSnapshot(challengesQuery, (snapshot) => {
      setChallenges(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[challenges] listener failed:', error);
    })
  );

  // Yearly Goals listener
  const yearlyGoalsQuery = query(collection(db, `households/${householdId}/yearlyGoals`).withConverter(yearlyGoalConverter));
  unsubscribers.push(
    onSnapshot(yearlyGoalsQuery, (snapshot) => {
      setYearlyGoals(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[yearlyGoals] listener failed:', error);
    })
  );

  // Rewards listener
  const rewardsQuery = query(collection(db, `households/${householdId}/rewards`).withConverter(rewardItemConverter));
  unsubscribers.push(
    onSnapshot(rewardsQuery, (snapshot) => {
      setRewards(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[rewards] listener failed:', error);
    })
  );

  return unsubscribers;
}
