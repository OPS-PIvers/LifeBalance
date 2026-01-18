import '@testing-library/jest-dom';

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
