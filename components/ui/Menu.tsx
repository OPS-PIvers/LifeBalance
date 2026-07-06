import React from 'react';
import { Popover } from '@/components/ui/Popover';

/**
 * Visual tone of a menu action. Drives label/icon/highlight colors so a
 * destructive ("danger"), primary, or informational ("info") action reads
 * differently without each call site re-deriving Tailwind classes.
 */
export type MenuItemTone = 'default' | 'primary' | 'danger' | 'info';

export interface MenuItem {
  /** Stable React key + identity. */
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  tone?: MenuItemTone;
  /** Overrides the visible label for screen readers when it needs more context. */
  ariaLabel?: string;
}

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: MenuItem[];
  /** Required: labels the menu for assistive tech. */
  ariaLabel: string;
  /** Positioning classes relative to the trigger's `relative` wrapper. */
  position?: string;
  /** Extra panel classes — typically a width (e.g. `min-w-[208px]`). */
  className?: string;
  /**
   * Stop click propagation when an item is activated. Set for menus rendered
   * inside an otherwise-clickable surface (e.g. a HabitCard) so selecting an
   * action never also triggers the card.
   */
  stopPropagation?: boolean;
}

const TONE_LABEL: Record<MenuItemTone, string> = {
  default: 'text-brand-700 dark:text-brand-200',
  primary: 'text-accent-700 dark:text-accent-200',
  danger: 'text-money-neg dark:text-money-negDark',
  info: 'text-habit-blue dark:text-habit-blue',
};

const TONE_ICON: Record<MenuItemTone, string> = {
  default: 'text-brand-400 dark:text-brand-450',
  primary: 'text-accent-600 dark:text-accent-300',
  danger: '', // inherits the (red) label color
  info: '', // inherits the (blue) label color
};

// Hover + keyboard-focus highlight. Default/primary share the warm habit-side
// tint; danger/info tint with their own semantic color.
const TONE_BG: Record<MenuItemTone, string> = {
  default: 'hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:bg-warm-50 dark:focus:bg-warm-900/20',
  primary: 'hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:bg-warm-50 dark:focus:bg-warm-900/20',
  danger: 'hover:bg-money-bgNeg dark:hover:bg-money-neg/15 focus:bg-money-bgNeg dark:focus:bg-money-neg/15',
  info: 'hover:bg-habit-blue/10 dark:hover:bg-habit-blue/15 focus:bg-habit-blue/10 dark:focus:bg-habit-blue/15',
};

/**
 * Menu — an anchored dropdown of flat actions, built on {@link Popover}. Pass a
 * declarative `items` array; the component renders accessible `menuitem`
 * buttons with grouped-flat styling, tone-driven colors, and (via Popover)
 * click-away dismissal, Escape, focus trapping, and ArrowUp/Down roving.
 *
 * For non-list content (rich panels, radio filters) use {@link Popover}
 * directly.
 */
export const Menu: React.FC<MenuProps> = ({
  isOpen,
  onClose,
  items,
  ariaLabel,
  position,
  className,
  stopPropagation = false,
}) => {
  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      role="menu"
      ariaLabel={ariaLabel}
      ariaOrientation="vertical"
      position={position}
      className={['overflow-hidden py-1', className].filter(Boolean).join(' ')}
    >
      {items.map((item) => {
        const tone = item.tone ?? 'default';
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-label={item.ariaLabel}
            onClick={(e) => {
              if (stopPropagation) e.stopPropagation();
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            className={[
              'w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed',
              TONE_LABEL[tone],
              TONE_BG[tone],
            ].join(' ')}
          >
            {item.icon && (
              <span className={TONE_ICON[tone]} aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </Popover>
  );
};
