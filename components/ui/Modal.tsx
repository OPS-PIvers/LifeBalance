import React, { useEffect, useState } from 'react';
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
   * Background color of the backdrop. Defaults to 'bg-slate-900/50' (or 60/90 based on usage).
   * Unifier decision: Standardize to 'bg-slate-900/60' for better contrast.
   */
  backdropColor?: string;
  /**
   * Whether to add padding-bottom for mobile safe area + navigation.
   * Defaults to true.
   */
  mobileSafePadding?: boolean;
}

/**
 * Standardized Modal Component.
 * Unified Pattern:
 * - Fixed z-index (z-[60])
 * - Backdrop blur
 * - Animation (zoom-in-95)
 * - Rounded corners (rounded-2xl)
 * - Shadow (shadow-xl/2xl)
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
}) => {
  const [show, setShow] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setShow(true);
    else {
      // Small timeout to allow exit animation if we were implementing one,
      // but standard usage here just unmounts.
      // Keeping it simple for now to match existing behavior which is "if (!isOpen) return null".
      setShow(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[60] flex p-4",
        centerContent && "items-center justify-center"
      )}
      style={mobileSafePadding ? { paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' } : undefined}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className={clsx(
          "absolute inset-0 backdrop-blur-sm transition-opacity",
          backdropColor
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Content Container */}
      <div
        className={twMerge(
          "relative w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200",
          "max-h-[calc(100dvh-10rem)] sm:max-h-[80vh]", // Standardized max-height
          maxWidth,
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};
