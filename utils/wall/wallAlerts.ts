import type { WallCalendarFeed, WallEvent, WallTravel, WallTravelMode } from '@/types/schema';
import { spokenDuration, spokenTime } from './wallSpeech';
import { leavePlan, routeFor } from './wallLeave';

/**
 * Starting-soon alerts (docs/plans/wall-display-kiosk.md §12 "Alerts").
 *
 * Only timed events from calendars with alerts on. With a leave time
 * (./wallLeave.ts: the event's own, or start − trip − how early to arrive): a
 * heads-up 10 min before leave-by, then "Time to leave" at leave-by. Without
 * one (no location, no home address, no route): one alert `leadMin` before
 * the start.
 */

export type AlertKind = 'heads-up' | 'leave' | 'soon';

export interface WallAlert {
  /** Stable per event start and kind, so a moved event alerts again. */
  key: string;
  kind: AlertKind;
  event: WallEvent;
  /** When it fires (ms). */
  at: number;
  start: number;
  /** When to leave (ms), or null for a plain starting-soon alert. */
  leaveBy: number | null;
  travelMin: number | null;
  mode: WallTravelMode;
}

export const ALERT_HEADS_UP_MIN = 10;
/** A missed alert (wall asleep, reloading) still shows if it's this recent. */
export const ALERT_GRACE_MS = 5 * 60_000;
/** How long the card stays up. */
export const ALERT_SHOW_MS = 60_000;

const MIN = 60_000;
const KIND_ORDER: Record<AlertKind, number> = { 'heads-up': 0, soon: 1, leave: 2 };

export function planAlerts(
  events: readonly WallEvent[],
  feeds: readonly WallCalendarFeed[],
  travel: readonly WallTravel[],
  leadMin: number,
  earlyMin: number
): WallAlert[] {
  const modes = new Map(feeds.filter(f => f.alerts === true).map(f => [f.id, f.travelMode ?? 'drive']));
  const minutes = new Map(travel.map(t => [t.id, t]));
  const out: WallAlert[] = [];
  for (const event of events) {
    const mode = event.feedId ? modes.get(event.feedId) : undefined;
    if (!mode || event.allDay || event.source !== 'feed' || !event.start) continue;
    const start = Date.parse(event.start);
    if (Number.isNaN(start)) continue;
    const plan = leavePlan(event, routeFor(event, minutes), earlyMin);
    const base = { event, start, leaveBy: plan?.at ?? null, travelMin: plan?.travelMin ?? null, mode: minutes.get(event.id)?.mode ?? mode };
    const key = (kind: AlertKind) => `${event.id}|${event.start}|${kind}`;
    if (plan) {
      out.push({ ...base, key: key('heads-up'), kind: 'heads-up', at: plan.at - ALERT_HEADS_UP_MIN * MIN });
      out.push({ ...base, key: key('leave'), kind: 'leave', at: plan.at });
    } else {
      out.push({ ...base, key: key('soon'), kind: 'soon', at: start - leadMin * MIN });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The alert to show now, if any: due within the grace window, before its
 * event starts, and not shown before. When two are due at once (the wall was
 * asleep) the later step wins: "Time to leave" beats the heads-up.
 */
export function dueAlert(plans: readonly WallAlert[], now: number, seen: ReadonlySet<string>): WallAlert | null {
  let best: WallAlert | null = null;
  for (const p of plans) {
    if (seen.has(p.key) || p.at > now || now - p.at > ALERT_GRACE_MS || now >= p.start) continue;
    if (!best || p.start < best.start || (p.start === best.start && KIND_ORDER[p.kind] > KIND_ORDER[best.kind])) best = p;
  }
  return best;
}

const MODE_NOUN: Record<WallTravelMode, string> = { drive: 'drive', walk: 'walk', bike: 'bike ride', transit: 'trip by transit' };

export interface AlertWords {
  kicker: string;
  title: string;
  /** "4:30 PM · Leo · 20 min drive" */
  detail: string;
  /** "Leave by 4:10", or empty. */
  leaveBy: string;
  speech: string;
}

/** What the card says and what the wall reads out. `person` is a first name, or null for Family. */
export function alertWords(alert: WallAlert, now: number, timeZone: string, person: string | null): AlertWords {
  const title = alert.event.title;
  const at = spokenTime(alert.event.start ?? '', timeZone);
  const travelMin = alert.travelMin;
  // "a 20 minute drive", "a 1 hour 5 minute drive"
  const trip = travelMin !== null ? `${spokenDuration(travelMin).replace(/minutes\b/, 'minute').replace(/hours\b/, 'hour')} ${MODE_NOUN[alert.mode]}` : '';
  const tripShort = travelMin !== null ? `${travelMin} min ${MODE_NOUN[alert.mode]}` : '';
  const detail = [at, person, tripShort].filter(Boolean).join(' · ');
  const leaveByMs = alert.leaveBy ?? alert.start;
  const tripLine = trip ? ` It's a ${trip}.` : '';
  const lower = title.charAt(0).toLowerCase() + title.slice(1);
  // "Leo, time to leave…" or, for Family, "Time to leave…"
  const say = (rest: string) => (person ? `${person}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1));
  if (alert.kind === 'leave') {
    return {
      kicker: 'Time to leave',
      title,
      detail,
      leaveBy: '',
      speech: say(`time to leave for ${lower}.${tripLine}`),
    };
  }
  if (alert.kind === 'heads-up') {
    const left = Math.max(1, Math.round((leaveByMs - now) / MIN));
    return {
      kicker: `Leave in ${left} min`,
      title,
      detail,
      leaveBy: `Leave by ${spokenTime(new Date(leaveByMs).toISOString(), timeZone)}`,
      speech: say(`${lower} at ${at}. Leave in ${spokenDuration(left)}.${tripLine}`),
    };
  }
  const left = Math.max(1, Math.round((alert.start - now) / MIN));
  return {
    kicker: `Starts in ${left} min`,
    title,
    detail,
    leaveBy: '',
    speech: say(`${lower} starts in ${spokenDuration(left)}.`),
  };
}

const SEEN_KEY = 'LB_WALL_ALERTS_SEEN';
const SEEN_MAX = 60;

export function readSeenAlerts(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveSeenAlerts(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_MAX)));
  } catch {
    // Without storage a reload could repeat an alert; still shown once per session.
  }
}
