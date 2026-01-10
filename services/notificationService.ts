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

      // Get service worker registration if available to prevent conflicts
      let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
      if ('serviceWorker' in navigator) {
        try {
          // Look for existing registration at /sw.js (standard PWA SW) or root
          const registration = await navigator.serviceWorker.getRegistration('/sw.js');
          if (registration) {
            serviceWorkerRegistration = registration;
          }
        } catch (e) {
          console.warn('Failed to get service worker registration', e);
        }
      }

      let token;
      try {
        token = await getToken(messaging, {
          vapidKey,
          ...(serviceWorkerRegistration ? { serviceWorkerRegistration } : {})
        });
      } catch (tokenError) {
        console.error('Error fetching FCM token:', tokenError);
        toast.error('Failed to connect to push service.');
        return false;
      }

      if (token) {
        // Save token to user's member profile in the household
        const memberRef = doc(db, `households/${householdId}/members/${userId}`);
        await updateDoc(memberRef, {
          fcmTokens: arrayUnion(token)
        });
        toast.success('Notifications enabled!');
        return true;
      } else {
        console.error('No registration token available.');
        toast.error('Failed to get notification token.');
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
