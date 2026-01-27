import React, { memo, useMemo } from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList, GroceryCatalogItem } from '@/types/schema';
import { Reorder, useDragControls, useMotionValue, useTransform, motion, PanInfo } from 'framer-motion';
import { GripVertical, Check, Trash2, Edit2, Store, RotateCcw, ShoppingBag } from 'lucide-react';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import clsx from 'clsx';

interface ShoppingItemRowProps {
  item: ShoppingItem;
  stores?: StoreType[];
  quickStockLists?: QuickStockList[];
  groceryCatalog?: GroceryCatalogItem[];
  onCheck: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  onUpdate?: (item: ShoppingItem) => void;
  onQuickListChange?: (item: ShoppingItem, newListId: string) => void;
  isReorderable?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (item: ShoppingItem) => void;
}

const ShoppingItemRowComponent: React.FC<ShoppingItemRowProps> = ({
  item,
  stores,
  quickStockLists,
  groceryCatalog,
  onCheck,
  onDelete,
  onEdit,
  onUpdate,
  onQuickListChange,
  isReorderable = true,
  onReorderDragStart,
  onReorderDragEnd,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection
}) => {
  const dragControls = useDragControls();
  const x = useMotionValue(0);

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
    if (isSelectionMode) return; // Disable swipe actions in selection mode
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

  // Determine active Quick List
  const activeList = useMemo(() => {
    if (!quickStockLists || !groceryCatalog) return null;
    const catalogItem = groceryCatalog.find(c => c.name.toLowerCase() === item.name.toLowerCase());
    if (!catalogItem) return null;
    return quickStockLists.find(list => list.items?.includes(catalogItem.id));
  }, [quickStockLists, groceryCatalog, item.name]);

  const ActiveIcon = activeList
    ? (TEMPLATE_ICONS.find(i => i.id === activeList.icon)?.icon || ShoppingBag)
    : ShoppingBag;

  const Content = (
    <>
      {/* Background Layer for Swipe Actions (Hidden in Selection Mode) */}
      {!isSelectionMode && (
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
      )}

      {/* Foreground Layer */}
      <motion.div
        drag={isSelectionMode ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.1} // Resistance feel
        onDragEnd={handleDragEnd}
        onClick={() => isSelectionMode && onToggleSelection?.(item)}
        style={{ x: isSelectionMode ? 0 : x, touchAction: 'pan-y' }}
        className={clsx(
          "relative z-10 flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm border transition-colors",
          item.isPurchased && !isSelectionMode ? "opacity-60 bg-gray-50 border-gray-100" : "border-gray-100",
          isSelectionMode && isSelected && "bg-brand-50 border-brand-200",
          isSelectionMode && !isSelected && "hover:bg-gray-50"
        )}
      >
        {/* Selection Checkbox OR Drag Handle */}
        {isSelectionMode ? (
          <div className={clsx(
            "w-6 h-6 flex items-center justify-center shrink-0 transition-colors",
            isSelected ? "text-brand-600" : "text-gray-300"
          )}>
             {isSelected ? (
               <div className="w-5 h-5 bg-brand-600 rounded flex items-center justify-center text-white">
                 <Check size={14} strokeWidth={3} />
               </div>
             ) : (
               <div className="w-5 h-5 border-2 border-gray-300 rounded" />
             )}
          </div>
        ) : isReorderable ? (
            <div
                onPointerDown={(e) => dragControls.start(e)}
                className="touch-none cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600"
                aria-label="Drag to reorder"
            >
                <GripVertical size={20} />
            </div>
        ) : null}

        {/* Checkbox (Standard Mode) */}
        {!isSelectionMode && (
          <button
              onClick={(e) => { e.stopPropagation(); onCheck(item); }}
              className={clsx(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors shrink-0",
                  item.isPurchased
                      ? "bg-green-500 border-green-500 text-white"
                      : "border-gray-300 hover:border-brand-500 text-transparent"
              )}
          >
              <Check size={14} strokeWidth={3} />
          </button>
        )}

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
                 <div className="relative group">
                    <span className={clsx(
                        "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border whitespace-nowrap transition-colors relative z-0",
                        // Focus ring logic for accessibility (when hidden select is focused)
                        "group-focus-within:ring-2 group-focus-within:ring-brand-500 group-focus-within:ring-offset-1",
                        item.store && stores
                            ? (() => {
                                const storeObj = stores.find(s => s.name === item.store);
                                const colorKey = storeObj?.color || DEFAULT_STORE_COLOR;
                                const color = STORE_COLORS[colorKey] || STORE_COLORS[DEFAULT_STORE_COLOR];
                                return `${color.bg} ${color.text} ${color.border}`;
                            })()
                            : "bg-gray-100 text-gray-500 border-gray-200"
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
                          "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border whitespace-nowrap transition-colors relative z-0",
                          "group-focus-within:ring-2 group-focus-within:ring-brand-500 group-focus-within:ring-offset-1",
                          activeList
                              ? (() => {
                                  const colorKey = activeList.color || DEFAULT_STORE_COLOR;
                                  const color = STORE_COLORS[colorKey] || STORE_COLORS[DEFAULT_STORE_COLOR];
                                  return `${color.bg} ${color.text} ${color.border}`;
                              })()
                              : "bg-gray-50 text-gray-400 border-gray-200 border-dashed"
                      )}>
                          <ActiveIcon size={10} />
                          {activeList ? activeList.name : "Add to Quick List"}
                      </span>
                      <select
                          value={activeList ? activeList.id : ""}
                          onChange={(e) => {
                              onQuickListChange(item, e.target.value);
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          aria-label="Select Quick List"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <option value="">{activeList ? "Remove from List" : "Add to Quick List"}</option>
                          {quickStockLists.map(list => (
                              <option key={list.id} value={list.id}>{list.name}</option>
                          ))}
                      </select>
                   </div>
                 )}
            </div>
        </div>

        {/* Edit Action (Hidden in Selection Mode) */}
        {!isSelectionMode && (
          <button
              onClick={(e) => { e.stopPropagation(); onEdit(item); }}
              className="p-2 text-gray-400 hover:text-brand-600 rounded-full hover:bg-brand-50 transition-colors"
              aria-label="Edit item"
          >
              <Edit2 size={18} />
          </button>
        )}

      </motion.div>
    </>
  );

  if (isReorderable) {
    return (
        <Reorder.Item
            value={item}
            id={item.id}
            dragListener={!isSelectionMode}
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
         prev.groceryCatalog === next.groceryCatalog &&
         prev.onUpdate === next.onUpdate &&
         prev.onQuickListChange === next.onQuickListChange &&
         prev.isReorderable === next.isReorderable &&
         prev.onReorderDragStart === next.onReorderDragStart &&
         prev.onReorderDragEnd === next.onReorderDragEnd &&
         prev.isSelectionMode === next.isSelectionMode &&
         prev.isSelected === next.isSelected &&
         prev.onToggleSelection === next.onToggleSelection;
};

export const ShoppingItemRow = memo(ShoppingItemRowComponent, arePropsEqual);
