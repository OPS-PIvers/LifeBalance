import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Loading from '@/pages/Loading';
import { isWallDevice } from '@/utils/wall/wallDevice';

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, householdId, loading } = useAuth();

  if (loading) {
    return <Loading />;
  }

  if (!user) {
    // A device set up as a wall display shows the pairing screen when it's
    // signed out (e.g. after a revoke), never Google sign-in.
    return <Navigate to={isWallDevice() ? '/wall/pair' : '/login'} replace />;
  }

  if (!householdId) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
