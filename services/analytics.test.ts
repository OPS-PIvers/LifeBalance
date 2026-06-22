import { describe, it, expect, vi } from 'vitest';

// firebase.config initializes Firebase on import; stub it so importing the
// analytics module under test doesn't spin up a real Firebase app.
vi.mock('@/firebase.config', () => ({ default: {} }));

import { track } from './analytics';

describe('analytics.track', () => {
  it('never throws and no-ops when analytics is uninitialized (dev/test/SSR)', () => {
    // In the test environment import.meta.env.PROD is false, so analytics never
    // initializes and the firebase/analytics SDK is never dynamically imported —
    // track() must be a completely safe no-op.
    expect(() => track('unit_test_event')).not.toThrow();
    expect(() =>
      track('unit_test_event', { value: 1, label: 'x' })
    ).not.toThrow();
  });
});
