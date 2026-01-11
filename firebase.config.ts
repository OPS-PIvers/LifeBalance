import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Validate critical config
if (!firebaseConfig.apiKey) {
  console.error('Firebase configuration error: Missing VITE_FIREBASE_API_KEY. Using mock config for app initialization to prevent crash.');
  // Provide dummy config so initializeApp doesn't crash immediately.
  // This allows the app to load for "Bypass Mode" usage only.
  // Any Firebase network or auth calls will fail with these bypass-mode credentials, which is expected.
  firebaseConfig.apiKey = 'bypass-mode-mock-api-key';
  firebaseConfig.authDomain = 'bypass-mode-mock-project.firebaseapp.invalid';
  firebaseConfig.projectId = 'bypass-mode-mock-project';
  firebaseConfig.appId = '1:000000000000:bypass-mode-mock-app-id-ffffffffffffffff'; // Clearly mock appId to satisfy Firebase checks
  firebaseConfig.messagingSenderId = 'bypass-mode-mock-sender-id'; // Clearly mock senderId
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize Messaging with conditional check for browser environment
// to prevent errors in SSR, tests, or unsupported contexts.
let messagingInstance: Messaging | null = null;
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
