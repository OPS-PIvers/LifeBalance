import { HabitMood, HabitSubmission } from '@/types/schema';

/** Compact shape handed to the AI insight prompt — never the full submission. */
export interface ReflectionSnippet {
  habitTitle: string;
  mood?: HabitMood;
  note?: string;
}

// Keeps a note-heavy insight prompt from ballooning; matches the ~280-char cap
// enforced at write time in useHabitActions, but a second, smaller cap here so
// the payload sent to the AI insight prompt stays deliberately terse.
const INSIGHT_NOTE_MAX_LENGTH = 80;

/**
 * F-HABITS-06 owner note (3): pick the most recent note/mood-bearing
 * submissions to surface in the AI insight prompt, bounded and de-identified
 * down to {habitTitle, mood, note}. Pure so it's unit-testable without
 * Firestore — callers fetch the candidate submissions and pass them in here.
 */
export function selectRecentReflections(
  submissions: HabitSubmission[],
  limit = 5
): ReflectionSnippet[] {
  return submissions
    .filter(s => s.mood || s.note)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)
    .map(s => ({
      habitTitle: s.habitTitle,
      ...(s.mood ? { mood: s.mood } : {}),
      ...(s.note ? { note: s.note.slice(0, INSIGHT_NOTE_MAX_LENGTH) } : {}),
    }));
}
