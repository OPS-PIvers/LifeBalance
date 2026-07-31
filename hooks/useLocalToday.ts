import { useEffect, useState } from 'react';
import { addDays, differenceInMilliseconds, startOfDay } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * Today's local `yyyy-MM-dd`, re-derived at local midnight.
 *
 * Held in state (not a mount-time memo, and NOT a bare `getLocalDateString()`
 * call during render) so an always-open surface — a wall-mounted tablet PWA, or
 * simply a phone left on a screen overnight — rolls forward instead of keeping
 * yesterday's "today" until something else happens to re-render it. A
 * self-rescheduling timeout re-derives the day just past midnight; setState
 * with the unchanged string is a no-op, so renders only happen when the day
 * actually flips.
 *
 * WHY IT'S SHARED: any two surfaces that answer the same date-bounded question
 * must anchor on the SAME day, or they disagree across the midnight boundary.
 * That bit the footer's review badge, which computed its day during render
 * while `useActionQueue` ticked: at midnight a snoozed transaction rejoined the
 * queue's list while the badge kept counting it as snoozed, so the badge read
 * lower than the list it points at. Consume this hook rather than calling
 * `getLocalDateString()` in render whenever the value feeds a comparison
 * another live surface also makes.
 */
export const useLocalToday = (): string => {
  const [localToday, setLocalToday] = useState(() => getLocalDateString());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleMidnightTick = () => {
      const now = new Date();
      // addDays is DST-safe (vs. a manual 24h add); the +1s buffer keeps a
      // slightly-early wakeup from re-arming a zero-delay loop.
      const msUntilMidnight =
        differenceInMilliseconds(startOfDay(addDays(now, 1)), now) + 1000;
      timeoutId = setTimeout(() => {
        setLocalToday(getLocalDateString());
        scheduleMidnightTick();
      }, msUntilMidnight);
    };
    scheduleMidnightTick();
    return () => clearTimeout(timeoutId);
  }, []);

  return localToday;
};
