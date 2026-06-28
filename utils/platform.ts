/**
 * Pure platform / capability detection helpers.
 *
 * These deliberately have NO Firebase dependency so they can be imported on the
 * eager boot path (e.g. authService, NotificationSettings) WITHOUT dragging
 * firebase/messaging along. The notification flow that actually touches
 * firebase/messaging lives in services/notificationService.tsx, which is only
 * loaded lazily (when notifications are set up). Keeping these split is what
 * keeps firebase/messaging off the boot path.
 */

/**
 * Detect if the current device is running iOS.
 */
export const isIOSDevice = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  // Check for iOS devices including iPad on iOS 13+ (which reports as Mac)
  // Add pointer:coarse check to avoid false positives on MacBook Pro with Touch Bar
  const isIOSUserAgent = /iPad|iPhone|iPod/.test(userAgent);
  const isPadOnMac = navigator.platform === 'MacIntel' &&
    navigator.maxTouchPoints > 1 &&
    window.matchMedia('(pointer: coarse)').matches;

  return isIOSUserAgent || isPadOnMac;
};

/**
 * Detect if the app is running as a PWA (added to home screen).
 */
export const isPWA = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check if running in standalone mode (PWA)
  return window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari specific check
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
};

/**
 * Check if the browser supports Web Push (feature detection, not device detection).
 * This is the recommended approach per Web Push standards.
 */
export const supportsPush = (): boolean => {
  return 'serviceWorker' in navigator && 'PushManager' in window;
};

/**
 * Parse the iOS version from the user agent, or null if it can't be determined.
 */
export const parseIOSVersion = (): number | null => {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  if (match) {
    return parseFloat(`${match[1]}.${match[2]}`);
  }
  return null;
};
