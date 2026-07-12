import React, { memo, useRef } from 'react';
import { ShoppingItem, Store as StoreType, QuickStockList } from '@/types/schema';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, Check, Trash2, Store, ShoppingBag } from 'lucide-react';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { haptic } from '@/utils/haptics';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { SwipeActionRow } from '@/components/ui/SwipeActionRow';
import clsx from 'clsx';

const LONG_PRESS_MS = 500;

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

  // --- Gesture model: TAP anywhere on the row (checkbox or content) toggles
  // purchased; LONG-PRESS anywhere on the row opens the edit drawer (as does
  // right-click / the keyboard context-menu key, for pointers that can't
  // long-press). Same timer pattern as ActionQueueItem: armed on pointer-down,
  // cancelled by >10px movement (that's a swipe/scroll/reorder, not a press).
  // The reorder grip stops pointer-down propagation in the capture phase, so
  // pressing it never arms the timer. ---
  const longPressTimer = useRef<number | null>(null);
  // When true, the next click on a row control is a gesture artifact and must
  // be swallowed: browsers synthesize a click from the pointer-up that ends a
  // fired long-press AND from the one that ends a horizontal swipe — without
  // this, finishing a swipe over the item name pops the edit drawer.
  const suppressClick = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button / touch contact only
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    suppressClick.current = false;
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      // Android-only in practice: a timer callback has no transient user
      // activation, so the iOS transport can't fire here (see utils/haptics.ts).
      haptic('medium');
      onEdit(item);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressTimer.current === null || !pressOrigin.current) return;
    // A press that starts moving is a swipe/scroll, not a long-press.
    if (Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y) > 10) {
      cancelLongPress();
    }
  };

  // A starting swipe both kills the pending long-press and marks the gesture's
  // terminating click as an artifact. The pointer-move cancel alone is not
  // enough: once framer-motion's drag session claims the pointer, React
  // pointermove handlers on this element stop firing.
  const handleGestureDragStart = () => {
    cancelLongPress();
    suppressClick.current = true;
  };

  // Swallow the click that ends a fired long-press or a swipe (see above).
  const consumeSuppressedClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  };

  // Check toggle with light haptic — for the content-area tap, where the
  // haptic must be triggered programmatically (dead on iOS 26.5+, works
  // elsewhere; see utils/haptics.ts).
  const handleCheck = () => {
    if (consumeSuppressedClick()) return;
    haptic('light');
    onCheck(item);
  };

  // Same toggle for the HapticCheck control, which produces its own haptic
  // (native iOS tick from the real switch input + Android vibrate).
  const handleCheckFromControl = () => {
    if (consumeSuppressedClick()) return;
    onCheck(item);
  };

  // Right-click / keyboard context-menu → edit drawer. Guarded by
  // suppressClick so a long-press that already fired (some platforms
  // synthesize contextmenu around the same ~500ms mark) doesn't open it twice.
  // suppressClick is SET only when a touch long-press is in flight (timer
  // armed): that release synthesizes a click that must be swallowed, whereas a
  // desktop right-click / keyboard menu key never produces one — setting the
  // flag there would instead swallow a later keyboard-Enter "click" (which has
  // no pointer-down to reset the flag).
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (suppressClick.current) return;
    if (longPressTimer.current !== null) suppressClick.current = true;
    cancelLongPress();
    onEdit(item);
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
    // Gmail-style swipe: right = purchased (unchecked items only — a checked
    // item's right swipe stays a no-op, so no affordance is advertised), left
    // = delete, checked or not (owner decision: swiping a checked item removes
    // it; unchecking is a tap, not a swipe). Partial swipes stick open to a
    // tappable button; SwipeActionRow handles thresholds, reveal, and haptics.
    <SwipeActionRow
      startAction={item.isPurchased ? undefined : {
        icon: Check,
        label: 'Purchased',
        tone: 'positive',
        onAction: () => onCheck(item),
      }}
      endAction={{
        icon: Trash2,
        label: 'Delete',
        tone: 'destructive',
        hapticPattern: 'medium',
        onAction: () => onDelete(item),
      }}
      onSwipeStart={handleGestureDragStart}
    >
      {/* Foreground layer — the checkbox and tap/long-press-to-edit live here.
          select-none + no touch-callout keep iOS from starting text selection /
          the share sheet during a long-press. */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={handleContextMenu}
        className={clsx(
          "relative flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-brand-800 transition-colors duration-(--duration-fast) ease-(--ease-standard) select-none [-webkit-touch-callout:none]",
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

        {/* Checkbox (Alternative to Swipe) - p-3 -m-3 enlarges tappable area to
            ~44px. HapticCheck (real switch input) so the tap fires the native
            iOS system haptic even on 26.5+. */}
        <HapticCheck
            checked={item.isPurchased}
            onCheckedChange={handleCheckFromControl}
            aria-label={item.isPurchased ? `Mark ${item.name} as not purchased` : `Mark ${item.name} as purchased`}
            className="p-3 -m-3 shrink-0"
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
        </HapticCheck>

        {/* Content — a plain TAP here toggles purchased, same as the checkbox
            (owner request: tap anywhere on the card completes the item).
            Long-press (or right-click / context-menu key) opens the edit
            drawer where store / quick-list / delete live. Deliberately NOT a
            button: it duplicates the checkbox's action for pointers only, so a
            second per-row tab stop / SR control would be pure noise — the
            checkbox is the one accessible toggle, while the name/meta here
            stay readable as plain text. */}
        <div
            onClick={handleCheck}
            className="flex-1 min-w-0 text-left"
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
        </div>

        {/* Keyboard/AT path to the edit drawer: long-press and right-click are
            pointer-only, and macOS has no context-menu key — without this,
            keyboard and screen-reader users would have no way to reach
            store/quick-list/delete. sr-only until keyboard-focused (skip-link
            pattern), so pointer users never see an extra control. */}
        <button
            type="button"
            onClick={() => { if (!consumeSuppressedClick()) onEdit(item); }}
            aria-label={`Edit ${item.name}`}
            className="sr-only focus-visible:not-sr-only focus-visible:flex-none focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:text-accent-600 dark:focus-visible:text-accent-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:rounded-sm"
        >
            Edit
        </button>

      </div>
    </SwipeActionRow>
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
