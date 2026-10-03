/**
 * Phase 0 lab bookkeeping (docs/plans/wall-display-kiosk.md §6). Attempts and
 * device events persist in this device's localStorage so results survive the
 * cold launches the test protocol asks for, and export as Markdown for
 * docs/plans/wall-display-phase0-results.md. Throwaway: deleted with the lab.
 */

export type LabEngine = 'A' | 'B';

export interface LabAttempt {
  id: string;
  engine: LabEngine;
  at: string;
  launchId: string;
  standalone: boolean;
  transcript: string;
  intentJson: string;
  /** End of speech → intent on screen, ms. */
  latencyMs: number | null;
  /** Free-form timing breakdown for the results doc. */
  detail: string;
  error?: string;
  verdict?: 'ok' | 'wrong';
}

export interface LabEvent {
  at: string;
  launchId: string;
  kind: string;
  detail?: string;
}

const ATTEMPTS_KEY = 'LB_WALL_LAB_ATTEMPTS';
const EVENTS_KEY = 'LB_WALL_LAB_EVENTS';
const MAX_EVENTS = 500;

/** One id per page load: a cold launch of the Home Screen app is a new one. */
export const LAUNCH_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the on-screen state still shows the result.
  }
}

export const readAttempts = (): LabAttempt[] => read<LabAttempt>(ATTEMPTS_KEY);
export const readEvents = (): LabEvent[] => read<LabEvent>(EVENTS_KEY);

export function saveAttempt(attempt: LabAttempt): LabAttempt[] {
  const next = [...readAttempts().filter(a => a.id !== attempt.id), attempt];
  write(ATTEMPTS_KEY, next);
  return next;
}

export function logEvent(kind: string, detail?: string): void {
  const next = [...readEvents(), { at: new Date().toISOString(), launchId: LAUNCH_ID, kind, ...(detail ? { detail } : {}) }];
  write(EVENTS_KEY, next.slice(-MAX_EVENTS));
}

export function clearLab(): void {
  write(ATTEMPTS_KEY, []);
  write(EVENTS_KEY, []);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 ? hi : ((sorted[mid - 1] ?? 0) + hi) / 2;
}

export interface EngineSummary {
  engine: LabEngine;
  attempts: number;
  scored: number;
  correct: number;
  errors: number;
  medianMs: number | null;
  launches: number;
}

export function summarize(attempts: LabAttempt[], engine: LabEngine): EngineSummary {
  const mine = attempts.filter(a => a.engine === engine);
  const scored = mine.filter(a => a.verdict);
  const latencies = mine.flatMap(a => (a.error || a.latencyMs === null ? [] : [a.latencyMs]));
  return {
    engine,
    attempts: mine.length,
    scored: scored.length,
    correct: scored.filter(a => a.verdict === 'ok').length,
    errors: mine.filter(a => a.error).length,
    medianMs: median(latencies),
    launches: new Set(mine.map(a => a.launchId)).size,
  };
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function toMarkdown(attempts: LabAttempt[], events: LabEvent[], environment: string): string {
  const lines: string[] = ['## Environment', '', environment, '', '## Summary', ''];
  lines.push('| Engine | Attempts | Scored | Correct | Errors | Median latency | Launches |', '|---|---|---|---|---|---|---|');
  for (const engine of ['A', 'B'] as const) {
    const s = summarize(attempts, engine);
    lines.push(
      `| ${engine} | ${s.attempts} | ${s.scored} | ${s.correct} | ${s.errors} | ${s.medianMs === null ? '–' : `${Math.round(s.medianMs)} ms`} | ${s.launches} |`
    );
  }
  lines.push('', '## Attempts', '', '| When | Engine | Launch | Standalone | Heard | Intent | Latency | Verdict | Detail |', '|---|---|---|---|---|---|---|---|---|');
  for (const a of attempts) {
    lines.push(
      `| ${a.at} | ${a.engine} | ${a.launchId} | ${a.standalone ? 'yes' : 'no'} | ${cell(a.transcript)} | ${cell(a.error ? `ERROR: ${a.error}` : a.intentJson)} | ${a.latencyMs === null ? '–' : `${Math.round(a.latencyMs)} ms`} | ${a.verdict ?? '–'} | ${cell(a.detail)} |`
    );
  }
  lines.push('', '## Device events', '', '| When | Launch | Event | Detail |', '|---|---|---|---|');
  for (const e of events) lines.push(`| ${e.at} | ${e.launchId} | ${e.kind} | ${cell(e.detail ?? '')} |`);
  return lines.join('\n');
}
