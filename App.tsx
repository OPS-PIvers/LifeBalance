
import React, { useEffect, useState, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { FirebaseHouseholdProvider } from './contexts/FirebaseHouseholdContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import ModuleRoute from './components/auth/ModuleRoute';
import MainLayout from './components/layout/MainLayout';
import OfflineBanner from './components/layout/OfflineBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { ConfirmDialogHost } from './components/ui/ConfirmDialogHost';
import { ToastLimiter } from './components/ui/ToastLimiter';

// Lazy load pages for code splitting and faster initial load
const Login = React.lazy(() => import('./pages/Login'));
const PrivacyPolicy = React.lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('./pages/TermsOfService'));
const HouseholdSetup = React.lazy(() => import('./pages/HouseholdSetup'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Budget = React.lazy(() => import('./pages/Budget'));
const Habits = React.lazy(() => import('./pages/Habits'));
const Settings = React.lazy(() => import('./pages/Settings'));
const MigrateSubmissions = React.lazy(() => import('./pages/MigrateSubmissions'));
const OnboardingWizard = React.lazy(() => import('./components/onboarding/OnboardingWizard'));
const MealsPage = React.lazy(() => import('./pages/MealsPage'));
const ShoppingPage = React.lazy(() => import('./pages/ShoppingPage'));
const ToDosPage = React.lazy(() => import('./pages/ToDosPage'));
const ListsPage = React.lazy(() => import('./pages/ListsPage'));

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
        .then(({ setupForegroundNotificationListener }) =>
          setupForegroundNotificationListener(),
        )
        .then((cleanup) => {
          if (isMounted) {
            cleanupFn = cleanup;
          } else {
            // Effect was cleaned up before the listener resolved; tear it down now.
            cleanup?.();
          }
        })
        .catch((error) => {
          console.error('[App] Failed to load notification service:', error);
          toast.error('Failed to enable notifications. Please reload the page.');
        });
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
  const [MockProviders, setMockProviders] = React.useState<{
    Auth: React.ComponentType<{ children: React.ReactNode }>;
    Household: React.ComponentType<{ children: React.ReactNode }>;
  } | null>(null);

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
      <ThemeProvider>
      <AuthProviderComponent>
        <HouseholdProviderComponent>
          <div className="min-h-screen bg-brand-50 dark:bg-brand-900 font-sans text-brand-800 dark:text-brand-100 transition-colors">
            {isTestMode && (
              <div className="bg-warm-600 text-white text-xs font-bold text-center px-2 py-1 fixed top-0 left-0 right-0 z-banner shadow-raised">
                🧪 TEST MODE - MOCK DATA (Development Only)
              </div>
            )}
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/setup" element={<HouseholdSetup />} />

                {/* First-run onboarding wizard — full-page (no MainLayout). Gated
                    to new creators: ProtectedRoute sends users with no household to
                    /setup, and the wizard itself redirects to / once onboarding is
                    complete, so returning users never get stuck here. */}
                <Route
                  path="/onboarding"
                  element={
                    <ProtectedRoute>
                      <ErrorBoundary>
                        <OnboardingWizard />
                      </ErrorBoundary>
                    </ProtectedRoute>
                  }
                />

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
                  path="/lists"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="plan">
                          <ListsPage />
                        </ModuleRoute>
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/budget"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="money">
                          <Budget />
                        </ModuleRoute>
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/habits"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="habits">
                          <Habits />
                        </ModuleRoute>
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/meals"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="meals">
                          <MealsPage />
                        </ModuleRoute>
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/shopping"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="shopping">
                          <ShoppingPage />
                        </ModuleRoute>
                      </MainLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/todos"
                  element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ModuleRoute module="todos">
                          <ToDosPage />
                        </ModuleRoute>
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

            {/* react-hot-toast announces each toast via its own per-toast aria-live
                region (default role="status", aria-live="polite"), so no outer
                wrapper is needed — an extra region with aria-atomic would re-announce
                every active toast on each new one. */}
            <Toaster
              position="top-center"
              containerClassName="z-toast"
              containerStyle={{
                top: 'calc(env(safe-area-inset-top) + 1rem)',
              }}
              toastOptions={{
                className: 'bg-brand-800 text-white font-medium rounded-btn shadow-raised',
                success: {
                  iconTheme: {
                    // Evergreen accent-600, the app's primary action color.
                    primary: '#285742',
                    secondary: 'white',
                  },
                },
              }}
            />
            <ToastLimiter />
            <ConfirmDialogHost />
            <OfflineBanner />
          </div>
        </HouseholdProviderComponent>
      </AuthProviderComponent>
      </ThemeProvider>
    </HashRouter>
  );
};

export default App;
