import React, { memo, useRef } from 'react';
import { ShoppingItem } from '@/types/schema';
import { Reorder, useDragControls } from 'framer-motion';
import { Check, Trash2, Plus, Clock } from 'lucide-react';
import { haptic } from '@/utils/haptics';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { SwipeActionRow, type SwipeAction } from '@/components/ui/SwipeActionRow';
import { ListRow } from '@/components/ui/ListRow';
import clsx from 'clsx';

const LONG_PRESS_MS = 500;

interface ShoppingItemRowProps {
  item: ShoppingItem;
  onCheck: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
  onEdit: (item: ShoppingItem) => void;
  /**
   * 'active' (default) is the ordinary checkbox row. 'parked' renders the
   * "Saved for later" variant: a circular outline Plus leading control
   * instead of the checkbox, and a promote (not purchase) swipe on the
   * start side. See SAVED_FOR_LATER_SPEC.md.
   */
  variant?: 'active' | 'parked';
  /** 'parked' rows only: promotes the item back to the active shopping list
   *  (tapping the leading Plus control, or a right swipe). Required when
   *  `variant === 'parked'`. */
  onPromote?: (item: ShoppingItem) => void;
  /**
   * 'active' rows only: when provided, adds a SECONDARY "Save for later"
   * swipe action beside the (still-primary) Delete. Omitted from the row's
   * actions entirely for a purchased item — a purchased item can never be
   * parked (see `toggleShoppingItemPurchased`'s guard, the reverse rule).
   */
  onSaveForLater?: (item: ShoppingItem) => void;
  isReorderable?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
}

