
import React, { useEffect, useState, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { FirebaseHouseholdProvider } from './contexts/FirebaseHouseholdContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';

// Lazy load pages for code splitting and faster initial load
const Login = React.lazy(() => import('./pages/Login'));
const HouseholdSetup = React.lazy(() => import('./pages/HouseholdSetup'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Budget = React.lazy(() => import('./pages/Budget'));
const Habits = React.lazy(() => import('./pages/Habits'));
const Settings = React.lazy(() => import('./pages/Settings'));
const MigrateSubmissions = React.lazy(() => import('./pages/MigrateSubmissions'));
const MealsPage = React.lazy(() => import('./pages/MealsPage'));
const ShoppingPage = React.lazy(() => import('./pages/ShoppingPage'));
const ToDosPage = React.lazy(() => import('./pages/ToDosPage'));

const LoadingFallback = () => (
  <div className="min-h-screen bg-brand-50 flex items-center justify-center">
    <div className="text-brand-600 font-medium">Loading...</div>
  </div>
);

const App: React.FC = () => {
  // Track notification permission state to react to changes
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );

  // Listen for permission changes (triggered by Settings.tsx via custom event)
  useEffect(() => {
    const handlePermissionChange = () => {
      if ('Notification' in window) {
        setNotificationPermission(Notification.permission);
      }
    };

    window.addEventListener('notification-permission-changed', handlePermissionChange);
    return () => {
      window.removeEventListener('notification-permission-changed', handlePermissionChange);
    };
  }, []);

  // Set up foreground notification listener when permission is granted
  // Background notifications on iOS 16.4+ are handled by the service worker's push event
  useEffect(() => {
    let cleanupFn: (() => void) | null = null;
    let isMounted = true;

    if (notificationPermission === 'granted') {
      // Dynamic import ensures notification service (and heavy Firebase Messaging)
      // is only loaded when actually needed/authorized.
      import('./services/notificationService')
        .then(({ setupForegroundNotificationListener }) => {
          if (isMounted) {
            cleanupFn = setupForegroundNotificationListener();
          }
        })
        .catch(console.error);
    }

    return () => {
      isMounted = false;
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, [notificationPermission]);

  // Test mode check - only available in development with explicit flag
  // This is ONLY checked at render time, not stored anywhere
  const isTestMode = import.meta.env.DEV &&
                     import.meta.env.VITE_ENABLE_TEST_MODE === 'true' &&
                     sessionStorage.getItem('LIFEBALANCE_TEST_MODE') === 'true';

  // Dynamically load mock providers only when needed (tree-shaken in production)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [MockProviders, setMockProviders] = React.useState<any>(null);

  React.useEffect(() => {
    if (isTestMode && !MockProviders) {
      // Dynamic import ensures mock code is excluded from production bundle
      Promise.all([
        import('./contexts/MockAuthContext'),
        import('./contexts/MockHouseholdContext')
      ]).then(([authModule, householdModule]) => {
        setMockProviders({
          Auth: authModule.MockAuthProvider,
          Household: householdModule.MockHouseholdProvider
        });
      });
    }
  }, [isTestMode, MockProviders]);

  // Choose providers based on test mode
  const AuthProviderComponent = (isTestMode && MockProviders) ? MockProviders.Auth : AuthProvider;
  const HouseholdProviderComponent = (isTestMode && MockProviders) ? MockProviders.Household : FirebaseHouseholdProvider;

  // If test mode is active but providers aren't loaded yet, show loading state
  if (isTestMode && !MockProviders) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center">
        <div className="text-brand-600 font-medium">Loading test mode...</div>
      </div>
    );
  }

  return (
    <HashRouter>
      <AuthProviderComponent>
        <HouseholdProviderComponent>
          <div className="min-h-screen bg-brand-50 font-sans text-brand-800">
            {isTestMode && (
              <div className="bg-orange-600 text-white text-xs font-bold text-center px-2 py-1 fixed top-0 left-0 right-0 z-[9999] shadow-lg">
                🧪 TEST MODE - MOCK DATA (Development Only)
              </div>
            )}
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/setup" element={<HouseholdSetup />} />

                {/* Protected Routes */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Dashboard />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/budget"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Budget />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/habits"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Habits />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/meals"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <MealsPage />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/shopping"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ShoppingPage />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/todos"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ToDosPage />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Settings />
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/migrate-submissions"
                  element={
                    <ProtectedRoute>
                      <MigrateSubmissions />
                    </ProtectedRoute>
                  }
                />

                {/* Catch all - redirect to home */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>

            <Toaster
              position="top-center"
              containerStyle={{
                top: 'calc(env(safe-area-inset-top) + 1rem)',
                zIndex: 99999,
              }}
              toastOptions={{
                className: 'bg-brand-800 text-white font-medium rounded-lg shadow-lg',
                success: {
                  iconTheme: {
                    primary: '#10B981',
                    secondary: 'white',
                  },
                },
              }}
            />
          </div>
        </HouseholdProviderComponent>
      </AuthProviderComponent>
    </HashRouter>
  );
};

export default App;
