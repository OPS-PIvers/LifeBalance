import React, { useCallback, useMemo } from 'react';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Switch } from '@/components/ui/Switch';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Eyebrow from '@/components/ui/Eyebrow';
import HomeWidgetOrder from '@/components/settings/HomeWidgetOrder';
import { resolveDashboardOrder } from '@/utils/dashboardLayout';
import {
  NAV_PAGES,
  isHouseholdModuleEnabled,
  resolveHiddenKeys,
  resolveLandingOptions,
  resolveLandingScreenKey,
  toggleHiddenKey,
  type LandingScreenKey,
  type ModuleSettings,
  type VisibilityKey,
} from '@/utils/moduleVisibility';
import type { HouseholdMember } from '@/types/schema';

interface MyViewSettingsProps {
  member: HouseholdMember;
  /** Household module map — leaves the household has turned off aren't listed. */
  settings: ModuleSettings;
  onSave: (updates: Pick<HouseholdMember, 'dashboardLayout' | 'hiddenKeys' | 'homeScreen'>) => void;
}

/**
 * The first-run wizard's "What I see" step (2F.1, extending F-XCUT-02's widget
 * editor). Settings no longer mounts this — its Modules & Dashboard screen
 * collapsed onto the single `MemberVisibilityMatrix` — but
 * `components/onboarding/OnboardingWizard.tsx` renders it as step 4, so it
 * stays the wizard's own visibility surface (and the reason the heading text
 * "What I see" still exists in the app).
 *
 * One list of everything this member can turn off: each page's sub-views first,
 * then the Home widgets (which additionally reorder, via the shared
 * `HomeWidgetOrder` component Settings mounts too). Both write the member's
 * single `hiddenKeys` list — a page's sub-views and Home's widgets are the same
 * kind of key now.
 *
 * Only leaves the HOUSEHOLD has enabled are listed: a member cannot re-enable
 * something the household turned off, so a dead switch would just be a lie.
 * Settings itself is not listed and cannot be — it is absent from the key set
 * entirely (see utils/moduleVisibility.ts), which is the lockout guard.
 */
