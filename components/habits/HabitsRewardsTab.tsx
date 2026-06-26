import React, { useState } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Gift, Lock, Settings2, Inbox } from 'lucide-react';
import { Section } from '@/components/ui/Section';

/**
 * HabitsRewardsTab — the Rewards sub-tab of the Habits page (redesign IA).
 *
 * Recreates the rewards-store content from the (to-be-deleted) RewardsModal as a
 * grouped-flat, in-page surface with warm-amber gamification accents. Redeeming a
 * reward uses the FROZEN `redeemReward` mutation directly (a single context call).
 *
 * Kid-Mode reward MANAGEMENT (create/edit/delete) and the parent redemption
 * review queue involve heavier multi-field forms whose wiring lives in
 * RewardsModal. Per the redesign PRIORITY guardrail we do NOT re-implement that
 * here; instead, when Kid Mode is on, a calm CTA opens the existing modal so the
 * working flow is never broken. (Phase 3 may fully dissolve it.)
 */
export interface HabitsRewardsTabProps {
  /** Opens the existing RewardsModal — used for Kid-Mode management/review. */
  onOpenRewardsModal: () => void;
}

const HabitsRewardsTab: React.FC<HabitsRewardsTabProps> = ({ onOpenRewardsModal }) => {
  const { rewardsInventory, totalPoints, redeemReward } = useGamification();
  const { household } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const pendingCount = (household?.pendingRedemptions ?? []).length;

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

      {/* Reward store grid */}
      {rewardsInventory.length === 0 ? (
        <div className="flex flex-col items-center text-center py-14 px-6 border-2 border-dashed border-brand-200 dark:border-brand-700 rounded-2xl bg-white/50 dark:bg-brand-800/40">
          <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-700/50 flex items-center justify-center mb-4 text-brand-400 dark:text-brand-500">
            <Gift size={28} />
          </div>
          <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-50">No rewards yet</h3>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-1 max-w-xs">
            Earn points by completing habits, then spend them on rewards your household sets up.
          </p>
        </div>
      ) : (
        <Section title="Rewards store">
          <div className="grid grid-cols-2 gap-3">
            {rewardsInventory.map(reward => {
              const canAfford = totalPoints >= reward.cost;
              const busy = redeemingId === reward.id;
              return (
                <div
                  key={reward.id}
                  className={`flex flex-col p-4 surface-section transition-opacity ${
                    canAfford ? '' : 'opacity-60'
                  }`}
                >
                  <div className="text-4xl mb-3 self-center" aria-hidden="true">{reward.icon}</div>
                  <h3 className="font-semibold text-brand-900 dark:text-brand-50 text-sm text-center mb-1">
                    {reward.title}
                  </h3>
                  <p className="font-mono text-xs font-bold tabular-nums text-warm-600 dark:text-warm-300 text-center mb-4">
                    {reward.cost} pts
                  </p>
                  <button
                    onClick={() => canAfford && !busy && handleRedeem(reward.id)}
                    disabled={!canAfford || busy}
                    className={`mt-auto py-2 rounded-btn text-xs font-bold transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) active:scale-95 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 ${
                      canAfford
                        ? 'bg-accent-600 text-white hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400'
                        : 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-500 cursor-not-allowed'
                    }`}
                  >
                    {canAfford ? (
                      busy ? 'Redeeming…' : 'Redeem'
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Lock size={11} /> Locked
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Kid-Mode management / review entry point — dormant unless Kid Mode is on.
          Keeps the heavy RewardsModal wiring intact (see component doc). */}
      {kidModeEnabled && (
        <Section title="Parent controls">
          <button
            type="button"
            onClick={onOpenRewardsModal}
            className="w-full flex items-center gap-3 surface-section px-4 py-3.5 text-left hover:border-warm-300 dark:hover:border-warm-700 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-card bg-warm-100 text-warm-600 dark:bg-warm-900/30 dark:text-warm-200 shrink-0">
              {pendingCount > 0 ? <Inbox size={18} /> : <Settings2 size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-brand-900 dark:text-brand-50">
                Manage rewards &amp; requests
              </span>
              <span className="block text-xs text-brand-500 dark:text-brand-400">
                {pendingCount > 0
                  ? `${pendingCount} pending request${pendingCount === 1 ? '' : 's'} to review`
                  : 'Create, edit, and review kid reward redemptions'}
              </span>
            </span>
            {pendingCount > 0 && (
              <span className="shrink-0 rounded-full bg-warm-500 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>
        </Section>
      )}
    </div>
  );
};

export default HabitsRewardsTab;
