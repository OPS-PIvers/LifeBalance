import React, { useState, useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, Plus, Activity, List, Settings } from 'lucide-react';
import { LazyMount } from '@/components/ui/LazyMount';
import CountBadge from '@/components/ui/CountBadge';
import { preloadOnIdle } from '@/utils/preloadOnIdle';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { needsReview, isReviewSnoozed } from '@/hooks/useActionQueue';
import { getLocalDateString } from '@/utils/dateHelpers';

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
  //
  // INVARIANT: this predicate must count EXACTLY what Budget → Overview's
  // "Needs review" section lists (`NeedsReviewSection`, which filters
  // `useActionQueue`'s output), or the badge leads to a surface that doesn't
  // explain it. That means snoozed rows are excluded here too — `useActionQueue`
  // drops them, and a transaction the user deliberately deferred should stop
  // nagging in the nav rather than keep the count high with nothing to show.
  // Local day, never the UTC one (repo rule) — the snooze boundary is a local
  // `yyyy-MM-dd`, so an evening UTC roll would un-snooze a row a day early.
  const { transactions } = useFinance();
  const localToday = getLocalDateString();
  const pendingReviewCount = useMemo(
    () => transactions.filter((t) => needsReview(t) && !isReviewSnoozed(t, localToday)).length,
    [transactions, localToday]
  );

  // Plan 090 — which top-level pages are enabled for this household.
  const { isModuleEnabled, isPlanVisible, isPlanTabVisible, isHomeVisible } = useModuleVisibility();

  // The capture FAB opens the CaptureModal. Mirror the modal's tab gating exactly:
  // money follows its top-level flag, while todo/shop follow plan-tab visibility
  // (Plan master + the sub-tab) so we never offer a capture whose destination page
  // is hidden. Hidden only when none of the three are available.
  const showCaptureFab =
    isModuleEnabled('money') || isPlanTabVisible('todos') || isPlanTabVisible('shopping');

  useEffect(() => preloadOnIdle(loadCaptureModal), []);

  // Build the enabled nav items. Home is gated the same way as every other
  // page now (2F.2) — a member can hide it via `hiddenKeys`, unlike the other
  // pages it has no household-level toggle. Order matters: it determines the
  // balanced left/right split below.
  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [];
    if (isHomeVisible) {
      items.push({ key: 'home', to: '/', end: true, label: 'Home', icon: LayoutDashboard });
    }
    if (isModuleEnabled('habits')) {
      items.push({ key: 'habits', to: '/habits', label: 'Habits', icon: Activity });
    }
    if (isModuleEnabled('money')) {
      items.push({ key: 'money', to: '/budget', label: 'Budget', icon: Wallet, badgeCount: pendingReviewCount });
    }
    if (isPlanVisible) {
      items.push({ key: 'lists', to: '/lists', label: 'Lists', icon: List });
    }
    // A member can now hide Home (2F.2) on top of every other page already
    // being hideable at the household level, so all four can end up off
    // simultaneously — an empty footer would read as broken rather than as
    // "nothing to show here". Settings is the structurally un-hideable
    // terminal fallback everywhere else in this feature (it's absent from the
    // `VisibilityKey` set entirely, see `NAV_PAGES`), so fall back to a direct
    // link there rather than render a bare bar.
    if (items.length === 0) {
      items.push({ key: 'settings', to: '/settings', label: 'Settings', icon: Settings });
    }
    return items;
  }, [isHomeVisible, isModuleEnabled, isPlanVisible, pendingReviewCount]);

  // Balanced split around the centered FAB (decision 7): the items fill left up
  // to half (ceil), the rest right — Home used to always anchor the left group
  // when it was unconditional, but it's now just whichever item (if any) sorts
  // first among however many are currently enabled.
  // 4 -> 2|2, 3 -> 2|1, 2 -> 1|1, 1 -> item|∅ (the Settings fallback above
  // guarantees this is never 0|0).
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
    `relative flex flex-col items-center justify-center w-full h-14 gap-0.5 transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
      isActive
        ? 'text-accent-600 dark:text-accent-300'
        : 'text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300'
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
            {/* Non-color active affordance: a short accent indicator bar at the
                top edge of the active tab, so the selection reads without relying
                on color alone. */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-accent-600 dark:bg-accent-300"
              />
            )}
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
        <div className="flex items-center justify-between h-14 px-2 relative">

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
            <div className="absolute left-1/2 -translate-x-1/2 -top-7">
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
