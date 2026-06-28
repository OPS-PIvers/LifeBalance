import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import type { Messaging } from 'firebase/messaging';
import type { Functions } from 'firebase/functions';

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

// Cloud Functions and Messaging are initialized LAZILY (dynamic import) so
// firebase/functions and firebase/messaging stay OFF the eager boot path and out
// of the always-loaded vendor-firebase chunk. They only load the first time a
// callable is invoked or notifications are set up. The instances are cached.

// undefined = getter not yet run; a Functions value once resolved.
let functionsInstance: Functions | undefined;
// In-flight init promise so concurrent boot-time callers (e.g. App.tsx and the
// household provider) share ONE dynamic import + getFunctions(app) instead of
// each kicking off their own. Once the instance resolves, the instance cache
// short-circuits and this promise is only ever live during the init window.
let functionsPromise: Promise<Functions> | null = null;

/**
 * Lazily initialize Cloud Functions (callable functions, e.g. deletehousehold),
 * caching the instance. Dynamically imports firebase/functions so it leaves the
 * eager boot bundle.
 */
export function getFunctionsInstance(): Promise<Functions> {
  if (functionsInstance) return Promise.resolve(functionsInstance);
  if (!functionsPromise) {
    functionsPromise = (async () => {
      const { getFunctions } = await import('firebase/functions');
      functionsInstance = getFunctions(app);
      return functionsInstance;
    })();
  }
  return functionsPromise;
}

// undefined = getter not yet run; null = unsupported / failed to init;
// a Messaging value once resolved successfully.
let messagingInstance: Messaging | null | undefined;
// In-flight init promise so concurrent callers share ONE init attempt. Like the
// instance cache, messaging init is single-shot: on failure we cache null
// permanently (matching the old module-init behavior — NOT retryable).
let messagingPromise: Promise<Messaging | null> | null = null;

/**
 * Lazily initialize Firebase Messaging, caching the instance. Returns null when
 * messaging is unavailable (SSR, tests, unsupported contexts) so callers can
 * no-op exactly as before. Dynamically imports firebase/messaging so it leaves
 * the eager boot bundle.
 */
export function getMessagingInstance(): Promise<Messaging | null> {
  if (messagingInstance !== undefined) return Promise.resolve(messagingInstance);
  if (typeof window === 'undefined') {
    messagingInstance = null;
    return Promise.resolve(messagingInstance);
  }
  if (!messagingPromise) {
    messagingPromise = (async () => {
      try {
        const { getMessaging } = await import('firebase/messaging');
        messagingInstance = getMessaging(app);
      } catch (e) {
        console.warn('Firebase Messaging failed to initialize', e);
        messagingInstance = null;
      }
      return messagingInstance;
    })();
  }
  return messagingPromise;
}

export const googleProvider = new GoogleAuthProvider();

// Configure Google provider
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export default app;
