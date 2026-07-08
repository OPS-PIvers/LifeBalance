import { useEffect } from 'react';
import toast, { useToasterStore } from 'react-hot-toast';

/**
 * Max number of toasts visible at once, app-wide.
 *
 * react-hot-toast has no built-in cap, and a burst of programmatic toasts
 * (e.g. several failed background syncs firing in quick succession) would
 * otherwise stack into a wall on a phone screen. Material guidance is a
 * single visible snackbar; we allow 2 so a newly-surfaced error isn't
 * instantly buried by an in-flight success toast.
 */
const TOAST_LIMIT = 2;

/**
 * Renders nothing. Watches the shared react-hot-toast store and dismisses
 * the oldest visible toasts once more than `TOAST_LIMIT` are showing,
 * keeping the newest ones on screen.
 *
 * react-hot-toast's reducer prepends new toasts (`[newToast, ...toasts]`),
 * so the store array is newest-first — the toasts at index >= TOAST_LIMIT
 * are the oldest visible ones, which is exactly what we want to drop.
 *
 * `toast.dismiss` marks a toast as dismissed (triggering its exit
 * animation) rather than removing it instantly; the library removes it
 * from the store shortly after. That's the desired behavior here too.
 *
 * Mount once near the app's <Toaster /> (see App.tsx).
 */
export const ToastLimiter: React.FC = () => {
  const { toasts } = useToasterStore();

  useEffect(() => {
    toasts
      .filter((t) => t.visible)
      .filter((_, i) => i >= TOAST_LIMIT)
      .forEach((t) => toast.dismiss(t.id));
  }, [toasts]);

  return null;
};
