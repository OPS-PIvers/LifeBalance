import React, { Suspense, useState } from 'react';

interface LazyMountProps {
  /** Mounts children the first time this is true, then keeps them mounted. */
  when: boolean;
  children: React.ReactNode;
}

/**
 * Defers mounting `React.lazy` modal/drawer children until they are first
 * opened, so their chunk (and heavy deps like framer-motion) stays out of the
 * boot bundle. After the first open the children stay mounted, so the drawer's
 * exit animation still plays on close and re-opens are instant.
 *
 * While the chunk is loading on first open, a plain backdrop is shown so the
 * tap gives immediate feedback.
 */
export const LazyMount: React.FC<LazyMountProps> = ({ when, children }) => {
  // Latch: once opened, stay mounted. Guarded set-state-during-render is the
  // documented React pattern for deriving state from props without an effect.
  const [hasOpened, setHasOpened] = useState(when);
  if (when && !hasOpened) setHasOpened(true);
  if (!when && !hasOpened) return null;

  return (
    <Suspense
      fallback={
        when ? (
          <div
            className="fixed inset-0 z-modal bg-slate-900/40 backdrop-blur-sm"
            aria-hidden="true"
            data-testid="lazy-mount-fallback"
          />
        ) : null
      }
    >
      {children}
    </Suspense>
  );
};
