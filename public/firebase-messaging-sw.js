// Give the service worker access to Firebase Messaging.
// Note: We use the compat libraries here because service workers don't natively support ES modules in all contexts
// and we want a standalone file in public/.
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker
// Note: For background messages to work reliably, you must provide the messagingSenderId.
// Since this is a static file, we use a placeholder. Please replace 'YOUR_SENDER_ID'
// with your actual Sender ID from the Firebase Console (Settings > Cloud Messaging).
// You can also find it in your firebase.config.ts if it's hardcoded there.

// Try-catch to prevent SW crash if config is invalid
try {
  firebase.initializeApp({
    // Replace with your actual Sender ID
    messagingSenderId: 'YOUR_SENDER_ID'
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
