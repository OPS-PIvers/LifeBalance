import React, { Suspense, lazy, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';

// Lazy so the kid view (Plan 080b) stays out of the always-mounted boot bundle —
// it only loads when a parent actually switches into a kid.
const KidDashboard = lazy(() => import('@/components/kid/KidDashboard'));

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { pathname } = useLocation();
  const { members, activeMemberId, isLoading } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();

  // Active managed kid → Kid Mode. Validated against the live members list so a
  // stale sessionStorage value (e.g. a removed kid, or the flag turned off) falls
  // straight back to the normal parent shell.
  const activeKid = useMemo(
    () =>
      kidModeEnabled && activeMemberId
        ? members.find((m) => m.uid === activeMemberId && m.isManaged === true)
        : undefined,
    [kidModeEnabled, activeMemberId, members],
  );

  // On refresh while acting as a kid, the members listener hasn't resolved yet, so
  // `activeKid` is transiently undefined. Without this guard we would briefly render
  // the parent shell (finance headers, nav, routed parent page) before the kid view
  // mounts — a privacy leak that defeats the sessionStorage persistence. Hold the
  // loading fallback whenever we intend to be in Kid Mode but are still loading.
  if (kidModeEnabled && activeMemberId && !activeKid && isLoading) {
    return <div className="h-dvh bg-warm-50 dark:bg-brand-900" />;
  }

  // Kid Mode replaces the ENTIRE parent shell (toolbar + routed page + bottom-nav)
  // with the scoped kid surface, so finance/settings/other-member data is
  // structurally absent rather than merely hidden. Its own ErrorBoundary keeps a
  // crash in the kid view from taking down the rest of the app.
  if (activeKid) {
    return (
      <ErrorBoundary key="kid-dashboard">
        <Suspense fallback={<div className="h-dvh bg-warm-50 dark:bg-brand-900" />}>
          <KidDashboard />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-brand-50 dark:bg-brand-900 transition-colors">
      <div className="flex-none">
        <TopToolbar />
      </div>

      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth w-full">
        <div className="pb-8">
          {/* key=pathname resets the boundary on navigation so a crashed page
              does not stay crashed after the user navigates away */}
          <ErrorBoundary key={pathname}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <div className="flex-none z-20">
        <BottomNav />
      </div>
    </div>
  );
};

export default MainLayout;
