import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { useReducedMotion } from '@/hooks/useReducedMotion';

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

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Optional fixed header content (won't scroll) */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Disable default content padding */
  noPadding?: boolean;
  /** Accessibility: ID of element that labels this drawer */
  ariaLabelledBy?: string;
  /** Accessibility: Label for this drawer (used if no ariaLabelledBy or title) */
  ariaLabel?: string;
  /** Prevent closing via backdrop, escape, or swipe */
  disableClose?: boolean;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  header,
  children,
  className,
  noPadding = false,
  ariaLabelledBy,
  ariaLabel,
  disableClose = false
}) => {
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Focus trap + focus restoration.
  // - Stores the element that was focused before opening.
  // - Moves focus into the drawer on open (first focusable, else the container).
  // - Restores focus to the previously-focused element on close/unmount.
  // Note: setState is never called here, so react-hooks/set-state-in-effect is satisfied.
  useEffect(() => {
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

  // Trap Tab / Shift+Tab inside the drawer.
  useEffect(() => {
    if (!isOpen) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = contentRef.current;
      if (!container) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
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

    window.addEventListener('keydown', handleTab);
    return () => window.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || disableClose) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, disableClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="fixed inset-0 z-modal bg-slate-900/60 backdrop-blur-sm"
            onClick={disableClose ? undefined : onClose}
            data-testid="drawer-backdrop"
            aria-hidden="true"
          />

          {/* Drawer Content */}
          <motion.div
            ref={contentRef}
            tabIndex={-1}
            initial={reduceMotion ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduceMotion ? { y: 0 } : { y: '100%' }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 200 }}
            className={twMerge(
              "fixed bottom-0 left-0 right-0 z-modal bg-white rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col outline-none",
              className
            )}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (!disableClose && (info.offset.y > 100 || info.velocity.y > 500)) {
                onClose();
              }
            }}
            data-testid="drawer-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy || (title ? titleId : undefined)}
            aria-label={!ariaLabelledBy && !title ? ariaLabel : undefined}
          >
             {/* Handle bar for visual cue */}
             <div className="w-full flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing touch-none" onClick={(e) => e.stopPropagation()}>
               <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
             </div>

             {/* Header */}
             {title && (
               <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 shrink-0">
                 <h3 id={titleId} className="font-bold text-lg text-slate-800">{title}</h3>
                 <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100" aria-label="Close drawer" disabled={disableClose}>
                   <X size={20} />
                 </button>
               </div>
             )}

             {/* Custom Header (fixed, won't scroll) */}
             {header && (
               <div className="shrink-0">
                 {header}
               </div>
             )}

             {/* Content */}
             <div className={twMerge("scroll-contain-y flex-1 pb-safe", !noPadding && "p-4")}>
               {children}
             </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};
