import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { createIdleTimer } from '@/utils/wall/wallIdle';
import { isNight, minutesInZone } from '@/utils/wall/wallNight';
import { logEvent } from './labLog';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const WAKE_MS = 60_000;

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Check 6 support: idle return, the night window and a timer-lag meter.
 * Leave this tab open for the 72-hour soak; the lag and idle counts show
 * whether iPadOS throttles timers on a page that never sleeps.
 */
const LabTimers: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  const [idleSec, setIdleSec] = useState(10);
  const [idleCount, setIdleCount] = useState(0);
  const [lastPoke, setLastPoke] = useState(() => Date.now());
  const [maxLagMs, setMaxLagMs] = useState(0);
  const startMinute = minutesInZone(new Date(), TIME_ZONE);
  const [night, setNight] = useState({ start: hhmm(startMinute + 1), end: hhmm(startMinute + 3) });
  const [nightPreview, setNightPreview] = useState(false);
  const [wakeUntil, setWakeUntil] = useState(0);
  const [idleFired, setIdleFired] = useState(false);

  // 1 Hz clock plus a lag meter: how late each tick actually fires.
  useEffect(() => {
    let expected = performance.now() + 1000;
    const id = window.setInterval(() => {
      const lag = performance.now() - expected;
      expected = performance.now() + 1000;
      setNow(new Date());
      if (lag > 0) setMaxLagMs(prev => (lag > prev ? lag : prev));
      if (lag > 5000) logEvent('timer-lag', `${Math.round(lag)} ms`);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const timer = createIdleTimer({
      timeoutMs: idleSec * 1000,
      onIdle: () => {
        setIdleCount(c => c + 1);
        setIdleFired(true);
        logEvent('idle-return', `${idleSec}s`);
      },
    });
    const poke = () => {
      timer.poke();
      setLastPoke(Date.now());
      setIdleFired(false);
    };
    timer.poke();
    window.addEventListener('pointerdown', poke);
    window.addEventListener('keydown', poke);
    return () => {
      timer.stop();
      window.removeEventListener('pointerdown', poke);
      window.removeEventListener('keydown', poke);
    };
  }, [idleSec]);

  const inNight = isNight(now, night, TIME_ZONE);
  const awake = now.getTime() < wakeUntil;
  const showNight = nightPreview || (inNight && !awake);
  const idleLeft = Math.max(0, idleSec - Math.floor((now.getTime() - lastPoke) / 1000));

  return (
    <div className="space-y-6 text-lg">
      <dl className="grid grid-cols-[16rem_1fr] gap-y-2">
        <dt className="text-brand-500">Time zone</dt>
        <dd>{TIME_ZONE}, {hhmm(minutesInZone(now, TIME_ZONE))}</dd>
        <dt className="text-brand-500">Max timer lag</dt>
        <dd>{Math.round(maxLagMs)} ms</dd>
        <dt className="text-brand-500">Idle return</dt>
        <dd>
          {idleFired ? 'fired, waiting for a tap' : `in ${idleLeft}s`} · fired {idleCount}×
        </dd>
        <dt className="text-brand-500">Night window</dt>
        <dd>{inNight ? (awake ? 'night, woken' : 'night') : 'day'}</dd>
      </dl>
      <div className="flex flex-wrap gap-6 items-end">
        <label className="grid gap-1">
          Idle after (s)
          <input type="number" min={3} className="h-12 w-28 rounded-lg border border-brand-300 px-3 bg-transparent" value={idleSec} onChange={e => setIdleSec(Math.max(3, Number(e.target.value) || 3))} />
        </label>
        <label className="grid gap-1">
          Night start
          <input type="time" className="h-12 rounded-lg border border-brand-300 px-3 bg-transparent" value={night.start} onChange={e => setNight(n => ({ ...n, start: e.target.value }))} />
        </label>
        <label className="grid gap-1">
          Night end
          <input type="time" className="h-12 rounded-lg border border-brand-300 px-3 bg-transparent" value={night.end} onChange={e => setNight(n => ({ ...n, end: e.target.value }))} />
        </label>
        <Button variant="outline" size="lg" onClick={() => setNightPreview(true)}>Preview night screen</Button>
      </div>
      {showNight && (
        <button
          type="button"
          className="fixed inset-0 z-modal bg-black text-brand-500 flex flex-col items-center justify-center gap-4"
          onClick={() => {
            setNightPreview(false);
            setWakeUntil(Date.now() + WAKE_MS);
          }}
        >
          <span className="font-display text-[160px] leading-none">
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')}
          </span>
          <span className="text-2xl">Tap to wake for 60 seconds</span>
        </button>
      )}
    </div>
  );
};

export default LabTimers;
