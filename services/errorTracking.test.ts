// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/react';

// Controllable gate for init() so the queueing tests can hold initialization
// open and deterministically fire captureException() calls "before the SDK is
// ready". Harmless for the non-PROD tests (the SDK is never imported).
let resolveInit: (() => void) | undefined;
const mockCaptureException = vi.fn();
const mockInit = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
);

vi.mock('@sentry/react', () => ({
  init: mockInit,
  captureException: mockCaptureException,
}));

import { initErrorTracking, captureException } from './errorTracking';

describe('errorTracking.captureException', () => {
  it('never throws and no-ops when tracking is uninitialized (dev/test/SSR)', () => {
    // In the test environment import.meta.env.PROD is false, so tracking never
    // initializes and the @sentry/react SDK is never dynamically imported —
    // captureException() must be a completely safe no-op.
    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(() =>
      captureException(new Error('boom'), { componentStack: 'x' }),
    ).not.toThrow();
  });

  it('initErrorTracking() is a safe no-op fire-and-forget call in dev', () => {
    expect(() => initErrorTracking()).not.toThrow();
  });
});

// A fresh module instance per test so each one gets its own init lifecycle.
async function importFreshErrorTracking() {
  vi.resetModules();
  const mod = await import('./errorTracking');
  const sentryReact = await import('@sentry/react');
  return {
    initErrorTracking: mod.initErrorTracking,
    captureException: mod.captureException,
    init: vi.mocked(sentryReact.init),
    sentryCaptureException: vi.mocked(sentryReact.captureException),
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('errorTracking init gating + queueing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveInit = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not initialize without a DSN, even in production', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initErrorTracking: initFresh, init } = await importFreshErrorTracking();

    initFresh();
    await flushMicrotasks();

    expect(init).not.toHaveBeenCalled();
  });

  it('initializes with sendDefaultPii false and a beforeSend scrubber when DSN + PROD are set', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');
    const { initErrorTracking: initFresh, init } = await importFreshErrorTracking();

    initFresh();
    await flushMicrotasks();
    resolveInit?.();
    await flushMicrotasks();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]?.[0];
    expect(options?.dsn).toBe('https://key@o0.ingest.sentry.io/1');
    expect(options?.sendDefaultPii).toBe(false);

    // beforeSend must strip request bodies and breadcrumb data payloads.
    const fakeEvent: ErrorEvent = {
      type: undefined,
      request: { url: 'https://example.com', data: '{"amount":42}' },
      breadcrumbs: [{ category: 'xhr', data: { amount: 42 } }],
    };
    const scrubbed = await options?.beforeSend?.(fakeEvent, {});
    expect(scrubbed?.request).toBeUndefined();
    expect(scrubbed?.breadcrumbs?.[0]?.data).toBeUndefined();
  });

  it('queues errors fired before init settles and flushes them once the SDK is ready', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');
    const { captureException: captureFresh, sentryCaptureException } =
      await importFreshErrorTracking();

    const err = new Error('boot crash');
    captureFresh(err, { componentStack: 'stack' });
    expect(sentryCaptureException).not.toHaveBeenCalled();

    await flushMicrotasks(); // let init reach the sentry init() gate
    resolveInit?.();
    await flushMicrotasks();

    expect(sentryCaptureException).toHaveBeenCalledWith(err, {
      extra: { componentStack: 'stack' },
    });
  });

  it('bounds the pre-init queue', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');
    const { captureException: captureFresh, sentryCaptureException } =
      await importFreshErrorTracking();

    for (let i = 0; i < 20; i++) captureFresh(new Error(`err_${i}`));

    await flushMicrotasks();
    resolveInit?.();
    await flushMicrotasks();

    expect(sentryCaptureException).toHaveBeenCalledTimes(10);
  });

  it('discards queued errors and stops queueing once init settles unavailable (non-PROD)', async () => {
    vi.stubEnv('PROD', false);
    const { captureException: captureFresh, sentryCaptureException } =
      await importFreshErrorTracking();

    captureFresh(new Error('boot crash'));
    await flushMicrotasks();
    // Post-settle errors are dropped immediately, never queued.
    captureFresh(new Error('late error'));
    await flushMicrotasks();

    expect(sentryCaptureException).not.toHaveBeenCalled();
  });
});
