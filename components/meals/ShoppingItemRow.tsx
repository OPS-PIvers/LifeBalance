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
  quickStockLists?: QuickStockList[];
  activeQuickList?: QuickStockList;
  onCheck: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  onUpdate?: (item: ShoppingItem) => void;
  onQuickListChange?: (item: ShoppingItem, newListId: string) => void;
  isReorderable?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
}

const ShoppingItemRowComponent: React.FC<ShoppingItemRowProps> = ({ item, stores, quickStockLists, activeQuickList, onCheck, onDelete, onEdit, onUpdate, onQuickListChange, isReorderable = true, onReorderDragStart, onReorderDragEnd }) => {
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

  const Content = (
    <>
      {/* Background Layer for Swipe Actions */}
      <motion.div
        className="absolute inset-0 flex items-center justify-between px-4 z-0"
        style={{ backgroundColor: bgColor }}
      >
        <motion.div style={{ opacity: rightIconOpacity, scale: rightIconScale }} className="flex items-center gap-2 text-money-pos font-bold">
           <Check size={20} />
           <span>Purchased</span>
        </motion.div>

        <motion.div style={{ opacity: leftIconOpacity, scale: leftIconScale }} className="flex items-center gap-2 font-bold ml-auto">
           {item.isPurchased ? (
             <span className="flex items-center gap-2 text-accent-600 dark:text-accent-300">
                <RotateCcw size={20} /> Uncheck
             </span>
           ) : (
             <span className="flex items-center gap-2 text-money-neg">
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
          "relative z-10 flex items-center gap-4 p-4 bg-white dark:bg-brand-800 rounded-xl border border-brand-200 dark:border-brand-700 transition-colors duration-(--duration-fast) ease-(--ease-standard)",
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
                className="touch-none cursor-grab active:cursor-grabbing p-1 text-brand-400 hover:text-brand-600 dark:text-brand-500 dark:hover:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-sm"
                aria-label={`Drag to reorder ${item.name}`}
            >
                <GripVertical size={20} />
            </div>
        )}

        {/* Checkbox (Alternative to Swipe) */}
        <button
            onClick={handleCheck}
            aria-label={item.isPurchased ? `Mark ${item.name} as not purchased` : `Mark ${item.name} as purchased`}
            className={clsx(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors shrink-0",
                item.isPurchased
                    ? "bg-money-pos border-money-pos text-white"
                    : "border-brand-300 hover:border-accent-500 text-transparent dark:border-brand-600 dark:hover:border-accent-400"
            )}
        >
            <Check size={14} strokeWidth={3} />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
            <div className={clsx(
                "font-medium break-words transition-colors",
                item.isPurchased ? "text-brand-500 dark:text-brand-400 line-through decoration-brand-400 dark:decoration-brand-600" : "text-brand-900 dark:text-brand-50"
            )}>
                {item.name}
            </div>

            {/* Metadata Chips */}
            <div className="flex flex-wrap items-center gap-2 mt-1">
                 {item.quantity && (
                    <span className="text-xs text-brand-500 bg-brand-100 dark:bg-brand-700/50 dark:text-brand-300 px-2 py-1.5 rounded-full font-medium">
                        {item.quantity}
                    </span>
                 )}
                 <div className="relative group">
                    <span className={clsx(
                        "flex items-center gap-1 text-xs px-2 py-1.5 rounded-full border whitespace-nowrap transition-colors relative z-0",
                        // Focus ring logic for accessibility (when hidden select is focused)
                        "group-focus-within:ring-2 group-focus-within:ring-accent-500/40 group-focus-within:ring-offset-1",
                        item.store && stores
                            ? (() => {
                                const storeObj = stores.find(s => s.name === item.store);
                                const colorKey = storeObj?.color || DEFAULT_STORE_COLOR;
                                const color = STORE_COLORS[colorKey] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!; // DEFAULT_STORE_COLOR is always present
                                return `${color.bg} ${color.text} ${color.border}`;
                            })()
                            : "bg-brand-100 text-brand-500 border-brand-200 dark:bg-brand-700/50 dark:text-brand-400 dark:border-brand-600"
                    )}>
                        <Store size={10} />
                        {item.store || "No store selected"}
                    </span>
                    {stores && onUpdate && (
                        <select
                            value={item.store || ""}
                            onChange={(e) => {
                                const newStore = e.target.value;
                                onUpdate({ ...item, store: newStore || undefined });
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            aria-label="Select store"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <option value="">No store selected</option>
                            {stores.map(s => (
                                <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                        </select>
                    )}
                 </div>

                 {/* Quick List Chip */}
                 {quickStockLists && onQuickListChange && (
                   <div className="relative group">
                      <span className={clsx(
                          "flex items-center gap-1 text-xs px-2 py-1.5 rounded-full border whitespace-nowrap transition-colors relative z-0",
                          "group-focus-within:ring-2 group-focus-within:ring-accent-500/40 group-focus-within:ring-offset-1",
                          activeQuickList
                              ? (() => {
                                  const colorKey = activeQuickList.color || DEFAULT_STORE_COLOR;
                                  const color = STORE_COLORS[colorKey] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!; // DEFAULT_STORE_COLOR is always present
                                  return `${color.bg} ${color.text} ${color.border}`;
                              })()
                              : "bg-brand-50 text-brand-400 border-brand-200 border-dashed hover:bg-brand-100 hover:border-brand-300 dark:bg-brand-700/40 dark:text-brand-500 dark:border-brand-600 dark:hover:bg-brand-700/60"
                      )}>
                          <ActiveIcon size={10} />
                          {activeQuickList ? activeQuickList.name : "Add to Quick List"}
                      </span>
                      <select
                          value={activeQuickList ? activeQuickList.id : ""}
                          onChange={(e) => {
                              onQuickListChange(item, e.target.value);
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          aria-label="Select Quick List"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <option value="">{activeQuickList ? "Remove from List" : "Add to Quick List"}</option>
                          {quickStockLists.map(list => (
                              <option key={list.id} value={list.id}>{list.name}</option>
                          ))}
                      </select>
                   </div>
                 )}
            </div>
        </div>

        {/* Edit Action */}
        <button
            onClick={() => onEdit(item)}
            className="p-3.5 text-brand-300 hover:text-brand-600 rounded-full hover:bg-brand-100 transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
            aria-label={`Edit ${item.name}`}
        >
            <Edit2 size={18} />
        </button>

        {/* Delete Action — keyboard/non-touch alternative to swipe-left */}
        <button
            onClick={() => { haptic('medium'); onDelete(item); }}
            className="p-3.5 text-brand-300 hover:text-money-neg rounded-full hover:bg-money-bgNeg transition-colors dark:text-brand-600 dark:hover:text-money-neg dark:hover:bg-money-neg/10"
            aria-label={`Delete ${item.name}`}
        >
            <Trash2 size={18} />
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
            className="relative overflow-hidden mb-2 rounded-xl"
            style={{ touchAction: 'pan-y' }}
            onDragStart={onReorderDragStart}
            onDragEnd={onReorderDragEnd}
        >
            {Content}
        </Reorder.Item>
    );
  }

  return (
    <div className="relative overflow-hidden mb-2 rounded-xl">
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
         prev.quickStockLists === next.quickStockLists &&
         prev.activeQuickList === next.activeQuickList &&
         prev.onUpdate === next.onUpdate &&
         prev.onQuickListChange === next.onQuickListChange &&
         prev.isReorderable === next.isReorderable &&
         prev.onReorderDragStart === next.onReorderDragStart &&
         prev.onReorderDragEnd === next.onReorderDragEnd;
};

export const ShoppingItemRow = memo(ShoppingItemRowComponent, arePropsEqual);
