/* eslint-disable */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/firebase.config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getUserHousehold } from '@/services/householdService';
import { signOut as authServiceSignOut } from '@/services/authService';
import toast from 'react-hot-toast';

interface AuthContextType {
  user: User | null;
  currentUser: User | null; // Alias for user
  householdId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  logout: () => Promise<void>; // Alias for signOut
  setHouseholdId: (id: string) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // --- Private Alpha Guard ---
        const adminUid = import.meta.env.VITE_ADMIN_UID;
        // Only enforce check if admin UID is set (production/staging)
        // If VITE_ADMIN_UID is not set (dev), we skip this check to avoid locking out developers
        if (adminUid && firebaseUser.uid !== adminUid) {
          try {
            const testersRef = collection(db, 'beta_testers');
            const q = query(testersRef, where('email', '==', firebaseUser.email));
            const snapshot = await getDocs(q);

            let isAuthorized = false;
            if (!snapshot.empty) {
              const testerData = snapshot.docs[0].data();
              if (testerData.status === 'active') {
                isAuthorized = true;
              }
            }

            if (!isAuthorized) {
              console.warn(`User ${firebaseUser.email} denied access (Private Alpha)`);
              await authServiceSignOut();
              setUser(null);
              setHouseholdIdState(null);
              setLoading(false);
              toast.error("Private Alpha: Access Restricted");
              return;
            }
          } catch (error) {
            console.error("Beta verification failed:", error);
            // Fail closed for security
            await authServiceSignOut();
            setUser(null);
            setHouseholdIdState(null);
            setLoading(false);
            toast.error("Verification failed. Please try again.");
            return;
          }
        }
        // ---------------------------

        // Check if user has a household
        try {
          const hid = await getUserHousehold(firebaseUser.uid);
          setHouseholdIdState(hid);
        } catch (error) {
          console.error('Error fetching household:', error);
          setHouseholdIdState(null);
        }
      } else {
        setHouseholdIdState(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signOut = async () => {
    await authServiceSignOut();
    setHouseholdIdState(null);
  };

  const setHouseholdId = (id: string) => {
    setHouseholdIdState(id);
  };

  return (
    <AuthContext.Provider value={{
      user,
      currentUser: user, // Provide alias
      householdId,
      loading,
      signOut,
      logout: signOut, // Provide alias
      setHouseholdId
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
