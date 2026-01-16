
import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { FirebaseHouseholdProvider } from './contexts/FirebaseHouseholdContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import HouseholdSetup from './pages/HouseholdSetup';
import Dashboard from './pages/Dashboard';
import Budget from './pages/Budget';
import Habits from './pages/Habits';
import Settings from './pages/Settings';
import MigrateSubmissions from './pages/MigrateSubmissions';
import MealsPage from './pages/MealsPage';
import ShoppingPage from './pages/ShoppingPage';
import ToDosPage from './pages/ToDosPage';
import { setupForegroundNotificationListener } from './services/notificationService';

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
    if (notificationPermission === 'granted') {
      const unsubscribe = setupForegroundNotificationListener();
      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }
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
