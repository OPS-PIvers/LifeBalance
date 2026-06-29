import React, { useEffect, useMemo, useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { CaptureTransactionManual } from '@/components/modals/CaptureTransactionManual';
import { useFinance, useGamification, useShopping } from '@/contexts/FirebaseHouseholdContext';
import type { Transaction } from '@/types/schema';

interface AwaitingAmountDrawerProps {
  /**
   * Snapshot of the awaiting-amount stubs taken when the drawer opened. A
   * snapshot (not the live list) so submits/dismisses shrinking `transactions`
   * don't reshuffle indices mid-cycle.
   */
  stubs: Transaction[];
  isOpen: boolean;
  /** Closes the whole drawer; any remaining stubs stay in the Action Queue. */
  onClose: () => void;
}

/**
 * On-app-open cycler for Apple Pay "$0 pre-auth" stubs (pending_review
 * transactions with `needsAmount === true`). Shows ONE prefilled manual-style
 * card at a time — the user enters the real amount + category and submits
 * (which promotes the existing stub to a verified transaction), or skips to the
 * next. Dismissed/skipped stubs stay in the Action Queue (they won't auto-pop
 * again — the caller stamps `needsAmountPromptedAt` when it opens this drawer).
 *
 * Lazy-mounted from MainLayout so the Drawer + framer-motion stay out of the
 * boot bundle.
 */
const AwaitingAmountDrawer: React.FC<AwaitingAmountDrawerProps> = ({ stubs, isOpen, onClose }) => {
  const { buckets, transactions, accounts, updateTransaction, markNeedsAmountPrompted } = useFinance();
  const { habits } = useGamification();
  const { stores } = useShopping();

  const [index, setIndex] = useState(0);
  const current = stubs[index];

  // Stamp every stub in this batch as "prompted" once the drawer opens, so a
  // dismissed/skipped stub never auto-pops again (it stays in the Action Queue).
  // This is a Firestore write (not local state), so it's a legit sync effect.
  useEffect(() => {
    if (isOpen && stubs.length > 0) {
      void markNeedsAmountPrompted(stubs.map((s) => s.id));
    }
  }, [isOpen, stubs, markNeedsAmountPrompted]);

  // Mirror CaptureModal's category set exactly so this card behaves like the
  // standard manual-entry path.
  const dynamicCategories = useMemo(
    () => [...buckets.map((b) => b.name), 'Budgeted in Calendar'],
    [buckets],
  );

  const advance = () => {
    if (index + 1 < stubs.length) {
      setIndex(index + 1);
    } else {
      // Keep `index` on the last card so `current` stays defined through the
      // Drawer's exit animation; the parent flips isOpen to actually close.
      onClose();
    }
  };

  // Promote the EXISTING stub instead of creating a new doc: we ignore the
  // form's generated id and patch the stub via updateTransaction. Under the
  // verified-only balance model (Plan 015) the pending_review stub has NOT yet
  // touched the checking balance; flipping it to `verified` here makes
  // updateTransaction apply its full impact once (effectiveImpact goes 0 →
  // −amount), so the entered amount debits exactly once with no duplicate. We
  // deliberately do NOT advance here — CaptureTransactionManual calls onClose()
  // itself after a successful submit, and onClose is wired to advance, so
  // advancing here too would skip the next card.
  const handleSubmit = async (tx: Transaction) => {
    if (!current) return;
    const updates: Partial<Transaction> = {
      amount: tx.amount,
      category: tx.category,
      date: tx.date,
      status: 'verified',
      needsAmount: false,
    };
    if (tx.store) updates.store = tx.store;
    if (tx.accountId) updates.accountId = tx.accountId;
    if (tx.subBucketId) updates.subBucketId = tx.subBucketId;
    if (tx.relatedHabitIds && tx.relatedHabitIds.length > 0) {
      updates.relatedHabitIds = tx.relatedHabitIds;
    }
    await updateTransaction(current.id, updates);
  };

  if (!current) return null;

  const isLast = index + 1 >= stubs.length;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Add amount (${index + 1} of ${stubs.length})`}
      height="tall"
      footer={
        <Button variant="ghost" className="w-full" onClick={advance}>
          {isLast ? 'Done for now' : 'Skip — add later'}
        </Button>
      }
    >
      {/* key remounts the form per stub so its lazy-initialized fields reflect
          the new prefilled merchant/date. */}
      <CaptureTransactionManual
        key={current.id}
        initialData={{
          merchant: current.merchant,
          date: current.date,
          category: current.category,
          amount: '',
        }}
        onAddTransaction={handleSubmit}
        onClose={advance}
        dynamicCategories={dynamicCategories}
        habits={habits}
        transactions={transactions}
        buckets={buckets}
        stores={stores}
        accounts={accounts}
      />
    </Drawer>
  );
};

export default AwaitingAmountDrawer;
