// Service Worker for LifeBalance PWA with Firebase Cloud Messaging
// NOTE: the cache name must be a static string. A previous timestamp-based
// version (`new Date().toISOString()`) was re-evaluated every time the
// browser restarted the (frequently terminated) worker, so each cold start
// wrote to a brand-new cache and storage churned without ever being a cache
// hit target. Hashed build assets are content-addressed and safe to keep
// across deploys; bump this version only when the caching strategy changes.
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'lifebalance-' + CACHE_VERSION;

// Firebase Cloud Messaging integration
// Import Firebase scripts for background message handling
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

// Initialize Firebase for FCM
// IMPORTANT: This value must match your Firebase project's messaging sender ID
// from firebase.config.ts. If the Firebase project changes, update this value.
// This is hardcoded because service workers cannot access environment variables at runtime.
const MESSAGING_SENDER_ID = '611571061016';

// Track Firebase Messaging initialization status
let firebaseMessagingReady = false;

/**
 * Validate URL to prevent XSS attacks
 * Only allows relative URLs or same-origin URLs
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Allow relative paths starting with /
  if (url.startsWith('/')) return true;
  // Allow hash routes
  if (url.startsWith('#')) return true;
  // Block javascript:, data:, and other dangerous protocols
  if (url.match(/^(javascript|data|vbscript|file):/i)) return false;
  // For absolute URLs, ensure same origin
  try {
    const parsed = new URL(url, self.location.origin);
    return parsed.origin === self.location.origin;
  } catch {
    return false;
  }
}

/**
 * Sanitize URL for storage in notification data
 */
function sanitizeUrl(url) {
  return isValidUrl(url) ? url : '/';
}

// F-NOTIF-05: inline notification action buttons.
// The sending job serializes an array of {action, title} to the `actions` field
// of the FCM data payload (JSON string, since data values must be strings). We
// parse + validate it here into the `options.actions` array the OS renders.
// Kept intentionally strict — bad/foreign entries are dropped, capped at 2 (the
// practical limit most platforms display), and each action id is echoed into the
// deep link on click (see notificationclick) rather than trusted to do anything
// on its own. Keep the action ids in sync with utils/notificationActions.ts and
// functions/src/shared/notificationActions.ts.
function parseNotificationActions(rawActions) {
  if (typeof rawActions !== 'string' || rawActions.length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawActions);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (a) =>
        a &&
        typeof a.action === 'string' &&
        a.action.length > 0 &&
        typeof a.title === 'string' &&
        a.title.length > 0
    )
    .slice(0, 2)
    .map((a) => ({ action: a.action, title: a.title }));
}

try {
  firebase.initializeApp({
    messagingSenderId: MESSAGING_SENDER_ID
  });

  // Initialize messaging but DO NOT use onBackgroundMessage
  // Firebase's onBackgroundMessage does NOT properly use event.waitUntil(),
  // which causes Safari/iOS to treat notifications as "silent pushes".
  // After 3 silent pushes, Safari revokes push permission entirely.
  // See: https://github.com/firebase/firebase-js-sdk/issues/8010
  const messaging = firebase.messaging();

  firebaseMessagingReady = true;
  console.log('[SW] Firebase Messaging initialized successfully');
} catch (error) {
  console.error('[SW] Firebase Messaging initialization failed:', error);
  firebaseMessagingReady = false;
}

