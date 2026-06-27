import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Plus, Pencil, Trash2, Check, Inbox } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatCurrency } from '@/utils/formatCurrency';
import type { RewardItem, HouseholdMember, RewardRedemption } from '@/types/schema';
import {
  type RewardDraft,
  type RewardType,
  EMPTY_REWARD_DRAFT,
  draftFromReward,
  buildRewardPayload,
} from '@/utils/rewardDraft';

interface RewardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// TODO(redesign-IA): this modal is kept because the Kid-Mode reward
// management + parent-redemption review flows below are not yet reproduced in
// Habits → Rewards (they involve heavier multi-field forms). It has been
// restyled to the new editorial-finance language; dissolve into the Rewards tab
// in a later pass. The non-Kid-Mode reward store IS already covered by the tab.
const inputClass =
  'w-full rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 px-3 py-2 text-sm text-brand-900 dark:text-brand-100 focus:border-warm-500 focus:outline-hidden focus:ring-2 focus:ring-warm-500/30';
const labelClass =
  'block text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300 mb-1';

/**
 * Parent review queue for kid reward-redemption requests (Plan 080d-2). Rendered
 * only when Kid Mode is enabled AND there is at least one pending request (so it
 * is fully dormant otherwise). Approving deducts the kid's points + credits the
 * allowance IOU; denying just dismisses. Both are idempotent in the context.
 */
