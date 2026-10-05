/**
 * Wake-word lab bookkeeping (docs/plans/wall-display-kiosk.md §12 "Wake
 * word"): settings and every detection are kept on the iPad so a day-long
 * run survives reloads, then summarized for the results doc.
 */

export interface WakeDetection {
  at: number;
  label: string;
  launch: string;
  /** Marked by hand: someone said it, or it fired on its own. */
  verdict?: 'real' | 'false';
}

export interface WakeSession {
  launch: string;
  startedAt: number;
  /** Tap → listening, ms. Long means iPadOS showed the mic prompt. */
  readyMs: number;
  stoppedAt?: number;
  error?: string;
}

export interface WakeSettings {
  accessKey: string;
  /** A built-in keyword name, or "custom" for the uploaded .ppn. */
  keyword: string;
  sensitivity: number;
  customLabel: string;
  /** Base64 of the uploaded .ppn. */
  customPpn: string;
}

const SETTINGS_KEY = 'LB_LAB_WAKE_SETTINGS';
const DETECTIONS_KEY = 'LB_LAB_WAKE_DETECTIONS';
const SESSIONS_KEY = 'LB_LAB_WAKE_SESSIONS';
const MISSES_KEY = 'LB_LAB_WAKE_MISSES';
const MAX = 500;

/** Porcupine's language model, from Picovoice's own repo (no app asset needed). */
export const PORCUPINE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/Picovoice/porcupine@v4.0/lib/common/porcupine_params.pv';

export const DEFAULT_WAKE_SETTINGS: WakeSettings = { accessKey: '', keyword: 'Computer', sensitivity: 0.5, customLabel: 'Hey Home', customPpn: '' };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full store only loses history.
  }
}

export const readWakeSettings = (): WakeSettings => ({ ...DEFAULT_WAKE_SETTINGS, ...read<Partial<WakeSettings>>(SETTINGS_KEY, {}) });
export const saveWakeSettings = (s: WakeSettings): void => write(SETTINGS_KEY, s);
export const readDetections = (): WakeDetection[] => read<WakeDetection[]>(DETECTIONS_KEY, []);
export const readSessions = (): WakeSession[] => read<WakeSession[]>(SESSIONS_KEY, []);
export const readMisses = (): number => read<number>(MISSES_KEY, 0);

export function saveDetections(list: WakeDetection[]): WakeDetection[] {
  const kept = list.slice(-MAX);
  write(DETECTIONS_KEY, kept);
  return kept;
}

export function saveSessions(list: WakeSession[]): WakeSession[] {
  const kept = list.slice(-MAX);
  write(SESSIONS_KEY, kept);
  return kept;
}

export const saveMisses = (n: number): void => write(MISSES_KEY, n);

export function clearWakeLog(): void {
  for (const key of [DETECTIONS_KEY, SESSIONS_KEY, MISSES_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }
}

export interface WakeSummary {
  listeningHours: number;
  detections: number;
  real: number;
  falseTriggers: number;
  /** Per listening hour. */
  falsePerHour: number;
  misses: number;
  /** real / (real + misses). */
  hitRate: number | null;
  launches: number;
  /** Launches whose start took > 1.5 s (a mic prompt, most likely). */
  slowStarts: number;
  errors: number;
}

export function summarizeWake(detections: readonly WakeDetection[], sessions: readonly WakeSession[], misses: number, now: number): WakeSummary {
  const ms = sessions.reduce((sum, s) => sum + Math.max(0, (s.stoppedAt ?? now) - s.startedAt), 0);
  const hours = ms / 3_600_000;
  const real = detections.filter(d => d.verdict === 'real').length;
  const falseTriggers = detections.filter(d => d.verdict === 'false').length;
  return {
    listeningHours: Math.round(hours * 10) / 10,
    detections: detections.length,
    real,
    falseTriggers,
    falsePerHour: hours > 0 ? Math.round((falseTriggers / hours) * 100) / 100 : 0,
    misses,
    hitRate: real + misses > 0 ? Math.round((real / (real + misses)) * 100) / 100 : null,
    launches: new Set(sessions.map(s => s.launch)).size,
    slowStarts: sessions.filter(s => s.readyMs > 1500).length,
    errors: sessions.filter(s => s.error).length,
  };
}

export function wakeMarkdown(summary: WakeSummary, settings: WakeSettings): string {
  const word = settings.keyword === 'custom' ? `${settings.customLabel} (custom .ppn)` : settings.keyword;
  return [
    `### Wake word (${word}, sensitivity ${settings.sensitivity})`,
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Listening | ${summary.listeningHours} h over ${summary.launches} launch(es) |`,
    `| Detections | ${summary.detections} (${summary.real} real, ${summary.falseTriggers} false) |`,
    `| False triggers per hour | ${summary.falsePerHour} |`,
    `| Missed (said it, nothing happened) | ${summary.misses} |`,
    `| Hit rate | ${summary.hitRate === null ? 'n/a' : `${Math.round(summary.hitRate * 100)}%`} |`,
    `| Slow starts (mic prompt likely) | ${summary.slowStarts} |`,
    `| Errors | ${summary.errors} |`,
  ].join('\n');
}

/** File → base64 (for the uploaded .ppn). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
