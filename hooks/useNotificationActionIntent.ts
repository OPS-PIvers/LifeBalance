import { useEffect, useRef, useState } from 'react';
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
 *
 * Consumed once in `MainLayout` (authenticated shell). Reliable for the common
 * cold-open case where the SW `openWindow`s a fresh page load; an already-open,
 * focused window is a known limitation shared with the existing nsrc/recap deep
 * links (there is no client-side SW NAVIGATE handler today).
 */
export function useNotificationActionIntent(): void {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { householdId } = useHouseholdCore();

  // Read + strip the param exactly once on mount. StrictMode double-invokes
  // effects in dev, so guard with a ref to avoid consuming twice.
  const [pendingAction, setPendingAction] = useState<NotificationActionId | null>(null);
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    setPendingAction(consumeNotificationAction());
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
}
