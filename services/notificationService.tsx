import type { MessagePayload } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { getMessagingInstance, db, auth } from '@/firebase.config';
import { isIOSDevice, isPWA, supportsPush, parseIOSVersion } from '@/utils/platform';
import toast from 'react-hot-toast';

// Re-export the pure platform helpers so existing
// `import ... from '@/services/notificationService'` call sites keep working.
// Eager consumers (authService, NotificationSettings) should import these from
// '@/utils/platform' directly to avoid pulling this messaging-touching module
// onto the boot path.
export { isIOSDevice, isPWA, supportsPush };

// Memoized in-flight (or settled) foreground-listener setup. Registration spans
// multiple awaits (resolve messaging, then dynamically import onMessage), so a
// plain "check a flag then assign it later" guard is NOT atomic: two rapid calls
// (React StrictMode mount→cleanup→mount, or a permission flip within the resolve
// window) could both pass the check and both call onMessage, leaking a second
// listener. Caching the PROMISE makes concurrent callers share one registration.
// The cleanup resets this to null so a later mount can re-register after teardown.
let foregroundListenerSetup: Promise<(() => void) | null> | null = null;

/**
 * Validate URL to prevent XSS attacks
 * Only allows relative URLs starting with / or # (for HashRouter)
 */
const isValidNavigationUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  // Only allow relative paths or hash routes
  return url.startsWith('/') || url.startsWith('#');
};

/**
 * Navigate to a URL using a custom event for router decoupling
 * This allows the app to handle navigation without tight coupling to HashRouter
 */
const navigateToUrl = (url: string): void => {
  if (!isValidNavigationUrl(url)) {
    console.warn('[Notifications] Invalid navigation URL blocked:', url);
    return;
  }
  // Dispatch custom event that can be handled by any router implementation
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { url } }));
  // Normalize URL by stripping leading # to prevent double hash (##/path)
  const normalizedUrl = url.startsWith('#') ? url.slice(1) : url;
  window.location.hash = normalizedUrl;
};

/**
 * Check if the device supports push notifications
 * Uses feature detection first, then provides iOS-specific guidance
 */
export const checkNotificationSupport = (): {
  supported: boolean;
  fullPushSupport: boolean;
  reason?: string;
} => {
  if (!('Notification' in window)) {
    return { supported: false, fullPushSupport: false, reason: 'Browser does not support notifications' };
  }

  if (!('serviceWorker' in navigator)) {
    return { supported: false, fullPushSupport: false, reason: 'Service workers not supported' };
  }

  // Feature detection: check for PushManager support
  const hasPushManager = 'PushManager' in window;

  const iOS = isIOSDevice();
  const pwa = isPWA();

  // iOS Safari (not installed as PWA)
  // On iOS, Notification API is undefined in regular Safari tabs - only available in PWA mode
  if (iOS && !pwa) {
    const iOSVersion = parseIOSVersion();
    if (iOSVersion && iOSVersion < 16.4) {
      return {
        supported: false,
        fullPushSupport: false,
        reason: 'iOS 16.4 or later required. Please update your device.'
      };
    }
    return {
      supported: false,
      fullPushSupport: false,
      reason: 'Add to Home Screen first. Tap Share > Add to Home Screen, then enable notifications.'
    };
  }

  // iOS PWA with iOS 16.4+ - full Web Push IS supported
  if (iOS && pwa && hasPushManager) {
    return {
      supported: true,
      fullPushSupport: true,
      reason: 'Background notifications supported on iOS 16.4+'
    };
  }

  // iOS PWA without PushManager (older iOS or edge case)
  if (iOS && pwa && !hasPushManager) {
    return {
      supported: true,
      fullPushSupport: false,
      reason: 'Notifications work when app is open'
    };
  }

  // Desktop/Android with full push support
  if (hasPushManager) {
    return { supported: true, fullPushSupport: true };
  }

  // Fallback: notifications supported but no push
  return { supported: true, fullPushSupport: false, reason: 'In-app notifications only' };
};

/**
 * Set up foreground message listener to display notifications when app is open.
 * This handles the case when the user has the app open and a push arrives.
 * Background notifications on iOS 16.4+ are handled by the service worker's
 * native 'push' event listener.
 */
