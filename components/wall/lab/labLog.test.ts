import { beforeEach, describe, expect, it } from 'vitest';
import { clearLab, logEvent, median, readEvents, saveAttempt, summarize, toMarkdown, type LabAttempt } from './labLog';

const attempt = (over: Partial<LabAttempt>): LabAttempt => ({
  id: Math.random().toString(36),
  engine: 'A',
  at: '2026-10-03T20:00:00Z',
  launchId: 'L1',
  standalone: true,
  transcript: 'add milk',
  intentJson: '{"intent":"add_shopping"}',
  latencyMs: 1000,
  detail: '',
  ...over,
});

describe('labLog', () => {
  beforeEach(() => clearLab());

  it('median handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('summarizes per engine, excluding errors from latency', () => {
    const all = [
      attempt({ verdict: 'ok', latencyMs: 1000 }),
      attempt({ verdict: 'wrong', latencyMs: 3000, launchId: 'L2' }),
      attempt({ error: 'network', latencyMs: 9000 }),
      attempt({ engine: 'B', verdict: 'ok' }),
    ];
    expect(summarize(all, 'A')).toEqual({
      engine: 'A', attempts: 3, scored: 2, correct: 1, errors: 1, medianMs: 2000, launches: 2,
    });
  });

  it('upserts attempts by id and caps nothing it shouldn’t', () => {
    const a = attempt({ id: 'x' });
    saveAttempt(a);
    expect(saveAttempt({ ...a, verdict: 'ok' })).toHaveLength(1);
  });

  it('logs events and exports escaped Markdown', () => {
    logEvent('online', 'back');
    expect(readEvents()).toHaveLength(1);
    const md = toMarkdown([attempt({ transcript: 'a | b' })], readEvents(), 'iPad');
    expect(md).toContain('a \\| b');
    expect(md).toContain('| online |');
  });
});
