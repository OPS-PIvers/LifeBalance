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

// Mock Lazy Loaded Pages
vi.mock('./pages/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard Page</div>,
}));

vi.mock('./pages/Login', () => ({
  default: () => <div data-testid="login-page">Login Page</div>,
}));

vi.mock('./pages/HouseholdSetup', () => ({
  default: () => <div data-testid="setup-page">Setup Page</div>,
}));

vi.mock('./pages/Budget', () => ({
  default: () => <div data-testid="budget-page">Budget Page</div>
}));

vi.mock('./pages/Habits', () => ({
  default: () => <div data-testid="habits-page">Habits Page</div>
}));

vi.mock('./pages/MealsPage', () => ({
  default: () => <div data-testid="meals-page">Meals Page</div>
}));

vi.mock('./pages/ShoppingPage', () => ({
  default: () => <div data-testid="shopping-page">Shopping Page</div>
}));

vi.mock('./pages/ToDosPage', () => ({
  default: () => <div data-testid="todos-page">ToDos Page</div>
}));

vi.mock('./pages/ListsPage', () => ({
  default: () => <div data-testid="lists-page">Lists Page</div>
}));

vi.mock('./pages/Settings', () => ({
  default: () => <div data-testid="settings-page">Settings Page</div>
}));

vi.mock('./pages/MigrateSubmissions', () => ({
  default: () => <div data-testid="migrate-page">Migrate Page</div>
}));

// Mock Layout
vi.mock('./components/layout/MainLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="main-layout">{children}</div>,
}));

// Mock notification service
vi.mock('./services/notificationService', () => ({
  setupForegroundNotificationListener: vi.fn(() => vi.fn()),
}));

describe('App Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = ''; // Reset router state
  });

  const mockAuthenticatedUser = {
    user: { uid: 'test-user', email: 'test@example.com' } as unknown as import('firebase/auth').User,
    currentUser: { uid: 'test-user', email: 'test@example.com' } as unknown as import('firebase/auth').User,
    householdId: 'test-household',
    loading: false,
    signOut: vi.fn(),
    logout: vi.fn(),
    setHouseholdId: vi.fn(),
    accessDeniedEmail: null as string | null,
    clearAccessError: vi.fn(),
  };

  it('renders Dashboard at root path /', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());
  });

  it('redirects to Login when unauthenticated', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      ...mockAuthenticatedUser,
      user: null,
      currentUser: null,
      householdId: null,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
  });

  it('redirects to Setup when authenticated but no household', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      ...mockAuthenticatedUser,
      householdId: null,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('setup-page')).toBeInTheDocument());
  });

  it('renders Budget page at /budget', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/budget';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('budget-page')).toBeInTheDocument());
  });

  it('renders Habits page at /habits', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/habits';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('habits-page')).toBeInTheDocument());
  });

  it('renders Meals page at /meals', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/meals';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('meals-page')).toBeInTheDocument());
  });

  it('renders Shopping page at /shopping', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/shopping';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('shopping-page')).toBeInTheDocument());
  });

  it('renders ToDos page at /todos', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/todos';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('todos-page')).toBeInTheDocument());
  });

  it('renders Lists page at /lists', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/lists';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('lists-page')).toBeInTheDocument());
  });

  it('renders Settings page at /settings', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/settings';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('settings-page')).toBeInTheDocument());
  });

  it('renders Migrate page at /migrate-submissions', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/migrate-submissions';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('migrate-page')).toBeInTheDocument());
  });

  it('redirects unknown routes to Dashboard', async () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue(mockAuthenticatedUser);
    window.location.hash = '#/unknown-route-123';
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());
  });
});