// Native push event listener - REQUIRED for iOS Safari PWAs
// This is the ONLY push handler we use because:
// 1. Firebase's onBackgroundMessage doesn't use event.waitUntil() properly
// 2. Safari/iOS revokes push permission after 3 "silent" pushes
// 3. The native 'push' event with event.waitUntil() is the correct pattern per W3C spec
//
// References:
// - https://github.com/firebase/firebase-js-sdk/issues/8010
// - https://developer.apple.com/documentation/usernotifications/sending_web_push_notifications_in_web_apps_and_browsers
// F-NOTIF-10 — per-notification-type vibration patterns.
//
// Platform reality check: `vibrate` on showNotification() options is honored
// ONLY by Android Chrome/Edge (Chromium). iOS Safari/PWAs ignore it completely
// (no Vibration API support at all on WebKit/iOS), and desktop browsers have
// no vibration hardware so it's a silent no-op there too. Passing an
// unsupported pattern is harmless (browsers that don't support it simply
// don't vibrate), so we ship this for the Android slice without any feature
// detection needed.
//
// Kept in sync with utils/notificationVibration.ts's VIBRATE_PATTERNS table —
// a service worker can't `import` from the app bundle, so this is a
// deliberate duplication (same pattern as the frozen-date streak table
// documented in CLAUDE.md). Update both together.
const DEFAULT_VIBRATE_PATTERN = [100, 50, 100];
const PUSH_VIBRATE_PATTERNS = {
  streak_warning: [200, 80, 200, 80, 200],
  budget_alert: [200, 80, 200, 80, 200],
  bill_reminder: [150, 60, 150],
  habit_reminder: [80, 60, 80],
  action_queue_reminder: [80, 60, 80],
  weekly_recap: [100],
  monthly_money_recap: [100],
  test_notification: [100, 50, 100]
};

function getVibratePattern(type) {
  if (!type || typeof type !== 'string') return DEFAULT_VIBRATE_PATTERN;
  return PUSH_VIBRATE_PATTERNS[type] || DEFAULT_VIBRATE_PATTERN;
}

self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);

  // CRITICAL: We must show a notification for EVERY push event on iOS
  // If we don't, Safari considers it a "silent push" and will revoke permission

  if (!event.data) {
    console.log('[SW] Push event has no data, showing fallback notification');
    // Even with no data, we MUST show something on iOS or permission gets revoked
    event.waitUntil(
      self.registration.showNotification('LifeBalance', {
        body: 'You have a new notification',
        icon: '/icon-192.png',
        badge: '/icon-192.png'
      })
    );
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    console.log('[SW] Push payload:', payload);
  } catch (e) {
    // If it's not JSON, show a generic notification
    console.log('[SW] Push data is not JSON:', event.data.text());
    event.waitUntil(
      self.registration.showNotification('LifeBalance', {
        body: event.data.text() || 'You have a new notification',
        icon: '/icon-192.png',
        badge: '/icon-192.png'
      })
    );
    return;
  }

  // Firebase FCM sends notifications in a specific format
  // Check for both FCM format and standard Web Push format
  const notification = payload.notification || payload;
  const data = payload.data || {};

  const title = notification.title || 'LifeBalance';
  // Sanitize URL to prevent XSS - only allow relative or same-origin URLs
  const rawUrl = data.url || payload.fcmOptions?.link || '/';
  const safeUrl = sanitizeUrl(rawUrl);

  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.fcmMessageId || `lifebalance-${Date.now()}`,
    data: {
      ...data,
      url: safeUrl
    },
    // Vibration pattern for mobile devices — per-type where the caller sent
    // one (data.type), else the generic default. Only honored by Android
    // Chrome/Edge in practice; see the comment on getVibratePattern above.
    vibrate: getVibratePattern(data.type)
  };

  // F-NOTIF-05: attach inline action buttons if the payload carried any.
  const notificationActions = parseNotificationActions(data.actions);
  if (notificationActions.length > 0) {
    options.actions = notificationActions;
  }

  // F-NOTIF-07: mirror an app-icon badge count for background pushes (the
  // client's useAppBadge hook only runs while a tab is open). The server
  // may attach a `badgeCount` on the data payload (e.g. unpaid-bills +
  // at-risk-streaks count); feature-detected and best-effort — a missing
  // count or unsupported API is a silent no-op, never blocks the
  // notification display above.
  const badgeCount = Number(data.badgeCount);
  if ('setAppBadge' in self.navigator && Number.isFinite(badgeCount)) {
    const safeBadgeCount = badgeCount > 0 ? Math.floor(badgeCount) : 0;
    const badgePromise = safeBadgeCount > 0
      ? self.navigator.setAppBadge(safeBadgeCount)
      : ('clearAppBadge' in self.navigator ? self.navigator.clearAppBadge() : Promise.resolve());
    event.waitUntil(badgePromise.catch((err) => console.error('[SW] Failed to set app badge:', err)));
  }

  // CRITICAL: event.waitUntil() ensures Safari doesn't treat this as a silent push
  // The Promise passed to waitUntil must resolve BEFORE the event handler completes
  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => console.log('[SW] Notification displayed successfully'))
      .catch((err) => console.error('[SW] Failed to show notification:', err))
  );
});

