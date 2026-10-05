import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALL_SETTINGS,
  effectiveLayout,
  normalizeLayout,
  normalizeModules,
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
