import { useState, useEffect, useCallback, useRef } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { findLocationMatches, HabitLocationMatch } from '@/utils/habitLocationPrompt';

/**
 * Habit Automations (PRD #1065) — the foreground geo check-in.
 *
 * On app open: ONE `navigator.geolocation` read, but ONLY when (a) at least
 * one habit has a saved location and (b) the Permissions API reports
 * geolocation is already `granted` — this NEVER triggers the browser's native
 * permission prompt. A match surfaces a confirm-prompt banner via the
 * returned `current` match; confirming fires the habit exactly like one
 * manual tap (via `toggleHabit`'s existing atomic batch) with `source: 'geo'`
 * attribution. Dismissing or confirming both advance to the next queued
 * match, if any.
 *
 * Per-location daily dedup ("at most once per day per location") is enforced
 * by marking a match's dedup key as shown the moment it's SURFACED (not when
 * confirmed) — re-opening the app the same day at the same spot must not
 * re-prompt even if the first prompt was dismissed.
 */

const STORAGE_KEY = 'lb_habit_geo_prompted_v1';

interface StoredDedup {
  date: string;
  keys: string[];
}

function readStoredDedup(today: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredDedup;
    return parsed.date === today ? parsed.keys : [];
  } catch {
    return [];
  }
}

function writeStoredDedup(today: string, keys: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, keys }));
  } catch {
    // Best-effort only — localStorage may be unavailable (private mode quota,
    // storage disabled). Worst case: the prompt can re-surface later today.
  }
}

export interface UseHabitLocationPromptResult {
  /** The next match awaiting a confirm/dismiss decision, or null. */
  current: HabitLocationMatch | null;
  /** Fires the habit like one manual tap, attributed "via location: <name>". */
  confirm: () => Promise<void>;
  /** Drops the current match without logging anything. */
  dismiss: () => void;
}

export function useHabitLocationPrompt(): UseHabitLocationPromptResult {
  const { habits, toggleHabit } = useGamification();
  const [queue, setQueue] = useState<HabitLocationMatch[]>([]);
  // Guards the ONE geolocation read per app open (per PRD #18) — a re-render
  // (e.g. habits list updating) must not fire a second read.
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const anyLocations = habits.some((h) => (h.triggers?.locations?.length ?? 0) > 0);
    if (!anyLocations) return;

    hasCheckedRef.current = true;

    const runCheck = () => {
      const today = getLocalDateString();
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const current = { lat: position.coords.latitude, lng: position.coords.longitude };
          const prompted = readStoredDedup(today);
          const matches = findLocationMatches(habits, current, today, prompted);
          if (matches.length === 0) return;
          writeStoredDedup(today, [
            ...prompted,
            ...matches.map((m) => `geo:${m.locationId}:${today}`),
          ]);
          setQueue(matches);
        },
        () => {
          // Silent — GPS unavailable, timed out, or permission changed
          // between the Permissions check and the read. Never nag.
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
      );
    };

    // Never trigger the native permission prompt unprompted on boot — only
    // read when the Permissions API confirms geolocation is already granted.
    // A browser without the Permissions API (or a failed query) skips
    // silently rather than risk surprising the member with a prompt.
    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'granted') runCheck();
        })
        .catch(() => {
          // Unsupported query in this browser — skip silently.
        });
    }
  }, [habits]);

  const current = queue[0] ?? null;

  const dismiss = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const confirm = useCallback(async () => {
    if (!current) return;
    await toggleHabit(current.habitId, 'up', {
      type: 'geo',
      locationId: current.locationId,
      label: current.locationName,
    });
    setQueue((prev) => prev.slice(1));
  }, [current, toggleHabit]);

  return { current, confirm, dismiss };
}
