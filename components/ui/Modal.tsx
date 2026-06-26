import React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useFocusTrap } from '@/hooks/useFocusTrap';

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
   * If true, the dialog fills the screen as an edge-to-edge sheet on small
   * viewports (full width, near-full height via dvh + safe-area insets, square
   * corners) and reverts to the centered, rounded, `maxWidth`-capped card at the
   * `sm` breakpoint and up. Opt-in (defaults to false) so existing modals are
   * unaffected. Designed for content-dense panels (e.g. the Developer Console)
   * that need real estate on a phone. When enabled the outer gutter is removed on
   * mobile so the sheet is truly full-bleed.
   */
  fullScreenOnMobile?: boolean;
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
   * Accessible name for the dialog when there is no visible title element
   * to reference with ariaLabelledBy. If both are provided, both attributes
   * are rendered (aria-labelledby takes precedence per the spec).
   */
  ariaLabel?: string;
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
  fullScreenOnMobile = false,
  ariaLabelledBy,
  ariaLabel,
  ariaDescribedBy,
}) => {
  // Focus trap + restoration (moves focus in on open, traps Tab, restores on close).
  const contentRef = useFocusTrap<HTMLDivElement>(isOpen);

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

  // When full-screen-on-mobile, drop the outer gutter on phones (the sheet itself
  // owns the safe-area inset) and restore the standard p-4 gutter at sm+. The
  // inline safe-area padding is only meaningful for the centered desktop card, so
  // it is moved onto the sm+ media query via Tailwind below in that mode.
  const outerSafeStyle = mobileSafePadding && !fullScreenOnMobile ? {
    paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
    paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))',
  } : undefined;

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-modal flex",
        fullScreenOnMobile ? "p-0 sm:p-4" : "p-4",
        centerContent && "items-center justify-center"
      )}
      style={outerSafeStyle}
      data-testid="modal-backdrop-wrapper"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div
        className={clsx(
          "absolute inset-0 backdrop-blur-xs transition-opacity",
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
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={twMerge(
          "relative w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 outline-hidden",
          // Standardized max-height with dvh + vh fallback using supports modifier
          "max-h-[calc(100vh-10rem)] supports-[height:100dvh]:max-h-[calc(100dvh-10rem)] sm:max-h-[80vh]",
          // Mobile full-screen sheet: edge-to-edge, square corners, and fill the
          // viewport height (minus safe-area insets) on phones; everything reverts
          // at sm+ so the desktop centered card is untouched. Placed AFTER the
          // standardized rules so twMerge lets the responsive variants win on mobile.
          fullScreenOnMobile &&
            "h-[100dvh] max-h-[100dvh] supports-[height:100dvh]:max-h-[100dvh] rounded-none pt-[env(safe-area-inset-top)] pb-safe sm:h-auto sm:max-h-[80vh] sm:rounded-2xl sm:pt-0 sm:pb-0",
          maxWidth,
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
