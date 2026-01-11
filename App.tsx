
import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { FirebaseHouseholdProvider } from './contexts/FirebaseHouseholdContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import TopToolbar from './components/layout/TopToolbar';
import BottomNav from './components/layout/BottomNav';
import Login from './pages/Login';
import HouseholdSetup from './pages/HouseholdSetup';
import Dashboard from './pages/Dashboard';
import Budget from './pages/Budget';
import Habits from './pages/Habits';
import Settings from './pages/Settings';
import PlaceholderPage from './pages/PlaceholderPage';
import MigrateSubmissions from './pages/MigrateSubmissions';
import MealsPage from './pages/MealsPage';
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

  return (
    <HashRouter>
      <AuthProvider>
        <FirebaseHouseholdProvider>
          <div className="min-h-screen bg-brand-50 font-sans text-brand-800">
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/setup" element={<HouseholdSetup />} />

              {/* Protected Routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <Dashboard />
                      </main>
                      <BottomNav />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/budget"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <Budget />
                      </main>
                      <BottomNav />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/habits"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <Habits />
                      </main>
                      <BottomNav />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/meals"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <MealsPage />
                      </main>
                      <BottomNav />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/todos"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <ToDosPage />
                      </main>
                      <BottomNav />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <>
                      <TopToolbar />
                      <main>
                        <Settings />
                      </main>
                      <BottomNav />
                    </>
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
        </FirebaseHouseholdProvider>
      </AuthProvider>
    </HashRouter>
  );
};

export default App;
