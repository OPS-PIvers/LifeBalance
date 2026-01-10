// Give the service worker access to Firebase Messaging.
// Note: We use the compat libraries here because service workers don't natively support ES modules in all contexts
// and we want a standalone file in public/.
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker
// Note: For background messages to work reliably, you must provide the messagingSenderId.
// This value must match the VITE_FIREBASE_MESSAGING_SENDER_ID in your environment variables.
// IMPORTANT: Keep this value in sync with your Firebase project configuration (e.g., firebase.config.ts).
// If the Firebase project or messaging sender ID changes, this constant must be updated manually.
const MESSAGING_SENDER_ID = '611571061016';

// Try-catch to prevent SW crash if config is invalid
try {
  firebase.initializeApp({
    messagingSenderId: MESSAGING_SENDER_ID
  });

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const notificationTitle = payload.notification?.title || 'New Notification';
    const notificationOptions = {
      body: payload.notification?.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (error) {
  console.error('[firebase-messaging-sw.js] Initialization failed:', error);
}