export const MyViewSettings: React.FC<MyViewSettingsProps> = ({ member, settings, onSave }) => {
  const order = useMemo(() => resolveDashboardOrder(member.dashboardLayout), [member.dashboardLayout]);
  // Effective hidden list — a member who never customized sees the lean
  // defaults, and their first toggle persists from that seeded state rather
  // than from an empty list (which would suddenly reveal every widget).
  const hidden = useMemo(
    () => [...resolveHiddenKeys({ hiddenKeys: member.hiddenKeys, dashboardHidden: member.dashboardHidden })],
    [member.hiddenKeys, member.dashboardHidden]
  );
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Pages/leaves the household has enabled. A page with no enabled leaf is
  // dropped entirely — there is nothing for the member to decide about it.
  const pages = useMemo(
    () =>
      NAV_PAGES.filter(page => isHouseholdModuleEnabled(settings, page.module))
        .map(page => ({
          key: page.key,
          label: page.label,
          leaves: page.groups
            .flatMap(g => g.leaves)
            .filter(leaf => isHouseholdModuleEnabled(settings, leaf.module)),
        }))
        .filter(page => page.leaves.length > 0),
    [settings]
  );

  const handleToggle = useCallback(
    (key: VisibilityKey) => {
      onSave({ dashboardLayout: order, hiddenKeys: toggleHiddenKey(hidden, key) });
    },
    [order, hidden, onSave]
  );

  // 2F.2 — Home becomes toggleable, same switch mechanics as every other leaf.
  const homeHidden = hiddenSet.has('home');

  // Landing-screen picker: ONLY destinations actually reachable right now —
  // Home (unless the member just hid it above) plus any page that still has
  // at least one visible leaf for this member. Offering a hidden destination
  // would be a dead switch. Shared with the admin matrix (MemberVisibilityMatrix)
  // via `resolveLandingOptions` so there's one derivation, not two.
  const landingOptions = useMemo(
    () => resolveLandingOptions(settings, hiddenSet),
    [settings, hiddenSet]
  );

  // The CURRENTLY effective landing screen — walks the member's chosen
  // `homeScreen` → the first reachable destination, so the control always
  // shows a real, selectable value even before the member ever picks one.
  const effectiveLandingScreen = useMemo(
    () => resolveLandingScreenKey({ homeScreen: member.homeScreen }, settings, hiddenSet),
    [member.homeScreen, settings, hiddenSet]
  );
  // `resolveLandingScreenKey` can answer `'settings'` (every destination
  // hidden), which isn't one of `landingOptions` — the control below only
  // renders while at least one option exists, so this narrows back to a real
  // `LandingScreenKey` for that render (falling back to the first option is
  // unreachable in practice: it's non-empty exactly when this isn't 'settings').
  const landingValue: LandingScreenKey =
    effectiveLandingScreen === 'settings'
      ? (landingOptions[0]?.key ?? 'home')
      : effectiveLandingScreen;

  const handleSetLandingScreen = useCallback(
    (key: LandingScreenKey) => {
      onSave({ dashboardLayout: order, hiddenKeys: hidden, homeScreen: key });
    },
    [order, hidden, onSave]
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Choose what appears in your own navigation and on your Home screen. This only affects your
        view — other household members keep theirs. Turn off every view on a page and that page
        leaves your nav; leave one on and tapping it goes straight there.
      </p>

      {/* 2F.2 — Home is toggleable like any other page. Hiding it doesn't lose
          your Home widget choices below; it just takes Home out of your nav
          and out of the landing-screen choices underneath. */}
      <div className="space-y-2">
        <div className="px-1">
          <Eyebrow className="block">Home</Eyebrow>
          {homeHidden && (
            <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
              Hidden from your navigation.
            </p>
          )}
        </div>
        <SurfaceList>
          <Row>
            <div className={`flex-1 min-w-0 ${homeHidden ? 'opacity-50' : ''}`}>
              <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
                Home
              </p>
            </div>
            <Switch
              aria-label="Show Home in your navigation"
              checked={!homeHidden}
              onCheckedChange={() => handleToggle('home')}
            />
          </Row>
        </SurfaceList>
      </div>

      {pages.map(page => {
        const visibleCount = page.leaves.filter(leaf => !hiddenSet.has(leaf.key)).length;
        return (
          <div key={page.key} className="space-y-2">
            <div className="px-1">
              <Eyebrow className="block">{page.label}</Eyebrow>
              {visibleCount === 0 && (
                <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
                  Hidden from your navigation.
                </p>
              )}
            </div>
            <SurfaceList>
              {page.leaves.map(leaf => {
                const isHidden = hiddenSet.has(leaf.key);
                return (
                  <Row key={leaf.key}>
                    <div className={`flex-1 min-w-0 ${isHidden ? 'opacity-50' : ''}`}>
                      <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
                        {leaf.label}
                      </p>
                    </div>
                    <Switch
                      aria-label={`Show ${leaf.label} in ${page.label}`}
                      checked={!isHidden}
                      onCheckedChange={() => handleToggle(leaf.key)}
                    />
                  </Row>
                );
              })}
            </SurfaceList>
          </div>
        );
      })}

      {/* 2F.2 — where you land when you open the app. Only reachable
          destinations are offered; with one (or zero, forced to Settings)
          there's no real choice, so the control doesn't render. */}
      {landingOptions.length > 1 && (
        <div className="space-y-2">
          <div className="px-1">
            <Eyebrow className="block">Landing screen</Eyebrow>
            <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
              Where you land when you open the app.
            </p>
          </div>
          <SegmentedControl
            name="Landing screen"
            value={landingValue}
            onChange={handleSetLandingScreen}
            options={landingOptions.map(o => ({ value: o.key, label: o.label }))}
          />
        </div>
      )}

      {/* Widget order + per-widget switches come from the SHARED
          `HomeWidgetOrder` component (Settings' "Home widget order" section
          mounts the same one) so there is a single implementation of the
          drag list to keep in sync. */}
      <div className="space-y-2">
        <div className="px-1">
          <Eyebrow className="block">Home widgets</Eyebrow>
        </div>
        <HomeWidgetOrder member={member} onSave={onSave} />
      </div>
    </div>
  );
};

export default MyViewSettings;
