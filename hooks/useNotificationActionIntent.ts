import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  consumeNotificationAction,
  consumeNotificationHabitId,
  NOTIFICATION_ACTIONS,
  type NotificationActionId,
} from '@/utils/notificationActions';

/**
 * F-NOTIF-05 — dispatch a notification action-button tap on app open.
 *
 * When the user taps "Pay bill" / "Snooze 1 day" on a bill-reminder push, the
 * service worker opens the app with `?nact=<action>` in the URL. This hook reads
 * + strips that param once on mount (mirroring how `recapParam` and
 * `notificationSource` consume their deep-link params) and, once the household
 * session is ready, performs the action from the authenticated client — so no
 * unauthenticated Cloud Function endpoint is needed:
 *   - `pay-bill`   : navigate to the budget page (the pay flow) + a nudge toast.
 *   - `snooze-bill`: write `billReminders.snoozedUntil = tomorrow` on the member
 *     doc so the scheduled sendbillreminders job skips the next day.
 *   - `log-habit`  : F-HABITS-03 — logs the habit named by the `nhabit` param.
 *     NOT performed here: that needs the gamification slice, and this hook runs
 *     in `MainLayout`, which deliberately consumes only narrow slices so a habit
 *     toggle can't re-render the whole shell. The habit id is returned instead
 *     and MainLayout renders a short-lived child to do the write.
 *
 * Consumed once in `MainLayout` (authenticated shell). Reliable for the common
 * cold-open case where the SW `openWindow`s a fresh page load; an already-open,
 * focused window is a known limitation shared with the existing nsrc/recap deep
 * links (there is no client-side SW NAVIGATE handler today).
 */
export interface NotificationActionIntent {
  /** Habit to log from a `log-habit` tap, or null when there's nothing pending. */
  logHabitId: string | null;
  /** Called by the dispatching child once the log has been attempted. */
  clearLogHabit: () => void;
}

export function useNotificationActionIntent(): NotificationActionIntent {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { householdId } = useHouseholdCore();

  // Read + strip the param exactly once on mount. StrictMode double-invokes
  // effects in dev, so guard with a ref to avoid consuming twice.
  const [pendingAction, setPendingAction] = useState<NotificationActionId | null>(null);
  // The habit target is read in the SAME pass as the action so the two params
  // can't be consumed by racing readers — whoever strips `nact` first would
  // otherwise leave a second reader with no action to match the target against.
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null);
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const action = consumeNotificationAction();
    const habitId = consumeNotificationHabitId();
    setPendingAction(action);
    setPendingHabitId(action === NOTIFICATION_ACTIONS.logHabit ? habitId : null);
  }, []);

  // Perform the action once the auth + household context is available. Guarded
  // so it runs at most once per consumed action.
  const dispatchedRef = useRef(false);
  useEffect(() => {
    if (!pendingAction || dispatchedRef.current) return;
    if (!householdId || !user) return; // wait for the session to settle
    dispatchedRef.current = true;

    if (pendingAction === NOTIFICATION_ACTIONS.payBill) {
      navigate('/budget');
      toast('Open a bill below to mark it paid', { icon: '💸' });
      return;
    }

    // F-HABITS-03: land on the habits page so the logged habit (and its streak)
    // is visible behind the points toast. The write itself is the child's job —
    // see the interface doc above. Matters for the already-open-window case,
    // where the SW focused an existing tab on some other route.
    if (pendingAction === NOTIFICATION_ACTIONS.logHabit) {
      navigate('/habits');
      return;
    }

    if (pendingAction === NOTIFICATION_ACTIONS.snoozeBill) {
      const snoozedUntil = getLocalDateString(addDays(new Date(), 1));
      const memberRef = doc(db, 'households', householdId, 'members', user.uid);
      updateDoc(memberRef, {
        'notificationPreferences.billReminders.snoozedUntil': snoozedUntil,
      })
        .then(() => toast.success('Bill reminders snoozed until tomorrow'))
        .catch((error) => {
          console.error('[Notifications] Failed to snooze bill reminders:', error);
          toast.error('Could not snooze bill reminders');
        });
    }
  }, [pendingAction, householdId, user, navigate]);

  const clearLogHabit = useCallback(() => setPendingHabitId(null), []);

  return { logHabitId: pendingHabitId, clearLogHabit };
}
