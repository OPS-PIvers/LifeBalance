import React, { useState } from 'react';
import { Section, SurfaceList } from '@/components/ui/Section';
import { ShowMoreRow } from '@/components/ui/ShowMoreRow';
import { ActionQueueItemCard } from '@/components/dashboard/ActionQueueItem';
import { useActionQueueTriage } from '@/hooks/useActionQueueTriage';
import { isTransactionQueueItem } from '@/hooks/useActionQueue';

/**
 * The transaction subset of the Action Queue, rendered at the top of
 * Money → Overview.
 *
 * WHY THIS EXISTS: the footer's Budget badge counts transactions needing
 * review, but the Budget page had no surface listing them — the badge's own
 * destination couldn't explain the number, so tapping it was a dead end (the
 * only triage list lived on Home, which a member can hide). This section IS
 * that explanation, so the badge's predicate and this list's filter must stay
 * in lockstep (`BottomNav` holds the matching invariant comment).
 *
 * Only transactions are listed: bills already have their own row-actioned
 * surface here (`UpcomingBillsWidget`) and to-dos belong to Lists, so a full
 * mixed queue would duplicate the first and import the third onto a money page.
 *
 * SELECTION/BULK IS DELIBERATELY EXCLUDED — not an oversight and not a
 * follow-up. The bulk action bar is fixed page chrome that would collide with
 * the Money tab strip, and bulk approve over transactions already exists on
 * Money → Transactions. So every selection prop is hard-disabled below,
 * including `enableLongPressSelect={false}` — otherwise a long press would
 * haptic-confirm a gesture with nothing behind it and then swallow the click
 * that ended it.
 */

/** House convention for Overview-style widgets is 3–5 rows (UpcomingBills=3,
 *  DailyHabits=5). Home's Action Queue caps at 6, justified there by being the
 *  app's PRIMARY triage surface; this one is a secondary explanation of a badge. */
const MAX_VISIBLE_ITEMS = 5;

// Stable no-op identities for the disabled selection props. Defined at module
// scope rather than inline: `ActionQueueItemCard`'s memo comparator compares
// these by reference, so fresh arrow literals would defeat it on every render.
const noopToggleSelect = () => {};
const noopEnterSelectionMode = () => {};

interface NeedsReviewSectionProps {
  /**
   * Take over the pay sheet — mirrors `UpcomingBillsWidget`'s `onPay` idiom so
   * Money → Overview's existing `AccountPicker` serves this section too and no
   * second picker is mounted.
   */
  onOpenPaySheet: (id: string, amount: number) => void;
}

const NeedsReviewSection: React.FC<NeedsReviewSectionProps> = ({ onOpenPaySheet }) => {
  const [expanded, setExpanded] = useState(false);
  const {
    actionQueue,
    expandedId,
    setExpandedId,
    openPaySheet,
    approveDetails,
    handleSwipeApprove,
    handleSwipeDefer,
    cardProps,
  } = useActionQueueTriage({ onOpenPaySheet });

  const items = actionQueue.filter(isTransactionQueueItem);

  // Render nothing at zero rather than an empty-state card — same rule as the
  // sibling widgets on this tab (see `UpcomingBillsWidget`). Placed AFTER every
  // hook call above so the hook order is unconditional.
  if (items.length === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, MAX_VISIBLE_ITEMS);

  return (
    <Section title={`Needs review (${items.length})`}>
      <SurfaceList>
        {visibleItems.map(item => (
          <ActionQueueItemCard
            key={item.id}
            item={item}
            isExpanded={expandedId === item.id}
            setExpandedId={setExpandedId}
            openPaySheet={openPaySheet}
            selectionMode={false}
            isSelected={false}
            onToggleSelect={noopToggleSelect}
            onEnterSelectionMode={noopEnterSelectionMode}
            enableLongPressSelect={false}
            onSwipeApprove={handleSwipeApprove}
            onSwipeDefer={handleSwipeDefer}
            approveDetail={approveDetails.get(item.id)}
            {...cardProps}
          />
        ))}
        <ShowMoreRow
          hiddenCount={items.length - MAX_VISIBLE_ITEMS}
          expanded={expanded}
          onToggle={() => setExpanded(v => !v)}
          noun="transaction"
        />
      </SurfaceList>
    </Section>
  );
};

export default NeedsReviewSection;