const ShoppingItemRowComponent: React.FC<ShoppingItemRowProps> = ({
  item, onCheck, onDelete, onEdit, variant = 'active', onPromote, onSaveForLater,
  isReorderable = true, onReorderDragStart, onReorderDragEnd,
}) => {
  const dragControls = useDragControls();
  const isParked = variant === 'parked';

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
  // elsewhere; see utils/haptics.ts). A parked row has no purchased concept
  // (and the context guard would reject it anyway) — a content tap is a
  // no-op there; the row's control for promoting is the leading Plus button.
  const handleCheck = () => {
    if (consumeSuppressedClick()) return;
    if (isParked) return;
    haptic('light');
    onCheck(item);
  };

  // Same toggle for the HapticCheck control, which produces its own haptic
  // (native iOS tick from the real switch input + Android vibrate).
  const handleCheckFromControl = () => {
    if (consumeSuppressedClick()) return;
    onCheck(item);
  };

  // Leading-control promote for a parked row. Not a toggle (no "checked"
  // state to reflect), so this is a plain button rather than HapticCheck.
  const handlePromote = () => {
    if (consumeSuppressedClick()) return;
    haptic('light');
    onPromote?.(item);
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

  // Parked rows: right swipe = promote (positive), left swipe = delete
  // (destructive) — no purchased concept at all. Active rows: right swipe =
  // purchased (unchecked items only — a checked item's right swipe stays a
  // no-op, so no affordance is advertised); left swipe keeps Delete as the
  // PRIMARY (zero muscle-memory change) with "Save for later" as a
  // SECONDARY, reachable once the row sticks open — never for a purchased
  // item, which can't be parked.
  const startActions: SwipeAction[] | undefined = isParked
    ? [{
        icon: Plus,
        label: 'Move to list',
        // No custom ariaLabel: the leading control already carries "Move
        // {name} to your shopping list" (see below) — a matching label on
        // this stuck-open swipe button would be an ambiguous duplicate
        // accessible name within the same row.
        tone: 'positive',
        onAction: () => onPromote?.(item),
      }]
    : item.isPurchased
      ? undefined
      : [{
          icon: Check,
          label: 'Purchased',
          tone: 'positive',
          onAction: () => onCheck(item),
        }];

  const endActions: SwipeAction[] = isParked
    ? [{
        icon: Trash2,
        label: 'Delete',
        tone: 'destructive',
        hapticPattern: 'medium',
        onAction: () => onDelete(item),
      }]
    : [
        {
          icon: Trash2,
          label: 'Delete',
          tone: 'destructive',
          hapticPattern: 'medium',
          onAction: () => onDelete(item),
        },
        ...(!item.isPurchased && onSaveForLater ? [{
          icon: Clock,
          label: 'Save for later',
          ariaLabel: `Save ${item.name} for later`,
          tone: 'warm',
          onAction: () => onSaveForLater(item),
        } satisfies SwipeAction] : []),
      ];

  const Content = (
    // Partial swipes stick open to a tappable button; SwipeActionRow handles
    // thresholds, reveal, and haptics.
    <SwipeActionRow
      startActions={startActions}
      endActions={endActions}
      onSwipeStart={handleGestureDragStart}
    >
      {/* Foreground layer — the checkbox and tap/long-press-to-edit live here.
          ListRow gives the standard anatomy: [checkbox] [content] [grip][kebab],
          with the grip in the right rail so it stays out of the start path of
          the rightward "purchased" swipe. select-none + no touch-callout keep
          iOS from starting text selection / the share sheet during a long-press. */}
      <ListRow
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={handleContextMenu}
        className={clsx(
          "bg-white dark:bg-brand-800 transition-colors duration-(--duration-fast) ease-(--ease-standard) select-none [-webkit-touch-callout:none]",
          item.isPurchased && "opacity-70 bg-brand-50 dark:bg-brand-800/60"
        )}
        leading={
          isParked ? (
            /* Parked leading control: a circular outline Plus (reusing the
               checkbox's exact geometry — w-5 h-5 rounded-full border-2 —
               accent-toned rather than money-pos) that PROMOTES the item.
               A plain button, not HapticCheck: there is no "checked" state
               to reflect, only a one-way action. */
            <button
              type="button"
              onClick={handlePromote}
              aria-label={`Move ${item.name} to your shopping list`}
              className="p-3 -m-3 shrink-0"
            >
              <span className="w-5 h-5 rounded-full border-2 border-accent-400 hover:border-accent-500 flex items-center justify-center text-accent-500 dark:border-accent-500 dark:hover:border-accent-400 dark:text-accent-400 transition-colors">
                <Plus size={12} strokeWidth={3} />
              </span>
            </button>
          ) : (
            /* Checkbox (Alternative to Swipe) - p-3 -m-3 enlarges tappable area to
               ~44px. HapticCheck (real switch input) so the tap fires the native
               iOS system haptic even on 26.5+. */
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
          )
        }
        grip={isReorderable ? {
            onPointerDownCapture: (e) => {
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
            },
        } : undefined}
        menu={{
            // Visible, focusable path to the edit drawer (store / quick-list /
            // delete). This is also the keyboard/AT route — long-press and
            // right-click are pointer-only — replacing the old sr-only Edit
            // button. Guarded like every row control against the synthetic
            // click that ends a swipe or fired long-press.
            ariaLabel: `Options for ${item.name}`,
            hasPopup: 'dialog',
            onOpen: () => { if (!consumeSuppressedClick()) onEdit(item); },
        }}
      >
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
            className="text-left"
        >
            <div className={clsx(
                "text-sm font-medium truncate transition-colors",
                item.isPurchased ? "text-brand-500 dark:text-brand-400 line-through decoration-brand-400 dark:decoration-brand-600" : "text-brand-900 dark:text-brand-50"
            )}>
                {item.name}
            </div>

            {/* Store / quick-list chips and quantity are deliberately NOT shown
                here (owner decision, F-2G paper cuts): they're filter/metrics
                info, not needed at a glance, and stay in the edit drawer, the
                CSV export, and the shared text. */}
        </div>
      </ListRow>
    </SwipeActionRow>
  );

  // Global search deep-link target (see hooks/useScrollToHighlight) — derived
  // from `item.id` rather than taken as a prop deliberately: this component is
  // memoized with a hand-written field-by-field comparator below, which a new
  // prop would have to join, and the flash is applied imperatively via DOM
  // classList so no render-time state is involved either way.
  if (isReorderable) {
    return (
        <Reorder.Item
            value={item}
            id={item.id}
            data-highlight-target={item.id}
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
    <div data-highlight-target={item.id} className="relative overflow-hidden bg-white dark:bg-brand-800 hairline-divider">
        {Content}
    </div>
  );
};

const arePropsEqual = (prev: ShoppingItemRowProps, next: ShoppingItemRowProps) => {
  const prevItem = prev.item;
  const nextItem = next.item;

  // Deep compare item fields to handle Firestore reference instability.
  // quantity is deliberately excluded — the row never renders it (it stays in
  // the edit drawer/CSV export/shared text only), so a quantity-only change
  // must not force a re-render here.
  const isItemEqual =
    prevItem.id === nextItem.id &&
    prevItem.name === nextItem.name &&
    prevItem.category === nextItem.category &&
    prevItem.store === nextItem.store &&
    prevItem.isPurchased === nextItem.isPurchased &&
    prevItem.notes === nextItem.notes &&
    prevItem.addedFromMealId === nextItem.addedFromMealId &&
    prevItem.order === nextItem.order &&
    prevItem.savedForLater === nextItem.savedForLater;

  return isItemEqual &&
         prev.onCheck === next.onCheck &&
         prev.onDelete === next.onDelete &&
         prev.onEdit === next.onEdit &&
         prev.variant === next.variant &&
         prev.onPromote === next.onPromote &&
         prev.onSaveForLater === next.onSaveForLater &&
         prev.isReorderable === next.isReorderable &&
         prev.onReorderDragStart === next.onReorderDragStart &&
         prev.onReorderDragEnd === next.onReorderDragEnd;
};

export const ShoppingItemRow = memo(ShoppingItemRowComponent, arePropsEqual);
