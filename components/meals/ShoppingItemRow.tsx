import React, { memo } from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList } from '@/types/schema';
import { Reorder, useDragControls, useMotionValue, useTransform, motion, PanInfo } from 'framer-motion';
import { GripVertical, Check, Trash2, Edit2, Store, RotateCcw, ShoppingBag } from 'lucide-react';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import clsx from 'clsx';

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

  // Background color interpolation based on drag position
  const bgColor = useTransform(
    x,
    [-100, -50, 0, 50, 100],
    ['#fef2f2', '#fef2f2', '#ffffff', '#ecfdf5', '#ecfdf5'] // Tailwind red-50 / emerald-50
  );

  // Icon opacity/scale based on drag position
  const leftIconOpacity = useTransform(x, [-50, -20], [1, 0]);
  const rightIconOpacity = useTransform(x, [20, 50], [0, 1]);
  const leftIconScale = useTransform(x, [-100, -50], [1.2, 1]);
  const rightIconScale = useTransform(x, [50, 100], [1, 1.2]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const threshold = 80;
    if (info.offset.x > threshold) {
      // Swipe Right -> Check
      if (!item.isPurchased) {
        onCheck(item);
      }
    } else if (info.offset.x < -threshold) {
      // Swipe Left -> Delete or Uncheck
      if (item.isPurchased) {
        onCheck(item); // Toggle back
      } else {
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
        className="absolute inset-0 flex items-center justify-between px-4 z-0 rounded-xl"
        style={{ backgroundColor: bgColor }}
      >
        <motion.div style={{ opacity: rightIconOpacity, scale: rightIconScale }} className="flex items-center gap-2 text-green-700 font-bold">
           <Check size={20} />
           <span>Purchased</span>
        </motion.div>

        <motion.div style={{ opacity: leftIconOpacity, scale: leftIconScale }} className="flex items-center gap-2 font-bold ml-auto">
           {item.isPurchased ? (
             <span className="flex items-center gap-2 text-brand-600">
                <RotateCcw size={20} /> Uncheck
             </span>
           ) : (
             <span className="flex items-center gap-2 text-red-600">
                <Trash2 size={20} /> Delete
             </span>
           )}
        </motion.div>
      </motion.div>

      {/* Foreground Layer */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.1} // Resistance feel
        onDragEnd={handleDragEnd}
        style={{ x, touchAction: 'pan-y' }}
        className={clsx(
          "relative z-10 flex items-center gap-3 p-3.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm ring-1 ring-black/5 transition-all hover:shadow-soft",
          item.isPurchased && "opacity-60 bg-slate-50/50 grayscale"
        )}
      >
        {/* Drag Handle - Only render if reorderable */}
        {isReorderable && (
            <div
                onPointerDown={(e) => dragControls.start(e)}
                className="touch-none cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600"
                aria-label="Drag to reorder"
            >
                <GripVertical size={20} />
            </div>
        )}

        {/* Checkbox (Alternative to Swipe) */}
        <button
            onClick={() => onCheck(item)}
            className={clsx(
                "w-6 h-6 rounded-full border flex items-center justify-center transition-all shrink-0",
                item.isPurchased
                    ? "bg-emerald-500 border-emerald-500 text-white shadow-sm scale-90"
                    : "bg-white border-slate-300 hover:border-emerald-500 hover:ring-2 hover:ring-emerald-100 text-transparent"
            )}
        >
            <Check size={14} strokeWidth={3} />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
            <div className={clsx(
                "font-medium truncate transition-all text-base tracking-tight",
                item.isPurchased ? "text-slate-400 line-through decoration-slate-300" : "text-slate-900"
            )}>
                {item.name}
            </div>

            {/* Metadata Chips */}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                 {item.quantity && (
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full ring-1 ring-slate-200">
                        {item.quantity}
                    </span>
                 )}
                 <div className="relative group">
                    <span className={clsx(
                        "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors relative z-0",
                        // Focus ring logic for accessibility (when hidden select is focused)
                        "group-focus-within:ring-2 group-focus-within:ring-brand-600 group-focus-within:ring-offset-1",
                        item.store && stores
                            ? (() => {
                                const storeObj = stores.find(s => s.name === item.store);
                                const colorKey = storeObj?.color || DEFAULT_STORE_COLOR;
                                const color = STORE_COLORS[colorKey] || STORE_COLORS[DEFAULT_STORE_COLOR];
                                return `${color.bg} ${color.text} ${color.border}`;
                            })()
                            : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                    )}>
                        <Store size={10} />
                        {item.store || "No store"}
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
                          "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors relative z-0",
                          "group-focus-within:ring-2 group-focus-within:ring-brand-600 group-focus-within:ring-offset-1",
                          activeQuickList
                              ? (() => {
                                  const colorKey = activeQuickList.color || DEFAULT_STORE_COLOR;
                                  const color = STORE_COLORS[colorKey] || STORE_COLORS[DEFAULT_STORE_COLOR];
                                  return `${color.bg} ${color.text} ${color.border}`;
                              })()
                              : "bg-white text-slate-300 border-slate-200 border-dashed hover:text-brand-500 hover:border-brand-300"
                      )}>
                          <ActiveIcon size={10} />
                          {activeQuickList ? activeQuickList.name : "List"}
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
            className="p-2 text-gray-400 hover:text-brand-600 rounded-full hover:bg-brand-50 transition-colors"
            aria-label="Edit item"
        >
            <Edit2 size={18} />
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
