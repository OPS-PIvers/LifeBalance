import { getToken } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { messaging, db, auth } from '@/firebase.config';
import toast from 'react-hot-toast';

export const requestNotificationPermission = async (
  householdId: string,
  userId: string
): Promise<boolean> => {
  try {
    if (!('Notification' in window)) {
      toast.error('This browser does not support notifications.');
      return false;
    }

    if (!messaging) {
      console.warn('Firebase Messaging not initialized.');
      toast.error('Notifications not supported on this device.');
      return false;
    }

    // Security check: Ensure authenticated user matches the userId being updated
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== userId) {
      console.error('Security violation: Attempted to update tokens for another user.');
      toast.error('Unauthorized access.');
      return false;
    }

    // Validate that the user is actually a member of the specified household
    const memberRef = doc(db, `households/${householdId}/members/${userId}`);
    const memberDoc = await getDoc(memberRef);
    
    if (!memberDoc.exists()) {
      console.error('Security violation: User is not a member of the specified household.');
      toast.error('You are not a member of this household.');
      return false;
    }

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        console.warn('VITE_FIREBASE_VAPID_KEY is missing in environment variables. Notifications may not work.');
        toast.error('Configuration error: Missing VAPID key');
        return false;
      }

      // Get FCM token using the existing service worker at /sw.js
      // The service worker was registered on app load in index.html
      let token;
      try {
        // Ensure service workers are supported and retrieve the existing registration
        if (!('serviceWorker' in navigator)) {
          console.error('Service workers are not supported in this browser.');
          toast.error('Push notifications are not supported in this browser.');
          return false;
        }

        const registration = await navigator.serviceWorker.getRegistration('/sw.js');

        if (!registration) {
          console.error('Service worker at /sw.js is not registered.');
          toast.error('Notifications are not available because the service worker is not ready.');
          return false;
        }

        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration
        });
      } catch (tokenError: any) {
        console.error('Error fetching FCM token:', tokenError);
        
        // Provide specific error messages based on failure type
        if (tokenError.code === 'messaging/permission-blocked') {
          toast.error('Notification permission blocked. Please enable in browser settings.');
        } else if (tokenError.code === 'messaging/unsupported-browser') {
          toast.error('Push notifications are not supported in this browser.');
        } else if (tokenError.code === 'messaging/failed-service-worker-registration') {
          toast.error('Service worker registration failed. Try refreshing the page.');
        } else if (tokenError.message?.includes('VAPID')) {
          toast.error('Configuration error: Invalid VAPID key.');
        } else {
          toast.error('Failed to connect to push service. Check your internet connection.');
        }
        return false;
      }

      if (token) {
        // Save token to user's member profile in the household
        const memberRef = doc(db, `households/${householdId}/members/${userId}`);
        
        try {
          // IMPORTANT: arrayUnion prevents exact duplicates but DOES NOT remove stale tokens.
          // Over time, this array will accumulate invalid tokens from:
          // - Tokens refreshed by Firebase (old tokens become invalid)
          // - Multiple devices accessing the same account
          // - Users clearing browser data or reinstalling
          //
          // RECOMMENDED SOLUTION for production:
          // 1. Store tokens as a map: { [tokenId]: { token, deviceId, timestamp, lastVerified } }
          // 2. Implement a backend Cloud Function to periodically validate tokens via FCM API
          // 3. Remove tokens that return "NotRegistered" or "InvalidRegistration" errors
          // 4. On each new token registration, check if limit exceeded (e.g., >10 tokens) and clean old ones
          //
          // For MVP/small-scale use, arrayUnion is acceptable but expect delivery failures
          // to stale tokens (Firebase handles this gracefully with no user impact).
          await updateDoc(memberRef, {
            fcmTokens: arrayUnion(token)
          });
          toast.success('Notifications enabled!');
          return true;
        } catch (updateError) {
          console.error('Failed to save FCM token to user profile:', updateError);
          toast.error('Failed to save notification settings. Please try again.');
          return false;
        }
      } else {
        console.error('No registration token available. Possible causes: Service worker not registered, VAPID key mismatch, or browser incompatibility.');
        toast.error('Could not retrieve notification token. Service worker may not be ready.');
        return false;
      }
    } else {
      toast.error('Notification permission denied.');
      return false;
    }
  } catch (error) {
    console.error('An error occurred while retrieving token. ', error);
    toast.error('Error enabling notifications.');
    return false;
  }
};
