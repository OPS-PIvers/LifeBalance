import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-modal bg-slate-900/60 backdrop-blur-sm"
            onClick={disableClose ? undefined : onClose}
            data-testid="drawer-backdrop"
            aria-hidden="true"
          />

          {/* Drawer Content */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
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
