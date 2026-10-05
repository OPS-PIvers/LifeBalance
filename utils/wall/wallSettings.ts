import type { WallLayout, WallModuleKey, WallSettings, WallSoundStyle, WallVoiceEngine } from '@/types/schema';

/**
 * Defaults and normalization for `wallSettings/config`
 * (docs/plans/wall-display-kiosk.md §4.4). The doc is member-editable and may
 * be missing or partial, so every read goes through `resolveWallSettings`:
 * an absent or malformed field falls back to its default rather than
 * breaking the wall.
 */

export const WALL_MODULE_KEYS: readonly WallModuleKey[] = ['coming', 'shopping', 'todos', 'meals'];
export const WALL_ROTATION_INTERVALS: readonly number[] = [30, 60, 120, 300];
export const WALL_IDLE_RETURN_OPTIONS: readonly number[] = [60, 180, 300, 600];
export const WALL_VOICE_ENGINES: readonly WallVoiceEngine[] = ['auto', 'speech', 'audio', 'off'];
export const WALL_SOUND_STYLES: readonly WallSoundStyle[] = ['speak', 'chime'];
/** Settings' Low / Medium / High. */
export const WALL_VOLUMES: readonly number[] = [0.4, 0.7, 1];

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
  sound: { confirm: 'speak', alerts: 'speak', volume: 0.7 },
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
  return { modules: normalizeModules(raw['modules']) };
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function resolveWallSettings(raw: unknown): WallSettings {
  const d = isRecord(raw) ? raw : {};
  const def = DEFAULT_WALL_SETTINGS;
  const rotation = isRecord(d['rotation']) ? d['rotation'] : {};
  const night = isRecord(d['night']) ? d['night'] : {};
  const weather = isRecord(d['weather']) ? d['weather'] : undefined;
  const sound = isRecord(d['sound']) ? d['sound'] : {};
  const volume = Number(sound['volume']);

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
    sound: {
      confirm: WALL_SOUND_STYLES.find(v => v === sound['confirm']) ?? def.sound.confirm,
      alerts: WALL_SOUND_STYLES.find(v => v === sound['alerts']) ?? def.sound.alerts,
      volume: Number.isFinite(volume) && volume >= 0.2 && volume <= 1 ? volume : def.sound.volume,
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
  return settings;
}

/** A display's own layout wins; otherwise the household's starting modules. */
export function effectiveLayout(displayLayout: WallLayout | undefined, settings: WallSettings): WallLayout {
  return displayLayout ?? { modules: settings.defaultModules };
}
