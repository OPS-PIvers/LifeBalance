import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useLandingRoute } from '@/hooks/useLandingRoute';

interface HomeRouteProps {
  children: ReactNode;
}

/**
 * 2F.2 (Home becomes toggleable) — route guard for `/`, mirroring `ModuleRoute`.
 *
 * Home has no household-level toggle (unlike Habits/Money/Lists), only the
 * member's own `hiddenKeys` — so a member can hide it like any other page,
 * which means `/` may point at nothing. This is what prevents that: once Home
 * is hidden for this member, redirect to `resolveLandingRoute`'s answer (the
 * member's chosen `homeScreen`, else the first still-enabled nav destination,
 * else `/settings`) instead of rendering the Dashboard nobody asked to see.
 *
 * Must be rendered INSIDE the household provider (i.e. inside ProtectedRoute +
 * MainLayout) so it can read live visibility, same as `ModuleRoute`.
 *
 * Fail-open: during cold load `isHomeVisible` reports true (no member yet), so
 * children render unchanged until the real answer is known.
 */
const HomeRoute: React.FC<HomeRouteProps> = ({ children }) => {
  const { isHomeVisible } = useModuleVisibility();
  const landingRoute = useLandingRoute();

  if (!isHomeVisible) {
    return <Navigate to={landingRoute} replace />;
  }

  return <>{children}</>;
};

export default HomeRoute;
