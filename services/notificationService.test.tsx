/**
 * Tests for notificationService's foreground-listener setup.
 *
 * Focus: setupForegroundNotificationListener must register exactly ONE onMessage
 * listener even under concurrent/rapid calls. Registration spans multiple awaits
 * (resolve messaging, then dynamically import onMessage), so the guard must be a
 * memoized promise — not a flag assigned only after the awaits — otherwise two
 * overlapping calls would both register a listener (duplicate foreground toasts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { onMessageMock, unsubscribeMock, getMessagingInstanceMock } = vi.hoisted(() => ({
  onMessageMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  getMessagingInstanceMock: vi.fn(),
}));

// Local firebase/messaging mock (overrides the global vitest.setup mock) so we
// can count onMessage registrations precisely.
vi.mock('firebase/messaging', () => ({
  onMessage: onMessageMock,
  getToken: vi.fn(),
  getMessaging: vi.fn(() => ({})),
  isSupported: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/firebase.config', () => ({
  db: {},
  auth: { currentUser: null },
  getMessagingInstance: getMessagingInstanceMock,
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

describe('setupForegroundNotificationListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    onMessageMock.mockReturnValue(unsubscribeMock);
    // Messaging is available (a non-null instance).
    getMessagingInstanceMock.mockResolvedValue({ __isMessaging: true });
  });

  it('registers onMessage exactly once for two overlapping concurrent calls', async () => {
    const { setupForegroundNotificationListener } = await import('./notificationService');

    // Fire two calls without awaiting the first — simulates a StrictMode
    // mount→cleanup→mount or a rapid permission flip within the resolve window.
    const p1 = setupForegroundNotificationListener();
    const p2 = setupForegroundNotificationListener();

    const [cleanup1, cleanup2] = await Promise.all([p1, p2]);

    expect(onMessageMock).toHaveBeenCalledTimes(1);
    // Both callers share the same memoized setup → same cleanup.
    expect(cleanup1).toBe(cleanup2);
    expect(typeof cleanup1).toBe('function');
  });

  it('returns the same listener for a sequential second call (no re-registration)', async () => {
    const { setupForegroundNotificationListener } = await import('./notificationService');

    const cleanup1 = await setupForegroundNotificationListener();
    const cleanup2 = await setupForegroundNotificationListener();

    expect(onMessageMock).toHaveBeenCalledTimes(1);
    expect(cleanup1).toBe(cleanup2);
  });

  it('re-registers after cleanup so a later mount works', async () => {
    const { setupForegroundNotificationListener } = await import('./notificationService');

    const cleanup = await setupForegroundNotificationListener();
    expect(onMessageMock).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toBeNull();

    // Tear down, then set up again.
    cleanup?.();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);

    await setupForegroundNotificationListener();
    expect(onMessageMock).toHaveBeenCalledTimes(2);
  });

  it('returns null and does not register when messaging is unavailable', async () => {
    getMessagingInstanceMock.mockResolvedValue(null);
    const { setupForegroundNotificationListener } = await import('./notificationService');

    const result = await setupForegroundNotificationListener();

    expect(result).toBeNull();
    expect(onMessageMock).not.toHaveBeenCalled();

    // After an unsupported result the memo resets, so a later call can retry.
    getMessagingInstanceMock.mockResolvedValue({ __isMessaging: true });
    const cleanup = await setupForegroundNotificationListener();
    expect(cleanup).not.toBeNull();
    expect(onMessageMock).toHaveBeenCalledTimes(1);
  });

  it('recovers when setup throws once: resolves null (no throw), resets memo, retries successfully', async () => {
    // Simulate a transient failure during registration (e.g. chunk-load error
    // surfacing as onMessage throwing).
    onMessageMock.mockImplementationOnce(() => {
      throw new Error('transient chunk load failure');
    });
    const { setupForegroundNotificationListener } = await import('./notificationService');

    // First call must resolve to null rather than reject (no unhandled rejection
    // for App.tsx/Settings.tsx, which call without a .catch).
    const failed = await setupForegroundNotificationListener();
    expect(failed).toBeNull();
    expect(onMessageMock).toHaveBeenCalledTimes(1);

    // The rejected/failed attempt must NOT be cached forever — a subsequent call
    // retries and registers a working listener.
    onMessageMock.mockReturnValue(unsubscribeMock);
    const cleanup = await setupForegroundNotificationListener();
    expect(cleanup).not.toBeNull();
    expect(typeof cleanup).toBe('function');
    expect(onMessageMock).toHaveBeenCalledTimes(2);
  });
});
