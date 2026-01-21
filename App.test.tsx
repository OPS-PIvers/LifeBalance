import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import * as AuthContext from './contexts/AuthContext';

// Mock the contexts
vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: vi.fn(),
}));

vi.mock('./contexts/FirebaseHouseholdContext', () => ({
  FirebaseHouseholdProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  Toaster: () => <div data-testid="toaster" />,
  toast: { error: vi.fn(), success: vi.fn() },
  default: { error: vi.fn(), success: vi.fn() },
}));

// Mock Lazy Loaded Pages to avoid full render and focus on routing
vi.mock('./pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));

vi.mock('./pages/Login', () => ({
  default: () => <div data-testid="login-page">Login Page</div>,
}));

vi.mock('./pages/HouseholdSetup', () => ({
  default: () => <div data-testid="setup-page">Setup Page</div>,
}));

// Mock Layout
vi.mock('./components/layout/MainLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="main-layout">{children}</div>,
}));

// Mock notification service
vi.mock('./services/notificationService', () => ({
  setupForegroundNotificationListener: vi.fn(() => vi.fn()),
}));

describe('App Smoke Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = ''; // Reset router state
  });

  it('renders Dashboard when authenticated and has household', async () => {
    // Mock authenticated user with household
    const mockUser = { uid: 'test-user', email: 'test@example.com' };
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: mockUser as unknown as import('firebase/auth').User,
      currentUser: mockUser as unknown as import('firebase/auth').User,
      householdId: 'test-household',
      loading: false,
      signOut: vi.fn(),
      logout: vi.fn(),
      setHouseholdId: vi.fn(),
    });

    render(<App />);

    // Expect to see the dashboard (wrapped in layout)
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
  });

  it('redirects to Login when unauthenticated', async () => {
    // Mock unauthenticated user
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: null,
      currentUser: null,
      householdId: null,
      loading: false,
      signOut: vi.fn(),
      logout: vi.fn(),
      setHouseholdId: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
  });

  it('redirects to Setup when authenticated but no household', async () => {
    // Mock authenticated user but NO household
    const mockUser = { uid: 'test-user' };
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: mockUser as unknown as import('firebase/auth').User,
      currentUser: mockUser as unknown as import('firebase/auth').User,
      householdId: null,
      loading: false,
      signOut: vi.fn(),
      logout: vi.fn(),
      setHouseholdId: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeInTheDocument();
    });
  });
});
