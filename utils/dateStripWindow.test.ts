import { describe, it, expect } from 'vitest';
import {
  initialStripWindow,
  extendStripWindowTo,
  STRIP_WINDOW_SIZE,
  STRIP_WINDOW_PAD,
  STRIP_WINDOW_EDGE_THRESHOLD,
} from './dateStripWindow';

describe('initialStripWindow', () => {
  it('centers a full-size window on centerIndex when there is room on both sides', () => {
    const totalDays = 500;
    const centerIndex = 250;
    const window = initialStripWindow(centerIndex, totalDays);
    expect(window.end - window.start).toBe(STRIP_WINDOW_SIZE);
    expect(window.start).toBeLessThanOrEqual(centerIndex);
    expect(window.end).toBeGreaterThan(centerIndex);
  });

  it('clamps to the start of the range without shrinking the window size', () => {
    const totalDays = 500;
    const window = initialStripWindow(2, totalDays);
    expect(window.start).toBe(0);
    expect(window.end - window.start).toBe(STRIP_WINDOW_SIZE);
  });

  it('clamps to the end of the range without shrinking the window size', () => {
    const totalDays = 100;
    const window = initialStripWindow(98, totalDays);
    expect(window.end).toBe(totalDays);
    expect(window.end - window.start).toBe(STRIP_WINDOW_SIZE);
  });

  it('shrinks to fit when totalDays is smaller than the window size', () => {
    const totalDays = 10;
    const window = initialStripWindow(5, totalDays);
    expect(window.start).toBe(0);
    expect(window.end).toBe(10);
  });
});

describe('extendStripWindowTo', () => {
  it('returns the same object reference when the target is not near an edge', () => {
    const window = { start: 100, end: 128 };
    const result = extendStripWindowTo(window, 114, 500);
    expect(result).toBe(window);
  });

  it('grows the start edge when the target is within the threshold of it', () => {
    const window = { start: 100, end: 128 };
    const target = 100 + STRIP_WINDOW_EDGE_THRESHOLD - 1; // just inside the threshold
    const result = extendStripWindowTo(window, target, 500);
    expect(result).not.toBe(window);
    expect(result.start).toBe(Math.max(0, target - STRIP_WINDOW_PAD));
    expect(result.start).toBeLessThan(window.start);
    // End is untouched
    expect(result.end).toBe(window.end);
  });

  it('grows the end edge when the target is within the threshold of it', () => {
    const window = { start: 100, end: 128 };
    const target = 128 - STRIP_WINDOW_EDGE_THRESHOLD; // just inside the threshold
    const result = extendStripWindowTo(window, target, 500);
    expect(result).not.toBe(window);
    expect(result.end).toBe(Math.min(500, target + STRIP_WINDOW_PAD + 1));
    expect(result.end).toBeGreaterThan(window.end);
    // Start is untouched
    expect(result.start).toBe(window.start);
  });

  it('clamps growth at the start of the range (index 0)', () => {
    const window = { start: 5, end: 40 };
    const result = extendStripWindowTo(window, 2, 500);
    expect(result.start).toBe(0);
  });

  it('clamps growth at the end of the range (totalDays)', () => {
    const totalDays = 150;
    const window = { start: 110, end: 145 };
    const result = extendStripWindowTo(window, 148, totalDays);
    expect(result.end).toBe(totalDays);
  });

  it('never shrinks an already-larger window even if the target is centered', () => {
    const window = { start: 0, end: 147 }; // full range already materialized
    const result = extendStripWindowTo(window, 70, 147);
    expect(result).toBe(window);
  });

  it('can grow both edges at once for a very small existing window', () => {
    const window = { start: 100, end: 102 };
    const result = extendStripWindowTo(window, 101, 500);
    expect(result.start).toBeLessThan(window.start);
    expect(result.end).toBeGreaterThan(window.end);
  });
});
