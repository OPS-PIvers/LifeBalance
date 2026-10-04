/**
 * Weather for the wall's top bar (docs/plans/wall-display-kiosk.md §4.8),
 * from Open-Meteo (free, no key). Pure parsing and summarizing; the fetch
 * lives in the runtime hook. All hour math uses Open-Meteo's local
 * "yyyy-MM-ddTHH:mm" strings (timezone=auto), so it's in the forecast
 * location's own time.
 */
import { hourLabel } from './wallTime';

export type WeatherIcon = 'sun' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export interface WeatherBlock {
  label: 'Morning' | 'Afternoon' | 'Evening' | 'Overnight';
  temp: number;
  icon: WeatherIcon;
  rainy: boolean;
}

export interface WeatherDay {
  date: string; // yyyy-MM-dd
  high: number;
  low: number;
  icon: WeatherIcon;
  precipMax: number;
}

export interface WallWeather {
  fetchedAt: number;
  current: { temp: number; icon: WeatherIcon };
  high: number;
  low: number;
  blocks: WeatherBlock[];
  rainNote: string | null;
  days: WeatherDay[];
}

export function forecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,weather_code',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: '6',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/** WMO weather code → icon. */
export function iconFor(code: number): WeatherIcon {
  if (code === 0) return 'sun';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloud';
}

const RAINY_ICONS: readonly WeatherIcon[] = ['rain', 'snow', 'storm'];

const PERIODS = [
  { label: 'Morning', start: 6, end: 12 },
  { label: 'Afternoon', start: 12, end: 17 },
  { label: 'Evening', start: 17, end: 21 },
  { label: 'Overnight', start: 21, end: 30 }, // 21:00 → 06:00 next day
] as const;

interface Hour {
  time: string; // yyyy-MM-ddTHH:mm
  temp: number;
  code: number;
  precip: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const nums = (v: unknown): number[] | null => (Array.isArray(v) && v.every(n => typeof n === 'number' || n === null) ? v.map(n => (typeof n === 'number' ? n : NaN)) : null);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every(s => typeof s === 'string') ? (v as string[]) : null);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Most frequent code; ties go to the higher (more severe) code. */
function dominant(codes: number[]): number {
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = codes[0] ?? 0;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code > best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

const hourOf = (time: string) => Number(time.slice(11, 13));
const dateOf = (time: string) => time.slice(0, 10);

function addDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The period containing `time`, and that period instance's start date. */
function periodAt(time: string): { index: number; date: string } {
  const h = hourOf(time);
  if (h < 6) {
    const d = new Date(`${dateOf(time)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { index: 3, date: d.toISOString().slice(0, 10) };
  }
  const index = PERIODS.findIndex(p => h >= p.start && h < p.end);
  return { index: index < 0 ? 3 : index, date: dateOf(time) };
}

/** Local time string for (date, hour), rolling hour ≥ 24 into the next day. */
function at(date: string, hour: number): string {
  const d = hour >= 24 ? addDay(date) : date;
  return `${d}T${String(hour % 24).padStart(2, '0')}:00`;
}

/** The current period (remaining hours) and the next two. */
export function timeOfDayBlocks(hours: Hour[], now: string): WeatherBlock[] {
  const nowHour = at(dateOf(now), hourOf(now));
  let { index, date } = periodAt(now);
  const blocks: WeatherBlock[] = [];
  for (let i = 0; i < 3; i++) {
    const p = PERIODS[index];
    if (!p) break;
    const from = at(date, p.start);
    const to = at(date, p.end);
    const span = hours.filter(h => h.time >= from && h.time < to && h.time >= nowHour && Number.isFinite(h.temp));
    if (span.length > 0) {
      const icon = iconFor(dominant(span.map(h => h.code)));
      blocks.push({ label: p.label, temp: Math.round(median(span.map(h => h.temp))), icon, rainy: RAINY_ICONS.includes(icon) });
    }
    index = (index + 1) % PERIODS.length;
    if (index === 0) date = addDay(date);
  }
  return blocks;
}

/** "Rain likely 6–8 pm" for the first run of ≥50% hours in the next 12 h. */
export function rainNote(hours: Hour[], now: string): string | null {
  const nowHour = at(dateOf(now), hourOf(now));
  const upcoming = hours.filter(h => h.time >= nowHour).slice(0, 12);
  const first = upcoming.findIndex(h => h.precip >= 50);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < upcoming.length && (upcoming[last + 1]?.precip ?? 0) >= 50) last++;
  const startTime = upcoming[first]?.time ?? nowHour;
  const endHour = (hourOf(upcoming[last]?.time ?? nowHour) + 1) % 24;
  const endLabel = hourLabel(endHour);
  if (first === 0) return `Rain likely until ${endLabel}`;
  const startHour = hourOf(startTime);
  const sameHalf = startHour < 12 === endHour < 12 && endHour !== 0;
  const startLabel = sameHalf ? hourLabel(startHour).replace(/ (am|pm)$/, '') : hourLabel(startHour);
  return `Rain likely ${startLabel}–${endLabel}`;
}

/** Validates and summarizes an Open-Meteo response; null when it's unusable. */
export function parseForecast(raw: unknown, fetchedAt: number): WallWeather | null {
  if (!isRecord(raw) || !isRecord(raw['current']) || !isRecord(raw['hourly']) || !isRecord(raw['daily'])) return null;
  const current = raw['current'];
  const now = current['time'];
  const temp = current['temperature_2m'];
  const code = current['weather_code'];
  if (typeof now !== 'string' || typeof temp !== 'number' || typeof code !== 'number') return null;

  const h = raw['hourly'];
  const times = strs(h['time']);
  const temps = nums(h['temperature_2m']);
  const precips = nums(h['precipitation_probability']);
  const codes = nums(h['weather_code']);
  const d = raw['daily'];
  const dTimes = strs(d['time']);
  const highs = nums(d['temperature_2m_max']);
  const lows = nums(d['temperature_2m_min']);
  const dCodes = nums(d['weather_code']);
  const dPrecip = nums(d['precipitation_probability_max']);
  if (!times || !temps || !precips || !codes || !dTimes || !highs || !lows || !dCodes || !dPrecip) return null;

  const hours: Hour[] = times.map((time, i) => ({
    time,
    temp: temps[i] ?? NaN,
    code: codes[i] ?? 0,
    precip: Number.isFinite(precips[i]) ? (precips[i] ?? 0) : 0,
  }));
  const days: WeatherDay[] = dTimes.map((date, i) => ({
    date,
    high: Math.round(highs[i] ?? NaN),
    low: Math.round(lows[i] ?? NaN),
    icon: iconFor(dCodes[i] ?? 0),
    precipMax: Number.isFinite(dPrecip[i]) ? (dPrecip[i] ?? 0) : 0,
  }));
  const today = days.find(day => day.date === dateOf(now)) ?? days[0];
  if (!today) return null;

  return {
    fetchedAt,
    current: { temp: Math.round(temp), icon: iconFor(code) },
    high: today.high,
    low: today.low,
    blocks: timeOfDayBlocks(hours, now),
    rainNote: rainNote(hours, now),
    days: days.slice(0, 5),
  };
}

/** Weather older than this is hidden rather than shown as current. */
export const WEATHER_STALE_MS = 6 * 60 * 60 * 1000;
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
