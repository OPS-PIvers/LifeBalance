import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize Messaging conditionally
// We need to use a promise-based approach or a getter because isSupported is async
// and we can't export 'await' result at top level easily in all bundlers without top-level-await support.
// However, for simplicity and common patterns, we often just export the instance if supported, or null.
// But isSupported() is async.
// Standard pattern: Export a function to get messaging, or rely on lazy loading.
// For now, I'll export `messaging` as the instance, but we can't await at top level safely in all envs.
// Actually, `getMessaging` checks internally if window is defined. The `isSupported` check helps avoid errors in non-browser envs.
// Let's try to export it directly but wrap in try-catch for basic environment checks.
// The previous "await isSupported()" was risky at top level.

let messagingInstance: any = null;
if (typeof window !== 'undefined') {
  try {
    messagingInstance = getMessaging(app);
  } catch (e) {
    console.warn('Firebase Messaging failed to initialize', e);
  }
}

export const messaging = messagingInstance;
export const googleProvider = new GoogleAuthProvider();

// Configure Google provider
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export default app;
