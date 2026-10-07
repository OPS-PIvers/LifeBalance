import type { WallLayout, WallModuleKey, WallSettings, WallSoundStyle, WallVoiceEngine, WallWakeFile, WallWakeModel } from '@/types/schema';

/**
 * Defaults and normalization for `wallSettings/config`
 * (docs/plans/wall-display-kiosk.md §4.4). The doc is member-editable and may
 * be missing or partial, so every read goes through `resolveWallSettings`:
 * an absent or malformed field falls back to its default rather than
 * breaking the wall.
 */

export const WALL_MODULE_KEYS: readonly WallModuleKey[] = ['coming', 'shopping', 'todos', 'meals', 'due'];
export const WALL_ROTATION_INTERVALS: readonly number[] = [30, 60, 120, 300];
export const WALL_IDLE_RETURN_OPTIONS: readonly number[] = [60, 180, 300, 600];
export const WALL_VOICE_ENGINES: readonly WallVoiceEngine[] = ['auto', 'device', 'speech', 'audio', 'off'];
export const WALL_SOUND_STYLES: readonly WallSoundStyle[] = ['speak', 'chime'];
/** Settings' Low / Medium / High. */
export const WALL_VOLUMES: readonly number[] = [0.4, 0.7, 1];
export const WALL_ALERT_LEADS: readonly number[] = [5, 10, 15, 30];

/** openWakeWord's pre-trained English wake words the wall ships (public/voice/openwakeword-*). */
export const WAKE_BUILT_INS: readonly { keyword: string; label: string }[] = [
  { keyword: 'hey_jarvis', label: 'Hey Jarvis' },
  { keyword: 'hey_mycroft', label: 'Hey Mycroft' },
  { keyword: 'hey_rhasspy', label: 'Hey Rhasspy' },
];
/** Settings' Low / Medium / High sensitivity, as detection thresholds (higher sensitivity = lower threshold). */
export const WAKE_THRESHOLDS: readonly { label: string; threshold: number }[] = [
  { label: 'Low', threshold: 0.7 },
  { label: 'Medium', threshold: 0.5 },
  { label: 'High', threshold: 0.3 },
];
/** A custom .onnx is stored in chunk docs (`wallSettings/wake-N`), each under Firestore's 1 MB. */
export const WAKE_CHUNK_BYTES = 700_000;
export const WAKE_MAX_CHUNKS = 4;
/** openWakeWord's notebook makes ~0.9 MB; the stock models are ≤ 1.3 MB. */
export const WAKE_CUSTOM_MAX_BYTES = WAKE_CHUNK_BYTES * WAKE_MAX_CHUNKS;
export const wakeChunkDocId = (i: number): string => `wake-${i}`;

/** A file's bytes as the chunks it's stored in. */
export function splitWakeFile(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += WAKE_CHUNK_BYTES) out.push(bytes.subarray(at, at + WAKE_CHUNK_BYTES));
  return out;
}

/** The chunks back into the file, checking each belongs to it. */
export function joinWakeFile(file: WallWakeFile, chunks: readonly ({ id?: unknown; data?: Uint8Array } | undefined)[]): Uint8Array {
  const out = new Uint8Array(file.bytes);
  let at = 0;
  for (let i = 0; i < file.chunks; i++) {
    const c = chunks[i];
    if (!c || c.id !== file.id || !(c.data instanceof Uint8Array)) throw new Error('The wake word file is incomplete. Upload it again.');
    if (at + c.data.length > out.length) throw new Error('The wake word file is the wrong size. Upload it again.');
    out.set(c.data, at);
    at += c.data.length;
  }
  if (at !== file.bytes) throw new Error('The wake word file is the wrong size. Upload it again.');
  return out;
}

export const DEFAULT_WAKE_MODEL: WallWakeModel = { keyword: 'hey_jarvis', label: 'Hey Jarvis', threshold: 0.5 };

export const DEFAULT_WALL_SETTINGS: WallSettings = {
  defaultModules: ['coming'],
  rotation: { enabled: false, intervalSec: 60 },
  idleReturnSec: 180,
  night: { start: '22:00', end: '06:00' },
  theme: 'light',
  textSize: 'normal',
  showBills: true,
  holidaysEnabled: true,
  voice: 'auto',
  wakeWord: true,
  wakeModel: DEFAULT_WAKE_MODEL,
  sound: { confirm: 'speak', alerts: 'speak', volume: 0.7 },
  alerts: { leadMin: 10 },
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 0–2 known, distinct modules; anything else is dropped. */
export function normalizeModules(raw: unknown): WallModuleKey[] {
  if (!Array.isArray(raw)) return [];
  const out: WallModuleKey[] = [];
  for (const entry of raw) {
    const key = WALL_MODULE_KEYS.find(k => k === entry);
    if (key && !out.includes(key)) out.push(key);
    if (out.length === 2) break;
  }
  return out;
}

export function normalizeLayout(raw: unknown): WallLayout | undefined {
  if (!isRecord(raw)) return undefined;
  const modules = normalizeModules(raw['modules']);
  const rawDay = raw['day'];
  if (rawDay === null) return { modules, day: null };
  const day = WALL_MODULE_KEYS.find(k => k === rawDay);
  // An unknown key (a newer wall's module) falls back to the default.
  return day && !modules.includes(day) ? { modules, day } : { modules };
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function normalizeWakeFile(raw: unknown): WallWakeFile | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, chunks, bytes } = raw;
  if (typeof id !== 'string' || !id) return undefined;
  if (typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 1 || chunks > WAKE_MAX_CHUNKS) return undefined;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > chunks * WAKE_CHUNK_BYTES) return undefined;
  return { id, chunks, bytes };
}

