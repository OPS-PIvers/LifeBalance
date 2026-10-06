import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALL_SETTINGS,
  effectiveLayout,
  normalizeLayout,
  normalizeModules,
  normalizeWakeModel,
  DEFAULT_WAKE_MODEL,
  WAKE_CHUNK_BYTES,
  joinWakeFile,
  splitWakeFile,
  resolveWallSettings,
} from './wallSettings';

describe('resolveWallSettings', () => {
  it('returns the defaults for a missing or non-object doc', () => {
    expect(resolveWallSettings(undefined)).toEqual(DEFAULT_WALL_SETTINGS);
    expect(resolveWallSettings('nope')).toEqual(DEFAULT_WALL_SETTINGS);
  });

  it('keeps valid fields', () => {
    const s = resolveWallSettings({
      defaultModules: ['shopping', 'todos'],
      rotation: { enabled: true, intervalSec: 120 },
      idleReturnSec: 300,
      night: { start: '21:30', end: '07:00' },
      theme: 'dark',
      textSize: 'large',
      showBills: false,
      holidaysEnabled: false,
      voice: 'audio',
      wakeWord: false,
      wakeModel: { keyword: 'custom', file: { id: 'f1', chunks: 2, bytes: 900000 }, label: ' Hey Home ', threshold: 0.3 },
      sound: { confirm: 'chime', alerts: 'chime', volume: 1 },
      alerts: { leadMin: 15 },
      homeAddressSet: true,
      travelError: 'Turn on Routes',
      weather: { lat: 44.97, lon: -93.6, label: 'Orono, MN' },
      timeZone: 'America/Chicago',
      lastManualSyncAt: '2026-10-03T20:00:00.000Z',
    });
    expect(s).toEqual({
      defaultModules: ['shopping', 'todos'],
      rotation: { enabled: true, intervalSec: 120 },
      idleReturnSec: 300,
      night: { start: '21:30', end: '07:00' },
      theme: 'dark',
      textSize: 'large',
      showBills: false,
      holidaysEnabled: false,
      voice: 'audio',
      wakeWord: false,
      wakeModel: { keyword: 'custom', file: { id: 'f1', chunks: 2, bytes: 900000 }, label: 'Hey Home', threshold: 0.3 },
      sound: { confirm: 'chime', alerts: 'chime', volume: 1 },
      alerts: { leadMin: 15 },
      homeAddressSet: true,
      travelError: 'Turn on Routes',
      weather: { lat: 44.97, lon: -93.6, label: 'Orono, MN' },
      timeZone: 'America/Chicago',
      lastManualSyncAt: '2026-10-03T20:00:00.000Z',
    });
  });

  it('falls back field by field on malformed values', () => {
    const s = resolveWallSettings({
      defaultModules: 'coming',
      rotation: { enabled: 'yes', intervalSec: 7 },
      idleReturnSec: 1,
      night: { start: '25:00', end: 6 },
      theme: 'neon',
      voice: 'telepathy',
      wakeWord: 'sure',
      wakeModel: { keyword: 'alexa', threshold: 7 },
      sound: { confirm: 'sing', alerts: 3, volume: 5 },
      alerts: { leadMin: 7 },
      homeAddressSet: 'yes',
      weather: { lat: 200, lon: 0, label: 'x' },
      timeZone: 'Mars/Olympus',
    });
    expect(s).toEqual(DEFAULT_WALL_SETTINGS);
  });

  it('allows an empty module list (Today-only)', () => {
    expect(resolveWallSettings({ defaultModules: [] }).defaultModules).toEqual([]);
  });
});

