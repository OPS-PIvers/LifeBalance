import React from 'react';
import { Check } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/utils/cn';

export interface TabSubViewOption<T extends string> {
  value: T;
  label: string;
}

export interface TabSubViewMenuProps<T extends string> {
  isOpen: boolean;
  onClose: () => void;
  options: TabSubViewOption<T>[];
  /**
   * The currently-selected (checked) sub-view. The checkmark means "you are
   * here" — omit it when the menu's group is NOT the active tab (previewing
   * another group's menu), so no item is checked and initial focus falls to
   * the first row instead.
   */
  value?: T;
  /** Called with the picked sub-view; the menu closes itself first. */
  onSelect: (value: T) => void;
  /** Accessible name for the menu (e.g. "Activity view"). */
  name: string;
  /** `data-tabs-value` of the tab trigger to anchor the menu under. */
  anchorValue: string;
  /**
   * The `relative` container wrapping the TabsList — the menu positions
   * absolutely inside it, horizontally aligned with the anchor trigger
   * (looked up via `[data-tabs-value]`) and clamped to the container.
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Checked-item tint. 'accent' (default, evergreen) or 'warm' (amber — gamification surfaces). */
  tone?: 'accent' | 'warm';
}

const TAB_SUB_VIEW_MENU_TONES = {
  accent: {
    checkedText: 'text-accent-700 dark:text-accent-200',
    icon: 'text-accent-600 dark:text-accent-300',
  },
  warm: {
    checkedText: 'text-warm-700 dark:text-warm-300',
    icon: 'text-warm-600 dark:text-warm-300',
  },
} as const;

/** Keep in sync with the panel's `w-48` class — used to clamp the left offset. */
const MENU_WIDTH_PX = 192;

// TabSubViewMenu: the popover of a multi-view tab (Money's Activity/Planned/
// Budget, Habits' Progress/Rewards). Tapping such a tab opens this menu of its
// sub-views anchored under the trigger; picking one navigates, Escape/outside
// tap close without navigating. Built on {@link Popover}, which owns the
// click-away backdrop, Escape, focus trap (the checked item carries
// `data-autofocus` so it receives initial focus), ArrowUp/Down roving across
// the `menuitemradio` rows, and the reduced-motion-suppressed entrance.
export const TabSubViewMenu = <T extends string>({
  isOpen,
  onClose,
  options,
  value,
  onSelect,
  name,
  anchorValue,
  anchorRef,
  tone = 'accent',
}: TabSubViewMenuProps<T>) => {
  const toneStyles = TAB_SUB_VIEW_MENU_TONES[tone];

  // Horizontal offset within the anchor container so the menu sits under its
  // tab trigger, clamped so it never spills past the tab bar's right edge.
  const [left, setLeft] = React.useState(0);
  const updatePosition = React.useCallback(() => {
    const container = anchorRef.current;
    const trigger = container?.querySelector<HTMLElement>(
      `[data-tabs-value="${CSS.escape(anchorValue)}"]`
    );
    if (!container || !trigger) return;
    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const max = Math.max(0, containerRect.width - MENU_WIDTH_PX);
    setLeft(Math.round(Math.min(Math.max(0, triggerRect.left - containerRect.left), max)));
  }, [anchorRef, anchorValue]);

  // Layout effect so the offset is applied before first paint on open (no
  // flash at left: 0); re-clamped on viewport resize while open.
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen, updatePosition]);

  // A "menu" over one (or zero) sub-views is no choice at all — render nothing.
  // Lets callers pass a conditionally-built option list (e.g. a flag-gated
  // segment) without guarding the mount themselves.
  if (options.length < 2) return null;

  return (
    <div className="absolute top-full" style={{ left }}>
      <Popover
        isOpen={isOpen}
        onClose={onClose}
        role="menu"
        ariaLabel={name}
        ariaOrientation="vertical"
        position="top-1 left-0"
        className="w-48 overflow-hidden py-1"
      >
        {options.map((opt) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              // Initial focus lands on the current sub-view (useFocusTrap
              // prefers [data-autofocus] over the first focusable).
              data-autofocus={checked || undefined}
              onClick={() => {
                onClose();
                onSelect(opt.value);
              }}
              className={cn(
                'w-full min-h-11 flex items-center gap-3 px-4 py-3 text-sm font-semibold text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden',
                // focus-visible (not focus) for the row highlight: initial
                // focus lands programmatically on the checked row when the
                // menu opens, and after a touch/pointer open that must show
                // ONLY the checkmark — a painted row would read as a stuck
                // pre-selection. Keyboard roving (ArrowUp/Down moves real
                // focus) still qualifies as :focus-visible and paints it.
                'hover:bg-brand-50 dark:hover:bg-brand-700/40 focus-visible:bg-brand-50 dark:focus-visible:bg-brand-700/40 active:bg-brand-50 dark:active:bg-brand-700/40',
                checked ? toneStyles.checkedText : 'text-brand-700 dark:text-brand-200'
              )}
            >
              <span className="flex-1">{opt.label}</span>
              {checked && (
                <Check size={16} strokeWidth={3} className={toneStyles.icon} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </Popover>
    </div>
  );
};
