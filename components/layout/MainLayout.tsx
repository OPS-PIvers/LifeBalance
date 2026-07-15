import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';
import ErrorBoundary from '@/components/ErrorBoundary';
import { LazyMount } from '@/components/ui/LazyMount';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import { useHouseholdCore, useFinance } from '@/contexts/FirebaseHouseholdContext';
import { isReviewSnoozed } from '@/hooks/useActionQueue';
import { useAppReopen } from '@/hooks/useAppReopen';
import { getLocalDateString } from '@/utils/dateHelpers';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { useKeyboardViewportAnchor } from '@/hooks/useKeyboardViewportAnchor';
import { useNotificationActionIntent } from '@/hooks/useNotificationActionIntent';

// Lazy so the kid view (Plan 080b) stays out of the always-mounted boot bundle —
// it only loads when a parent actually switches into a kid.
const KidDashboard = lazy(() => import('@/components/kid/KidDashboard'));

// Lazy (+ idle preload) so the Drawer/framer-motion stay out of the boot bundle.
// Surfaced on app-open whenever any un-snoozed pending_review transactions exist.
const loadReviewPendingDrawer = () => import('@/components/modals/ReviewPendingDrawer');
const ReviewPendingDrawer = lazy(loadReviewPendingDrawer);

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { pathname } = useLocation();
  const { members, activeMemberId, isLoading, householdId } = useHouseholdCore();
  const { transactions } = useFinance();
  const kidModeEnabled = useKidModeEnabled(householdId);
  // Keeps the header and fixed overlays (toasts) anchored when the iOS
  // keyboard pans the window; the ref scopes it to in-page inputs (portal
  // Drawers/Modals keep WebKit's native pan). See the hook's doc comment.
  const { shellRef, isKeyboardAnchored } = useKeyboardViewportAnchor<HTMLDivElement>();

  // F-NOTIF-05: dispatch a bill-reminder push action-button tap (Pay bill /
  // Snooze) if the app was opened via one. Unconditional (above Kid-Mode early
  // returns) to satisfy rules-of-hooks.
  useNotificationActionIntent();

  // Every un-snoozed pending_review transaction is a review candidate. Ordered
  // newest-first (date desc) so the most recent activity is reviewed first.
  // Hooks are declared unconditionally (above the Kid-Mode early returns) to
  // satisfy rules-of-hooks; the drawer itself only renders in the normal shell.
  const reviewToday = getLocalDateString();
  const pendingReviewTransactions = useMemo(
    () =>
      transactions
        .filter((t) => t.status === 'pending_review' && !isReviewSnoozed(t, reviewToday))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [transactions, reviewToday],
  );
  // Once-per-app-open: snapshot the pending transactions and auto-open the
  // cycling review drawer.
  const [hasAutoOpenedReview, setHasAutoOpenedReview] = useState(false);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<typeof transactions>([]);

  useEffect(() => preloadOnIdle(loadReviewPendingDrawer), []);

  // On an installed PWA, "opening the app" is usually re-foregrounding a page
  // that has been alive for days — no remount, so the mount-time latch above
  // would fire only on a genuine page load. Re-arm it when the app returns to
  // the foreground after a real absence, so pending transactions that synced in
  // while backgrounded (e.g. a spouse's iOS-Shortcut purchase) auto-surface for
  // every household member. Skipped while the drawer is already open: the user
  // is mid-review, and re-snapshotting would reshuffle the cycle under them.
  // (useAppReopen tracks the latest callback in a ref, so a changed dep here
  // never re-subscribes the document listener.)
  useAppReopen(
    useCallback(() => {
      if (!reviewDrawerOpen) setHasAutoOpenedReview(false);
    }, [reviewDrawerOpen]),
  );

  // Active managed kid → Kid Mode. Validated against the live members list so a
  // stale sessionStorage value (e.g. a removed kid, or the flag turned off) falls
  // straight back to the normal parent shell. Declared ABOVE the auto-open guard
  // so the guard can exclude Kid-Mode renders (see below).
  const activeKid = useMemo(
    () =>
      kidModeEnabled && activeMemberId
        ? members.find((m) => m.uid === activeMemberId && m.isManaged === true)
        : undefined,
    [kidModeEnabled, activeMemberId, members],
  );

  // Decide the once-per-app-open trigger during render (guarded
  // set-state-during-render — the documented React pattern, same as LazyMount —
  // to avoid a setState-in-effect cascade). Unlike the old needsAmount-stub
  // flow, nothing is stamped on the docs: the drawer re-opens on EVERY app open
  // while any un-snoozed pending_review transactions remain. Excluding
  // `activeKid` keeps the flag from latching on a render destined for the
  // Kid-Mode early return (which never mounts the review drawer) — otherwise it
  // could be consumed without ever showing the drawer, or pop on Kid-Mode exit.
  if (!isLoading && !activeKid && !hasAutoOpenedReview && pendingReviewTransactions.length > 0) {
    setHasAutoOpenedReview(true);
    setReviewSnapshot(pendingReviewTransactions); // snapshot so the cycle is stable
    setReviewDrawerOpen(true);
  }

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
    <div
      ref={shellRef}
      // --app-height is set by useKeyboardViewportAnchor while the iOS
      // keyboard is open (visual viewport height); otherwise 100dvh as before.
      className="flex flex-col h-[var(--app-height,100dvh)] overflow-hidden bg-brand-50 dark:bg-brand-900 transition-colors"
    >
      <div className="flex-none">
        <TopToolbar />
      </div>

      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain relative scroll-smooth w-full">
        <div className="pb-8">
          {/* key=pathname resets the boundary on navigation so a crashed page
              does not stay crashed after the user navigates away */}
          <ErrorBoundary key={pathname}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      {/* Hidden while the keyboard has the shell anchored — a nav bar pinned
          directly above the keyboard reads as floating mid-screen. The freed
          space goes to the <main> scroller. */}
      <div className={`flex-none z-sticky ${isKeyboardAnchored ? 'hidden' : ''}`}>
        <BottomNav />
      </div>

      {/* Pending-transaction review cycler — lazy so Drawer/framer-motion stay
          out of the boot bundle. Opens once per app-open whenever any un-snoozed
          pending_review transactions exist. */}
      <LazyMount when={reviewDrawerOpen}>
        <ReviewPendingDrawer
          transactions={reviewSnapshot}
          isOpen={reviewDrawerOpen}
          onClose={() => setReviewDrawerOpen(false)}
        />
      </LazyMount>
    </div>
  );
};

export default MainLayout;
