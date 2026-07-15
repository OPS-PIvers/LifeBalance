import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordSessionAndGetCount, hasMetInstallEngagementGate } from './pwaInstallEngagement';
import { FIRST_HABIT_FLAG } from './firstTimeFlags';

describe('recordSessionAndGetCount', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('increments the persistent count on first call this tab lifetime', () => {
    expect(recordSessionAndGetCount()).toBe(1);
    expect(window.localStorage.getItem('lb_session_count')).toBe('1');
  });

  it('does not double-count within the same tab lifetime (sessionStorage guard)', () => {
    expect(recordSessionAndGetCount()).toBe(1);
    expect(recordSessionAndGetCount()).toBe(1);
    expect(recordSessionAndGetCount()).toBe(1);
  });

  it('increments again after a simulated new tab lifetime (sessionStorage cleared)', () => {
    expect(recordSessionAndGetCount()).toBe(1);
    window.sessionStorage.clear();
    expect(recordSessionAndGetCount()).toBe(2);
  });

  it('returns 0 when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(recordSessionAndGetCount()).toBe(0);
  });
});

describe('hasMetInstallEngagementGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is false below the session threshold with no first-habit flag', () => {
    expect(hasMetInstallEngagementGate(1)).toBe(false);
    expect(hasMetInstallEngagementGate(2)).toBe(false);
  });

  it('is true once the session threshold is reached', () => {
    expect(hasMetInstallEngagementGate(3)).toBe(true);
    expect(hasMetInstallEngagementGate(10)).toBe(true);
  });

  it('is true early when the first-habit flag is set, regardless of session count', () => {
    window.localStorage.setItem(FIRST_HABIT_FLAG, '1');
    expect(hasMetInstallEngagementGate(1)).toBe(true);
  });

  it('returns false (fail-closed) when storage is unavailable and threshold unmet', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(hasMetInstallEngagementGate(1)).toBe(false);
  });
});
