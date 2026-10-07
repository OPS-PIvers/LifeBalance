import { describe, expect, it } from 'vitest';
import { glideOffset, shouldAutoScroll, wrapOffset } from './wallAutoScroll';

describe('glideOffset', () => {
  const SPEED = 24;
  const RAMP = 1800;
  const D = 1200;
  const total = (D / SPEED) * 1000 + RAMP;

  it('starts at rest and ends exactly on the distance', () => {
    expect(glideOffset(D, 0, SPEED, RAMP)).toEqual({ offset: 0, done: false });
    expect(glideOffset(D, total, SPEED, RAMP)).toEqual({ offset: D, done: true });
    expect(glideOffset(D, total + 5000, SPEED, RAMP)).toEqual({ offset: D, done: true });
  });

  it('only ever moves forward', () => {
    let last = -1;
    for (let t = 0; t <= total; t += 16) {
      const { offset } = glideOffset(D, t, SPEED, RAMP);
      expect(offset).toBeGreaterThanOrEqual(last);
      last = offset;
    }
  });

  it('eases in and out, and cruises at the set speed', () => {
    const step = (t: number) => (glideOffset(D, t + 10, SPEED, RAMP).offset - glideOffset(D, t, SPEED, RAMP).offset) * 100; // px/s
    expect(step(0)).toBeLessThan(1);
    expect(step(total / 2)).toBeCloseTo(SPEED, 3);
    expect(step(total - 10)).toBeLessThan(1);
  });

  it('is continuous where the ramps meet the cruise', () => {
    for (const t of [RAMP, total - RAMP]) {
      const a = glideOffset(D, t - 0.01, SPEED, RAMP).offset;
      const b = glideOffset(D, t + 0.01, SPEED, RAMP).offset;
      expect(Math.abs(b - a)).toBeLessThan(0.01);
    }
  });

  it('shortens the ramps for a glide too short to reach cruising speed', () => {
    const short = 20; // px; a full ramp would cover SPEED·RAMP/2 = 21.6 px each way
    const r = (short / SPEED) * 1000;
    const end = r * 2;
    expect(glideOffset(short, end / 2, SPEED, RAMP).offset).toBeCloseTo(short / 2, 6);
    expect(glideOffset(short, end, SPEED, RAMP)).toEqual({ offset: short, done: true });
  });

  it('treats no distance as already done', () => {
    expect(glideOffset(0, 100)).toEqual({ offset: 0, done: true });
  });
});

describe('wrapOffset', () => {
  it('folds an offset into one lap', () => {
    expect(wrapOffset(0, 500)).toBe(0);
    expect(wrapOffset(500, 500)).toBe(0);
    expect(wrapOffset(620, 500)).toBe(120);
    expect(wrapOffset(-30, 500)).toBe(470);
    expect(wrapOffset(30, 0)).toBe(0);
  });
});

describe('shouldAutoScroll', () => {
  it('turns only for content taller than the module', () => {
    expect(shouldAutoScroll(900, 600)).toBe(true);
    expect(shouldAutoScroll(600, 600)).toBe(false);
    expect(shouldAutoScroll(601, 600)).toBe(false); // sub-pixel rounding is not overflow
    expect(shouldAutoScroll(900, 0)).toBe(false); // not laid out (jsdom, hidden)
  });
});
