import React from 'react';
import { GripVertical, MoreVertical } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface ListRowGrip {
  /**
   * Capture-phase pointer-down. The caller starts its drag gesture here and
   * must stopPropagation before any parent gesture layer (e.g. a horizontal
   * SwipeActionRow drag) sees the same pointer — two framer-motion gestures on
   * one pointer contend for the single global drag lock.
   */
  onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export interface ListRowMenu {
  /** Accessible name, e.g. `Options for Milk`. */
  ariaLabel: string;
  onOpen: () => void;
  /** What the kebab opens — a dropdown menu or a drawer/dialog. */
  hasPopup?: 'menu' | 'dialog';
  expanded?: boolean;
}

interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Leading control — the row's completion toggle (checkbox, action circle). */
  leading?: React.ReactNode;
  /** Trailing extras rendered between the content and the right rail (e.g. an importance star). */
  accessories?: React.ReactNode;
  /** Reorder grip; rendered in the right rail, only when the list is reorderable. */
  grip?: ListRowGrip;
  /** Kebab options trigger; rendered as the last element of the right rail. */
  menu?: ListRowMenu;
  children: React.ReactNode;
}

/**
 * ListRow — the shared anatomy for checkable list rows (shopping, to-dos,
 * habits): `[toggle] [content flex-1] [accessories] [grip?] [kebab?]`.
 *
 * The completion control is always the leftmost element, and the reorder grip
 * + options kebab live together in a right rail — never on the left, where
 * they would displace the toggle and sit in the start path of a rightward
 * swipe gesture. Gesture handling (tap, long-press, swipe) stays with the
 * caller: spread handlers onto this component via the rest props.
 */
export const ListRow: React.FC<ListRowProps> = ({
  leading,
  accessories,
  grip,
  menu,
  className,
  children,
  ...rest
}) => (
  <div className={cn('relative flex items-center gap-3 px-3 py-2.5', className)} {...rest}>
    {leading}
    <div className="flex-1 min-w-0">{children}</div>
    {accessories}
    {(grip || menu) && (
      <div className="flex items-center gap-0.5 shrink-0 -mr-1">
        {grip && (
          // Pointer-only decoration, hidden from AT: it implements no keyboard
          // reordering, and a focusable "button" that does nothing on
          // Space/Enter is a WCAG trap. Keyboard/screen-reader users manage
          // items (including ordering) through the kebab's surface instead.
          <div
            onPointerDownCapture={grip.onPointerDownCapture}
            className="touch-none cursor-grab active:cursor-grabbing p-1.5 text-brand-300 hover:text-brand-600 dark:text-brand-500 dark:hover:text-brand-300 rounded-sm"
            aria-hidden="true"
          >
            <GripVertical size={16} />
          </div>
        )}
        {menu && (
          <button
            type="button"
            onClick={menu.onOpen}
            aria-label={menu.ariaLabel}
            aria-haspopup={menu.hasPopup ?? 'menu'}
            aria-expanded={menu.expanded}
            className="p-2 text-brand-300 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-full hover:bg-brand-100 dark:hover:bg-brand-700/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
    )}
  </div>
);
