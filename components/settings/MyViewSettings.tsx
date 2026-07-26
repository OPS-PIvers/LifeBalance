import React, { useCallback, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';
import {
  DASHBOARD_WIDGETS,
  resolveDashboardOrder,
  moveWidget,
  type DashboardWidgetDef,
} from '@/utils/dashboardLayout';
import {
  NAV_PAGES,
  isHouseholdModuleEnabled,
  resolveHiddenKeys,
  toggleHiddenKey,
  type ModuleSettings,
  type VisibilityKey,
} from '@/utils/moduleVisibility';
import type { HouseholdMember } from '@/types/schema';

interface MyViewSettingsProps {
  member: HouseholdMember;
  /** Household module map — leaves the household has turned off aren't listed. */
  settings: ModuleSettings;
  onSave: (updates: Pick<HouseholdMember, 'dashboardLayout' | 'hiddenKeys'>) => void;
}

const WIDGET_DEFS = new Map<string, DashboardWidgetDef>(DASHBOARD_WIDGETS.map(w => [w.id, w]));

/**
 * Settings → "What I see" (2F.1, extending F-XCUT-02's widget editor).
 *
 * One list of everything this member can turn off: each page's sub-views first,
 * then the Home widgets (which additionally reorder). Both write the member's
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

  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      onSave({ dashboardLayout: moveWidget(order, id, direction), hiddenKeys: hidden });
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

      <div className="space-y-2">
        <div className="px-1">
          <Eyebrow className="block">Home widgets</Eyebrow>
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
            Reorder with the arrows; switch off to hide.
          </p>
        </div>
        <SurfaceList>
          {order.map((id, index) => {
            const def = WIDGET_DEFS.get(id);
            if (!def) return null;
            const isHidden = hiddenSet.has(id);
            return (
              <Row key={id}>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${def.label} up`}
                    disabled={index === 0}
                    onClick={() => handleMove(id, 'up')}
                  >
                    <ChevronUp size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${def.label} down`}
                    disabled={index === order.length - 1}
                    onClick={() => handleMove(id, 'down')}
                  >
                    <ChevronDown size={14} />
                  </Button>
                </div>
                <div className={`flex-1 min-w-0 ${isHidden ? 'opacity-50' : ''}`}>
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
                    {def.label}
                  </p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">{def.description}</p>
                </div>
                <Switch
                  aria-label={`Show ${def.label} on Home`}
                  checked={!isHidden}
                  onCheckedChange={() => handleToggle(def.id)}
                />
              </Row>
            );
          })}
        </SurfaceList>
      </div>
    </div>
  );
};

export default MyViewSettings;
