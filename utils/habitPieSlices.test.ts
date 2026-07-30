import { describe, it, expect } from 'vitest';
import { pieSlicePaths } from '@/utils/habitPieSlices';

const GREEN = '#285742';
const AMBER = '#b87a29';

describe('habitPieSlices', () => {
  it('draws a solo completion as one full disc', () => {
    const slices = pieSlicePaths([{ key: 'paul', color: GREEN, units: 1 }]);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.color).toBe(GREEN);
    // Two arcs, because a single arc command cannot close a 360° circle.
    expect(slices[0]?.d.match(/A21,21/g)).toHaveLength(2);
  });

  it('splits 2:1 into a two-thirds and a one-third slice, starting at 12 o’clock', () => {
    const slices = pieSlicePaths([
      { key: 'paul', color: GREEN, units: 2 },
      { key: 'jen', color: AMBER, units: 1 },
    ]);
    expect(slices.map(s => s.key)).toEqual(['paul', 'jen']);
    // The first slice starts at the top of the disc (cx, cy - r) and, being
    // larger than a half turn, takes the large-arc flag.
    expect(slices[0]?.d).toBe('M23,23 L23,2 A21,21 0 1 1 4.81,33.5 Z');
    // …and the second starts EXACTLY where the first ended — no seam, no gap,
    // which is the whole reason slices are cut from cumulative fractions.
    expect(slices[1]?.d).toBe('M23,23 L4.81,33.5 A21,21 0 0 1 23,2 Z');
  });

  it('never emits a stroke or a gap between slices', () => {
    const slices = pieSlicePaths([
      { key: 'a', color: GREEN, units: 1 },
      { key: 'b', color: AMBER, units: 1 },
    ]);
    // Adjacent endpoints are identical strings, so no sliver of background can
    // show through between them.
    const firstEnd = slices[0]?.d.split('A21,21 0 0 1 ')[1]?.replace(' Z', '');
    expect(slices[1]?.d).toContain(`L${firstEnd}`);
  });

  it('normalises over ATTRIBUTED units only, so the disc is always full', () => {
    // 3 attributed units on a day whose counter is higher (grandfathered
    // completions attributed to nobody) still fills the whole disc.
    const slices = pieSlicePaths([
      { key: 'paul', color: GREEN, units: 2 },
      { key: 'jen', color: AMBER, units: 1 },
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.d).toContain('4.81,33.5');
  });

  it('drops zero/negative segments and returns nothing when there is no attribution', () => {
    expect(pieSlicePaths([])).toEqual([]);
    expect(pieSlicePaths([{ key: 'paul', color: GREEN, units: 0 }])).toEqual([]);
    expect(pieSlicePaths([{ key: 'paul', color: GREEN, units: -2 }])).toEqual([]);
    const mixed = pieSlicePaths([
      { key: 'paul', color: GREEN, units: 0 },
      { key: 'jen', color: AMBER, units: 3 },
    ]);
    // Jen is now the only segment, so she gets the full disc.
    expect(mixed).toHaveLength(1);
    expect(mixed[0]?.key).toBe('jen');
  });

  it('honours a custom geometry', () => {
    const slices = pieSlicePaths([{ key: 'a', color: GREEN, units: 1 }], { center: 10, radius: 8 });
    expect(slices[0]?.d).toBe('M10,2 A8,8 0 1 1 10,18 A8,8 0 1 1 10,2 Z');
  });
});
