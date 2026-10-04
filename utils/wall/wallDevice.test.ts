// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isWallDevice, parseDisplayClaims, setWallDevice } from './wallDevice';

describe('wall device flag', () => {
  afterEach(() => localStorage.clear());

  it('round-trips', () => {
    expect(isWallDevice()).toBe(false);
    setWallDevice(true);
    expect(isWallDevice()).toBe(true);
    setWallDevice(false);
    expect(isWallDevice()).toBe(false);
  });
});

describe('parseDisplayClaims', () => {
  it('accepts only complete display claims', () => {
    expect(parseDisplayClaims({ display: true, hid: 'H1', did: 'd1' })).toEqual({ hid: 'H1', did: 'd1' });
    expect(parseDisplayClaims({ display: 'true', hid: 'H1', did: 'd1' })).toBeNull();
    expect(parseDisplayClaims({ display: true, hid: 'H1' })).toBeNull();
    expect(parseDisplayClaims({ email: 'a@b.c' })).toBeNull();
  });
});
