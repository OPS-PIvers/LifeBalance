import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

interface ModuleRouteProps {
  /** The module/sub-tab this route belongs to. */
  module: ModuleKey;
  children: ReactNode;
}

/**
 * Plan 090 (Modular pages) — route guard that redirects a disabled page to Home.
 *
 * Handles deep links, bookmarks, and stale PWA shortcuts to a page the household
 * has turned off. Must be rendered INSIDE the household provider (i.e. inside
 * ProtectedRoute + MainLayout) so it can read live module visibility.
 *
 * Fail-open: during cold load the settings are absent, so `useModuleVisibility`
 * reports the module enabled and the children render unchanged — intended.
 */
const ModuleRoute: React.FC<ModuleRouteProps> = ({ module, children }) => {
  const v = useModuleVisibility();
  const ok =
    module === 'plan'
      ? v.isPlanVisible
      : module === 'todos' || module === 'meals' || module === 'shopping'
        ? v.isPlanTabVisible(module)
        : v.isModuleEnabled(module);

  return ok ? <>{children}</> : <Navigate to="/" replace />;
};

export default ModuleRoute;
