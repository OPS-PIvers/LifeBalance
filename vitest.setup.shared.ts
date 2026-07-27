// Environment-agnostic test setup, shared by BOTH vitest projects (see
// vite.config.ts). Keep this file free of anything that needs a DOM — the
// `node` project loads it directly, and it is the only setup those 200+
// pure-logic suites pay for. DOM-only setup belongs in vitest.setup.ts.
import { vi } from 'vitest';

// Suppress Firebase Messaging "unsupported-browser" errors in test environment.
// Neither test environment provides window.navigator.serviceWorker: jsdom has no
// implementation of it, and the node project has no window at all.
process.on('unhandledRejection', (reason: Error) => {
  if (reason?.message?.includes('messaging/unsupported-browser')) {
    // Silently ignore this known issue in test environment
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});

// Mock firebase/messaging globally to prevent initialization errors
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  onMessage: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn().mockResolvedValue(false),
}));
