
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, TrendingUp, User } from 'lucide-react';
import { useFinance, useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useAuth } from '@/contexts/AuthContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { LazyMount } from '@/components/ui/LazyMount';
import CountBadge from '@/components/ui/CountBadge';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import ProfileMenu from './ProfileMenu';

// Lazy-loaded so this drawer (and framer-motion via Drawer) stays out of the
// boot bundle; preloaded on idle below so the first tap is still instant.
// The Safe-to-Spend and Rewards glances no longer open modals — they deep-link
// into Money → Overview and Habits → Rewards respectively (redesign IA).
const loadFeedbackModal = () => import('@/components/modals/FeedbackModal');
const FeedbackModal = React.lazy(loadFeedbackModal);

// Plan 14: global search overlay — lazy for the same boot-bundle reason as
// FeedbackModal above. It owns its own slice consumption (transactions,
// habits, meals, todos, shopping items) so this always-mounted toolbar is not
// re-coupled to that state. Triggered from the Profile menu's Search row
// (moved off the header bar to declutter the mobile toolbar).
const loadSearchOverlay = () => import('@/components/search/SearchOverlay');
const SearchOverlay = React.lazy(loadSearchOverlay);

// Plan 016: the Safe-to-Spend figure opens a breakdown drawer (pool + bucket-
// tracking overlay) instead of deep-linking to Money → Overview. Lazy for the
// same boot-bundle reason as the modals above (Drawer/framer-motion off boot).
const loadSafeToSpendBreakdownDrawer = () => import('@/components/budget/SafeToSpendBreakdownDrawer');
const SafeToSpendBreakdownDrawer = React.lazy(loadSafeToSpendBreakdownDrawer);

// F-NOTIF-02: notification inbox drawer, opened via the Profile menu's
// Notifications row (moved off the header bell icon to declutter the mobile
// toolbar). Lazy for the same boot-bundle reason as the other Drawer-based
// modals above.
const loadNotificationInboxDrawer = () => import('@/components/layout/NotificationInboxDrawer');
const NotificationInboxDrawer = React.lazy(loadNotificationInboxDrawer);

