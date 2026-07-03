import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import TransactionReviewForm from '@/components/transactions/TransactionReviewForm';
import type { Transaction } from '@/types/schema';

interface ReviewPendingDrawerProps {
  /**
   * Snapshot of the pending_review transactions taken when the drawer opened. A
   * snapshot (not the live list) so approvals/deletes shrinking `transactions`
   * don't reshuffle indices mid-cycle.
   */
  transactions: Transaction[];
  isOpen: boolean;
  /** Closes the whole drawer; any un-reviewed transactions stay in the Action Queue. */
  onClose: () => void;
}

/**
 * On-app-open cycler for un-snoozed `pending_review` transactions. Shows ONE
 * transaction at a time in the shared review form — the user verifies (enters/
 * confirms the amount + category + account, tags habits) and approves, or skips
 * to the next. Skipped transactions stay in the Action Queue.
 *
 * Unlike the old awaiting-amount flow, NOTHING is stamped on the docs: the
 * drawer simply re-opens on the next app-open while any un-snoozed
 * pending_review transactions remain.
 *
 * Lazy-mounted from MainLayout so the Drawer + framer-motion stay out of the
 * boot bundle.
 */
const ReviewPendingDrawer: React.FC<ReviewPendingDrawerProps> = ({ transactions, isOpen, onClose }) => {
  const [index, setIndex] = useState(0);
  const current = transactions[index];

  const advance = () => {
    if (index + 1 < transactions.length) {
      setIndex(index + 1);
    } else {
      // Keep `index` on the last card so `current` stays defined through the
      // Drawer's exit animation; the parent flips isOpen to actually close.
      onClose();
    }
  };

  if (!current) return null;

  const isLast = index + 1 >= transactions.length;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Review (${index + 1} of ${transactions.length})`}
      height="tall"
      footer={
        <Button variant="ghost" className="w-full" onClick={advance}>
          {isLast ? 'Done for now' : 'Skip — add later'}
        </Button>
      }
    >
      {/* key remounts the form per transaction so its lazy-initialized fields
          reflect the new merchant/amount/date. Approving or deleting resolves
          the current card and advances (onDone/onDeleted → advance); the last
          card closes the drawer. */}
      <TransactionReviewForm
        key={current.id}
        transaction={current}
        onDone={advance}
      />
    </Drawer>
  );
};

export default ReviewPendingDrawer;
