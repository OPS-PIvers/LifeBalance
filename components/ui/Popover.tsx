import React, { useEffect } from 'react';
import { twMerge } from 'tailwind-merge';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Positioning classes relative to the nearest positioned ancestor. The
   * consumer must wrap the trigger + Popover in a `relative` container — the
   * panel anchors itself to it (it is NOT portalled, so the existing
   * `top-…/right-…` anchoring keeps working). Defaults to a right-aligned
   * dropdown below the trigger.
   */
  position?: string;
  /** Extra panel classes (width, overflow, transform-origin, etc.). */
  className?: string;
  /** ARIA role for the floating panel. Anchored menus use `menu`. */
  role?: 'menu' | 'listbox' | 'dialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaOrientation?: 'vertical' | 'horizontal';
  /** Drop the default grouped-flat surface (for fully custom panels). */
  unstyled?: boolean;
}

/**
 * Popover — the single anchored floating-panel primitive for the app's
 * dropdown menus (habit actions, profile menu, store filter, …). It owns the
 * shared mechanics every hand-rolled menu used to re-implement:
 * - a transparent full-screen backdrop for click-away dismissal,
 * - Escape-to-close,
 * - focus management via {@link useFocusTrap} (focus-in on open, Tab trapping,
 *   focus restoration to the trigger on close),
 * - roving ArrowUp/Down/Home/End focus across descendant `menuitem`s
 *   (including `menuitemradio` / `menuitemcheckbox`),
 * - grouped-flat surface + entrance animation + z-index.
 *
 * It positions itself absolutely within the nearest positioned ancestor (so it
 * is NOT portalled); render it as a sibling of the trigger inside a `relative`
 * wrapper. For flat action lists prefer the higher-level {@link Menu}.
 */
export const Popover: React.FC<PopoverProps> = ({
  isOpen,
  onClose,
  children,
  position = 'top-full right-0 mt-2',
  className,
  role = 'menu',
  ariaLabel,
  ariaLabelledBy,
  ariaOrientation,
  unstyled = false,
}) => {
  // Focus trap: moves focus into the panel on open, traps Tab, and restores
  // focus to the trigger (the element focused before open) on close.
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen);

  // Escape closes from anywhere while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Roving focus across menu items (matches the ARIA menu keyboard pattern).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(
        // The whole `menuitem` family — radios (single-select filters) AND
        // checkboxes (multi-select filters, e.g. the To-Dos category filter).
        // Omitting `menuitemcheckbox` left those panels with an empty item list,
        // silently disabling roving focus.
        '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])'
      )
    );
    if (items.length === 0) return;
    e.preventDefault();
    // Keep arrow-key roving self-contained so a scrollable/list ancestor doesn't
    // also react to it.
    e.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % items.length;
        break;
      case 'ArrowUp':
        next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      default: // End
        next = items.length - 1;
        break;
    }
    items[next]?.focus();
  };

  return (
    <>
      {/* Transparent click-away backdrop. Stop propagation so a dismiss-click
          doesn't also reach a clickable ancestor (the panel isn't portalled). */}
      <div
        className="fixed inset-0 z-dropdown"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-orientation={ariaOrientation}
        onKeyDown={handleKeyDown}
        className={twMerge(
          'absolute z-dropdown outline-hidden animate-in fade-in zoom-in-95 duration-(--duration-fast)',
          position,
          !unstyled && 'surface-overlay shadow-raised',
          className
        )}
      >
        {children}
      </div>
    </>
  );
};