// Handle notification clicks for deep linking
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();

  // Get the URL from the notification data, validate it, default to home
  const rawUrl = event.notification.data?.url || '/';
  const targetPath = sanitizeUrl(rawUrl);
  // Build full URL for comparison and opening
  const fullUrlToOpen = new URL(targetPath, self.location.origin).href;

  // Tag the URL we NAVIGATE/open with the notification type so the app can
  // attribute the open (`notification_opened`): a service worker cannot call
  // the GA client SDK, so the client reads + strips `nsrc` on boot. Window
  // MATCHING above/below stays on the untagged path so focusing an already-open
  // window behaves exactly as before. Keep this tagging in sync with
  // utils/notificationSource.ts (appendNotificationSource).
  const notificationType = typeof event.notification.data?.type === 'string'
    ? event.notification.data.type
    : '';
  let taggedPath = notificationType
    ? targetPath + (targetPath.includes('?') ? '&' : '?') + 'nsrc=' + encodeURIComponent(notificationType)
    : targetPath;

  // F-NOTIF-05: when the user tapped an inline ACTION button (not the body),
  // echo the action id into the deep link as `nact=<action>`. The app reads +
  // strips it on boot and dispatches the action from an authenticated session
  // (see utils/notificationActions.ts). Body taps have event.action === ''.
  const actionId = typeof event.action === 'string' ? event.action : '';
  if (actionId) {
    taggedPath = taggedPath + (taggedPath.includes('?') ? '&' : '?') + 'nact=' + encodeURIComponent(actionId);
  }

  const fullTaggedUrlToOpen = new URL(taggedPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open with matching URL or hash
      for (const client of clientList) {
        // Compare full URLs or check if client URL ends with the target path/hash
        const clientUrl = new URL(client.url);
        const targetUrl = new URL(fullUrlToOpen);

        // For HashRouter apps, compare the hash portions
        const hashMatch = clientUrl.hash && targetPath.startsWith('/') &&
          clientUrl.hash === '#' + targetPath;
        const exactMatch = client.url === fullUrlToOpen;

        if ((exactMatch || hashMatch) && 'focus' in client) {
          return client.focus();
        }
      }
      // If no matching window, try to focus any existing window and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then(() => {
            // Navigate to the target URL via postMessage
            client.postMessage({ type: 'NAVIGATE', url: taggedPath });
          });
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(fullTaggedUrlToOpen);
      }
    })
  );
});

// Assets to cache on install (shell)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache shell assets
self.addEventListener('install', (event) => {
  console.log('[SW] Install - version:', CACHE_VERSION);
  // Skip waiting to activate immediately
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

// Cap on cached immutable assets. Hashed filenames change every deploy, so
// without a bound the static-named cache would grow by roughly one bundle per
// release. Oldest (insertion-order) entries are evicted first; anything still
// in use gets re-cached on next fetch.
const MAX_ASSET_ENTRIES = 150;

async function trimAssetCache() {
  // Best-effort: a trim failure (quota/disk I/O) must never block activation.
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const assetKeys = keys.filter((req) => {
      const url = new URL(req.url, self.location.origin);
      return url.origin === self.location.origin && url.pathname.startsWith('/assets/');
    });
    const excess = assetKeys.length - MAX_ASSET_ENTRIES;
    if (excess > 0) {
      await Promise.all(assetKeys.slice(0, excess).map((req) => cache.delete(req)));
    }
  } catch (err) {
    console.error('[SW] Failed to trim asset cache:', err);
  }
}

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate - cleaning old caches');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('lifebalance-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => trimAssetCache()).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // For navigation requests (HTML), always go network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache the response
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request);
        })
    );
    return;
  }

  // Vite emits content-hashed, immutable files under /assets/ (e.g.
  // `index-mAUxcOUH.js`), so they can be served cache-first. (An earlier
  // `\.[a-f0-9]{8}\.(js|css)$` pattern expected webpack-style names and never
  // matched, which made every repeat visit re-download the whole bundle.)
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        });
      })
    );
    return;
  }

  // For all other requests, network-first
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
