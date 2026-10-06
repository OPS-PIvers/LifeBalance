import { describe, expect, it } from 'vitest';
import { MISS_TEXT_MAX, buildVoiceMiss, missExpiry, takeMissSlot } from './wallVoiceMiss';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('wall voice miss log', () => {
  it('builds a text-only record, clipped, with no empty optional fields', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const miss = buildVoiceMiss({ kind: 'unparsed', heard: ` ${'x'.repeat(500)} `, engine: 'device', view: 'calendar:week', appVersion: 'wall-4', now });
    expect(miss).toEqual({
      kind: 'unparsed',
      heard: 'x'.repeat(MISS_TEXT_MAX),
      free: '',
      alternative: '',
      engine: 'device',
      view: 'calendar:week',
      appVersion: 'wall-4',
      at: '2026-10-06T12:00:00.000Z',
    });
    expect(buildVoiceMiss({ kind: 'undo', heard: 'a', engine: 'device', view: 'v', did: 'Showed meals', appVersion: 'w', now }).did).toBe('Showed meals');
  });

  it('expires 30 days later', () => {
    expect(new Date(missExpiry('2026-10-06T12:00:00.000Z')).toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('caps a day at the limit and starts over the next day', () => {
    const storage = memoryStorage();
    expect(takeMissSlot(storage, '2026-10-06', 2)).toBe(true);
    expect(takeMissSlot(storage, '2026-10-06', 2)).toBe(true);
    expect(takeMissSlot(storage, '2026-10-06', 2)).toBe(false);
    expect(takeMissSlot(storage, '2026-10-07', 2)).toBe(true);
  });

  it('never blocks logging when storage is missing or throws', () => {
    expect(takeMissSlot(null, '2026-10-06', 0)).toBe(true);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined };
    expect(takeMissSlot(broken, '2026-10-06', 0)).toBe(true);
  });
});
