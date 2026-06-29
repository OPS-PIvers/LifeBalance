import React, { useState } from 'react';
import { Check, Inbox } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Section } from '@/components/ui/Section';
import { formatCurrency } from '@/utils/formatCurrency';
import type { HouseholdMember, RewardRedemption } from '@/types/schema';

/**
 * Parent review queue for kid reward-redemption requests (Plan 080d-2). Rendered
 * by HabitsRewardsTab only when Kid Mode is enabled AND there is at least one
 * pending request, so it is fully dormant for normal households. Approving deducts
 * the kid's points + credits the allowance IOU; denying just dismisses. Both are
 * idempotent + transactional in the context.
 *
 * (Moved verbatim in behaviour from the dissolved RewardsModal; restyled to the
 * Rewards tab's grouped-flat language.)
 */
export interface PendingRedemptionsPanelProps {
  pending: RewardRedemption[];
  kids: HouseholdMember[];
  currency?: string;
}

const PendingRedemptionsPanel: React.FC<PendingRedemptionsPanelProps> = ({
  pending,
  kids,
  currency,
}) => {
  const { approveRedemption, denyRedemption } = useGamification();
  const [busyId, setBusyId] = useState<string | null>(null);

  const kidName = (memberId: string) =>
    kids.find((k) => k.uid === memberId)?.displayName ?? 'A kid';

  const resolve = async (id: string, action: (id: string) => Promise<void>) => {
    setBusyId(id);
    try {
      await action(id);
    } catch {
      // approve/deny surface their own error toast; just clear the busy state.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Inbox size={15} className="text-warm-600 dark:text-warm-300" />
          Pending requests ({pending.length})
        </span>
      }
    >
      <ul className="space-y-2">
        {pending.map((req) => {
          const isAllowance = req.type === 'allowance' && req.allowanceCents !== undefined;
          const busy = busyId === req.id;
          return (
            <li
              key={req.id}
              className="flex items-center gap-3 surface-section px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-brand-900 dark:text-brand-50">
                  {kidName(req.memberId)} · {req.rewardTitle}
                </p>
                <p className="text-xs text-warm-600 dark:text-warm-300">
                  {req.cost} pts
                  {isAllowance
                    ? ` · ${formatCurrency((req.allowanceCents ?? 0) / 100, { currency })} allowance`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => resolve(req.id, approveRedemption)}
                disabled={busy}
                aria-label={`Approve ${req.rewardTitle} for ${kidName(req.memberId)}`}
                className="flex items-center gap-1 rounded-btn bg-accent-600 px-3 py-1.5 text-xs font-bold text-white transition-transform duration-(--duration-fast) ease-(--ease-standard) active:scale-95 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
              >
                <Check size={14} />
                Approve
              </button>
              <button
                type="button"
                onClick={() => resolve(req.id, denyRedemption)}
                disabled={busy}
                aria-label={`Deny ${req.rewardTitle} for ${kidName(req.memberId)}`}
                className="rounded-btn border border-brand-300 dark:border-brand-600 px-3 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-300 transition-transform duration-(--duration-fast) ease-(--ease-standard) active:scale-95 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40"
              >
                Deny
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
};

export default PendingRedemptionsPanel;
