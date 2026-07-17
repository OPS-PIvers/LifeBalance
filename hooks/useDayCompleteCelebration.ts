import { useCallback, useEffect, useRef, useState } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { streakForHabit } from '@/utils/habitLogic';
import {
  getDayCompleteStatus,
  markDayCompleteFired,
  shouldFireDayComplete,
} from '@/utils/dayComplete';

/** Data shown inside the celebration overlay (all derived read-only). */
export interface DayCompleteSummary {
  /** How many due daily habits were completed today. */
  total: number;
  /** Points earned today (from the gamification slice — no server read). */
  dailyPoints: number;
  /** Strongest active positive streak, for a bit of streak pride. 0 if none. */
  topStreak: number;
}

export interface DayCompleteCelebrationState {
  isOpen: boolean;
  summary: DayCompleteSummary | null;
  close: () => void;
}

/** Read window.localStorage defensively (SSR / private mode / disabled). */
const safeLocalStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Watches the habit list for the moment the user finishes their LAST due daily
 * habit and, on that false→true transition, opens the "day complete" moment —
 * at most once per local day per device (see `utils/dayComplete.ts`).
 *
 * Lives at the hook/component layer (not in a context) so it works identically
 * under the Firebase and Mock providers — both feed it through `useGamification`.
 * It performs no writes of any kind (only a localStorage latch).
 */
export const useDayCompleteCelebration = (): DayCompleteCelebrationState => {
  const { habits, dailyPoints } = useGamification();
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState<DayCompleteSummary | null>(null);

  // `null` = not yet measured. Initializing on the first effect run (rather than
  // to `false`) means arriving on the page already-complete only establishes the
  // baseline and never pops the moment — it fires only on a genuine transition
  // caused by a toggle in this session.
  const wasCompleteRef = useRef<boolean | null>(null);
  // Read the latest points at fire time without making the effect re-run on
  // every points change (which would fire mid-day as the counter ticks).
  const dailyPointsRef = useRef(dailyPoints);
  useEffect(() => {
    dailyPointsRef.current = dailyPoints;
  }, [dailyPoints]);

  useEffect(() => {
    const today = getLocalDateString();
    const status = getDayCompleteStatus(habits, today);
    const prev = wasCompleteRef.current;
    wasCompleteRef.current = status.isComplete;

    if (prev === null) return; // baseline only — never fire on first measurement

    const storage = safeLocalStorage();
    if (!shouldFireDayComplete({ wasComplete: prev, status, today, storage })) return;

    markDayCompleteFired(today, storage);

    const topStreak = habits.reduce((max, h) => {
      if (h.type !== 'positive') return max;
      const s = streakForHabit(h);
      return s > max ? s : max;
    }, 0);

    setSummary({ total: status.total, dailyPoints: dailyPointsRef.current, topStreak });
    setIsOpen(true);
  }, [habits]);

  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, summary, close };
};
