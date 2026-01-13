import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, type Messaging } from 'firebase/messaging';

// Fallback to mock config if env vars are missing (for Test Mode/CI)
const mockConfig = {
  apiKey: "test-mode-api-key",
  authDomain: "test-mode-app.firebaseapp.example",
  projectId: "test-mode-project",
  storageBucket: "test-mode-app.appspot.example",
  messagingSenderId: "ci-environment-sender-id",
  appId: "test-mode-app-id",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || mockConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || mockConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || mockConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || mockConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || mockConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || mockConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Validate critical config (only warn if we fell back to mock)
if (!import.meta.env.VITE_FIREBASE_API_KEY) {
  console.warn('Firebase configuration warning: Missing VITE_FIREBASE_API_KEY. Using mock configuration.');
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
