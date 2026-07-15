import React, { useCallback, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import {
  DASHBOARD_WIDGETS,
  resolveDashboardOrder,
  moveWidget,
  toggleWidgetHidden,
} from '@/utils/dashboardLayout';
import type { HouseholdMember } from '@/types/schema';

interface DashboardWidgetSettingsProps {
  member: HouseholdMember;
  onSave: (updates: Pick<HouseholdMember, 'dashboardLayout' | 'dashboardHidden'>) => void;
}

const WIDGET_LABELS = new Map(DASHBOARD_WIDGETS.map(w => [w.id, w]));

/**
 * Settings → "Dashboard widgets" editor (F-XCUT-02). Reorder (up/down) and
 * hide/show each Dashboard widget for the signed-in member; persisted via
 * `HouseholdMember.dashboardLayout` / `dashboardHidden`.
 */
export const DashboardWidgetSettings: React.FC<DashboardWidgetSettingsProps> = ({ member, onSave }) => {
  const order = useMemo(() => resolveDashboardOrder(member.dashboardLayout), [member.dashboardLayout]);
  const hidden = useMemo(() => member.dashboardHidden ?? [], [member.dashboardHidden]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const handleMove = useCallback((id: string, direction: 'up' | 'down') => {
    const next = moveWidget(order, id, direction);
    onSave({ dashboardLayout: next, dashboardHidden: hidden });
  }, [order, hidden, onSave]);

  const handleToggleHidden = useCallback((id: string) => {
    const next = toggleWidgetHidden(hidden, id);
    onSave({ dashboardLayout: order, dashboardHidden: next });
  }, [order, hidden, onSave]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Choose which Home widgets you see and the order they appear in. This only affects your
        own view — other household members keep their own layout.
      </p>
      <SurfaceList>
        {order.map((id, index) => {
          const def = WIDGET_LABELS.get(id);
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
                onCheckedChange={() => handleToggleHidden(id)}
              />
            </Row>
          );
        })}
      </SurfaceList>
    </div>
  );
};

export default DashboardWidgetSettings;