export const setupForegroundNotificationListener = (): Promise<(() => void) | null> => {
  // Atomic guard: if a setup is already in flight or settled, return the SAME
  // promise so concurrent callers can never register a second onMessage listener.
  // Assigning the promise happens synchronously (no await before this point), so
  // the check+assign is atomic within a single tick.
  if (foregroundListenerSetup) {
    console.log('[Notifications] Foreground listener already initialized');
    return foregroundListenerSetup;
  }

  foregroundListenerSetup = (async (): Promise<(() => void) | null> => {
    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('[Notifications] Firebase Messaging not available');
      // Reset so a later call can retry once messaging becomes available.
      foregroundListenerSetup = null;
      return null;
    }

    console.log('[Notifications] Setting up foreground message listener');

    const { onMessage } = await import('firebase/messaging');
    const unsubscribe = onMessage(messaging, (payload: MessagePayload) => {
      console.log('[Notifications] Foreground message received:', payload);

      const title = payload.notification?.title || 'LifeBalance';
      const body = payload.notification?.body || '';
      const url = payload.data?.url || '/';

      // Show in-app toast notification
      toast(
        (t) => (
          <div
            className="flex items-start gap-3 cursor-pointer"
            onClick={() => {
              toast.dismiss(t.id);
              // Navigate to the notification's target URL using validated navigation
              if (url && url !== '/') {
                navigateToUrl(url);
              }
            }}
          >
            <div className="flex-shrink-0 w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center">
              <span className="text-lg">🔔</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-brand-800 text-sm">{title}</p>
              {body && <p className="text-brand-600 text-xs mt-0.5">{body}</p>}
              <p className="text-brand-400 text-xs mt-1">Tap to view</p>
            </div>
          </div>
        ),
        {
          duration: 8000,
          style: {
            background: 'white',
            padding: '12px 16px',
            borderRadius: '12px',
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.15)',
            maxWidth: '400px',
          },
        }
      );

      // Also try to show a native notification if permission granted and document is hidden
      // Skip on iOS as the Notification constructor is not available in iOS Safari PWAs
      if (!isIOSDevice() && Notification.permission === 'granted' && document.hidden) {
        try {
          const notification = new Notification(title, {
            body: body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: payload.messageId || 'lifebalance-notification',
            data: { url }
          });

          notification.onclick = () => {
            window.focus();
            if (url && url !== '/') {
              navigateToUrl(url);
            }
            notification.close();
          };
        } catch (e) {
          // Native notifications may not work in all contexts, toast is the fallback
          console.log('[Notifications] Native notification failed, using toast:', e);
        }
      }
    });

    // Wrap unsubscribe to also clear the memoized setup so a future mount can
    // re-register after teardown (works even if the promise resolves after the
    // caller unmounted — App.tsx still invokes this cleanup).
    const cleanup = () => {
      unsubscribe();
      foregroundListenerSetup = null;
      console.log('[Notifications] Foreground listener cleaned up');
    };

    console.log('[Notifications] Foreground listener active');
    return cleanup;
  })();

  return foregroundListenerSetup;
};

export const requestNotificationPermission = async (
  householdId: string,
  userId: string
): Promise<boolean> => {
  try {
    if (!('Notification' in window)) {
      toast.error('This browser does not support notifications.');
      return false;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('Firebase Messaging not initialized.');
      toast.error('Notifications not supported on this device.');
      return false;
    }

    // Security check: Ensure authenticated user matches the userId being updated
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
      console.error('Security violation: Attempted to update tokens for another user.');
      toast.error('Unauthorized access.');
      return false;
    }

    // Validate that the user is actually a member of the specified household
    const memberRef = doc(db, `households/${householdId}/members/${userId}`);
    const memberDoc = await getDoc(memberRef);

    if (!memberDoc.exists()) {
      console.error('Security violation: User is not a member of the specified household.');
      toast.error('You are not a member of this household.');
      return false;
    }

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        console.warn('VITE_FIREBASE_VAPID_KEY is missing in environment variables. Notifications may not work.');
        toast.error('Configuration error: Missing VAPID key');
        return false;
      }

      // Get FCM token using the existing service worker at /sw.js
      // The service worker was registered on app load in index.html
      let token;
      try {
        // Ensure service workers are supported and retrieve the existing registration
        if (!('serviceWorker' in navigator)) {
          console.error('Service workers are not supported in this browser.');
          toast.error('Push notifications are not supported in this browser.');
          return false;
        }

        const registration = await navigator.serviceWorker.getRegistration('/sw.js');

        if (!registration) {
          console.error('Service worker at /sw.js is not registered.');
          toast.error('Notifications are not available because the service worker is not ready.');
          return false;
        }

        const { getToken } = await import('firebase/messaging');
        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration
        });
      } catch (tokenError: unknown) {
        const err = tokenError as { code?: string; message?: string };
        console.error('Error fetching FCM token:', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        console.error('Full error:', JSON.stringify(err, null, 2));

        // Provide specific error messages based on failure type
        if (err.code === 'messaging/permission-blocked') {
          toast.error('Notification permission blocked. Please enable in browser settings.');
        } else if (err.code === 'messaging/unsupported-browser') {
          toast.error('Push notifications are not supported in this browser.');
        } else if (err.code === 'messaging/failed-service-worker-registration') {
          toast.error('Service worker registration failed. Try refreshing the page.');
        } else if (err.message?.includes('VAPID')) {
          toast.error('Configuration error: Invalid VAPID key.');
        } else {
          toast.error(`Failed to connect to push service. Error: ${err.code || err.message}`);
        }
        return false;
      }

      if (token) {
        // Save token to user's member profile in the household
        const memberRef = doc(db, `households/${householdId}/members/${userId}`);

        try {
          // IMPORTANT: arrayUnion prevents exact duplicates but DOES NOT remove stale tokens.
          // Over time, this array will accumulate invalid tokens from:
          // - Tokens refreshed by Firebase (old tokens become invalid)
          // - Multiple devices accessing the same account
          // - Users clearing browser data or reinstalling
          //
          // RECOMMENDED SOLUTION for production:
          // 1. Store tokens as a map: { [tokenId]: { token, deviceId, timestamp, lastVerified } }
          // 2. Implement a backend Cloud Function to periodically validate tokens via FCM API
          // 3. Remove tokens that return "NotRegistered" or "InvalidRegistration" errors
          // 4. On each new token registration, check if limit exceeded (e.g., >10 tokens) and clean old ones
          //
          // For MVP/small-scale use, arrayUnion is acceptable but expect delivery failures
          // to stale tokens (Firebase handles this gracefully with no user impact).
          await updateDoc(memberRef, {
            fcmTokens: arrayUnion(token)
          });
          toast.success('Notifications enabled!');
          // Dispatch event to notify App.tsx of permission change
          window.dispatchEvent(new CustomEvent('notification-permission-changed'));
          return true;
        } catch (updateError) {
          console.error('Failed to save FCM token to user profile:', updateError);
          toast.error('Failed to save notification settings. Please try again.');
          return false;
        }
      } else {
        console.error('No registration token available. Possible causes: Service worker not registered, VAPID key mismatch, or browser incompatibility.');
        toast.error('Could not retrieve notification token. Service worker may not be ready.');
        return false;
      }
    } else {
      toast.error('Notification permission denied.');
      return false;
    }
  } catch (error) {
    console.error('An error occurred while retrieving token. ', error);
    toast.error('Error enabling notifications.');
    return false;
  }
};

