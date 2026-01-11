import React, { useState, ReactNode } from 'react';
import { User, IdTokenResult } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

// Define a safe mock user that satisfies the User interface without using 'any'
// We implement the critical methods and properties needed for the UI
const createMockUser = (): User => {
  const now = new Date().toISOString();

  return {
    uid: 'test-user-id',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://ui-avatars.com/api/?name=Test+User',
    emailVerified: true,
    isAnonymous: false,
    metadata: {
      creationTime: now,
      lastSignInTime: now,
    },
    providerData: [],
    refreshToken: 'mock-refresh-token',
    tenantId: null,
    phoneNumber: null,
    providerId: 'firebase',

    // Implement required methods with mock behavior
    delete: async () => Promise.resolve(),
    getIdToken: async () => Promise.resolve('mock-token'),
    getIdTokenResult: async () => Promise.resolve({
      token: 'mock-token',
      expirationTime: new Date(Date.now() + 3600000).toISOString(),
      authTime: now,
      issuedAtTime: now,
      signInProvider: 'google.com',
      signInSecondFactor: null,
      claims: {}
    } as IdTokenResult),
    reload: async () => Promise.resolve(),
    toJSON: () => ({}),
  } as unknown as User; // We still need a cast because User has many internal/private properties
};

// Create context matching the real AuthContext
// We'll export this to use in the provider, but the hook will consume the REAL AuthContext
// This is a bit of a trick: The Provider is what matters. The hook `useAuth` in components
// pulls from the Context object.
// Wait - `useAuth` imports `AuthContext` from `@/contexts/AuthContext`.
// So we must use THAT context object to provide value.
// We cannot create a NEW context object here. We must import the existing one.
import { AuthContext } from './AuthContext';

export const MockAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(createMockUser());
  const [householdId, setHouseholdIdState] = useState<string | null>('test-household-id');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const signOut = async () => {
    // Clear auth state before navigation
    setUser(null);
    setHouseholdIdState(null);

    // Clear test mode flags
    sessionStorage.removeItem('JULES_TEST_MODE');

    // Navigate to login using React Router
    navigate('/login');

    // Force a reload after navigation to ensure clean state for the next session
    // This mimics the behavior of a full sign-out
    window.location.reload();
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
