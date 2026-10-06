import type { WallEvent, WallTravel } from '@/types/schema';
import { longDateText } from './wallCalendar';
import { eventsOn } from './wallSelectors';
import { spokenTime } from './wallSpeech';
import type { WallWeather, WeatherIcon } from './wallWeather';

/**
 * The day brief (docs/plans/wall-display-kiosk.md §12 "Day brief"): weather
 * and events, as lines the card shows and the wall reads out one by one.
 */

export type BriefDay = 'today' | 'tomorrow';

export interface BriefLine {
  /** `answer`: a spoken answer's headline line; `item`: a plain list line. */
  kind: 'weather' | 'count' | 'event' | 'allday' | 'more' | 'answer' | 'item';
  /** What the card shows. */
  text: string;
  /** What the wall says; empty = shown, not read (an answer's list rows). */
  speech: string;
  /** The event's owner color key, for the dot. */
  ownerKey?: string;
}

export type BriefIcon = 'calendar' | 'weather' | 'meal' | 'list' | 'clock';

/**
 * A card the wall shows and reads aloud line by line: the day brief, and every
 * spoken answer (utils/wall/wallAnswers.ts) — one frame for both.
 */
export interface WallBrief {
  /** The day a day brief is about; absent on other answers. */
  day?: BriefDay;
  date: string;
  /** Small caps line above the title. */
  kicker: string;
  title: string;
  /** The card's accessible name. */
  label: string;
  icon: BriefIcon;
  lines: BriefLine[];
}

/** After this local hour, "what's my day" means tomorrow. */
export const BRIEF_EVENING_HOUR = 18;
const MAX_EVENTS = 8;

const SKY: Record<WeatherIcon, string> = {
  sun: 'sunny',
  partly: 'partly cloudy',
  cloud: 'cloudy',
  fog: 'foggy',
  rain: 'rainy',
  snow: 'snowy',
  storm: 'stormy',
};

/** "auto" → today, or tomorrow in the evening. */
export function briefDayFor(asked: BriefDay | 'auto', localHour: number): BriefDay {
  if (asked !== 'auto') return asked;
  return localHour >= BRIEF_EVENING_HOUR ? 'tomorrow' : 'today';
}

