import { describe, it, expect } from 'vitest';
import { HabitLocationTrigger } from '@/types/schema';
import {
  haversineMeters,
  isWithinRadius,
  locationsContainingPoint,
  shouldPromptLocation,
} from '@/utils/habitGeoTrigger';
import { triggerDedupKey } from '@/utils/habitTriggers';

function geoKey(locationId: string, date: string): string {
  const key = triggerDedupKey({ type: 'geo', locationId, label: 'x' }, date);
  if (key === null) throw new Error('geo dedup key must not be null');
  return key;
}

const target: HabitLocationTrigger = {
  id: 'loc-target',
  name: 'Target',
  lat: 44.9778,
  lng: -93.265,
  radiusMeters: 150,
};

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 44.9778, lng: -93.265 }, { lat: 44.9778, lng: -93.265 })).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 44.9778, lng: -93.265 };
    const b = { lat: 44.98, lng: -93.26 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('approximates a known short distance', () => {
    // ~0.001 deg of latitude ≈ 111 m.
    const d = haversineMeters({ lat: 44.9778, lng: -93.265 }, { lat: 44.9788, lng: -93.265 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
  });
});

describe('isWithinRadius', () => {
  it('is true well inside the radius', () => {
    expect(isWithinRadius({ lat: 44.9778, lng: -93.265 }, target)).toBe(true);
  });

  it('is false well outside the radius', () => {
    // ~1 km north.
    expect(isWithinRadius({ lat: 44.9868, lng: -93.265 }, target)).toBe(false);
  });

  it('counts a point exactly on the edge as inside (inclusive)', () => {
    // Construct a point whose measured distance we then use as the radius.
    const near = { lat: 44.9782, lng: -93.265 };
    const dist = haversineMeters(near, target);
    const edge: HabitLocationTrigger = { ...target, radiusMeters: dist };
    expect(isWithinRadius(near, edge)).toBe(true);
    const justInside: HabitLocationTrigger = { ...target, radiusMeters: dist - 0.01 };
    expect(isWithinRadius(near, justInside)).toBe(false);
  });
});

describe('locationsContainingPoint', () => {
  it('returns every location whose radius contains the point, in order', () => {
    const other: HabitLocationTrigger = { ...target, id: 'loc-far', lat: 45.5, lng: -93.265 };
    const wide: HabitLocationTrigger = { ...target, id: 'loc-wide', radiusMeters: 100000 };
    const result = locationsContainingPoint({ lat: 44.9778, lng: -93.265 }, [target, other, wide]);
    expect(result.map(l => l.id)).toEqual(['loc-target', 'loc-wide']);
  });
});

describe('geo dedup', () => {
  it('delegates to triggerDedupKey for a stable per-day-per-location key', () => {
    expect(geoKey('loc-target', '2026-07-22')).toBe('geo:loc-target:2026-07-22');
  });

  it('prompts when no key recorded today', () => {
    expect(shouldPromptLocation(target, '2026-07-22', [])).toBe(true);
  });

  it('suppresses a second prompt for the same location the same day', () => {
    const fired = [geoKey('loc-target', '2026-07-22')];
    expect(shouldPromptLocation(target, '2026-07-22', fired)).toBe(false);
  });

  it('prompts again the next day', () => {
    const fired = [geoKey('loc-target', '2026-07-22')];
    expect(shouldPromptLocation(target, '2026-07-23', fired)).toBe(true);
  });
});