describe('normalizeWakeModel', () => {
  it('defaults to Hey Jarvis at medium', () => {
    expect(normalizeWakeModel(undefined)).toEqual(DEFAULT_WAKE_MODEL);
    expect(DEFAULT_WAKE_MODEL).toEqual({ keyword: 'hey_jarvis', label: 'Hey Jarvis', threshold: 0.5 });
  });

  it('names a built-in word itself and drops a stale custom file', () => {
    expect(normalizeWakeModel({ keyword: 'hey_mycroft', label: 'whatever', file: { id: 'f1', chunks: 1, bytes: 3 }, threshold: 0.7 })).toEqual({
      keyword: 'hey_mycroft',
      label: 'Hey Mycroft',
      threshold: 0.7,
    });
  });

  it('falls back to the default when a custom word has no file', () => {
    expect(normalizeWakeModel({ keyword: 'custom', label: 'Hey Home', threshold: 0.3 })).toEqual({ ...DEFAULT_WAKE_MODEL, threshold: 0.3 });
  });

  it('calls an unnamed custom word Hey Home, and clamps the threshold', () => {
    expect(normalizeWakeModel({ keyword: 'custom', file: { id: 'f1', chunks: 1, bytes: 3 }, threshold: 2 })).toEqual({
      keyword: 'custom',
      file: { id: 'f1', chunks: 1, bytes: 3 },
      label: 'Hey Home',
      threshold: 0.5,
    });
  });

  it('rejects a file record that can’t be one', () => {
    for (const file of [{ id: '', chunks: 1, bytes: 3 }, { id: 'f', chunks: 5, bytes: 3 }, { id: 'f', chunks: 1, bytes: 700001 }, { id: 'f', chunks: 1.5, bytes: 3 }]) {
      expect(normalizeWakeModel({ keyword: 'custom', file })).toEqual(DEFAULT_WAKE_MODEL);
    }
  });
});

describe('splitWakeFile / joinWakeFile', () => {
  it('round-trips a file across chunks', () => {
    const bytes = Uint8Array.from({ length: WAKE_CHUNK_BYTES * 2 + 5 }, (_, i) => i % 251);
    const chunks = splitWakeFile(bytes);
    expect(chunks.map(c => c.length)).toEqual([WAKE_CHUNK_BYTES, WAKE_CHUNK_BYTES, 5]);
    const file = { id: 'f1', chunks: 3, bytes: bytes.length };
    const joined = joinWakeFile(file, chunks.map(data => ({ id: 'f1', data })));
    expect(Buffer.from(joined).equals(Buffer.from(bytes))).toBe(true);
  });

  it('refuses a chunk from another upload, a missing one, or the wrong size', () => {
    const file = { id: 'f1', chunks: 2, bytes: 10 };
    const a = { id: 'f1', data: new Uint8Array(5) };
    expect(() => joinWakeFile(file, [a, { id: 'f2', data: new Uint8Array(5) }])).toThrow(/incomplete/);
    expect(() => joinWakeFile(file, [a, undefined])).toThrow(/incomplete/);
    expect(() => joinWakeFile(file, [a, { id: 'f1', data: new Uint8Array(4) }])).toThrow(/wrong size/);
    expect(() => joinWakeFile(file, [a, { id: 'f1', data: new Uint8Array(6) }])).toThrow(/wrong size/);
  });
});

describe('normalizeModules / normalizeLayout', () => {
  it('keeps at most two distinct known modules', () => {
    expect(normalizeModules(['meals', 'meals', 'bogus', 'todos', 'coming'])).toEqual(['meals', 'todos']);
    expect(normalizeModules(null)).toEqual([]);
  });

  it('normalizes a layout or returns undefined', () => {
    expect(normalizeLayout({ modules: ['shopping'] })).toEqual({ modules: ['shopping'] });
    expect(normalizeLayout(undefined)).toBeUndefined();
  });
});

describe('effectiveLayout', () => {
  it('prefers the display layout, else the household default', () => {
    expect(effectiveLayout({ modules: [] }, DEFAULT_WALL_SETTINGS)).toEqual({ modules: [] });
    expect(effectiveLayout(undefined, DEFAULT_WALL_SETTINGS)).toEqual({ modules: ['coming'] });
  });
});