function weatherLine(day: BriefDay, date: string, weather: WallWeather | null): BriefLine | null {
  if (!weather) return null;
  if (day === 'today') {
    const rain = weather.rainNote ? ` ${weather.rainNote}.` : '';
    return {
      kind: 'weather',
      text: `${weather.current.temp}° now, ${SKY[weather.current.icon]} · high ${weather.high}°${weather.rainNote ? ` · ${weather.rainNote.toLowerCase()}` : ''}`,
      speech: `It's ${weather.current.temp} degrees and ${SKY[weather.current.icon]}, with a high of ${weather.high}.${rain.replace('–', ' to ')}`,
    };
  }
  const d = weather.days.find(x => x.date === date);
  if (!d) return null;
  const pct = Math.round(d.precipMax);
  // Only shown from 40%, so "an" is only ever the 80s.
  const article = pct >= 80 && pct < 90 ? 'an' : 'a';
  const rain = d.precipMax >= 40 ? ` There's ${article} ${pct} percent chance of rain.` : '';
  return {
    kind: 'weather',
    text: `${SKY[d.icon].charAt(0).toUpperCase()}${SKY[d.icon].slice(1)} · high ${d.high}°, low ${d.low}°${d.precipMax >= 40 ? ` · ${Math.round(d.precipMax)}% rain` : ''}`,
    speech: `Tomorrow looks ${SKY[d.icon]}, with a high of ${d.high} and a low of ${d.low}.${rain}`,
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export interface BriefInput {
  day: BriefDay;
  date: string;
  events: readonly WallEvent[];
  travel: readonly WallTravel[];
  weather: WallWeather | null;
  /** Wall clock, for skipping what's already over today. */
  now: number;
  timeZone: string;
  /** A first name for a member key, or null for Family / unknown. */
  person: (ownerKey: string) => string | null;
  /** That day's planned dinner; null = nothing planned; absent = no line. */
  dinner?: string | null;
  /** Open to-dos due that day (today: overdue too); absent = no line. */
  todosDue?: number;
}

export function composeBrief({ day, date, events, travel, weather, now, timeZone, person, dinner, todosDue }: BriefInput): WallBrief {
  const lines: BriefLine[] = [];
  const w = weatherLine(day, date, weather);
  if (w) lines.push(w);

  const all = eventsOn(events, date);
  const allDay = all.filter(e => e.allDay);
  // Today: only what hasn't finished yet.
  const timed = all.filter(e => !e.allDay && e.start && (day === 'tomorrow' || Date.parse(e.end ?? e.start) > now));
  const minutes = new Map(travel.filter(t => t.minutes !== null).map(t => [t.id, t]));
  const when = day === 'today' ? (timed.length < all.filter(e => !e.allDay).length ? 'left today' : 'today') : 'tomorrow';

  if (timed.length === 0) {
    lines.push({ kind: 'count', text: day === 'today' ? 'Nothing else on the calendar today' : 'Nothing on the calendar tomorrow', speech: day === 'today' ? 'Nothing else is on the calendar today.' : 'Nothing is on the calendar tomorrow.' });
  } else {
    const n = timed.length;
    lines.push({ kind: 'count', text: `${n} ${n === 1 ? 'thing' : 'things'} ${when}`, speech: `You have ${n} ${n === 1 ? 'thing' : 'things'} ${when}.` });
  }

  for (const e of allDay) {
    if (e.source === 'bill') lines.push({ kind: 'allday', text: `${e.title} is due`, speech: `The ${lowerFirst(e.title)} is due.` });
    else if (e.source === 'holiday') lines.push({ kind: 'allday', text: e.title, speech: `It's ${e.title}.` });
    else {
      const who = person(e.ownerKey);
      lines.push({ kind: 'allday', text: `All day · ${e.title}${who ? ` · ${who}` : ''}`, speech: `All day${who ? `, ${who} has` : ':'} ${lowerFirst(e.title)}.`, ownerKey: e.ownerKey });
    }
  }

  for (const e of timed.slice(0, MAX_EVENTS)) {
    const at = spokenTime(e.start ?? '', timeZone);
    const who = person(e.ownerKey);
    const t = minutes.get(e.id);
    const leaveBy = t && t.start === e.start && t.minutes !== null ? spokenTime(new Date(Date.parse(e.start ?? '') - t.minutes * 60_000).toISOString(), timeZone) : null;
    lines.push({
      kind: 'event',
      text: `${at} · ${e.title}${who ? ` · ${who}` : ''}${leaveBy ? ` · leave by ${leaveBy}` : ''}`,
      speech: `At ${at}, ${who ? `${who} has ${lowerFirst(e.title)}` : lowerFirst(e.title)}.${leaveBy ? ` Leave by ${leaveBy}.` : ''}`,
      ownerKey: e.ownerKey,
    });
  }
  if (timed.length > MAX_EVENTS) {
    const rest = timed.length - MAX_EVENTS;
    lines.push({ kind: 'more', text: `and ${rest} more`, speech: `And ${rest} more. The calendar has the rest.` });
  }
  if (dinner !== undefined) {
    const when = day === 'today' ? 'tonight' : 'tomorrow';
    lines.push(
      dinner
        ? { kind: 'item', text: `Dinner · ${dinner}`, speech: `Dinner ${when} is ${dinner}.` }
        : { kind: 'item', text: 'No dinner planned', speech: `Nothing's planned for dinner ${when}.` }
    );
  }
  if (todosDue !== undefined) {
    const when = day === 'today' ? 'today' : 'tomorrow';
    const n = todosDue;
    lines.push({
      kind: 'item',
      text: n === 0 ? `No to-dos due ${when}` : `${n} ${n === 1 ? 'to-do' : 'to-dos'} due ${when}`,
      speech: n === 0 ? `No to-dos are due ${when}.` : `There ${n === 1 ? 'is 1 to-do' : `are ${n} to-dos`} due ${when}.`,
    });
  }
  return {
    day,
    date,
    kicker: longDateText(date),
    title: day === 'today' ? 'Today' : 'Tomorrow',
    label: day === 'today' ? 'Your day' : 'Tomorrow',
    icon: 'calendar',
    lines,
  };
}
