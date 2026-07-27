import React, { useCallback, useMemo, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import {
  DASHBOARD_WIDGETS,
  resolveDashboardOrder,
  moveWidget,
  type DashboardWidgetDef,
  type DashboardWidgetId,
} from '@/utils/dashboardLayout';
import { resolveHiddenKeys, toggleHiddenKey } from '@/utils/moduleVisibility';
import type { HouseholdMember } from '@/types/schema';

/** The member fields a widget-order edit writes — the existing `onSave` contract. */
type WidgetOrderUpdate = Pick<HouseholdMember, 'dashboardLayout' | 'hiddenKeys'>;

interface HomeWidgetOrderProps {
  member: Pick<HouseholdMember, 'dashboardLayout' | 'hiddenKeys' | 'dashboardHidden'>;
  onSave: (updates: WidgetOrderUpdate) => void;
}

const WIDGET_DEFS = new Map<string, DashboardWidgetDef>(DASHBOARD_WIDGETS.map(w => [w.id, w]));

/**
 * Home widget order + visibility — ONE implementation with two mount points:
 * Settings → Modules & Dashboard ("Home widget order") and the first-run
 * `OnboardingWizard`'s "What I see" step (via `MyViewSettings`, which still
 * owns the wizard's leaf/landing-screen list).
 *
 * It was extracted out of `MyViewSettings` when Settings collapsed its three
 * overlapping visibility sections onto the single `MemberVisibilityMatrix`:
 * the matrix already carries every household toggle and every per-member leaf
 * and widget SWITCH, but has no notion of widget ORDER — which is the one
 * thing this component adds back.
 *
 * Both the order and the per-widget switch write the member's existing fields
 * through the caller's `onSave` (`dashboardLayout` + the unified `hiddenKeys`
 * list), so this is presentation only: no new field, no second hidden-key set.
 */
export const HomeWidgetOrder: React.FC<HomeWidgetOrderProps> = ({ member, onSave }) => {
  const order = useMemo(() => resolveDashboardOrder(member.dashboardLayout), [member.dashboardLayout]);
  // Effective hidden list — a member who never customized sees the lean
  // defaults, and their first toggle persists from that seeded state rather
  // than from an empty list (which would suddenly reveal every widget).
  const hidden = useMemo(
    () => [...resolveHiddenKeys({ hiddenKeys: member.hiddenKeys, dashboardHidden: member.dashboardHidden })],
    [member.hiddenKeys, member.dashboardHidden]
  );
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Local order for immediate feedback DURING a drag only (the same pattern as
  // HabitCategoryList): once the drag ends we persist and go straight back to
  // reading props, so there's no synchronising useEffect to get stale.
  const [dragOrder, setDragOrder] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const items = isDragging ? dragOrder : order;

  const persistOrder = useCallback(
    (next: readonly string[]) => {
      onSave({ dashboardLayout: [...next], hiddenKeys: hidden });
    },
    [onSave, hidden]
  );

  const handleReorder = useCallback((next: string[]) => {
    setIsDragging(true);
    setDragOrder(next);
  }, []);

  const handleDragEnd = useCallback(() => {
    // `isDragging` is the load-bearing guard, and it has to be: a press that
    // never actually moved anything fires no `onReorder`, yet `dragOrder` is
    // deliberately NOT cleared after a drag, so from the second press onward
    // it holds the PREVIOUS drag's order. Writing that would persist a stale
    // layout — so don't collapse this into a `dragOrder.length` check, which
    // only catches the very first press (when the array is still empty).
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOrder.length > 0) persistOrder(dragOrder);
  }, [isDragging, dragOrder, persistOrder]);

  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      persistOrder(moveWidget(items, id, direction));
    },
    [items, persistOrder]
  );

  // A widget id is itself one of the unified `VisibilityKey`s (see
  // utils/moduleVisibility.ts), so hiding one writes the same single list a
  // nav leaf does.
  const handleToggle = useCallback(
    (id: DashboardWidgetId) => {
      onSave({ dashboardLayout: order, hiddenKeys: toggleHiddenKey(hidden, id) });
    },
    [order, hidden, onSave]
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Drag a handle to reorder — or focus one and use the arrow keys. Switch off to hide.
      </p>
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={handleReorder}
        className="surface-section overflow-hidden [&>*:first-child]:border-t-0"
        aria-label="Home widget order"
      >
        {items.map(id => {
          const def = WIDGET_DEFS.get(id);
          if (!def) return null;
          return (
            <WidgetRow
              key={id}
              def={def}
              isHidden={hiddenSet.has(id)}
              onDragEnd={handleDragEnd}
              onMove={handleMove}
              onToggle={handleToggle}
            />
          );
        })}
      </Reorder.Group>
    </div>
  );
};

interface WidgetRowProps {
  def: DashboardWidgetDef;
  isHidden: boolean;
  onDragEnd: () => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onToggle: (id: DashboardWidgetId) => void;
}

const WidgetRow: React.FC<WidgetRowProps> = ({ def, isHidden, onDragEnd, onMove, onToggle }) => {
  const controls = useDragControls();

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => controls.start(e),
    [controls]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      onMove(def.id, e.key === 'ArrowUp' ? 'up' : 'down');
    },
    [def.id, onMove]
  );

  return (
    <Reorder.Item
      value={def.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      style={{ position: 'relative' }} // ensure z-index works while dragging
      // The row hairline lives on the Reorder.Item (not the padded div inside)
      // so the Group's `[&>*:first-child]` reset can still suppress the first
      // one, exactly as SurfaceList does for its Rows.
      className="hairline-divider"
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* DELIBERATE DEVIATION from this app's other drag grips
            (ShoppingSettingsModal, ListRow), which are `aria-hidden`
            pointer-only decoration: this handle replaced a pair of
            keyboard-operable chevron buttons, so leaving it pointer-only would
            be a straight accessibility regression. It stays a real button and
            moves the widget with ArrowUp/ArrowDown. */}
        <button
          type="button"
          aria-label={`Reorder ${def.label}`}
          onPointerDown={startDrag}
          onKeyDown={handleKeyDown}
          className="touch-none cursor-grab active:cursor-grabbing p-1.5 -ml-1.5 text-brand-300 hover:text-brand-600 dark:text-brand-500 dark:hover:text-brand-300 rounded-sm shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className={`flex-1 min-w-0 ${isHidden ? 'opacity-50' : ''}`}>
          <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
            {def.label}
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400">{def.description}</p>
        </div>
        <Switch
          aria-label={`Show ${def.label} on Home`}
          checked={!isHidden}
          onCheckedChange={() => onToggle(def.id)}
        />
      </div>
    </Reorder.Item>
  );
};

export default HomeWidgetOrder;
