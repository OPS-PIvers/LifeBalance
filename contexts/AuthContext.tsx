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
  // Email of the account that was just denied by the Private Alpha guard,
  // so the login screen can prompt the user to try a different account.
  accessDeniedEmail: string | null;
  clearAccessError: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDeniedEmail, setAccessDeniedEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Resolve the user's household first. Membership is also used as an
        // authorization signal by the Private Alpha guard below: existing
        // household members must never be locked out by the beta allowlist.
        let hid: string | null = null;
        try {
          hid = await getUserHousehold(firebaseUser.uid);
        } catch (error) {
          console.error('Error fetching household:', error);
        }

        // --- Private Alpha Guard ---
        const adminUid = import.meta.env.VITE_ADMIN_UID;
        // Only enforce check if admin UID is set (production/staging)
        // If VITE_ADMIN_UID is not set (dev), we skip this check to avoid locking out developers
        // Members of an existing household are always allowed (e.g. a household
        // owner invited them), so the beta allowlist only gates brand-new users.
        if (adminUid && firebaseUser.uid !== adminUid && !hid) {
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
              setAccessDeniedEmail(firebaseUser.email);
              setLoading(false);
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

        setAccessDeniedEmail(null);
        setHouseholdIdState(hid);
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

  const clearAccessError = () => {
    setAccessDeniedEmail(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      currentUser: user, // Provide alias
      householdId,
      loading,
      signOut,
      logout: signOut, // Provide alias
      setHouseholdId,
      accessDeniedEmail,
      clearAccessError
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
