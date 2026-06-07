import React, { useEffect, useState } from 'react';

/**
 * OfflineBanner — shows a slim fixed banner when the user loses connectivity.
 *
 * Placement: fixed just above the BottomNav (bottom of viewport + BottomNav height).
 * This avoids overlapping the test-mode banner at the top and the BottomNav itself.
 * z-index uses z-dropdown (50) so it sits above page content but below modals/toasts.
 */
const OfflineBanner: React.FC = () => {
  // Guard against SSR / test environments where navigator may not exist
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Fixed just above the BottomNav: BottomNav is h-16 (4rem) + safe-area-inset-bottom
      // motion-safe: use a subtle slide-up; motion-reduce: no animation
      className={[
        'fixed left-0 right-0 z-dropdown',
        // Position above BottomNav
        'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]',
        // Visual style: amber warning, consistent with app palette
        'bg-amber-500 dark:bg-amber-600',
        'text-white text-xs font-semibold text-center',
        'px-4 py-2 shadow-lg',
        // No animation by default; keep it simple and motion-safe
      ].join(' ')}
    >
      You&rsquo;re offline — changes will sync when you reconnect.
    </div>
  );
};

export default OfflineBanner;
