import React, { useRef, useState, useEffect } from 'react';
import { ShoppingItem } from '@/types/schema';
import { Reorder, useDragControls, useMotionValue, useTransform, motion, PanInfo, AnimatePresence } from 'framer-motion';
import { GripVertical, Check, Trash2, Edit2, Store, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

interface ShoppingItemRowProps {
  item: ShoppingItem;
  onCheck: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
}

export const ShoppingItemRow: React.FC<ShoppingItemRowProps> = ({ item, onCheck, onDelete, onEdit }) => {
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const [swiped, setSwiped] = useState<'left' | 'right' | null>(null);

  // Background color interpolation based on drag position
  const bgColor = useTransform(
    x,
    [-100, -50, 0, 50, 100],
    ['#fee2e2', '#fee2e2', '#ffffff', '#d1fae5', '#d1fae5']
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

  return (
    <Reorder.Item
      value={item}
      id={item.id}
      dragListener={false}
      dragControls={dragControls}
      className="relative overflow-hidden mb-2 rounded-xl"
      style={{ touchAction: 'pan-y' }}
    >
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
          "relative z-10 flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm border border-gray-100",
          item.isPurchased && "opacity-60 bg-gray-50"
        )}
      >
        {/* Drag Handle */}
        <div
            onPointerDown={(e) => dragControls.start(e)}
            className="touch-none cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600"
            aria-label="Drag to reorder"
        >
            <GripVertical size={20} />
        </div>

        {/* Checkbox (Alternative to Swipe) */}
        <button
            onClick={() => onCheck(item)}
            className={clsx(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors shrink-0",
                item.isPurchased
                    ? "bg-green-500 border-green-500 text-white"
                    : "border-gray-300 hover:border-brand-500 text-transparent"
            )}
        >
            <Check size={14} strokeWidth={3} />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
            <div className={clsx(
                "font-medium truncate transition-all",
                item.isPurchased ? "text-gray-500 line-through decoration-gray-400" : "text-gray-900"
            )}>
                {item.name}
            </div>

            {/* Metadata Chips */}
            <div className="flex flex-wrap items-center gap-2 mt-1">
                 {item.quantity && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {item.quantity}
                    </span>
                 )}
                 {item.store && (
                    <span className="flex items-center gap-1 text-xs text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-100">
                        <Store size={10} />
                        {item.store}
                    </span>
                 )}
                 {/* Category as optional metadata if needed, but user said not to display store categories.
                     Assuming they meant grouping. I'll hide category chip for cleaner look unless essential.
                     Maybe show it if it's not "Uncategorized" and not redundant?
                     User said: "store chip [store chip] [any other store chips]".
                     I'll stick to store for now.
                  */}
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
    </Reorder.Item>
  );
};
