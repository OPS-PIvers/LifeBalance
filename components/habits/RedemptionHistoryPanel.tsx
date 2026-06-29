import React from 'react';
import { History } from 'lucide-react';
import { parseISO, isValid, formatDistanceToNowStrict } from 'date-fns';
import { Section } from '@/components/ui/Section';
import type { HouseholdMember, RewardRedemptionRecord } from '@/types/schema';

/**
 * "Recently redeemed" — the rewards center's history log. Reads the bounded,
 * most-recent-first `Household.redemptionHistory` array (written atomically by
 * redeemReward alongside the point deduction). Renders nothing when empty so the
 * tab stays calm for a household that has never redeemed.
 */
export interface RedemptionHistoryPanelProps {
  history: RewardRedemptionRecord[];
  members: HouseholdMember[];
}

/** Relative "time ago" for an ISO timestamp, with a safe fallback. */
const timeAgo = (iso: string): string => {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true });
};

const RedemptionHistoryPanel: React.FC<RedemptionHistoryPanelProps> = ({ history, members }) => {
  if (history.length === 0) return null;

  const nameFor = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName ?? 'Someone';

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <History size={15} className="text-warm-600 dark:text-warm-300" />
          Recently redeemed
        </span>
      }
    >
      <ul className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
        {history.map((rec) => {
          const when = timeAgo(rec.redeemedAt);
          return (
            <li key={rec.id} className="flex items-center gap-3 px-4 py-3 hairline-divider">
              <span className="text-2xl shrink-0" aria-hidden="true">{rec.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-brand-900 dark:text-brand-50">
                  {rec.rewardTitle}
                </p>
                <p className="truncate text-xs text-brand-500 dark:text-brand-400">
                  {nameFor(rec.redeemedByUid)}
                  {when ? ` · ${when}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-money-neg">
                −{rec.cost} pts
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
};

export default RedemptionHistoryPanel;
