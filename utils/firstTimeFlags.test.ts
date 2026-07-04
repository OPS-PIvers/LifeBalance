import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldTrackFirstTime, FIRST_TRANSACTION_FLAG } from './firstTimeFlags';

describe('shouldTrackFirstTime', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires when the list was empty and the flag is unset, and sets the flag', () => {
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, true)).toBe(true);
    expect(window.localStorage.getItem(FIRST_TRANSACTION_FLAG)).toBe('1');
  });

  it('fires at most once per device', () => {
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, true)).toBe(true);
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, true)).toBe(false);
  });

  it('does not fire when the list already had items', () => {
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, false)).toBe(false);
    // A non-empty list must not consume the flag either.
    expect(window.localStorage.getItem(FIRST_TRANSACTION_FLAG)).toBeNull();
  });

  it('does not fire when the flag was already set (e.g. list re-emptied)', () => {
    window.localStorage.setItem(FIRST_TRANSACTION_FLAG, '1');
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, true)).toBe(false);
  });

  it('returns false (never repeats) when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(shouldTrackFirstTime(FIRST_TRANSACTION_FLAG, true)).toBe(false);
  });
});
