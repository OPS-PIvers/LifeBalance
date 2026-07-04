import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// firebase.config initializes Firebase on import; stub it so importing the
// analytics module under test doesn't spin up a real Firebase app.
vi.mock('@/firebase.config', () => ({ default: {} }));

// Controllable gate for isSupported() so the queueing tests can hold
// initialization open and deterministically fire track() calls "before the
// SDK is ready". Harmless for the non-PROD tests (the SDK is never imported).
let resolveSupported: ((supported: boolean) => void) | undefined;

vi.mock('firebase/analytics', () => ({
  isSupported: vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveSupported = resolve;
      }),
  ),
  getAnalytics: vi.fn(() => ({ mockAnalytics: true })),
  logEvent: vi.fn(),
}));

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

// A fresh module instance per test so each one gets its own init lifecycle.
async function importFreshAnalytics() {
  vi.resetModules();
  const mod = await import('./analytics');
  const { logEvent } = await import('firebase/analytics');
  return { track: mod.track, logEvent: vi.mocked(logEvent) };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('analytics.track pre-init queueing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSupported = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('queues events fired before init settles and flushes them once the SDK is ready', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-TEST');
    const { track: trackFresh, logEvent } = await importFreshAnalytics();

    // Boot-time event (e.g. notification_opened from index.tsx) while the
    // dynamic import / isSupported() check is still pending.
    trackFresh('notification_opened', { type: 'habit_reminder' });
    expect(logEvent).not.toHaveBeenCalled();

    await flushMicrotasks(); // let init reach the isSupported() gate
    resolveSupported?.(true);
    await flushMicrotasks();

    expect(logEvent).toHaveBeenCalledWith(
      { mockAnalytics: true },
      'notification_opened',
      { type: 'habit_reminder' },
    );
  });

  it('bounds the pre-init queue', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-TEST');
    const { track: trackFresh, logEvent } = await importFreshAnalytics();

    for (let i = 0; i < 30; i++) trackFresh(`event_${i}`);

    await flushMicrotasks();
    resolveSupported?.(true);
    await flushMicrotasks();

    expect(logEvent).toHaveBeenCalledTimes(20);
  });

  it('discards queued events and stops queueing once init settles unavailable (non-PROD)', async () => {
    vi.stubEnv('PROD', false);
    const { track: trackFresh, logEvent } = await importFreshAnalytics();

    trackFresh('notification_opened', { type: 'habit_reminder' });
    await flushMicrotasks();
    // Post-settle events are dropped immediately, never queued.
    trackFresh('late_event');
    await flushMicrotasks();

    expect(logEvent).not.toHaveBeenCalled();
  });
});
