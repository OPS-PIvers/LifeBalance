import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Selector matching elements that can receive keyboard focus.
 * Used by the focus trap to enumerate tabbable elements inside the dialog.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Tailwind max-width class.
   * Defaults to 'max-w-md' for standard modals, can be overridden.
   * Examples: 'max-w-sm', 'max-w-lg', 'max-w-2xl'
   */
  maxWidth?: string;
  /**
   * Optional custom class for the content container.
   */
  className?: string;
  /**
   * Whether to center content. Defaults to true.
   */
  centerContent?: boolean;
  /**
   * Background color of the backdrop. Defaults to 'bg-slate-900/60'.
   * Note: Older usages sometimes used 'bg-slate-900/50' or 'bg-slate-900/90'; these have been
   * standardized to 'bg-slate-900/60' for better contrast.
   */
  backdropColor?: string;
  /**
   * Whether to add padding-bottom for mobile safe area + navigation.
   * Defaults to true.
   */
  mobileSafePadding?: boolean;
  /**
   * If true, clicking the backdrop or pressing Escape will not close the modal.
   * Useful for processing states or critical confirmations.
   */
  disableBackdropClose?: boolean;
  /**
   * ID of the element labeling the modal (usually the title).
   * Enhances accessibility.
   */
  ariaLabelledBy?: string;
  /**
   * ID of the element describing the modal.
   * Enhances accessibility.
   */
  ariaDescribedBy?: string;
}

/**
 * Standardized Modal Component.
 * Unified Pattern:
 * - Fixed z-index (z-modal)
 * - Backdrop blur
 * - Animation (zoom-in-95)
 * - Rounded corners (rounded-2xl)
 * - Shadow (shadow-xl)
 * - Mobile safe area handling
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  maxWidth = 'max-w-md',
  className,
  centerContent = true,
  backdropColor = 'bg-slate-900/60',
  mobileSafePadding = true,
  disableBackdropClose = false,
  ariaLabelledBy,
  ariaDescribedBy,
}) => {
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Focus trap + focus restoration.
  // - Stores the element that was focused before opening.
  // - Moves focus into the dialog on open (first focusable, else the container).
  // - Restores focus to the previously-focused element on close/unmount.
  // Note: setState is never called here, so react-hooks/set-state-in-effect is satisfied.
  React.useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = contentRef.current;

    if (container) {
      const focusables = getFocusableElements(container);
      (focusables[0] ?? container).focus();
    }

    return () => {
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  // Trap Tab / Shift+Tab inside the dialog.
  React.useEffect(() => {
    if (!isOpen) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = contentRef.current;
      if (!container) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        // Nothing focusable inside; keep focus on the container.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  // Handle Escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !disableBackdropClose) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose, disableBackdropClose]);

  // Lock body scroll
  React.useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!disableBackdropClose && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={clsx(
        "fixed inset-0 z-modal flex p-4",
        centerContent && "items-center justify-center"
      )}
      style={mobileSafePadding ? {
        paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
        paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))'
      } : undefined}
      data-testid="modal-backdrop-wrapper"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div
        className={clsx(
          "absolute inset-0 backdrop-blur-sm transition-opacity",
          backdropColor
        )}
        aria-hidden="true"
      />

      {/* Content Container */}
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={twMerge(
          "relative w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 outline-none",
          // Standardized max-height with dvh + vh fallback using supports modifier
          "max-h-[calc(100vh-10rem)] supports-[height:100dvh]:max-h-[calc(100dvh-10rem)] sm:max-h-[80vh]",
          maxWidth,
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};
