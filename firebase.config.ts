import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
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

// Firebase Hosting serves the Google sign-in helper (/__/auth/*) on every
// hosting domain of the project. When the app is served from one of those
// domains, use the page's own host as authDomain so the helper is same-origin
// with the app. With the default <project>.firebaseapp.com authDomain the
// helper runs on a *different site* than <project>.web.app, and browsers that
// partition third-party storage (iOS Safari, installed PWAs) lose the helper's
// sessionStorage mid-flow, failing sign-in with "missing initial state".
// See https://firebase.google.com/docs/auth/web/redirect-best-practices
//
// Deliberately an explicit suffix allowlist rather than "any production
// host": on a non-Firebase-Hosting deploy the /__/auth/* helper wouldn't
// exist on the page's own host, and using it as authDomain would break
// sign-in entirely. If a custom domain is ever connected to Firebase
// Hosting, add its suffix here (Hosting serves the helper there too).
const isFirebaseHostingOrigin =
  typeof window !== 'undefined' &&
  (window.location.hostname.endsWith('.web.app') ||
    window.location.hostname.endsWith('.firebaseapp.com'));

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || mockConfig.apiKey,
  authDomain: isFirebaseHostingOrigin
    ? window.location.hostname
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || mockConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || mockConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || mockConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || mockConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || mockConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Validate critical config
const isProd = import.meta.env.PROD;
const isUsingMockConfig = firebaseConfig.apiKey === mockConfig.apiKey;
const isApiKeyMissing = !import.meta.env.VITE_FIREBASE_API_KEY;

if (isApiKeyMissing) {
  const msg = 'Firebase configuration warning: Missing VITE_FIREBASE_API_KEY. Using mock configuration.';
  if (isProd) {
    console.error(msg);
    // Hard failure in production if API key is missing
    throw new Error('Firebase configuration error: Missing Firebase API Key in production environment.');
  } else {
    console.warn(msg);
  }
} else if (isUsingMockConfig && isProd) {
  // Edge case: env var exists but equals the mock value (unlikely but possible via some config injection)
  console.error('Firebase configuration error: Using mock configuration in production.');
  throw new Error('Firebase configuration error: Using mock configuration in production.');
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);

// Enable Firestore offline persistence (IndexedDB) with multi-tab support.
// Falls back to plain getFirestore if IndexedDB is unavailable (SSR, private
// browsing, some CI environments) so the app never hard-crashes.
function initFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('Firestore persistence unavailable, falling back to default cache.', e);
    return getFirestore(app);
  }
}
export const db = initFirestore();

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
