import { describe, expect, it } from 'vitest';
import { wallFillHeight } from './wallViewport';

// A 12.9" iPad Pro: 1024 × 1366 points, 20pt status bar.
const pad = { screenWidth: 1024, screenHeight: 1366 };

describe('wallFillHeight', () => {
  it('fills the screen when a Home Screen app reports the viewport a status bar short (portrait)', () => {
    expect(wallFillHeight({ ...pad, standalone: true, innerWidth: 1024, innerHeight: 1346 })).toBe(1366);
  });

  it('fills the screen in landscape, with the screen reported portrait-fixed or swapped', () => {
    expect(wallFillHeight({ ...pad, standalone: true, innerWidth: 1366, innerHeight: 1004 })).toBe(1024);
    expect(wallFillHeight({ screenWidth: 1366, screenHeight: 1024, standalone: true, innerWidth: 1366, innerHeight: 1004 })).toBe(1024);
  });

  it('leaves a correct viewport alone', () => {
    expect(wallFillHeight({ ...pad, standalone: true, innerWidth: 1024, innerHeight: 1366 })).toBeNull();
  });

  it('leaves a browser tab alone, where the toolbar really does take room', () => {
    expect(wallFillHeight({ ...pad, standalone: false, innerWidth: 1024, innerHeight: 1290 })).toBeNull();
  });

  it('leaves Split View alone', () => {
    expect(wallFillHeight({ ...pad, standalone: true, innerWidth: 678, innerHeight: 1004 })).toBeNull();
  });

  it('ignores a shortfall bigger than any status bar (the keyboard is up)', () => {
    expect(wallFillHeight({ ...pad, standalone: true, innerWidth: 1366, innerHeight: 620 })).toBeNull();
  });
});
