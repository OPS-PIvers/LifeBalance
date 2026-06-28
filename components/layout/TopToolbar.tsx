
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, TrendingUp, User, AlertCircle } from 'lucide-react';
import { useFinance, useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useAuth } from '@/contexts/AuthContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { LazyMount } from '@/components/ui/LazyMount';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import ProfileMenu from './ProfileMenu';

// Lazy-loaded so this drawer (and framer-motion via Drawer) stays out of the
// boot bundle; preloaded on idle below so the first tap is still instant.
// The Safe-to-Spend and Rewards glances no longer open modals — they deep-link
// into Money → Overview and Habits → Rewards respectively (redesign IA).
const loadFeedbackModal = () => import('@/components/modals/FeedbackModal');
const FeedbackModal = React.lazy(loadFeedbackModal);

const TopToolbar: React.FC = () => {
  const { safeToSpend } = useFinance();
  const { dailyPoints, weeklyPoints } = useGamification();
  const { household } = useHouseholdCore();
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

  useEffect(() => preloadOnIdle(loadFeedbackModal), []);

  const isPositive = safeToSpend >= 0;

  return (
    <>
      <div className="relative z-dropdown">
        <header className="z-sticky w-full bg-brand-800 dark:bg-brand-900 border-b border-brand-700 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 flex items-center justify-between text-white">
          {/* Left Container: Safe-to-Spend (money domain — Plan 090). When money
              is off, render an empty spacer so `justify-between` keeps the right
              cluster pinned to the right edge instead of floating left. */}
          {isModuleEnabled('money') ? (
            <button
              type="button"
              aria-label="View Safe to Spend details"
              className="flex flex-col text-left cursor-pointer active:opacity-80 transition-opacity focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:rounded-lg"
              onClick={() => navigate('/budget', { state: { tab: 'overview' } })}
            >
              <span
                className={`text-2xl font-mono font-bold tracking-tight tabular-nums ${isPositive ? 'text-money-pos' : 'text-money-neg'}`}
              >
                {fmt(Math.abs(safeToSpend))}
              </span>
              <span className="font-display text-xs text-brand-300 uppercase tracking-wider font-semibold leading-tight">
                Safe to Spend
              </span>
            </button>
          ) : (
            <div aria-hidden="true" />
          )}

          {/* Right Container: Points Cluster + Profile */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsFeedbackOpen(true)}
              className="p-1.5 text-brand-300 hover:text-white hover:bg-brand-700 rounded-full transition-colors duration-(--duration-fast) ease-(--ease-standard)"
              aria-label="Send Feedback"
            >
              <AlertCircle size={18} />
            </button>

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
                {pendingRedemptionCount > 0 && (
                  <span
                    className="absolute -top-2 -right-2 z-10 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-money-neg text-white text-[10px] font-bold leading-none ring-2 ring-brand-800"
                    aria-hidden="true"
                  >
                    {pendingRedemptionCount > 9 ? '9+' : pendingRedemptionCount}
                  </span>
                )}
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

            {/* Profile Icon */}
            <button
              type="button"
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="ml-1 w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center text-brand-200 border border-brand-600 active:bg-brand-600 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400"
              aria-label="Open Profile Menu"
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
            </button>
          </div>
        </header>

        <ProfileMenu isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
      </div>

      <LazyMount when={isFeedbackOpen}>
        <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      </LazyMount>
    </>
  );
};

export default TopToolbar;
