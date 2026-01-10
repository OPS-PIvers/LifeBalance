import { getToken } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { messaging, db } from '@/firebase.config';
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

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
          console.warn('VITE_FIREBASE_VAPID_KEY is missing in environment variables. Notifications may not work.');
          toast.error('Configuration error: Missing VAPID key');
          return false;
      }

      const token = await getToken(messaging, {
        vapidKey: vapidKey
      });

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
