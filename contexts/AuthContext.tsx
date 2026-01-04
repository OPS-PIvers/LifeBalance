import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/firebase.config';
import { getUserHousehold } from '@/services/householdService';
import { signOut as authServiceSignOut } from '@/services/authService';

interface AuthContextType {
  user: User | null;
  householdId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
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
    <AuthContext.Provider value={{ user, householdId, loading, signOut, setHouseholdId }}>
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
