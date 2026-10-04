import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc, waitForPendingWrites } from 'firebase/firestore';
import { auth, db } from '@/firebase.config';
import { createIdleTimer } from '@/utils/wall/wallIdle';
import { isNight } from '@/utils/wall/wallNight';
import { zonedDateString, zonedParts } from '@/utils/wall/wallTime';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PENDING_OFFLINE_MS,
  NIGHT_WAKE_MS,
  isMaintenanceDue,
  offlineLevel,
  type OfflineLevel,
} from '@/utils/wall/wallStatus';
import { WEATHER_REFRESH_MS, WEATHER_STALE_MS, forecastUrl, parseForecast, type WallWeather } from '@/utils/wall/wallWeather';
import type { WallSettings } from '@/types/schema';

/** Reported in displays/{did}.appVersion; bump when the wall's behavior changes. */
const APP_VERSION = 'wall-2';
const MAINTENANCE_KEY = 'LB_WALL_MAINTENANCE_DATE';
const WEATHER_KEY = 'LB_WALL_WEATHER';
const HIDDEN_RESYNC_MS = 5 * 60 * 1000;

export interface WallRuntime {
  now: Date;
  timeZone: string;
  weather: WallWeather | null;
  offline: OfflineLevel;
  /** True while the night screen should show. */
  nightShowing: boolean;
  /** Wakes the wall from the night screen for 60 s. */
  wake: () => void;
  /** Bumps whenever the wall goes idle; screens reset on change. */
  idleEpoch: number;
}

interface Options {
  settings: WallSettings;
  householdId: string;
  displayId: string | null;
  /** Called once per idle timeout (navigate home, close overlays). */
  onIdle: () => void;
}

function readCachedWeather(): WallWeather | null {
  try {
    const raw = localStorage.getItem(WEATHER_KEY);
    return raw ? (JSON.parse(raw) as WallWeather) : null;
  } catch {
    return null;
  }
}

/**
 * Everything time-driven on the wall (docs/plans/wall-display-kiosk.md §4.8).
 * The pure rules live in utils/wall/*; this hook only wires them to timers,
 * Firestore and the network.
 */
export function useWallRuntime({ settings, householdId, displayId, onIdle }: Options): WallRuntime {
  const timeZone = settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WallWeather | null>(readCachedWeather);
  const [offlineSince, setOfflineSince] = useState<number | null>(() => (navigator.onLine ? null : Date.now()));
  const [heartbeatStuckSince, setHeartbeatStuckSince] = useState<number | null>(null);
  const [wakeUntil, setWakeUntil] = useState(0);
  const [idleEpoch, setIdleEpoch] = useState(0);
  const [weatherEpoch, setWeatherEpoch] = useState(0);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  // Clock: tick at the top of every minute (plus a 15 s safety tick), so
  // "3:15" flips on time without re-rendering every second.
  useEffect(() => {
    let timeout: number | undefined;
    const schedule = () => {
      const t = new Date();
      setNow(t);
      const msToMinute = 60_000 - (t.getSeconds() * 1000 + t.getMilliseconds());
      timeout = window.setTimeout(schedule, Math.min(msToMinute + 50, 15_000));
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, []);

  // Idle return.
  useEffect(() => {
    const timer = createIdleTimer({
      timeoutMs: settings.idleReturnSec * 1000,
      onIdle: () => {
        setIdleEpoch(e => e + 1);
        onIdleRef.current();
      },
    });
    const poke = () => timer.poke();
    timer.poke();
    window.addEventListener('pointerdown', poke, { passive: true });
    window.addEventListener('keydown', poke);
    return () => {
      timer.stop();
      window.removeEventListener('pointerdown', poke);
      window.removeEventListener('keydown', poke);
    };
  }, [settings.idleReturnSec]);

  // Weather: refresh every 30 min and on demand; keep the last good copy.
  const lat = settings.weather?.lat;
  const lon = settings.weather?.lon;
  useEffect(() => {
    if (lat === undefined || lon === undefined) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const parsed = parseForecast(await res.json(), Date.now());
        if (!parsed || cancelled) return;
        setWeather(parsed);
        try {
          localStorage.setItem(WEATHER_KEY, JSON.stringify(parsed));
        } catch {
          // Cache is a convenience only.
        }
      } catch {
        // Offline or Open-Meteo down: keep showing the last good forecast.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lat, lon, weatherEpoch]);

  // Connectivity: the browser's own signal...
  useEffect(() => {
    const goOffline = () => setOfflineSince(prev => prev ?? Date.now());
    const goOnline = () => setOfflineSince(null);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // ...plus the heartbeat: a paired display stamps lastSeenAt every 5 min, and
  // a write still pending after 60 s means the network is gone even if
  // navigator.onLine says otherwise (captive Wi-Fi, a dead router).
  useEffect(() => {
    if (!displayId) return undefined;
    const ref = doc(db, `households/${householdId}/displays/${displayId}`);
    const beat = () => {
      updateDoc(ref, { lastSeenAt: serverTimestamp(), appVersion: APP_VERSION }).catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const unsub = onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      setHeartbeatStuckSince(prev => (snap.metadata.hasPendingWrites ? (prev ?? Date.now()) : null));
    }, () => undefined);
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, [householdId, displayId]);

  // Coming back from a long sleep or the bfcache: refresh what timers missed.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const refresh = () => {
      setNow(new Date());
      setWeatherEpoch(e => e + 1);
      void auth.currentUser?.getIdToken(true).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_RESYNC_MS) refresh();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // Nightly maintenance (03:00 in the household zone): one full reload, which
  // also picks up any app update, skipped while writes are still queued.
  const hour = zonedParts(now, timeZone).hour;
  const today = zonedDateString(now, timeZone);
  // Re-attempt each minute of the 3 am hour (a pending-writes skip retries).
  const maintenanceTick = hour === 3 ? now.getMinutes() : -1;
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(MAINTENANCE_KEY);
    } catch {
      last = null;
    }
    if (!isMaintenanceDue(hour, today, last)) return;
    let cancelled = false;
    const timeout = new Promise<'timeout'>(resolve => window.setTimeout(() => resolve('timeout'), 30_000));
    void Promise.race([waitForPendingWrites(db).then(() => 'done' as const), timeout]).then(result => {
      if (cancelled || result !== 'done') return; // retried on a later minute this hour
      try {
        localStorage.setItem(MAINTENANCE_KEY, today);
      } catch {
        // Without storage we'd reload every minute of the hour; skip instead.
        return;
      }
      window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [hour, today, maintenanceTick]);

  const effectiveOfflineSince =
    offlineSince ?? (heartbeatStuckSince !== null && now.getTime() - heartbeatStuckSince > HEARTBEAT_PENDING_OFFLINE_MS ? heartbeatStuckSince : null);

  const wake = useCallback(() => setWakeUntil(Date.now() + NIGHT_WAKE_MS), []);
  const nightShowing = isNight(now, settings.night, timeZone) && now.getTime() >= wakeUntil;

  // Re-check the wake window when it ends (the minute tick may be up to 15 s late).
  useEffect(() => {
    if (wakeUntil <= Date.now()) return undefined;
    const id = window.setTimeout(() => setNow(new Date()), wakeUntil - Date.now() + 50);
    return () => window.clearTimeout(id);
  }, [wakeUntil]);

  return {
    now,
    timeZone,
    weather: weather && now.getTime() - weather.fetchedAt < WEATHER_STALE_MS ? weather : null,
    offline: offlineLevel(effectiveOfflineSince, now.getTime()),
    nightShowing,
    wake,
    idleEpoch,
  };
}
