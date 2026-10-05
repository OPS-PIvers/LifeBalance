// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WAKE_SETTINGS, fileToBase64, readDetections, saveDetections, summarizeWake, wakeMarkdown } from './labWake';

const H = 3_600_000;

beforeEach(() => localStorage.clear());

describe('summarizeWake', () => {
  it('scores false triggers per listening hour and the hit rate', () => {
    const sessions = [
      { launch: 'a', startedAt: 0, readyMs: 2400, stoppedAt: 2 * H },
      { launch: 'b', startedAt: 3 * H, readyMs: 300 },
    ];
    const detections = [
      { at: 1, label: 'Hey Home', launch: 'a', verdict: 'real' as const },
      { at: 2, label: 'Hey Home', launch: 'a', verdict: 'false' as const },
      { at: 3, label: 'Hey Home', launch: 'b', verdict: 'real' as const },
      { at: 4, label: 'Hey Home', launch: 'b' },
    ];
    const s = summarizeWake(detections, sessions, 1, 5 * H);
    expect(s).toEqual({
      listeningHours: 4,
      detections: 4,
      real: 2,
      falseTriggers: 1,
      falsePerHour: 0.25,
      misses: 1,
      hitRate: 0.67,
      launches: 2,
      slowStarts: 1,
      errors: 0,
    });
    expect(wakeMarkdown(s, { ...DEFAULT_WAKE_SETTINGS, keyword: 'custom', customLabel: 'Hey Home' })).toContain('| Hit rate | 67% |');
  });

  it('is empty-safe', () => {
    expect(summarizeWake([], [], 0, 0)).toMatchObject({ listeningHours: 0, falsePerHour: 0, hitRate: null });
  });
});

describe('storage', () => {
  it('keeps detections across reloads', () => {
    saveDetections([{ at: 1, label: 'x', launch: 'l' }]);
    expect(readDetections()).toEqual([{ at: 1, label: 'x', launch: 'l' }]);
  });

  it('base64s an uploaded file', async () => {
    expect(await fileToBase64(new Blob([new Uint8Array([104, 105])]))).toBe('aGk=');
  });
});
