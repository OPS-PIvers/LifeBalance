import React, { useState, useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, Plus, Activity, List } from 'lucide-react';
import { LazyMount } from '@/components/ui/LazyMount';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';

// Lazy-loaded so the Capture drawer (tabs, AI capture, presets) stays out of
// the boot bundle; preloaded on idle below so the first FAB tap is instant.
const loadCaptureModal = () => import('@/components/modals/CaptureModal');
const CaptureModal = React.lazy(loadCaptureModal);

const BottomNav: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Pending-items nudge (Plan 063): count transactions awaiting review so the Money
  // tab can show a badge. Subscribes to the narrow finance slice only.
  const { transactions } = useFinance();
  const pendingReviewCount = useMemo(
    () => transactions.filter((t) => t.status === 'pending_review').length,
    [transactions]
  );

  useEffect(() => preloadOnIdle(loadCaptureModal), []);

  // Active tab reads in the evergreen accent (the app's primary), inactive in the
  // calm paper neutrals. No glass — a solid surface with a hairline top edge.
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center w-full min-h-[44px] gap-1 transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
      isActive
        ? 'text-accent-600 dark:text-accent-300'
        : 'text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300'
    }`;

  const iconClass = (isActive: boolean) =>
    `w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`;

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="w-full bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 shadow-nav pb-safe"
      >
        <div className="flex items-center justify-between h-16 px-2 relative">

          {/* Left Group */}
          <div className="flex items-center flex-1 justify-around">
            <NavLink to="/" end className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <LayoutDashboard className={iconClass(isActive)} />
                  <span className="text-xs font-semibold">Home</span>
                </>
              )}
            </NavLink>
            <NavLink to="/habits" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <Activity className={iconClass(isActive)} />
                  <span className="text-xs font-semibold">Habits</span>
                </>
              )}
            </NavLink>
          </div>

          {/* Center FAB Placeholder to maintain spacing */}
          <div className="w-16 flex justify-center" />

          {/* Right Group */}
          <div className="flex items-center flex-1 justify-around">
            <NavLink to="/budget" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <Wallet className={iconClass(isActive)} />
                    {pendingReviewCount > 0 && (
                      <span
                        className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-money-neg text-white text-[10px] font-bold leading-none ring-2 ring-white dark:ring-brand-800"
                        aria-hidden="true"
                      >
                        {pendingReviewCount > 9 ? '9+' : pendingReviewCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold">
                    Money
                    {pendingReviewCount > 0 && (
                      <span className="sr-only">, {pendingReviewCount} pending review</span>
                    )}
                  </span>
                </>
              )}
            </NavLink>
            <NavLink to="/lists" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <List className={iconClass(isActive)} />
                  <span className="text-xs font-semibold">Plan</span>
                </>
              )}
            </NavLink>
          </div>

          {/* Actual FAB positioned absolutely — evergreen accent, the app's
              primary action color. */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-6">
            <button
              onClick={() => setIsModalOpen(true)}
              className="group flex items-center justify-center w-16 h-16 bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400 text-white rounded-full shadow-raised border-4 border-brand-50 dark:border-brand-900 active:scale-95 transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
              aria-label="Capture transaction, task, or item"
            >
              <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform duration-(--duration-slow) ease-(--ease-standard)" />
            </button>
          </div>
        </div>
      </nav>

      {/* Capture Modal Overlay */}
      <LazyMount when={isModalOpen}>
        <CaptureModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </LazyMount>
    </>
  );
};

export default BottomNav;
