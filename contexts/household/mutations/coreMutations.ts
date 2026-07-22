import {
  doc,
  updateDoc,
  deleteField,
  addDoc,
  collection,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit as firestoreLimit,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { Sparkles } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { CaptureReviewMode, CaptureType, DietaryProfile, Habit, HabitSubmission, Insight, ModuleKey, Transaction } from '@/types/schema';
import { hashKidPin } from '@/utils/kidPin';
import { track } from '@/services/analytics';
import { selectRecentReflections } from '@/utils/habitReflections';

// Pure-ish factories for the core household-settings/onboarding mutations plus
// `refreshInsight`, moved verbatim out of FirebaseHouseholdContext. See
// advisor-plans/08-context-decomposition.md step 4. Member and kid-profile
// mutations live in the sibling memberMutations.ts / kidMutations.ts.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * completeOnboarding / setHouseholdCurrency / setModuleVisibility /
 * setCaptureReviewMode / setKidModePin — original closures captured only
 * `householdId`.
 */
export function makeHouseholdSettingsMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const completeOnboarding = async () => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { onboardingComplete: true });
  };

  const setHouseholdCurrency = async (currency: string) => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { currency });
  };

  // Plan 090 — merge-write a single module flag using a dotted field path so
  // sibling keys in moduleVisibility are preserved (updateDoc merges nested
  // fields by dotted path; a plain { moduleVisibility: {...} } would overwrite
  // the whole map). Fail-open default means absent keys stay enabled.
  const setModuleVisibility = async (key: ModuleKey, value: boolean) => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { [`moduleVisibility.${key}`]: value });
  };

  // Same dotted-path-merge approach as setModuleVisibility: routes ONE capture
  // type ('expense' | 'shopping' | 'todo') to 'auto' or 'review' without
  // disturbing sibling keys in captureReview. Absent keys keep reading through
  // the legacy-preserving defaults in utils/captureReview.ts.
  const setCaptureReviewMode = async (type: CaptureType, mode: CaptureReviewMode) => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { [`captureReview.${type}`]: mode });
  };

  // Plan 080b: set/clear the Kid Mode exit PIN. A raw PIN is salted+hashed here
  // (never stored plaintext); passing null removes the PIN so exiting needs none.
  const setKidModePin = async (pin: string | null): Promise<void> => {
    if (!householdId) return;
    const ref = doc(db, 'households', householdId);
    if (pin === null) {
      await updateDoc(ref, { kidModePinHash: deleteField() });
      return;
    }
    const kidModePinHash = await hashKidPin(pin);
    await updateDoc(ref, { kidModePinHash });
  };

  // F-MEALS-03: persist the household's standing dietary restrictions/allergens
  // so AI meal calls and the recipe allergen badge can read it without a
  // per-session prompt. A single-doc write (no cross-doc atomicity needed).
  const setDietaryProfile = async (profile: DietaryProfile) => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { dietaryProfile: profile });
  };

  // F-MEALS-04: set/clear the habit auto-credited when a meal is marked cooked.
  // `null` clears the link (deleteField, matching setKidModePin's clear semantics).
  const setMealCookedHabitId = async (habitId: string | null): Promise<void> => {
    if (!householdId) return;
    const ref = doc(db, 'households', householdId);
    await updateDoc(ref, { mealCookedHabitId: habitId === null ? deleteField() : habitId });
  };

  // F-PLAT-07 — apply an entire module preset (e.g. "Finance only") in one
  // write. Same dotted-path-merge approach as setModuleVisibility, just N
  // keys in a single updateDoc so the write is atomic and there's no
  // flicker between individually-applied toggles.
  const updateModuleVisibility = async (patch: Partial<Record<ModuleKey, boolean>>) => {
    if (!householdId) return;
    const entries = Object.entries(patch) as [ModuleKey, boolean][];
    if (entries.length === 0) return;
    const dottedPatch = Object.fromEntries(
      entries.map(([key, value]) => [`moduleVisibility.${key}`, value]),
    );
    await updateDoc(doc(db, 'households', householdId), dottedPatch);
  };

  return { completeOnboarding, setHouseholdCurrency, setModuleVisibility, updateModuleVisibility, setCaptureReviewMode, setKidModePin, setDietaryProfile, setMealCookedHabitId };
}

/**
 * refreshInsight — original closure captured `householdId`, `isGeneratingInsight`,
 * `transactions`, `habits`, `insightsHistory`, plus the `setIsGeneratingInsight`
 * state setter.
 */
