import React, { useState, useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, Plus, Activity, List } from 'lucide-react';
import { LazyMount } from '@/components/ui/LazyMount';
import CountBadge from '@/components/ui/CountBadge';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

// Lazy-loaded so the Capture drawer (tabs, AI capture, presets) stays out of
// the boot bundle; preloaded on idle below so the first FAB tap is instant.
const loadCaptureModal = () => import('@/components/modals/CaptureModal');
const CaptureModal = React.lazy(loadCaptureModal);

/** A single footer nav destination. `badgeCount` drives the Money pending badge. */
interface NavItem {
  key: string;
  to: string;
  end?: boolean;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

const BottomNav: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Pending-items nudge (Plan 063): count transactions awaiting review so the Money
  // tab can show a badge. Subscribes to the narrow finance slice only.
  const { transactions } = useFinance();
  const pendingReviewCount = useMemo(
    () => transactions.filter((t) => t.status === 'pending_review').length,
    [transactions]
  );

  // Plan 090 — which top-level pages are enabled for this household.
  const { isModuleEnabled, isPlanVisible, isPlanTabVisible } = useModuleVisibility();

  // The capture FAB opens the CaptureModal. Mirror the modal's tab gating exactly:
  // money follows its top-level flag, while todo/shop follow plan-tab visibility
  // (Plan master + the sub-tab) so we never offer a capture whose destination page
  // is hidden. Hidden only when none of the three are available.
  const showCaptureFab =
    isModuleEnabled('money') || isPlanTabVisible('todos') || isPlanTabVisible('shopping');

  useEffect(() => preloadOnIdle(loadCaptureModal), []);

  // Build the enabled nav items. Home is ALWAYS shown; the rest are gated by
  // visibility. Order matters: it determines the balanced left/right split below.
  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { key: 'home', to: '/', end: true, label: 'Home', icon: LayoutDashboard },
    ];
    if (isModuleEnabled('habits')) {
      items.push({ key: 'habits', to: '/habits', label: 'Habits', icon: Activity });
    }
    if (isModuleEnabled('money')) {
      items.push({ key: 'money', to: '/budget', label: 'Money', icon: Wallet, badgeCount: pendingReviewCount });
    }
    if (isPlanVisible) {
      items.push({ key: 'plan', to: '/lists', label: 'Plan', icon: List });
    }
    return items;
  }, [isModuleEnabled, isPlanVisible, pendingReviewCount]);

  // Balanced split around the centered FAB (decision 7): Home always anchors the
  // left group; the remaining items fill left up to half (ceil), the rest right.
  // 4 -> 2|2, 3 -> 2|1, 2 -> 1|1, 1 -> Home|∅.
  const { leftItems, rightItems } = useMemo(() => {
    const leftCount = Math.ceil(navItems.length / 2);
    return {
      leftItems: navItems.slice(0, leftCount),
      rightItems: navItems.slice(leftCount),
    };
  }, [navItems]);

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

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const badge = item.badgeCount ?? 0;
    return (
      <NavLink key={item.key} to={item.to} end={item.end} className={navLinkClass}>
        {({ isActive }) => (
          <>
            <div className="relative">
              <Icon className={iconClass(isActive)} />
              <CountBadge count={badge} />
            </div>
            <span className="text-xs font-semibold">
              {item.label}
              {badge > 0 && (
                <span className="sr-only">, {badge} pending review</span>
              )}
            </span>
          </>
        )}
      </NavLink>
    );
  };

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="w-full bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 shadow-nav pb-safe"
      >
        <div className="flex items-center justify-between h-16 px-2 relative">

          {/* Left Group */}
          <div className="flex items-center flex-1 justify-around">
            {leftItems.map(renderNavItem)}
          </div>

          {/* Center FAB Placeholder to maintain spacing */}
          <div className="w-16 flex justify-center" />

          {/* Right Group */}
          <div className="flex items-center flex-1 justify-around">
            {rightItems.map(renderNavItem)}
          </div>

          {/* Actual FAB positioned absolutely — evergreen accent, the app's
              primary action color. Hidden when no capture module is enabled; the
              centered spacer above keeps the balanced left/right split intact. */}
          {showCaptureFab && (
            <div className="absolute left-1/2 -translate-x-1/2 -top-6">
              <button
                onClick={() => setIsModalOpen(true)}
                className="group flex items-center justify-center w-16 h-16 bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400 text-white rounded-full shadow-raised border-4 border-brand-50 dark:border-brand-900 active:scale-95 transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
                aria-label="Capture transaction, task, or item"
              >
                <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform duration-(--duration-slow) ease-(--ease-standard)" />
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Capture Modal Overlay — only mountable when the FAB exists. */}
      {showCaptureFab && (
        <LazyMount when={isModalOpen}>
          <CaptureModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </LazyMount>
      )}
    </>
  );
};

export default BottomNav;
