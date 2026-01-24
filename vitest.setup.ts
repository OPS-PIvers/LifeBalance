import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Suppress Firebase Messaging "unsupported-browser" errors in test environment
// This error occurs because jsdom doesn't have the window.navigator.serviceWorker API
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
