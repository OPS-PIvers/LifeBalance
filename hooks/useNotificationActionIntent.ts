import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { trackNotificationOpenFromUrl } from '@/utils/notificationSource';
import { applyNavigateMessage, readNavigateMessage } from '@/utils/swNavigation';
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
 * Consumed once in `MainLayout` (authenticated shell). Two arrival paths are
 * handled: a cold open, where the SW `openWindow`s a fresh page load carrying
 * the params, and an already-open window, where the SW focuses it and posts a
 * `NAVIGATE` message instead (see `utils/swNavigation.ts`). The latter used to
 * go nowhere, which on iOS — where a live window client nearly always exists —
 * meant deep links effectively never landed.
 */
export interface NotificationActionIntent {
  /** Habit to log from a `log-habit` tap, or null when there's nothing pending. */
  logHabitId: string | null;
  /** Called by the dispatching child once the log has been attempted. */
  clearLogHabit: () => void;
}

/**
 * One deep-link arrival. `nonce` distinguishes a fresh arrival from the same
 * action arriving twice, so a second tap of the same notification still
 * dispatches instead of being swallowed as an unchanged state value.
 */
interface PendingIntent {
  action: NotificationActionId | null;
  habitId: string | null;
  nonce: number;
}

const NO_INTENT: PendingIntent = { action: null, habitId: null, nonce: 0 };

export function useNotificationActionIntent(): NotificationActionIntent {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { householdId } = useHouseholdCore();

  // The habit target is read in the SAME pass as the action so the two params
  // can't be consumed by racing readers — whoever strips `nact` first would
  // otherwise leave a second reader with no action to match the target against.
  const [intent, setIntent] = useState<PendingIntent>(NO_INTENT);
  const consume = useCallback(() => {
    const action = consumeNotificationAction();
    const habitId = consumeNotificationHabitId();
    if (!action && !habitId) return;
    setIntent(prev => ({
      action,
      habitId: action === NOTIFICATION_ACTIONS.logHabit ? habitId : null,
      nonce: prev.nonce + 1,
    }));
  }, []);

  // Read + strip the params exactly once on mount. StrictMode double-invokes
  // effects in dev, so guard with a ref to avoid consuming twice.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    consume();
  }, [consume]);

  // Second arrival path: the SW focused an already-open window and asked it to
  // navigate. Applying the path puts the params back in the URL, so the same
  // consume pass handles both paths — but only after a task, because the
  // hashchange that drives the router is dispatched asynchronously and
  // consuming strips the params right back out.
  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onMessage = (event: MessageEvent) => {
      const path = readNavigateMessage(event.data);
      if (!path) return;
      applyNavigateMessage(path);
      const timer = setTimeout(() => {
        timers.delete(timer);
        // Attribution is a boot-time read elsewhere, so this arrival path would
        // otherwise never record a `notification_opened`.
        trackNotificationOpenFromUrl();
        consume();
      }, 0);
      timers.add(timer);
    };
    container.addEventListener('message', onMessage);
    // Required when listening via addEventListener rather than assigning
    // `onmessage`: delivery is otherwise buffered until the document's load
    // event, and React can mount this shell before that fires — which would
    // silently drop the very first notification tap of a session.
    container.startMessages?.();
    return () => {
      container.removeEventListener('message', onMessage);
      timers.forEach(clearTimeout);
    };
  }, [consume]);

  // Perform the action once the auth + household context is available. Guarded
  // by nonce so it runs at most once per arrival.
  const dispatchedNonceRef = useRef(0);
  const { action: pendingAction } = intent;
  useEffect(() => {
    if (!pendingAction || dispatchedNonceRef.current === intent.nonce) return;
    if (!householdId || !user) return; // wait for the session to settle
    dispatchedNonceRef.current = intent.nonce;

    if (pendingAction === NOTIFICATION_ACTIONS.payBill) {
      navigate('/budget');
      toast('Open a bill below to mark it paid', { icon: '💸' });
      return;
    }

    // F-HABITS-03: land on the habits page so the logged habit (and its streak)
    // is visible behind the points toast. The write itself is the child's job —
    // see the interface doc above. Both arrival paths now route there on their
    // own, so this is a fallback for a tap that reached us some other way — and
    // it must not fire when we're already there, or it would discard the `?due`
    // filter the reminder deep-linked with.
    if (pendingAction === NOTIFICATION_ACTIONS.logHabit) {
      if (pathname !== '/habits') navigate('/habits');
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
  }, [pendingAction, intent, householdId, user, navigate, pathname]);

  const clearLogHabit = useCallback(
    () => setIntent(prev => (prev.habitId === null ? prev : { ...prev, habitId: null })),
    []
  );

  return { logHabitId: intent.habitId, clearLogHabit };
}
