import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';
import ErrorBoundary from '@/components/ErrorBoundary';
import { LazyMount } from '@/components/ui/LazyMount';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import { useHouseholdCore, useFinance, useShopping, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { isReviewSnoozed, needsReview, useActionQueue } from '@/hooks/useActionQueue';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { buildReviewQueueSnapshot, type ReviewQueueItem } from '@/utils/reviewQueue';
import { useAppReopen } from '@/hooks/useAppReopen';
import { getLocalDateString } from '@/utils/dateHelpers';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { useKeyboardViewportAnchor } from '@/hooks/useKeyboardViewportAnchor';
import { InstallPwaBanner } from '@/components/ui/InstallPwaBanner';
import HabitLocationPromptBanner from '@/components/habits/HabitLocationPromptBanner';
import { useAppBadge } from '@/hooks/useAppBadge';
import { useNotificationActionIntent } from '@/hooks/useNotificationActionIntent';
import { subscribePayPeriodCeremony, type PayPeriodCeremonyEvent } from '@/utils/payPeriodCeremony';

// Lazy so the kid view (Plan 080b) stays out of the always-mounted boot bundle —
// it only loads when a parent actually switches into a kid.
const KidDashboard = lazy(() => import('@/components/kid/KidDashboard'));

// Lazy (+ idle preload) so the Drawer/framer-motion stay out of the boot bundle.
// Surfaced on app-open whenever any un-snoozed pending_review transactions exist.
const loadReviewPendingDrawer = () => import('@/components/modals/ReviewPendingDrawer');
const ReviewPendingDrawer = lazy(loadReviewPendingDrawer);

// Pay-period reset ceremony — lazy for the same reason. Opens on this device
// only, right after the member here confirms a paycheck that rolls the period.
const PayPeriodCeremonyDrawer = lazy(() => import('@/components/modals/PayPeriodCeremonyDrawer'));

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { pathname } = useLocation();
  const { members, activeMemberId, isLoading, householdId, householdSettings } = useHouseholdCore();
  const { transactions, buckets } = useFinance();
  const { shoppingAwaitingReview } = useShopping();
  const { todosAwaitingReview } = useTodos();
  const { isPlanTabVisible } = useModuleVisibility();
  const kidModeEnabled = useKidModeEnabled(householdId);
  // Keeps the header and fixed overlays (toasts) anchored when the iOS
  // keyboard pans the window; the ref scopes it to in-page inputs (portal
  // Drawers/Modals keep WebKit's native pan). See the hook's doc comment.
  const { shellRef, isKeyboardAnchored } = useKeyboardViewportAnchor<HTMLDivElement>();

  // F-NOTIF-07: mirror the Action Queue count onto the installed-PWA home
  // screen icon (Web App Badging API). Reuses useActionQueue's existing
  // count rather than computing a separate one (roadmap's "pick one source
  // of truth"); feature-detected/no-op everywhere the API isn't supported.
  const { actionQueue } = useActionQueue();
  useAppBadge(actionQueue.length);
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
        .filter((t) => needsReview(t) && !isReviewSnoozed(t, reviewToday))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [transactions, reviewToday],
  );
  // Combined, ordered review queue: transactions (gated on expense review mode)
  // first, then held to-dos, then held shopping captures. The transaction gate
  // is the critical accounting rule — in expense `auto` mode, pending
  // transactions still count toward Safe-to-Spend and stay reviewable via the
  // Action Queue, but must NOT be force-shown in this drawer; their inclusion
  // is independent of whether the drawer opens for a held to-do / shopping item.
  // Held todos/shopping are additionally gated on module visibility (Plan 090)
  // — a household that hid the To-Dos or Shopping tab must not get a review
  // card/auto-open drawer surfacing items whose destination page is hidden.
  // Transactions are deliberately NOT gated here (out of scope — see FIX 2).
  const reviewQueueItems = useMemo(
    () =>
      buildReviewQueueSnapshot({
        pendingReviewTransactions,
        todosAwaitingReview: isPlanTabVisible('todos') ? todosAwaitingReview : [],
        shoppingAwaitingReview: isPlanTabVisible('shopping') ? shoppingAwaitingReview : [],
        householdSettings,
      }),
    [pendingReviewTransactions, todosAwaitingReview, shoppingAwaitingReview, householdSettings, isPlanTabVisible],
  );
  // Once-per-app-open: snapshot the combined review queue and auto-open the
  // cycling review drawer.
  const [hasAutoOpenedReview, setHasAutoOpenedReview] = useState(false);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewQueueItem[]>([]);

  useEffect(() => preloadOnIdle(loadReviewPendingDrawer), []);

  // Pay-period reset ceremony — a paycheck confirmed ON THIS DEVICE that rolled
  // (or initialized) the pay period emits an event after its batch commits; we
  // open the ceremony drawer (closed-period recap + set-your-budgets prompt).
  // Dismissing it is a no-op by design: limits already carried over unchanged,
  // and the ceremony never re-opens for that period. bucketsRef keeps the
  // subscription stable across renders while still skipping households with no
  // buckets (nothing to recap or budget).
  const [ceremonyEvent, setCeremonyEvent] = useState<PayPeriodCeremonyEvent | null>(null);
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const bucketsRef = useRef(buckets);
  useEffect(() => {
    bucketsRef.current = buckets;
  }, [buckets]);
  useEffect(
    () =>
      subscribePayPeriodCeremony((event) => {
        if (bucketsRef.current.length === 0) return;
        setCeremonyEvent(event);
        setCeremonyOpen(true);
      }),
    [],
  );

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
  if (!isLoading && !activeKid && !hasAutoOpenedReview && reviewQueueItems.length > 0) {
    setHasAutoOpenedReview(true);
    setReviewSnapshot(reviewQueueItems); // snapshot so the cycle is stable
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
      {/* Skip link — the toolbar is 4 tab stops repeated on every page; this
          is the first focusable element so keyboard/SR users can jump past it. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-toast focus:px-4 focus:py-2 focus:rounded-btn focus:bg-accent-600 focus:text-white focus:font-semibold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        onClick={() => document.getElementById('main-content')?.focus()}
      >
        Skip to main content
      </a>

      <div className="flex-none">
        <TopToolbar />
      </div>

      <main
        id="main-content"
        // Focusable as a skip-link target only; not in the tab order.
        tabIndex={-1}
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-none relative scroll-smooth w-full focus:outline-hidden"
      >
        <div>
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

      {/* Held-for-review cycler — lazy so Drawer/framer-motion stay out of the
          boot bundle. Opens once per app-open whenever any un-snoozed
          pending_review transactions (expense `review` mode) or held to-do /
          shopping captures exist. */}
      <LazyMount when={reviewDrawerOpen}>
        <ReviewPendingDrawer
          items={reviewSnapshot}
          isOpen={reviewDrawerOpen}
          onClose={() => setReviewDrawerOpen(false)}
        />
      </LazyMount>

      {/* Pay-period reset ceremony — keyed on the new period so a later roll
          remounts the drawer with fresh drafts/recap. */}
      <LazyMount when={ceremonyOpen}>
        {ceremonyEvent && (
          <PayPeriodCeremonyDrawer
            key={ceremonyEvent.newPeriodId}
            event={ceremonyEvent}
            isOpen={ceremonyOpen}
            onClose={() => setCeremonyOpen(false)}
          />
        )}
      </LazyMount>

      <InstallPwaBanner />
      <HabitLocationPromptBanner />
    </div>
  );
};

export default MainLayout;