// Constants for token refresh
const TOKEN_REFRESH_KEY = 'fcm_token_last_refresh';
const TOKEN_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Refresh FCM token if it hasn't been refreshed recently.
 * iOS/Safari is particularly sensitive to stale tokens.
 *
 * Per Firebase documentation, tokens should be refreshed at least monthly,
 * but weekly is recommended for reliability. Tokens over 270 days old are rejected.
 *
 * References:
 * - https://github.com/firebase/firebase-js-sdk/issues/8013
 * - https://firebase.google.com/docs/cloud-messaging/manage-tokens
 */
export const refreshFCMTokenIfNeeded = async (
  householdId: string,
  userId: string
): Promise<boolean> => {
  try {
    // Check if we need to refresh (weekly refresh recommended for iOS)
    const lastRefresh = localStorage.getItem(TOKEN_REFRESH_KEY);
    const now = Date.now();

    if (lastRefresh) {
      const lastRefreshTime = parseInt(lastRefresh, 10);
      const timeSinceRefresh = now - lastRefreshTime;

      if (timeSinceRefresh < TOKEN_REFRESH_INTERVAL_MS) {
        console.log('[Notifications] Token refresh not needed yet, last refreshed:',
          new Date(lastRefreshTime).toISOString());
        return true;
      }
    }

    console.log('[Notifications] Refreshing FCM token...');

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn('[Notifications] Firebase Messaging not available for token refresh');
      return false;
    }

    if (Notification.permission !== 'granted') {
      console.log('[Notifications] Notification permission not granted, skipping token refresh');
      return false;
    }

    // Validate user
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
      console.warn('[Notifications] User mismatch, skipping token refresh');
      return false;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn('[Notifications] VAPID key missing, skipping token refresh');
      return false;
    }

    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) {
      console.warn('[Notifications] Service worker not registered, skipping token refresh');
      return false;
    }

    // Get a fresh token
    const { getToken } = await import('firebase/messaging');
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration
    });

    if (token) {
      // Update token in Firestore
      const memberRef = doc(db, `households/${householdId}/members/${userId}`);
      await updateDoc(memberRef, {
        fcmTokens: arrayUnion(token),
        lastTokenRefresh: new Date().toISOString()
      });

      // Update local storage with refresh timestamp
      localStorage.setItem(TOKEN_REFRESH_KEY, now.toString());

      console.log('[Notifications] FCM token refreshed successfully');
      return true;
    }

    console.warn('[Notifications] Failed to get token during refresh');
    return false;
  } catch (error) {
    console.error('[Notifications] Error refreshing FCM token:', error);
    return false;
  }
};