/** The wake word to use: a known built-in, or a custom model that has its file; anything else is the default. */
export function normalizeWakeModel(raw: unknown): WallWakeModel {
  if (!isRecord(raw)) return DEFAULT_WAKE_MODEL;
  const t = Number(raw['threshold']);
  const threshold = Number.isFinite(t) && t >= 0.05 && t <= 0.95 ? t : DEFAULT_WAKE_MODEL.threshold;
  const builtIn = WAKE_BUILT_INS.find(b => b.keyword === raw['keyword']);
  if (builtIn) return { keyword: builtIn.keyword, label: builtIn.label, threshold };
  const file = normalizeWakeFile(raw['file']);
  if (raw['keyword'] === 'custom' && file) {
    const label = typeof raw['label'] === 'string' && raw['label'].trim() ? raw['label'].trim() : 'Hey Home';
    return { keyword: 'custom', file, label, threshold };
  }
  return { ...DEFAULT_WAKE_MODEL, threshold };
}

export function resolveWallSettings(raw: unknown): WallSettings {
  const d = isRecord(raw) ? raw : {};
  const def = DEFAULT_WALL_SETTINGS;
  const rotation = isRecord(d['rotation']) ? d['rotation'] : {};
  const night = isRecord(d['night']) ? d['night'] : {};
  const weather = isRecord(d['weather']) ? d['weather'] : undefined;
  const sound = isRecord(d['sound']) ? d['sound'] : {};
  const volume = Number(sound['volume']);
  const alerts = isRecord(d['alerts']) ? d['alerts'] : {};

  const settings: WallSettings = {
    defaultModules: Array.isArray(d['defaultModules']) ? normalizeModules(d['defaultModules']) : def.defaultModules,
    rotation: {
      enabled: typeof rotation['enabled'] === 'boolean' ? rotation['enabled'] : def.rotation.enabled,
      intervalSec: WALL_ROTATION_INTERVALS.includes(Number(rotation['intervalSec']))
        ? Number(rotation['intervalSec'])
        : def.rotation.intervalSec,
    },
    idleReturnSec: WALL_IDLE_RETURN_OPTIONS.includes(Number(d['idleReturnSec']))
      ? Number(d['idleReturnSec'])
      : def.idleReturnSec,
    night: {
      start: typeof night['start'] === 'string' && HHMM_RE.test(night['start']) ? night['start'] : def.night.start,
      end: typeof night['end'] === 'string' && HHMM_RE.test(night['end']) ? night['end'] : def.night.end,
    },
    theme: d['theme'] === 'dark' ? 'dark' : 'light',
    textSize: d['textSize'] === 'large' ? 'large' : 'normal',
    showBills: typeof d['showBills'] === 'boolean' ? d['showBills'] : def.showBills,
    holidaysEnabled: typeof d['holidaysEnabled'] === 'boolean' ? d['holidaysEnabled'] : def.holidaysEnabled,
    voice: WALL_VOICE_ENGINES.find(v => v === d['voice']) ?? def.voice,
    wakeWord: typeof d['wakeWord'] === 'boolean' ? d['wakeWord'] : def.wakeWord,
    wakeModel: normalizeWakeModel(d['wakeModel']),
    sound: {
      confirm: WALL_SOUND_STYLES.find(v => v === sound['confirm']) ?? def.sound.confirm,
      alerts: WALL_SOUND_STYLES.find(v => v === sound['alerts']) ?? def.sound.alerts,
      volume: Number.isFinite(volume) && volume >= 0.2 && volume <= 1 ? volume : def.sound.volume,
    },
    alerts: {
      leadMin: WALL_ALERT_LEADS.includes(Number(alerts['leadMin'])) ? Number(alerts['leadMin']) : def.alerts.leadMin,
    },
  };
  if (
    weather &&
    typeof weather['lat'] === 'number' && Number.isFinite(weather['lat']) && Math.abs(weather['lat']) <= 90 &&
    typeof weather['lon'] === 'number' && Number.isFinite(weather['lon']) && Math.abs(weather['lon']) <= 180 &&
    typeof weather['label'] === 'string'
  ) {
    settings.weather = { lat: weather['lat'], lon: weather['lon'], label: weather['label'] };
  }
  if (typeof d['timeZone'] === 'string' && isValidTimeZone(d['timeZone'])) settings.timeZone = d['timeZone'];
  if (typeof d['lastManualSyncAt'] === 'string') settings.lastManualSyncAt = d['lastManualSyncAt'];
  if (d['homeAddressSet'] === true) settings.homeAddressSet = true;
  if (typeof d['travelError'] === 'string' && d['travelError']) settings.travelError = d['travelError'];
  return settings;
}

/** A display's own layout wins; otherwise the household's starting modules. */
export function effectiveLayout(displayLayout: WallLayout | undefined, settings: WallSettings): WallLayout {
  return displayLayout ?? { modules: settings.defaultModules };
}
