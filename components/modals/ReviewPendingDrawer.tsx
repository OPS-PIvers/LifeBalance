import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import TransactionReviewForm from '@/components/transactions/TransactionReviewForm';
import ShoppingReviewForm from '@/components/transactions/ShoppingReviewForm';
import TodoReviewForm from '@/components/transactions/TodoReviewForm';
import type { ReviewQueueItem } from '@/utils/reviewQueue';

export type { ReviewQueueItem } from '@/utils/reviewQueue';

interface ReviewPendingDrawerProps {
  /**
   * Snapshot of the held-for-review items taken when the drawer opened — a
   * mixed queue of pending transactions, to-dos, and shopping captures. A
   * snapshot (not the live lists) so approvals/deletes shrinking the underlying
   * lists don't reshuffle indices mid-cycle.
   */
  items: ReviewQueueItem[];
  isOpen: boolean;
  /** Closes the whole drawer; any un-reviewed items stay in their Action Queue / lists. */
  onClose: () => void;
}

/**
 * On-app-open cycler for held-for-review captures across ALL types. Shows ONE
 * item at a time in its per-type review form — the user verifies/edits the
 * fields and approves, or skips to the next. Skipped transactions stay in the
 * Action Queue; skipped to-dos/shopping items stay held (`needsReview`) until a
 * later app-open re-surfaces them.
 *
 * Nothing is stamped on the docs merely by opening: the drawer re-opens on the
 * next app-open while any un-snoozed pending_review transactions (in expense
 * `review` mode) or held to-do/shopping captures remain.
 *
 * Pure controlled component (items + isOpen + onClose, no internal data
 * fetching) so a later layer can also open it from the Action Queue.
 *
 * Lazy-mounted from MainLayout so the Drawer + framer-motion stay out of the
 * boot bundle.
 */
const ReviewPendingDrawer: React.FC<ReviewPendingDrawerProps> = ({ items, isOpen, onClose }) => {
  const [index, setIndex] = useState(0);
  // Footer slot for the transaction form's own Approve/Delete pair. Held as
  // state (not a ref) so attaching the node re-renders and hands it down;
  // `setActionsSlot` is a stable callback ref and React nulls it on unmount.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const current = items[index];

  const advance = () => {
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      // Keep `index` on the last card so `current` stays defined through the
      // Drawer's exit animation; the parent flips isOpen to actually close.
      onClose();
    }
  };

  if (!current) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Review (${index + 1} of ${items.length})`}
      height="tall"
      footer={
        <div
          data-testid="review-drawer-footer"
          className="flex flex-col gap-2 border-t border-brand-200 dark:border-brand-700 p-4"
        >
          {/* Slot the transaction form portals its Approve + Delete pair into,
              so the primary money action sits WITH Skip in the sticky bar
              instead of competing with it from the bottom of a long scroll.
              Only the transaction form opts in; the shopping/to-do forms are
              short enough to keep their own in-body CTAs. */}
          {current.kind === 'transaction' && <div ref={setActionsSlot} />}
          {/* ONE label for both cases. The button used to read "Skip — add
              later" mid-queue and something else on the last card, which put
              two names on one control for no gain: either way it defers this
              item without resolving it, and on the last card deferring is also
              what closes the drawer. */}
          <Button variant="ghost" className="w-full" onClick={advance}>
            Skip — add later
          </Button>
        </div>
      }
    >
      {/* key remounts the form per item so its lazy-initialized fields reflect
          the new item. Approving or deleting resolves the current card and
          advances (onDone/onDeleted → advance); the last card closes the
          drawer. Branch by kind to render the matching per-type form. */}
      {renderReviewForm(current, advance, actionsSlot)}
    </Drawer>
  );
};

/**
 * Renders the per-type review form for the current queue item. Each form takes
 * `onDone`/`onDeleted` = advance, so approve and delete both move to the next
 * card (the last card closes the drawer via `advance`).
 *
 * `actionsSlot` is the footer node the transaction form portals its own
 * Approve/Delete pair into — it stays the form's markup and the form's
 * validation, only the DOM position moves.
 */
function renderReviewForm(
  current: ReviewQueueItem,
  advance: () => void,
  actionsSlot: HTMLDivElement | null,
): React.ReactNode {
  switch (current.kind) {
    case 'transaction':
      return (
        <TransactionReviewForm
          key={current.id}
          transaction={current.transaction}
          onDone={advance}
          onDeleted={advance}
          actionsContainer={actionsSlot}
        />
      );
    case 'shopping':
      return (
        <ShoppingReviewForm
          key={current.id}
          item={current.item}
          onDone={advance}
          onDeleted={advance}
        />
      );
    case 'todo':
      return (
        <TodoReviewForm
          key={current.id}
          item={current.item}
          onDone={advance}
          onDeleted={advance}
        />
      );
  }
}

export default ReviewPendingDrawer;