const TopToolbar: React.FC = () => {
  const { safeToSpendBreakdown } = useFinance();
  // Fall back to 0 while the breakdown hasn't been computed yet (matches the
  // toolbar's prior initial render with the raw `safeToSpend` field).
  const safeToSpend = safeToSpendBreakdown?.safeToSpend ?? 0;
  const { dailyPoints, weeklyPoints } = useGamification();
  const { household, unreadNotificationCount } = useHouseholdCore();
  const { currentUser } = useAuth();
  const kidModeEnabled = useKidModeEnabled();
  const { isModuleEnabled } = useModuleVisibility();
  const fmt = useFormatCurrency();
  const navigate = useNavigate();

  // Plan 080d-2: count of kid redemption requests awaiting parent review, badged
  // on the rewards (points) control. Dormant: only counts when Kid Mode is on.
  const pendingRedemptionCount = kidModeEnabled
    ? household?.pendingRedemptions?.length ?? 0
    : 0;
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [stsOpen, setStsOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);

  useEffect(() => preloadOnIdle(loadFeedbackModal), []);
  useEffect(() => preloadOnIdle(loadSearchOverlay), []);
  useEffect(() => preloadOnIdle(loadSafeToSpendBreakdownDrawer), []);
  useEffect(() => preloadOnIdle(loadNotificationInboxDrawer), []);

  // Cmd/Ctrl+K opens search — a lightweight keydown listener only; no slice
  // consumption is added here (SearchOverlay owns its own data).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Anything that *displays* as $0.00 (see formatCurrency's clamp) counts as
  // non-negative, so a -$0.004 never renders a red "$0.00".
  const isPositive = safeToSpend > -0.005;

  return (
    <>
      <div className="relative z-dropdown">
        <header className="z-sticky w-full bg-brand-800 dark:bg-brand-900 border-b border-brand-700 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 flex items-center text-white">
          {/* Left Container: Safe-to-Spend (money domain — Plan 090). When money
              is off it's simply omitted; the right cluster uses `ml-auto` to stay
              pinned to the right edge. */}
          {isModuleEnabled('money') && (
            <button
              type="button"
              aria-label="View Safe to Spend details"
              className="flex flex-col text-left cursor-pointer active:opacity-80 transition-opacity focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:rounded-lg"
              onClick={() => setStsOpen(true)}
            >
              <span
                className={`text-2xl font-mono font-bold tracking-tight tabular-nums ${isPositive ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'}`}
              >
                {fmt(safeToSpend)}
              </span>
              <span className="font-display text-xs text-brand-300 uppercase tracking-wider font-semibold leading-tight">
                Safe to Spend
              </span>
            </button>
          )}

          {/* Right Container: Points Cluster + Profile */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Points Container - Clickable to open Rewards Modal (habits domain
                — Plan 090). Hidden entirely when habits is off; Feedback + Profile
                remain in this right cluster. */}
            {isModuleEnabled('habits') && (
              <button
                type="button"
                aria-label={
                  pendingRedemptionCount > 0
                    ? `View Rewards and Points breakdown, ${pendingRedemptionCount} pending request${pendingRedemptionCount === 1 ? '' : 's'}`
                    : 'View Rewards and Points breakdown'
                }
                className="relative flex items-center gap-2 sm:gap-4 cursor-pointer active:opacity-80 transition-opacity focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:rounded-lg"
                onClick={() => navigate('/habits', { state: { tab: 'rewards' } })}
              >
                {/* Plan 080d-2 — pending kid-redemption-request badge. Dormant unless
                    Kid Mode is on and there is at least one request awaiting review. */}
                <CountBadge count={pendingRedemptionCount} className="-top-2 z-10 ring-brand-800" />
                {/* Daily Points (warm gold star) */}
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1">
                    <span className="text-xl font-bold text-habit-gold tabular-nums">
                      {dailyPoints}
                    </span>
                    <Star className="w-4 h-4 fill-habit-gold text-habit-gold" />
                  </div>
                  <span className="text-xs text-brand-300 uppercase tracking-wider">Today</span>
                </div>

                {/* Vertical Divider */}
                <div className="h-8 w-px bg-brand-600"></div>

                {/* Weekly Points (slate-teal trend) */}
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1">
                    <span className="text-xl font-bold text-habit-blue tabular-nums">
                      {weeklyPoints}
                    </span>
                    <TrendingUp className="w-4 h-4 text-habit-blue" />
                  </div>
                  <span className="text-xs text-brand-300 uppercase tracking-wider">Week</span>
                </div>
              </button>
            )}

            {/* Profile Icon — also carries Search + Notifications now that those
                triggers have moved into the Profile menu (declutters the mobile
                header, which was crowding the points cluster against Safe-to-
                Spend). A small unread dot substitutes for the removed bell badge
                so the unread signal isn't lost when the menu is closed. */}
            <button
              type="button"
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="relative ml-1 w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center text-brand-200 border border-brand-600 active:bg-brand-600 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400"
              aria-label={
                unreadNotificationCount > 0
                  ? `Open Profile Menu, ${unreadNotificationCount} unread notification${unreadNotificationCount === 1 ? '' : 's'}`
                  : 'Open Profile Menu'
              }
              aria-expanded={isProfileOpen}
              aria-haspopup="menu"
            >
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt={currentUser.displayName ? `${currentUser.displayName}'s profile picture` : 'Profile picture'} className="w-full h-full rounded-full object-cover" />
              ) : currentUser?.displayName ? (
                <span className="font-bold text-sm">
                  {currentUser.displayName.charAt(0)}
                </span>
              ) : (
                <User className="w-5 h-5" />
              )}
              {unreadNotificationCount > 0 && (
                <span
                  className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-money-neg ring-2 ring-brand-800"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        </header>

        <ProfileMenu
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          onSendFeedback={() => setIsFeedbackOpen(true)}
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenNotifications={() => setIsInboxOpen(true)}
          unreadNotificationCount={unreadNotificationCount}
        />
      </div>

      <LazyMount when={isFeedbackOpen}>
        <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      </LazyMount>

      <LazyMount when={isSearchOpen}>
        <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      </LazyMount>

      <LazyMount when={stsOpen}>
        <SafeToSpendBreakdownDrawer open={stsOpen} onClose={() => setStsOpen(false)} />
      </LazyMount>

      <LazyMount when={isInboxOpen}>
        <NotificationInboxDrawer open={isInboxOpen} onClose={() => setIsInboxOpen(false)} />
      </LazyMount>
    </>
  );
};

export default TopToolbar;
