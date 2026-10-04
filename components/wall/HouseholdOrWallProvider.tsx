import React, { Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Loading from '@/pages/Loading';

const WallDisplayRoot = React.lazy(() => import('./WallDisplayRoot'));

interface HouseholdOrWallProviderProps {
  /** The normal household provider (Firebase or Test Mode mock). */
  household: React.ComponentType<{ children: React.ReactNode }>;
  children: React.ReactNode;
}

/**
 * Plan §4.2: a paired display gets ONLY the wall, on its own data provider.
 * FirebaseHouseholdProvider must never mount for it: it attaches finance,
 * recap and notification listeners the display isn't allowed to read.
 * Everyone else gets the normal app, unchanged.
 */
const HouseholdOrWallProvider: React.FC<HouseholdOrWallProviderProps> = ({ household: Household, children }) => {
  const { isDisplay } = useAuth();
  const location = useLocation();
  if (isDisplay) {
    if (location.pathname !== '/wall') return <Navigate to="/wall" replace />;
    return (
      <Suspense fallback={<Loading />}>
        <WallDisplayRoot />
      </Suspense>
    );
  }
  return <Household>{children}</Household>;
};

export default HouseholdOrWallProvider;
