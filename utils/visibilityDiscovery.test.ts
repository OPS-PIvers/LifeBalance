// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isVisibilityDiscoveryDismissed, dismissVisibilityDiscovery } from './visibilityDiscovery';

describe('visibilityDiscovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not dismissed for a member who has never seen it', () => {
    expect(isVisibilityDiscoveryDismissed('uid-1')).toBe(false);
  });

  it('stays dismissed after dismissVisibilityDiscovery', () => {
    dismissVisibilityDiscovery('uid-1');
    expect(isVisibilityDiscoveryDismissed('uid-1')).toBe(true);
  });

  it('is scoped per member uid, not shared across the household', () => {
    dismissVisibilityDiscovery('uid-1');
    expect(isVisibilityDiscoveryDismissed('uid-2')).toBe(false);
  });

  it('fails safe (never claims dismissed) when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(isVisibilityDiscoveryDismissed('uid-1')).toBe(false);
  });

  it('dismiss is best-effort when storage is unavailable (never throws)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => dismissVisibilityDiscovery('uid-1')).not.toThrow();
  });
});
