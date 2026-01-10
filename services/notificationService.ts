import { getToken } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
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
          // Note: We use arrayUnion which automatically prevents exact duplicate tokens.
          // Token refresh is handled by Firebase - when a token is refreshed, the old token
          // becomes invalid automatically on Firebase's side. The client will get a new token
          // on the next requestNotificationPermission (or other getToken) call.
          // For more advanced scenarios (multiple devices, token cleanup), consider periodically
          // re-calling getToken and storing tokens with metadata (device ID, timestamp) in a map
          // structure instead of an array, and removing tokens that are no longer valid.
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
