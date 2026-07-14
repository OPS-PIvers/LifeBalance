import React, { useState } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Gift, Lock } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Button } from '@/components/ui/Button';
import PendingRedemptionsPanel from '@/components/habits/PendingRedemptionsPanel';
import RedemptionHistoryPanel from '@/components/habits/RedemptionHistoryPanel';
import RewardManagerPanel from '@/components/habits/RewardManagerPanel';
import EmptyState from '@/components/ui/EmptyState';
import { isRewardLocked } from '@/utils/habitMilestones';

/**
 * HabitsRewardsTab — the Rewards sub-tab of the Habits page, and the app's single
 * "rewards center". It composes:
 *
 *  - a lifetime-points header,
 *  - the reward STORE (active rewards, instant redeem → deduct shared points),
 *  - "Recently redeemed" history (Household.redemptionHistory), capped with a
 *    "+N more" show-more row,
 *  - the parent redemption REVIEW queue (Kid Mode only, when there are requests),
 *  - reward MANAGEMENT (create / edit / delete) — available to EVERY household.
 *
 * Redeeming uses the `redeemReward` mutation (atomic: deduct points + log history).
 * The former RewardsModal (where management/review used to live, Kid-Mode-gated)
 * has been dissolved into this tab.
 *
 * Reward MANAGEMENT is collapsed by default (`RewardManagerPanel` wraps its list
 * in a `CollapsibleSection`) — the same rewards already appear in the store grid
 * above, so showing them twice by default was redundant; the create/edit form
 * opens in a `Drawer` regardless of the list's collapsed state.
 */
const HabitsRewardsTab: React.FC = () => {
  const { rewardsInventory, totalPoints, redeemReward } = useGamification();
  const { household, members } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const kids = members.filter((m) => m.role === 'kid');
  const pendingRedemptions = household?.pendingRedemptions ?? [];
  const redemptionHistory = household?.redemptionHistory ?? [];
  // The store shows only ACTIVE rewards; inactive ones still appear (labelled) in
  // the management list below so they can be re-activated or deleted.
  const activeRewards = rewardsInventory.filter((r) => r.active !== false);

  const handleRedeem = async (rewardId: string) => {
    setRedeemingId(rewardId);
    try {
      await redeemReward(rewardId);
    } catch {
      // redeemReward surfaces its own error toast.
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Lifetime points header */}
      <div className="flex items-center justify-between surface-section px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-card bg-warm-100 text-warm-600 dark:bg-warm-900/30 dark:text-warm-200">
            <Gift size={18} />
          </span>
          <div>
            <p className="text-xs font-medium text-brand-500 dark:text-brand-400">Lifetime points</p>
            <p className="font-mono text-lg font-bold tabular-nums text-brand-900 dark:text-brand-50">
              {totalPoints}
            </p>
          </div>
        </div>
      </div>

      {/* Reward store grid (active rewards only) */}
      {activeRewards.length > 0 ? (
        <Section title="Rewards store">
          <div className="grid grid-cols-2 gap-3">
            {activeRewards.map((reward) => {
              const canAfford = totalPoints >= reward.cost;
              // F-HABITS-02: a milestone-gated reward is locked until its
              // streak requirement has been crossed, independent of affordability.
              const milestoneLocked = isRewardLocked(reward, household?.unlockedRewardIds);
              const canRedeem = canAfford && !milestoneLocked;
              const busy = redeemingId === reward.id;
              return (
                <div
                  key={reward.id}
                  className={`flex flex-col p-4 surface-section transition-opacity ${
                    canRedeem ? '' : 'opacity-60'
                  }`}
                >
                  <div className="text-2xl mb-3 self-center" aria-hidden="true">{reward.icon}</div>
                  <h3 className="font-semibold text-brand-900 dark:text-brand-50 text-sm text-center mb-1">
                    {reward.title}
                  </h3>
                  <p className="font-mono text-xs font-bold tabular-nums text-warm-600 dark:text-warm-300 text-center mb-1">
                    {reward.cost} pts
                  </p>
                  {milestoneLocked && (
                    <p className="text-[11px] text-brand-500 dark:text-brand-400 text-center mb-2">
                      Unlocks at a {reward.unlockRequirement?.streakDays}-day streak
                    </p>
                  )}
                  <Button
                    variant="warning"
                    size="sm"
                    className="w-full mt-auto"
                    onClick={() => canRedeem && !busy && handleRedeem(reward.id)}
                    disabled={!canRedeem}
                    isLoading={busy}
                  >
                    {canRedeem ? 'Redeem' : (
                      <span className="inline-flex items-center gap-1">
                        <Lock size={11} /> Locked
                      </span>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </Section>
      ) : rewardsInventory.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={<Gift size={28} />}
          title="No rewards yet"
          description="Earn points by completing habits, then spend them on rewards your household sets up below."
        />
      ) : null}

      {/* Recently redeemed (renders nothing when empty) */}
      <RedemptionHistoryPanel history={redemptionHistory} members={members} />

      {/* Parent review queue — Kid Mode only, and only when there are requests. */}
      {kidModeEnabled && pendingRedemptions.length > 0 && (
        <PendingRedemptionsPanel
          pending={pendingRedemptions}
          kids={kids}
          currency={household?.currency}
        />
      )}

      {/* Manage rewards (create / edit / delete) — available to every household. */}
      <RewardManagerPanel kids={kids} kidModeEnabled={kidModeEnabled} />
    </div>
  );
};

export default HabitsRewardsTab;
