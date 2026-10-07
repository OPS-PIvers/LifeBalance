import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc, waitForPendingWrites } from 'firebase/firestore';
import { auth, db } from '@/firebase.config';
import { createIdleTimer } from '@/utils/wall/wallIdle';
import { isNight } from '@/utils/wall/wallNight';
import { UPDATE_CHECK_MS, WALL_UPDATE_EVENT, entryScriptOf, isUpdateAvailable, runningEntryScript } from '@/utils/wall/wallVersion';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PENDING_OFFLINE_MS,
  NIGHT_WAKE_MS,
  offlineLevel,
  type OfflineLevel,
} from '@/utils/wall/wallStatus';
import { WEATHER_REFRESH_MS, WEATHER_STALE_MS, forecastUrl, parseForecast, type WallWeather } from '@/utils/wall/wallWeather';
import type { WallSettings } from '@/types/schema';

/** Reported in displays/{did}.appVersion; bump when the wall's behavior changes. */
export const APP_VERSION = 'wall-5';
const RELOADED_FOR_KEY = 'LB_WALL_RELOADED_FOR';
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
  /** The new build's entry script once a deploy is out and not yet loaded, else null. */
  updateBuild: string | null;
  /**
   * Reloads into the new build (someone tapped Update), after giving queued
   * writes a moment to reach the server. Resolves false while the wall is
   * offline.
   */
  applyUpdate: () => Promise<boolean>;
}

interface Options {
  settings: WallSettings;
  householdId: string;
  displayId: string | null;
  /** Called once per idle timeout (navigate home, close overlays). */
  onIdle: () => void;
}

/** How long a reload waits for queued writes before going ahead anyway. */
const WRITES_GRACE_MS = 5_000;

/**
 * Gives queued writes a moment to reach the server before a reload. It does
 * not gate the reload: whether the wall is online is the offline mark's call
 * (navigator.onLine plus the heartbeat), and persistence keeps queued writes
 * in IndexedDB for the new page to send. Gating on waitForPendingWrites left
 * Update stuck on "Try again" on a wall whose heartbeat was confirming fine:
 * it waits on the whole local write queue, and something in it never settled
 * until the page was refreshed by hand.
 */
function settleWrites(): Promise<void> {
  const grace = new Promise<void>(resolve => window.setTimeout(resolve, WRITES_GRACE_MS));
  return Promise.race([waitForPendingWrites(db).catch(() => undefined), grace]);
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

  const effectiveOfflineSince =
    offlineSince ?? (heartbeatStuckSince !== null && now.getTime() - heartbeatStuckSince > HEARTBEAT_PENDING_OFFLINE_MS ? heartbeatStuckSince : null);

  const offline = offlineLevel(effectiveOfflineSince, now.getTime());
  const online = offline === 'online';
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const wake = useCallback(() => setWakeUntil(Date.now() + NIGHT_WAKE_MS), []);
  const applyUpdate = useCallback(async () => {
    if (!onlineRef.current || !navigator.onLine) return false;
    await settleWrites();
    window.location.reload();
    return true;
  }, []);
  const nightShowing = isNight(now, settings.night, timeZone) && now.getTime() >= wakeUntil;

  // Updates: ask every 10 min whether a new version is deployed, and right
  // away when the service worker reports one (index.html fires the event
  // instead of reloading a wall).
  const [running] = useState(() => runningEntryScript(document));
  const [served, setServed] = useState<string | null>(null);
  useEffect(() => {
    if (!running) return undefined; // dev server: nothing to compare
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/index.html', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const next = entryScriptOf(await res.text());
        if (!cancelled && next) setServed(next);
      } catch {
        // Offline: ask again next time.
      }
    };
    const onWorkerUpdate = () => void check();
    void check();
    const id = window.setInterval(() => void check(), UPDATE_CHECK_MS);
    window.addEventListener(WALL_UPDATE_EVENT, onWorkerUpdate);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener(WALL_UPDATE_EVENT, onWorkerUpdate);
    };
  }, [running]);

  // ...and apply it on its own only while the night screen is up: a reload
  // locks the iPad's audio and mic until the next touch, which nobody notices
  // at night. In the day the wall offers it instead (WallUpdateToast).
  // Skipped while the wall is offline (retried each minute) and never twice
  // for the same build, so a stale CDN can't cause a reload loop.
  const updateReady = isUpdateAvailable(running, served);
  const minuteTick = nightShowing && updateReady ? now.getMinutes() : -1;
  useEffect(() => {
    if (!updateReady || !nightShowing || !served || !online) return undefined;
    try {
      if (localStorage.getItem(RELOADED_FOR_KEY) === served) return undefined;
    } catch {
      return undefined; // without storage we couldn't stop a loop
    }
    let cancelled = false;
    void settleWrites().then(() => {
      if (cancelled) return;
      try {
        localStorage.setItem(RELOADED_FOR_KEY, served);
      } catch {
        return;
      }
      window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [updateReady, nightShowing, served, online, minuteTick]);

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
    offline,
    nightShowing,
    wake,
    idleEpoch,
    updateBuild: updateReady ? served : null,
    applyUpdate,
  };
}
