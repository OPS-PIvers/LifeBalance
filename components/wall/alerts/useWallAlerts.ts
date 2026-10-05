import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WallCalendarFeed, WallEvent, WallTravel } from '@/types/schema';
import { ALERT_SHOW_MS, dueAlert, planAlerts, readSeenAlerts, saveSeenAlerts, type WallAlert } from '@/utils/wall/wallAlerts';

interface Options {
  events: readonly WallEvent[];
  feeds: readonly WallCalendarFeed[];
  travel: readonly WallTravel[];
  leadMin: number;
  /** The wall's minute clock. */
  now: Date;
}

/**
 * Starting-soon alerts (plan §12): on each minute tick, the next due alert
 * that hasn't been shown (remembered across reloads) comes up for a minute.
 */
export function useWallAlerts({ events, feeds, travel, leadMin, now }: Options) {
  const plans = useMemo(() => planAlerts(events, feeds, travel, leadMin), [events, feeds, travel, leadMin]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeenAlerts);
  const [alert, setAlert] = useState<WallAlert | null>(null);

  // Derived from the clock during render (React's "adjust state while
  // rendering" pattern): a due alert takes the slot and is marked seen.
  if (!alert) {
    const due = dueAlert(plans, now.getTime(), seen);
    if (due) {
      setAlert(due);
      setSeen(new Set(seen).add(due.key));
    }
  }

  useEffect(() => saveSeenAlerts(seen), [seen]);

  useEffect(() => {
    if (!alert) return undefined;
    const id = window.setTimeout(() => setAlert(null), ALERT_SHOW_MS);
    return () => window.clearTimeout(id);
  }, [alert]);

  const dismiss = useCallback(() => setAlert(null), []);
  return { alert, dismiss };
}
