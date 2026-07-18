import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SUB_VIEW_HINT_KEY, hasSeenSubViewHint, markSubViewHintSeen } from './subViewHint';

describe('subViewHint latch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is unseen by default', () => {
    expect(hasSeenSubViewHint()).toBe(false);
  });

  it('is seen after marking', () => {
    markSubViewHintSeen();
    expect(hasSeenSubViewHint()).toBe(true);
    expect(localStorage.getItem(SUB_VIEW_HINT_KEY)).toBe('true');
  });

  it('marking is idempotent', () => {
    markSubViewHintSeen();
    markSubViewHintSeen();
    expect(hasSeenSubViewHint()).toBe(true);
  });

  it('ignores unexpected stored values', () => {
    localStorage.setItem(SUB_VIEW_HINT_KEY, 'yes');
    expect(hasSeenSubViewHint()).toBe(false);
  });

  it('fails closed (treated as seen) when storage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(hasSeenSubViewHint()).toBe(true);
  });

  it('swallows storage write errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => markSubViewHintSeen()).not.toThrow();
  });
});
