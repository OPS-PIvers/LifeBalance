// Service Worker for LifeBalance PWA with Firebase Cloud Messaging
// Cache version is timestamp-based to ensure automatic invalidation on new deployments
const CACHE_VERSION = new Date().toISOString();
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
    // Vibration pattern for mobile devices
    vibrate: [100, 50, 100]
  };

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
  const urlToOpen = sanitizeUrl(rawUrl);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
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
    }).then(() => {
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

  // For assets with hash in filename (immutable), cache-first
  if (url.pathname.match(/\.[a-f0-9]{8}\.(js|css)$/)) {
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
