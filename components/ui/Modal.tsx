import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
 * - Fixed z-index (z-[60])
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
        "fixed inset-0 z-[60] flex p-4",
        centerContent && "items-center justify-center"
      )}
      style={mobileSafePadding ? { paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
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
        className={twMerge(
          "relative w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200",
          "max-h-[calc(100vh-10rem)] max-h-[calc(100dvh-10rem)] sm:max-h-[80vh]", // Standardized max-height with dvh + vh fallback
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
