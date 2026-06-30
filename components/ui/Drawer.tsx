import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Optional fixed header content (won't scroll) */
  header?: React.ReactNode;
  /**
   * Optional fixed footer content rendered as a shrink-0 bar BELOW the
   * scrollable body (won't scroll). Use for sticky action bars (Save/Cancel)
   * so the body remains the single scroll container — avoids nesting a second
   * scroller inside the drawer body.
   */
  footer?: React.ReactNode;
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
  /**
   * Height behavior of the sheet.
   * - `'auto'` (default): sizes to content, capped at 90% of the viewport.
   *   Best for short, single-purpose drawers (confirmations, quick actions).
   * - `'tall'`: a fixed tall detent (~90% of the viewport). Best for
   *   multi-tab / multi-step drawers (e.g. Capture) so the frame stays stable
   *   and the body scrolls internally instead of the sheet resizing as its
   *   content changes between tabs or steps.
   */
  height?: 'auto' | 'tall';
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  header,
  footer,
  children,
  className,
  noPadding = false,
  ariaLabelledBy,
  ariaLabel,
  disableClose = false,
  height = 'auto'
}) => {
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  // Drag-to-dismiss is driven manually from the handle bar only (see below).
  // Without this, `drag="y"` on the whole sheet treats an inner body scroll as a
  // sheet drag — so scrolling the content bounces the sheet and can trip the
  // close threshold. Gating the drag to the handle lets the body scroll natively
  // (like an iOS sheet) while still allowing swipe-down-to-close from the grip.
  const dragControls = useDragControls();
  // Focus trap + restoration (moves focus in on open, traps Tab, restores on close).
  const contentRef = useFocusTrap<HTMLDivElement>(isOpen);

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
            className="fixed inset-0 z-modal bg-brand-900/60"
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
              // `dvh` tracks the *visible* viewport, so the sheet (and its CTA)
              // isn't hidden behind the iOS software keyboard. `vh` is kept as a
              // fallback for browsers without dvh support.
              "fixed bottom-0 left-0 right-0 z-modal bg-white dark:bg-brand-800 border-t border-x border-brand-200 dark:border-brand-700 rounded-t-card shadow-raised max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] flex flex-col outline-hidden",
              // Fixed detent: stable frame that scrolls internally instead of
              // resizing as content changes between tabs/steps.
              height === 'tall' && "h-[90vh] supports-[height:100dvh]:h-[90dvh]",
              className
            )}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
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
             {/* Handle bar — the sole drag-to-dismiss affordance. Starting the
                 drag here (rather than on the whole sheet) keeps body scrolling
                 from being misread as a swipe-to-close. */}
             <div
               className={twMerge(
                 "w-full flex justify-center pt-3 pb-1 touch-none",
                 disableClose ? "cursor-default" : "cursor-grab active:cursor-grabbing"
               )}
               onPointerDown={(e) => { if (!disableClose) dragControls.start(e); }}
             >
               <div className="w-12 h-1.5 bg-brand-300 dark:bg-brand-600 rounded-full" />
             </div>

             {/* Header */}
             {title && (
               <div className="px-4 py-3 flex items-center justify-between border-b border-brand-200 dark:border-brand-700 shrink-0">
                 <h3 id={titleId} className="font-display font-semibold text-lg text-brand-800 dark:text-brand-100">{title}</h3>
                 <button onClick={onClose} className="p-2 text-brand-400 hover:text-brand-600 rounded-full hover:bg-brand-100 dark:text-brand-500 dark:hover:text-brand-200 dark:hover:bg-brand-700" aria-label="Close drawer" disabled={disableClose}>
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
             <div className={twMerge("scroll-contain-y flex-1", !footer && "pb-safe", !noPadding && "p-4")}>
               {children}
             </div>

             {/* Footer (fixed; sits below the scrollable body) */}
             {footer && (
               <div className="shrink-0 pb-safe">
                 {footer}
               </div>
             )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};
