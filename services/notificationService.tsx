import React from 'react';
import { getToken, onMessage, type MessagePayload } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { messaging, db, auth } from '@/firebase.config';
import toast from 'react-hot-toast';

// Track if foreground listener is already set up to avoid duplicates
let foregroundListenerInitialized = false;

/**
 * Detect if the current device is running iOS
 */
export const isIOSDevice = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || '';
  // Check for iOS devices including iPad on iOS 13+ (which reports as Mac)
  return /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

/**
 * Detect if the app is running as a PWA (added to home screen)
 */
export const isPWA = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check if running in standalone mode (PWA)
  return window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari specific check
    (window.navigator as any).standalone === true;
};

/**
 * Check if the browser supports Web Push (feature detection, not device detection)
 * This is the recommended approach per Web Push standards
 */
export const supportsPush = (): boolean => {
  return 'serviceWorker' in navigator && 'PushManager' in window;
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
 * Parse iOS version from user agent
 */
const parseIOSVersion = (): number | null => {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  if (match) {
    return parseFloat(`${match[1]}.${match[2]}`);
  }
  return null;
};

/**
 * Set up foreground message listener to display notifications when app is open
 * This is CRITICAL for iOS PWAs where background notifications don't work
 */
export const setupForegroundNotificationListener = (): (() => void) | null => {
  if (!messaging) {
    console.warn('[Notifications] Firebase Messaging not available');
    return null;
  }

  if (foregroundListenerInitialized) {
    console.log('[Notifications] Foreground listener already initialized');
    return null;
  }

  console.log('[Notifications] Setting up foreground message listener');

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
            // Navigate to the notification's target URL
            if (url && url !== '/') {
              window.location.hash = url;
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
    // This helps when the PWA is open but in background tab
    if (Notification.permission === 'granted' && document.hidden) {
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
            window.location.hash = url;
          }
          notification.close();
        };
      } catch (e) {
        // Native notifications may not work in all contexts, toast is the fallback
        console.log('[Notifications] Native notification failed, using toast:', e);
      }
    }
  });

  foregroundListenerInitialized = true;
  console.log('[Notifications] Foreground listener active');

  return unsubscribe;
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

        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration
        });
      } catch (tokenError: any) {
        console.error('Error fetching FCM token:', tokenError);
        
        // Provide specific error messages based on failure type
        if (tokenError.code === 'messaging/permission-blocked') {
          toast.error('Notification permission blocked. Please enable in browser settings.');
        } else if (tokenError.code === 'messaging/unsupported-browser') {
          toast.error('Push notifications are not supported in this browser.');
        } else if (tokenError.code === 'messaging/failed-service-worker-registration') {
          toast.error('Service worker registration failed. Try refreshing the page.');
        } else if (tokenError.message?.includes('VAPID')) {
          toast.error('Configuration error: Invalid VAPID key.');
        } else {
          toast.error('Failed to connect to push service. Check your internet connection.');
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
