// Service Worker for LifeBalance PWA with Firebase Cloud Messaging
// IMPORTANT: Update this version string when deploying changes to trigger cache invalidation
const CACHE_VERSION = 'v1.1.0';
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

try {
  firebase.initializeApp({
    messagingSenderId: MESSAGING_SENDER_ID
  });

  const messaging = firebase.messaging();

  // Handle background messages (when app is not in focus)
  messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Received background message:', payload);

    // Extract notification and data payloads
    const notificationTitle = payload.notification?.title || 'New Notification';
    const notificationOptions = {
      body: payload.notification?.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Include data payload for deep linking and custom actions
      data: {
        ...payload.data,
        // Store the click action URL if provided
        url: payload.data?.url || payload.fcmOptions?.link || '/'
      }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
  
  firebaseMessagingReady = true;
  console.log('[SW] Firebase Messaging initialized successfully');
} catch (error) {
  console.error('[SW] Firebase Messaging initialization failed:', error);
  firebaseMessagingReady = false;
}

// Native push event listener - CRITICAL for iOS Safari PWAs
// iOS 16.4+ uses the standard Web Push API. Firebase's onBackgroundMessage may not
// catch all push events on iOS, so we add a native handler as a fallback.
// This listener fires when a push message arrives and the PWA is not in the foreground.
self.addEventListener('push', (event) => {
  console.log('[SW] Native push event received:', event);

  // If Firebase already handled this via onBackgroundMessage, don't double-notify.
  // Firebase sets a flag on handled messages - check if this was already processed.
  // However, on iOS this native handler may be the only one that fires.

  if (!event.data) {
    console.log('[SW] Push event has no data, skipping');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    console.log('[SW] Push payload:', payload);
  } catch (e) {
    // If it's not JSON, try to get text
    console.log('[SW] Push data is not JSON, trying text:', event.data.text());
    return;
  }

  // Firebase FCM sends notifications in a specific format
  // Check for both FCM format and standard Web Push format
  const notification = payload.notification || payload;
  const data = payload.data || {};

  const title = notification.title || 'LifeBalance';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.fcmMessageId || 'lifebalance-notification',
    data: {
      ...data,
      url: data.url || payload.fcmOptions?.link || '/'
    },
    // iOS-specific: ensure notification shows even if app recently active
    requireInteraction: false,
    silent: false
  };

  // Show the notification
  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => console.log('[SW] Notification shown successfully'))
      .catch((err) => console.error('[SW] Failed to show notification:', err))
  );
});

// Handle notification clicks for deep linking
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.notification.tag);
  event.notification.close();

  // Get the URL from the notification data, default to home
  const urlToOpen = event.notification.data?.url || '/';

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
