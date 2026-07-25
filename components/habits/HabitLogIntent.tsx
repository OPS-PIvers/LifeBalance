import React, { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';

interface HabitLogIntentProps {
  /** Habit to log, from the notification's `nhabit` deep-link param. */
  habitId: string;
  /** Called once the log has been attempted (success, failure, or skipped). */
  onDone: () => void;
}

/**
 * F-HABITS-03 — performs the `log-habit` notification-action write. Renders nothing.
 *
 * It exists as a component rather than living in `useNotificationActionIntent`
 * so the gamification slice subscription sits in a throwaway child instead of in
 * `MainLayout`: the shell reads only narrow slices on purpose, and subscribing it
 * to habits/points would re-render the entire app on every toggle by any member.
 *
 * Logs ONE unit for today with no explicit `TriggerSource` — i.e. as a plain
 * manual tap. That's the honest attribution: the reminder didn't log anything,
 * the person who tapped it did, so this needs no new trigger type, no attribution
 * line, and no per-day dedup key. Undo comes free from the points toast that
 * `toggleHabit` already raises.
 */
const HabitLogIntent: React.FC<HabitLogIntentProps> = ({ habitId, onDone }) => {
  const { isLoading } = useHouseholdCore();
  const { habits, toggleHabit } = useGamification();
  const firedRef = useRef(false);

  useEffect(() => {
    // Habits arrive via a listener, so an empty list while loading means "not
    // yet", not "no such habit" — resolving early would report not-found on
    // every cold open from a notification.
    if (firedRef.current || isLoading) return;
    firedRef.current = true;

    const habit = habits.find(h => h.id === habitId);
    if (!habit) {
      toast.error('That habit no longer exists');
      onDone();
      return;
    }
    // toggleHabit already no-ops an 'up' on an archived habit; say so rather
    // than leaving the tap looking like it silently did nothing.
    if (habit.archivedAt) {
      toast(`${habit.title} is archived`, { icon: '📦' });
      onDone();
      return;
    }

    void toggleHabit(habitId, 'up').finally(onDone);
  }, [habitId, habits, isLoading, toggleHabit, onDone]);

  return null;
};

export default HabitLogIntent;
