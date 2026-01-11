import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from 'firebase/auth';

// Define a simplified User type that matches what Firebase provides but is constructible
// We cast it to User to satisfy the context interface
const MOCK_USER: any = {
  uid: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  photoURL: 'https://ui-avatars.com/api/?name=Test+User',
  emailVerified: true,
  isAnonymous: false,
  metadata: {
    creationTime: new Date().toISOString(),
    lastSignInTime: new Date().toISOString(),
  },
  providerData: [],
  refreshToken: '',
  tenantId: null,
  delete: async () => {},
  getIdToken: async () => 'mock-token',
  getIdTokenResult: async () => ({
    token: 'mock-token',
    expirationTime: new Date(Date.now() + 3600000).toISOString(),
    authTime: new Date().toISOString(),
    issuedAtTime: new Date().toISOString(),
    signInProvider: 'google.com',
    signInSecondFactor: null,
    claims: {}
  }),
  reload: async () => {},
  toJSON: () => ({}),
  phoneNumber: null,
  providerId: 'firebase',
};

// We need to match the AuthContextType from AuthContext.tsx exactly
interface AuthContextType {
  user: User | null;
  householdId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setHouseholdId: (id: string) => void;
}

// Create context matching the real AuthContext
// We'll export this to use in the provider, but the hook will consume the REAL AuthContext
// This is a bit of a trick: The Provider is what matters. The hook `useAuth` in components
// pulls from the Context object.
// Wait - `useAuth` imports `AuthContext` from `@/contexts/AuthContext`.
// So we must use THAT context object to provide value.
// We cannot create a NEW context object here. We must import the existing one.
import { AuthContext } from './AuthContext';

export const MockAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(MOCK_USER as User);
  const [householdId, setHouseholdIdState] = useState<string | null>('test-household-id');
  const [loading, setLoading] = useState(false);

  const signOut = async () => {
    localStorage.removeItem('JULES_TEST_MODE');
    window.location.href = '/';
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
