import React from 'react';
import { ClipboardList } from 'lucide-react';
import { Section, SurfaceList, DisclosureRow } from '@/components/ui/Section';

interface ReviewQueueCardProps {
  /** Total held-for-review shopping + to-do captures (transactions excluded — they keep their own individual Action Queue cards). */
  count: number;
  /** Opens the unified `ReviewPendingDrawer` scoped to the held shopping/to-do snapshot. */
  onOpen: () => void;
}

/**
 * Aggregate "N items to review" card (Layer 4) — the discoverable home for
 * captures that L1's captureReview split hid from the shopping list / to-do
 * list (`shoppingAwaitingReview` / `todosAwaitingReview`). Renders at the top
 * of the Dashboard's Action Queue area whenever that count is nonzero; tapping
 * it opens `ReviewPendingDrawer` with a snapshot of just those held items.
 *
 * Deliberately excludes pending-review TRANSACTIONS — those still surface as
 * individual Action Queue cards (unchanged), so this card would otherwise
 * double-surface them.
 */
export const ReviewQueueCard: React.FC<ReviewQueueCardProps> = ({ count, onOpen }) => {
  if (count <= 0) return null;

  return (
    <Section className="mb-4">
      <SurfaceList>
        <DisclosureRow
          icon={<ClipboardList size={18} />}
          title={`${count} item${count === 1 ? '' : 's'} to review`}
          subtitle="Added via Quick Add — tap to approve"
          onClick={onOpen}
        />
      </SurfaceList>
    </Section>
  );
};

export default ReviewQueueCard;