export function makeRefreshInsight(deps: {
  db: Firestore;
  householdId: string | null;
  isGeneratingInsight: boolean;
  transactions: Transaction[];
  habits: Habit[];
  insightsHistory: Insight[];
  setIsGeneratingInsight: (value: boolean) => void;
}) {
  const { db, householdId, isGeneratingInsight, transactions, habits, insightsHistory, setIsGeneratingInsight } = deps;

  const refreshInsight = async () => {
    if (!householdId) return;

    // Prevent rapid clicking and multiple API calls
    if (isGeneratingInsight) {
      toast.error('An insight is already being generated. Please wait.');
      return;
    }

    // Validate that there's sufficient data to analyze
    const hasTransactions = Array.isArray(transactions) && transactions.length > 0;
    const hasHabits = Array.isArray(habits) && habits.length > 0;
    if (!hasTransactions && !hasHabits) {
      toast.error('Not enough data to generate insights yet. Add some transactions or habit activity first.');
      return;
    }

    try {
      setIsGeneratingInsight(true);
      toast.loading('Generating insight...', { id: 'insight-loading' });

      // Dynamically load Gemini service only when needed
      const { generateInsight } = await import('@/services/geminiService');

      // Get last 3 previous insights to avoid repetition
      const previousInsightsTexts = insightsHistory
        .slice(0, 3)
        .map(i => i.text);

      // F-DASH-11 — bounded recent feedback signals fed back into the prompt
      // so generation adapts: a few most-recent 'down'-rated insight texts
      // (avoid repeating that style/topic) and 'up'-rated ones (lean into it).
      // Bounded to 3 each so the prompt doesn't grow unbounded over time.
      const dislikedInsightsTexts = insightsHistory
        .filter(i => i.feedback === 'down')
        .slice(0, 3)
        .map(i => i.text);
      const likedInsightsTexts = insightsHistory
        .filter(i => i.feedback === 'up')
        .slice(0, 3)
        .map(i => i.text);

      // F-HABITS-06 owner note (3): fan out to at most 3 submission-tracked
      // habits, 3 most-recent submissions each — a small, bounded read (never
      // more than 9 docs) so this stays cheap on every insight generation.
      // selectRecentReflections then further trims/sorts down to 5 total.
      const submissionTrackedHabits = habits.filter(h => h.hasSubmissionTracking).slice(0, 3);
      const reflectionCandidates = (await Promise.all(
        submissionTrackedHabits.map(h => getDocs(query(
          collection(db, `households/${householdId}/habits/${h.id}/submissions`),
          orderBy('createdAt', 'desc'),
          firestoreLimit(3),
        )))
      )).flatMap(snap => snap.docs.map(d => d.data() as HabitSubmission));
      const recentReflections = selectRecentReflections(reflectionCandidates);

      const { text, actions } = await generateInsight(
        householdId,
        transactions,
        habits,
        previousInsightsTexts,
        {
          dislikedInsights: dislikedInsightsTexts,
          likedInsights: likedInsightsTexts,
        },
        undefined,
        recentReflections
      );

      const newInsight: Omit<Insight, 'id'> = {
        text,
        actions,
        generatedAt: new Date().toISOString(),
        type: 'general'
      };

      await addDoc(collection(db, `households/${householdId}/insights`), newInsight);

      track('insight_generated');
      toast.success('New insight generated!', { id: 'insight-loading', icon: toastIcon(Sparkles) });
    } catch (error) {
      console.error("Failed to generate insight:", error);
      toast.error(describeError(error, 'generate an insight', 'read'), { id: 'insight-loading' });
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  return { refreshInsight };
}

/**
 * refreshHabitPatterns (F-DASH-03) — modeled directly on `makeRefreshInsight`
 * above. Writes to a single household-scoped doc
 * (`households/{id}/habitInsights/current`, not a growing collection since
 * these are ephemeral/regenerable) rather than appending to a history.
 */
export function makeRefreshHabitPatterns(deps: {
  db: Firestore;
  householdId: string | null;
  isGeneratingHabitPatterns: boolean;
  habits: Habit[];
  setIsGeneratingHabitPatterns: (value: boolean) => void;
}) {
  const { db, householdId, isGeneratingHabitPatterns, habits, setIsGeneratingHabitPatterns } = deps;

  const refreshHabitPatterns = async () => {
    if (!householdId) return;

    if (isGeneratingHabitPatterns) {
      toast.error('Habit patterns are already being analyzed. Please wait.');
      return;
    }

    if (!Array.isArray(habits) || habits.length === 0) {
      toast.error('Add some habits first to get coaching insights.');
      return;
    }

    try {
      setIsGeneratingHabitPatterns(true);
      toast.loading('Analyzing your habits...', { id: 'habit-patterns-loading' });

      // Dynamically load Gemini service only when needed (keeps the SDK off boot).
      const { analyzeHabitPatterns } = await import('@/services/geminiService');

      const patterns = await analyzeHabitPatterns(householdId, habits);

      await setDoc(doc(db, `households/${householdId}/habitInsights/current`), {
        patterns,
        generatedAt: new Date().toISOString(),
      });

      track('habit_patterns_generated');
      toast.success('Habit coach updated!', { id: 'habit-patterns-loading', icon: toastIcon(Sparkles) });
    } catch (error) {
      console.error('Failed to analyze habit patterns:', error);
      toast.error(describeError(error, 'analyze habit patterns', 'read'), { id: 'habit-patterns-loading' });
    } finally {
      setIsGeneratingHabitPatterns(false);
    }
  };

  return { refreshHabitPatterns };
}

/**
 * rateInsight (F-DASH-11) — thumbs up/down on a single insight doc. Plain
 * `updateDoc`, no batch needed: it only ever touches the one insight doc.
 * Original closure captures only `householdId`.
 */
export function makeRateInsight(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const rateInsight = async (insightId: string, feedback: 'up' | 'down') => {
    if (!householdId) return;
    await updateDoc(doc(db, `households/${householdId}/insights`, insightId), {
      feedback,
      feedbackAt: new Date().toISOString(),
    });
    track('insight_rated', { feedback });
  };

  return { rateInsight };
}
