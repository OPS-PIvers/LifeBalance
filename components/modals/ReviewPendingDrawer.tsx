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

  const isLast = index + 1 >= items.length;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Review (${index + 1} of ${items.length})`}
      height="tall"
      footer={
        <Button variant="ghost" className="w-full" onClick={advance}>
          {isLast ? 'Done for now' : 'Skip — add later'}
        </Button>
      }
    >
      {/* key remounts the form per item so its lazy-initialized fields reflect
          the new item. Approving or deleting resolves the current card and
          advances (onDone/onDeleted → advance); the last card closes the
          drawer. Branch by kind to render the matching per-type form. */}
      {renderReviewForm(current, advance)}
    </Drawer>
  );
};

/**
 * Renders the per-type review form for the current queue item. Each form takes
 * `onDone`/`onDeleted` = advance, so approve and delete both move to the next
 * card (the last card closes the drawer via `advance`).
 */
function renderReviewForm(current: ReviewQueueItem, advance: () => void): React.ReactNode {
  switch (current.kind) {
    case 'transaction':
      return (
        <TransactionReviewForm
          key={current.id}
          transaction={current.transaction}
          onDone={advance}
          onDeleted={advance}
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
