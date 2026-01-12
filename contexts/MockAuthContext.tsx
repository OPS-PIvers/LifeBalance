import React, { useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

// Mock user implementation for testing
// This provides a realistic user object without requiring Firebase authentication
const createMockUser = (): User => {
  const now = new Date().toISOString();

  return {
    uid: 'test-user-id',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://ui-avatars.com/api/?name=Test+User&background=6366f1&color=fff',
    emailVerified: true,
    isAnonymous: false,
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    providerData: [{
      providerId: 'google.com',
      uid: 'test-user-id',
      displayName: 'Test User',
      email: 'test@example.com',
      phoneNumber: null,
      photoURL: 'https://ui-avatars.com/api/?name=Test+User&background=6366f1&color=fff',
    }],
    refreshToken: 'mock-refresh-token',
    tenantId: null,
    phoneNumber: null,
    providerId: 'firebase',

    // Required methods
    delete: async () => Promise.resolve(),
    getIdToken: async () => Promise.resolve('mock-id-token'),
    getIdTokenResult: async () => Promise.resolve({
      token: 'mock-id-token',
      expirationTime: new Date(Date.now() + 3600000).toISOString(),
      authTime: now,
      issuedAtTime: now,
      signInProvider: 'google.com',
      signInSecondFactor: null,
      claims: { email: 'test@example.com' }
    } as any),
    reload: async () => Promise.resolve(),
    toJSON: () => ({ uid: 'test-user-id', email: 'test@example.com' }),
  } as User;
};

// Import the real AuthContext to provide values to it
import { AuthContext } from './AuthContext';

export const MockAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user] = useState<User | null>(createMockUser());
  const [householdId, setHouseholdIdState] = useState<string | null>('test-household-id');
  const [loading] = useState(false);
  const navigate = useNavigate();

  const signOut = async () => {
    // Clear test mode flag
    sessionStorage.removeItem('LIFEBALANCE_TEST_MODE');

    // Navigate to login
    navigate('/login', { replace: true });
  };

  const setHouseholdId = (id: string) => {
    setHouseholdIdState(id);
  };

  return (
    <AuthContext.Provider value={{
      user,
      currentUser: user,
      householdId,
      loading,
      signOut,
      logout: signOut,
      setHouseholdId
    }}>
      {children}
    </AuthContext.Provider>
  );
};
