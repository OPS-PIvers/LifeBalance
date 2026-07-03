import React, { useState } from 'react';
import { History } from 'lucide-react';
import { parseISO, isValid, formatDistanceToNowStrict } from 'date-fns';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { ShowMoreRow } from '@/components/ui/ShowMoreRow';
import type { HouseholdMember, RewardRedemptionRecord } from '@/types/schema';

/**
 * "Recently redeemed" — the rewards center's history log. Reads the bounded,
 * most-recent-first `Household.redemptionHistory` array (written atomically by
 * redeemReward alongside the point deduction). Renders nothing when empty so the
 * tab stays calm for a household that has never redeemed.
 *
 * Caps the rendered list at `MAX_VISIBLE` with a trailing `ShowMoreRow` so a
 * long history doesn't push the store/manage sections further down the tab.
 */
export interface RedemptionHistoryPanelProps {
  history: RewardRedemptionRecord[];
  members: HouseholdMember[];
}

const MAX_VISIBLE = 5;

/** Relative "time ago" for an ISO timestamp, with a safe fallback. */
const timeAgo = (iso: string): string => {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true });
};

const RedemptionHistoryPanel: React.FC<RedemptionHistoryPanelProps> = ({ history, members }) => {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  const nameFor = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName ?? 'Someone';

  const visibleHistory = expanded ? history : history.slice(0, MAX_VISIBLE);

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <History size={15} className="text-warm-600 dark:text-warm-300" />
          Recently redeemed
        </span>
      }
    >
      <SurfaceList>
        {visibleHistory.map((rec) => {
          const when = timeAgo(rec.redeemedAt);
          return (
            <Row key={rec.id} dense>
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
            </Row>
          );
        })}
        <ShowMoreRow
          hiddenCount={history.length - MAX_VISIBLE}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          noun="redemption"
        />
      </SurfaceList>
    </Section>
  );
};

export default RedemptionHistoryPanel;
