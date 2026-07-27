// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRebalanceEligible,
  readRebalanceCooldowns,
  persistRebalanceReviewed,
  rebalanceStorageKey,
  REBALANCE_COOLDOWN_DAYS,
  readAnalysisCache,
  writeAnalysisCache,
  ANALYSIS_CACHE_TTL_MS,
} from '@/utils/pointRebalanceCadence';

describe('isRebalanceEligible', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');

  it('is eligible when there is no prior review', () => {
    expect(isRebalanceEligible('h1', {}, now)).toBe(true);
  });

  it('is eligible when the stored timestamp is malformed', () => {
    expect(isRebalanceEligible('h1', { h1: 'not-a-date' }, now)).toBe(true);
  });

  it('is not eligible just under the cooldown window', () => {
    const last = new Date(now.getTime() - (REBALANCE_COOLDOWN_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(isRebalanceEligible('h1', { h1: last }, now)).toBe(false);
  });

  it('is eligible exactly at the cooldown boundary', () => {
    const last = new Date(now.getTime() - REBALANCE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isRebalanceEligible('h1', { h1: last }, now)).toBe(true);
  });

  it('is eligible well past the cooldown window', () => {
    const last = new Date(now.getTime() - (REBALANCE_COOLDOWN_DAYS + 5) * 24 * 60 * 60 * 1000).toISOString();
    expect(isRebalanceEligible('h1', { h1: last }, now)).toBe(true);
  });

  it('treats a future timestamp (clock skew) as eligible rather than permanently hidden', () => {
    const future = new Date(now.getTime() + 60_000).toISOString();
    expect(isRebalanceEligible('h1', { h1: future }, now)).toBe(true);
  });

  it('only consults the entry for the given habit id', () => {
    const last = new Date(now.getTime() - 1000).toISOString();
    expect(isRebalanceEligible('h2', { h1: last }, now)).toBe(true);
  });
});

describe('readRebalanceCooldowns / persistRebalanceReviewed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads back a persisted timestamp under the habit-scoped key', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    persistRebalanceReviewed('h1', now);
    expect(window.localStorage.getItem(rebalanceStorageKey('h1'))).toBe(now.toISOString());

    const result = readRebalanceCooldowns(['h1', 'h2']);
    expect(result.h1).toBe(now.toISOString());
    expect(result.h2).toBeUndefined();
  });
});

describe('readAnalysisCache / writeAnalysisCache', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when nothing is cached', () => {
    expect(readAnalysisCache<{ a: number }>('house-1')).toBeNull();
  });

  it('returns the cached suggestions within the TTL', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    writeAnalysisCache('house-1', [{ a: 1 }], now);
    const later = new Date(now.getTime() + ANALYSIS_CACHE_TTL_MS - 1000);
    expect(readAnalysisCache<{ a: number }>('house-1', later)).toEqual([{ a: 1 }]);
  });

  it('returns null once the cache is past the TTL', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    writeAnalysisCache('house-1', [{ a: 1 }], now);
    const later = new Date(now.getTime() + ANALYSIS_CACHE_TTL_MS + 1000);
    expect(readAnalysisCache<{ a: number }>('house-1', later)).toBeNull();
  });

  it('is scoped per household id', () => {
    writeAnalysisCache('house-1', [{ a: 1 }]);
    expect(readAnalysisCache<{ a: number }>('house-2')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    window.localStorage.setItem('lb_point_rebalance_analysis_house-1', 'not-json');
    expect(readAnalysisCache('house-1')).toBeNull();
  });
});
