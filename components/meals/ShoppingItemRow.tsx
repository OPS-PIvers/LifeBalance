import React, { memo } from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList } from '@/types/schema';
import { Reorder, useDragControls, useMotionValue, useTransform, motion, PanInfo } from 'framer-motion';
import { GripVertical, Check, Trash2, Edit2, Store, RotateCcw, ShoppingBag } from 'lucide-react';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { haptic } from '@/utils/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import clsx from 'clsx';

// Swipe affordance background colors per theme.
const SWIPE_COLORS = {
  light: { delete: '#fbeeec', default: '#ffffff', complete: '#eef6f1' }, // money-bgNeg / white / money-bgPos
  dark: { delete: '#3f1d2b', default: '#242220', complete: '#0f2e23' },   // money-neg tint / brand-800 / money-pos tint
};

interface ShoppingItemRowProps {
  item: ShoppingItem;
  stores?: StoreType[];
  activeQuickList?: QuickStockList;
  onCheck: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  isReorderable?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
}

const ShoppingItemRowComponent: React.FC<ShoppingItemRowProps> = ({ item, stores, activeQuickList, onCheck, onDelete, onEdit, isReorderable = true, onReorderDragStart, onReorderDragEnd }) => {
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const isDark = useMediaQuery('(prefers-color-scheme: dark)') ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const palette = isDark ? SWIPE_COLORS.dark : SWIPE_COLORS.light;

  // Background color interpolation based on drag position
  const bgColor = useTransform(
    x,
    [-100, -50, 0, 50, 100],
    [
      palette.delete,
      palette.delete,
      palette.default,
      palette.complete,
      palette.complete
    ]
  );

  // Icon opacity/scale based on drag position
  const leftIconOpacity = useTransform(x, [-50, -20], [1, 0]);
  const rightIconOpacity = useTransform(x, [20, 50], [0, 1]);
  const leftIconScale = useTransform(x, [-100, -50], [1.2, 1]);
  const rightIconScale = useTransform(x, [50, 100], [1, 1.2]);

  // Check toggle with light haptic.
  const handleCheck = () => {
    haptic('light');
    onCheck(item);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const threshold = 80;
    if (info.offset.x > threshold) {
      // Swipe Right -> Check
      if (!item.isPurchased) {
        haptic('light');
        onCheck(item);
      }
    } else if (info.offset.x < -threshold) {
      // Swipe Left -> Delete or Uncheck
      if (item.isPurchased) {
        haptic('light');
        onCheck(item); // Toggle back
      } else {
        haptic('medium');
        onDelete(item);
      }
    }
  };

  const ActiveIcon = activeQuickList
    ? (TEMPLATE_ICONS.find(i => i.id === activeQuickList.icon)?.icon || ShoppingBag)
    : ShoppingBag;

  // Resolve store/quick-list tint once (read-only display; editing lives in the drawer).
  // Match case-insensitively so the tint resolves even with casing drift (e.g. "Costco" vs "costco").
  const storeName = item.store?.toLowerCase();
  const storeObj = storeName && stores ? stores.find(s => s.name.toLowerCase() === storeName) : undefined;
  const storeColor = STORE_COLORS[storeObj?.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!;
  const listColor = activeQuickList
    ? (STORE_COLORS[activeQuickList.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!)
    : null;

  const hasMeta = Boolean(item.quantity || item.store || activeQuickList);

  const Content = (
    <>
      {/* Background Layer for Swipe Actions */}
      <motion.div
        className="absolute inset-0 flex items-center justify-between px-4 z-0"
        style={{ backgroundColor: bgColor }}
      >
        <motion.div style={{ opacity: rightIconOpacity, scale: rightIconScale }} className="flex items-center gap-2 text-money-pos dark:text-money-posDark font-bold">
           <Check size={20} />
           <span>Purchased</span>
        </motion.div>

        <motion.div style={{ opacity: leftIconOpacity, scale: leftIconScale }} className="flex items-center gap-2 font-bold ml-auto">
           {item.isPurchased ? (
             <span className="flex items-center gap-2 text-accent-600 dark:text-accent-300">
                <RotateCcw size={20} /> Uncheck
             </span>
           ) : (
             <span className="flex items-center gap-2 text-money-neg dark:text-money-negDark">
                <Trash2 size={20} /> Delete
             </span>
           )}
        </motion.div>
      </motion.div>

      {/* Foreground Layer — drag disabled under reduced motion; checkbox/edit buttons remain. */}
      <motion.div
        drag={reduceMotion ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.1} // Resistance feel
        onDragEnd={reduceMotion ? undefined : handleDragEnd}
        style={{ x, touchAction: 'pan-y' }}
        className={clsx(
          "relative z-10 flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-brand-800 transition-colors duration-(--duration-fast) ease-(--ease-standard)",
          item.isPurchased && "opacity-70 bg-brand-50 dark:bg-brand-800/60"
        )}
      >
        {/* Drag Handle - Only render if reorderable */}
        {isReorderable && (
            <div
                role="button"
                tabIndex={0}
                onPointerDownCapture={(e) => {
                    // Only react to the primary button / touch contact. Without this,
                    // a right-click on the handle would be swallowed (blocking the
                    // context menu) and would needlessly start a drag.
                    if (e.button !== 0) return;
                    // Start ONLY the vertical reorder gesture from the handle, and
                    // stop the pointer event in the capture phase before it reaches
                    // the parent swipe layer's `drag="x"` listener. Otherwise both
                    // framer-motion drag gestures start on the same pointer and
                    // contend for the single global drag lock: the losing gesture's
                    // onMove silently no-ops and the conflicted pointer-up can skip
                    // the Reorder.Item's onDragEnd, which leaves the item visually
                    // "stuck" (dark) and un-draggable until a full page reload.
                    e.stopPropagation();
                    dragControls.start(e);
                }}
                onKeyDown={(e) => {
                    // Space/Enter don't initiate drag but ensure the element is reachable
                    // by keyboard; actual reorder via keyboard is handled by edit flow.
                    if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                    }
                }}
                className="touch-none cursor-grab active:cursor-grabbing -ml-1 p-1 text-brand-300 hover:text-brand-600 dark:text-brand-500 dark:hover:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-sm shrink-0"
                aria-label={`Drag to reorder ${item.name}`}
            >
                <GripVertical size={16} />
            </div>
        )}

        {/* Checkbox (Alternative to Swipe) - p-3 -m-3 enlarges tappable area to ~44px */}
        <button
            onClick={handleCheck}
            aria-label={item.isPurchased ? `Mark ${item.name} as not purchased` : `Mark ${item.name} as purchased`}
            className="group p-3 -m-3 shrink-0"
        >
            <span
                className={clsx(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                    item.isPurchased
                        ? "bg-money-pos border-money-pos text-white"
                        : "border-brand-300 group-hover:border-accent-500 text-transparent dark:border-brand-600 dark:group-hover:border-accent-400"
                )}
            >
                <Check size={12} strokeWidth={3} />
            </span>
        </button>

        {/* Content — tap opens the edit drawer where store / quick-list / delete live. */}
        <button
            type="button"
            onClick={() => onEdit(item)}
            className="flex-1 min-w-0 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-sm"
            aria-label={`Edit ${item.name}`}
        >
            <div className={clsx(
                "text-sm font-medium truncate transition-colors",
                item.isPurchased ? "text-brand-500 dark:text-brand-400 line-through decoration-brand-400 dark:decoration-brand-600" : "text-brand-900 dark:text-brand-50"
            )}>
                {item.name}
            </div>

            {/* Compact read-only metadata — only rendered when present */}
            {hasMeta && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {item.quantity && (
                        <span className="text-xxs font-medium text-brand-500 dark:text-brand-400">
                            {item.quantity}
                        </span>
                    )}
                    {item.store && (
                        <span className={clsx(
                            "flex items-center gap-1 text-xxs px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                            storeColor.bg, storeColor.text, storeColor.border
                        )}>
                            <Store size={9} />
                            {item.store}
                        </span>
                    )}
                    {activeQuickList && listColor && (
                        <span className={clsx(
                            "flex items-center gap-1 text-xxs px-1.5 py-0.5 rounded-full border whitespace-nowrap",
                            listColor.bg, listColor.text, listColor.border
                        )}>
                            <ActiveIcon size={9} />
                            {activeQuickList.name}
                        </span>
                    )}
                </div>
            )}
        </button>

        {/* Edit Action */}
        <button
            onClick={() => onEdit(item)}
            className="shrink-0 p-2 text-brand-300 hover:text-brand-600 rounded-full hover:bg-brand-100 transition-colors dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
            aria-label={`Edit ${item.name}`}
        >
            <Edit2 size={16} />
        </button>

      </motion.div>
    </>
  );

  if (isReorderable) {
    return (
        <Reorder.Item
            value={item}
            id={item.id}
            dragListener={false}
            dragControls={dragControls}
            className="relative overflow-hidden bg-white dark:bg-brand-800 hairline-divider"
            style={{ touchAction: 'pan-y' }}
            onDragStart={onReorderDragStart}
            onDragEnd={onReorderDragEnd}
        >
            {Content}
        </Reorder.Item>
    );
  }

  return (
    <div className="relative overflow-hidden bg-white dark:bg-brand-800 hairline-divider">
        {Content}
    </div>
  );
};

const arePropsEqual = (prev: ShoppingItemRowProps, next: ShoppingItemRowProps) => {
  const prevItem = prev.item;
  const nextItem = next.item;

  // Deep compare item fields to handle Firestore reference instability
  const isItemEqual =
    prevItem.id === nextItem.id &&
    prevItem.name === nextItem.name &&
    prevItem.category === nextItem.category &&
    prevItem.store === nextItem.store &&
    prevItem.quantity === nextItem.quantity &&
    prevItem.isPurchased === nextItem.isPurchased &&
    prevItem.notes === nextItem.notes &&
    prevItem.addedFromMealId === nextItem.addedFromMealId &&
    prevItem.order === nextItem.order;

  return isItemEqual &&
         prev.onCheck === next.onCheck &&
         prev.onDelete === next.onDelete &&
         prev.onEdit === next.onEdit &&
         prev.stores === next.stores &&
         prev.activeQuickList === next.activeQuickList &&
         prev.isReorderable === next.isReorderable &&
         prev.onReorderDragStart === next.onReorderDragStart &&
         prev.onReorderDragEnd === next.onReorderDragEnd;
};

export const ShoppingItemRow = memo(ShoppingItemRowComponent, arePropsEqual);