const PendingRedemptionsPanel: React.FC<{
  pending: RewardRedemption[];
  kids: HouseholdMember[];
  currency?: string;
}> = ({ pending, kids, currency }) => {
  const { approveRedemption, denyRedemption } = useGamification();
  const [busyId, setBusyId] = useState<string | null>(null);
  const headingId = useId();

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
    <section
      aria-labelledby={headingId}
      className="border-t border-brand-200 dark:border-brand-700 bg-warm-50 dark:bg-warm-900/15 px-6 py-5"
    >
      <h3
        id={headingId}
        className="flex items-center gap-2 font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-3"
      >
        <Inbox size={16} />
        Pending requests ({pending.length})
      </h3>

      <ul className="space-y-2">
        {pending.map((req) => {
          const isAllowance = req.type === 'allowance' && req.allowanceCents !== undefined;
          const busy = busyId === req.id;
          return (
            <li
              key={req.id}
              className="flex items-center gap-3 rounded-card bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 px-3 py-2"
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
    </section>
  );
};

/**
 * Parent-facing reward management panel (Plan 080d). Only rendered when Kid Mode
 * is enabled. Lets a parent create / edit / delete rewards in the live
 * households/{hid}/rewards subcollection.
 */
const RewardManagementPanel: React.FC<{ kids: HouseholdMember[] }> = ({ kids }) => {
  const { rewardsInventory, addReward, updateReward, deleteReward } = useGamification();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_REWARD_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RewardItem | null>(null);
  const formTitleId = useId();

  const resetForm = () => {
    setDraft(EMPTY_REWARD_DRAFT);
    setEditingId(null);
  };

  const beginEdit = (reward: RewardItem) => {
    setDraft(draftFromReward(reward));
    setEditingId(reward.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildRewardPayload(draft);
    if (!payload) return;

    // Guard the edit lookup: if the reward we were editing has since vanished
    // (e.g. deleted on another device), abort rather than calling updateReward
    // with an empty/undefined createdBy.
    let editTarget: RewardItem | undefined;
    if (editingId) {
      editTarget = rewardsInventory.find((r) => r.id === editingId);
      if (!editTarget) {
        toast.error('That reward no longer exists');
        resetForm();
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editingId && editTarget) {
        // Preserve the original createdBy (the live context ignores it on update —
        // it's immutable per the rules — but the mock store keeps the full object).
        await updateReward({ ...payload, id: editingId, createdBy: editTarget.createdBy });
      } else {
        await addReward(payload);
      }
      // Only clear/close on success — the context re-throws on failure (and has
      // already shown an error toast), so we keep the form open for a retry.
      resetForm();
    } catch {
      // Error toast is surfaced by the context method; keep the form populated.
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = draft.title.trim().length > 0 && draft.cost.trim().length > 0 && !submitting;

  return (
    <div className="border-t border-brand-200 dark:border-brand-700 bg-warm-50 dark:bg-warm-900/15 px-6 py-5">
      <h3
        id={formTitleId}
        className="flex items-center gap-2 font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-3"
      >
        <Plus size={16} />
        {editingId ? 'Edit reward' : 'Manage rewards'}
      </h3>

      <form onSubmit={handleSubmit} aria-labelledby={formTitleId} className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className={labelClass} htmlFor="reward-title">Title</label>
            <input
              id="reward-title"
              type="text"
              className={inputClass}
              value={draft.title}
              maxLength={100}
              placeholder="Movie Night"
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>
          <div className="w-20">
            <label className={labelClass} htmlFor="reward-icon">Icon</label>
            <input
              id="reward-icon"
              type="text"
              className={`${inputClass} text-center`}
              value={draft.icon}
              maxLength={8}
              onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="reward-cost">Cost (points)</label>
            <input
              id="reward-cost"
              type="number"
              min={0}
              className={inputClass}
              value={draft.cost}
              placeholder="50"
              onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
            />
          </div>
          <div>
            <span className={labelClass}>Type</span>
            <div className="flex rounded-btn border border-brand-200 dark:border-brand-700 overflow-hidden">
              {(['realWorld', 'allowance'] as RewardType[]).map((t) => {
                const selected = draft.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, type: t }))}
                    aria-pressed={selected}
                    className={`flex-1 px-2 py-2 text-xs font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard) ${
                      selected
                        ? 'bg-warm-500 text-white'
                        : 'bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-300'
                    }`}
                  >
                    {t === 'realWorld' ? 'Real-world' : 'Allowance'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {draft.type === 'allowance' && (
          <div>
            <label className={labelClass} htmlFor="reward-allowance">Allowance amount ($)</label>
            <input
              id="reward-allowance"
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={draft.allowanceDollars}
              placeholder="5.00"
              onChange={(e) => setDraft((d) => ({ ...d, allowanceDollars: e.target.value }))}
            />
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="reward-target">Target kid</label>
          <select
            id="reward-target"
            className={inputClass}
            value={draft.targetMemberId}
            onChange={(e) => setDraft((d) => ({ ...d, targetMemberId: e.target.value }))}
          >
            <option value="">All kids</option>
            {kids.map((kid) => (
              <option key={kid.uid} value={kid.uid}>
                {kid.displayName}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-200">
          <input
            type="checkbox"
            className="h-4 w-4 rounded-sm border-brand-300 text-warm-500 focus:ring-warm-500/40"
            checked={draft.active}
            onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
          />
          Active (shown in the store)
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 rounded-btn bg-warm-500 hover:bg-warm-600 px-4 py-2 text-sm font-bold text-white transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) active:scale-95 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            {editingId ? 'Save changes' : 'Add reward'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-btn border border-brand-300 dark:border-brand-600 px-4 py-2 text-sm font-bold text-brand-600 dark:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Existing rewards with edit/delete controls */}
      {rewardsInventory.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rewardsInventory.map((reward) => (
            <li
              key={reward.id}
              className="flex items-center gap-3 rounded-card bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 px-3 py-2"
            >
              <span className="text-xl" aria-hidden="true">{reward.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-brand-900 dark:text-brand-50">
                  {reward.title}
                </p>
                <p className="text-xs text-warm-600 dark:text-warm-300">
                  {reward.cost} pts
                  {reward.type === 'allowance' && reward.allowanceCents !== undefined
                    ? ` · $${(reward.allowanceCents / 100).toFixed(2)}`
                    : ''}
                  {reward.active === false ? ' · inactive' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => beginEdit(reward)}
                aria-label={`Edit ${reward.title}`}
                className="rounded-btn p-2 text-warm-600 hover:bg-warm-100 dark:text-warm-300 dark:hover:bg-warm-900/30 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(reward)}
                aria-label={`Delete ${reward.title}`}
                className="rounded-btn p-2 text-money-neg hover:bg-money-bgNeg dark:hover:bg-money-neg/15 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-money-neg/40"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            // deleteReward re-throws on failure (after toasting); swallow here so
            // there's no unhandled rejection — the user already sees the error.
            void deleteReward(pendingDelete.id).catch(() => {});
          }
          setPendingDelete(null);
        }}
        title="Delete reward?"
        message={
          pendingDelete
            ? `"${pendingDelete.title}" will be removed from the rewards store.`
            : ''
        }
        confirmLabel="Delete"
      />
    </div>
  );
};

const RewardsModal: React.FC<RewardsModalProps> = ({ isOpen, onClose }) => {
  const { rewardsInventory, totalPoints, redeemReward } = useGamification();
  const { members, household } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const titleId = useId();

  const kids = members.filter((m) => m.role === 'kid');
  const pendingRedemptions = household?.pendingRedemptions ?? [];

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      className="bg-brand-50 dark:bg-brand-900"
      ariaLabelledBy={titleId}
      header={
        <div className="flex items-center justify-between px-6 py-4 bg-brand-800 dark:bg-brand-900 border-b border-brand-700 text-white">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold">Rewards Store</h2>
            <p className="text-xs text-brand-300">Lifetime Points: {totalPoints}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-400"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>
      }
    >
      {/* Grid */}
      <div className="p-6 grid grid-cols-2 gap-4">
          {rewardsInventory.map(reward => {
            const canAfford = totalPoints >= reward.cost;

            return (
              <div
                key={reward.id}
                className={`flex flex-col p-4 bg-white dark:bg-brand-800 rounded-card border border-brand-200 dark:border-brand-700 transition-opacity ${
                  canAfford ? '' : 'opacity-60'
                }`}
              >
                <div className="text-4xl mb-3 self-center" aria-hidden="true">{reward.icon}</div>
                <h3 className="font-semibold text-brand-900 dark:text-brand-50 text-sm text-center mb-1">{reward.title}</h3>
                <p className="font-mono text-xs font-bold tabular-nums text-warm-600 dark:text-warm-300 text-center mb-4">{reward.cost} pts</p>

                <button
                  onClick={() => {
                    if (canAfford) redeemReward(reward.id);
                  }}
                  disabled={!canAfford}
                  className={`mt-auto py-2 rounded-btn text-xs font-bold transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) active:scale-95 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 ${
                    canAfford
                      ? 'bg-accent-600 text-white hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400'
                      : 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-500 cursor-not-allowed'
                  }`}
                >
                  {canAfford ? 'Redeem' : 'Locked'}
                </button>
              </div>
            );
          })}
      </div>

      {/* Plan 080d-2 — parent review queue for kid redemption requests. Doubly
          dormant: only when Kid Mode is on AND there are pending requests. */}
      {kidModeEnabled && pendingRedemptions.length > 0 && (
        <PendingRedemptionsPanel
          pending={pendingRedemptions}
          kids={kids}
          currency={household?.currency}
        />
      )}

      {/* Plan 080d — parent-facing reward management. Dormant: only shown when
          Kid Mode is enabled; otherwise the modal is the read-only store above. */}
      {kidModeEnabled && <RewardManagementPanel kids={kids} />}
    </Drawer>
  );
};

export default RewardsModal;
