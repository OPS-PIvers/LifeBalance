import React, { useId, useState } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { RewardItem, HouseholdMember } from '@/types/schema';

interface RewardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RewardType = NonNullable<RewardItem['type']>;

/** Draft shape for the create/edit form (allowanceCents tracked as a dollar string for the input). */
interface RewardDraft {
  title: string;
  cost: string;
  icon: string;
  type: RewardType;
  allowanceDollars: string;
  targetMemberId: string;
  active: boolean;
}

const EMPTY_DRAFT: RewardDraft = {
  title: '',
  cost: '',
  icon: '🎁',
  type: 'realWorld',
  allowanceDollars: '',
  targetMemberId: '',
  active: true,
};

function draftFromReward(reward: RewardItem): RewardDraft {
  return {
    title: reward.title,
    cost: String(reward.cost),
    icon: reward.icon,
    type: reward.type ?? 'realWorld',
    allowanceDollars:
      reward.allowanceCents !== undefined ? (reward.allowanceCents / 100).toFixed(2) : '',
    targetMemberId: reward.targetMemberId ?? '',
    active: reward.active ?? true,
  };
}

const inputClass =
  'w-full rounded-xl border border-purple-200 dark:border-purple-500/40 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30';
const labelClass =
  'block text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300 mb-1';

/**
 * Parent-facing reward management panel (Plan 080d). Only rendered when Kid Mode
 * is enabled. Lets a parent create / edit / delete rewards in the live
 * households/{hid}/rewards subcollection.
 */
const RewardManagementPanel: React.FC<{ kids: HouseholdMember[] }> = ({ kids }) => {
  const { rewardsInventory, addReward, updateReward, deleteReward } = useGamification();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RewardItem | null>(null);
  const formTitleId = useId();

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  };

  const beginEdit = (reward: RewardItem) => {
    setDraft(draftFromReward(reward));
    setEditingId(reward.id);
  };

  const buildPayload = (): Omit<RewardItem, 'id' | 'createdBy'> | null => {
    const title = draft.title.trim();
    const cost = Number(draft.cost);
    const icon = draft.icon.trim() || '🎁';
    if (!title || !Number.isFinite(cost) || cost < 0) return null;

    const payload: Omit<RewardItem, 'id' | 'createdBy'> = {
      title,
      cost,
      icon,
      type: draft.type,
      active: draft.active,
    };
    if (draft.type === 'allowance') {
      const dollars = Number(draft.allowanceDollars);
      // Convert dollars to integer cents; default to 0 when blank/invalid.
      payload.allowanceCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
    }
    if (draft.targetMemberId) {
      payload.targetMemberId = draft.targetMemberId;
    }
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    setSubmitting(true);
    try {
      if (editingId) {
        // Preserve the original createdBy (the live context ignores it on update —
        // it's immutable per the rules — but the mock store keeps the full object).
        const existing = rewardsInventory.find((r) => r.id === editingId);
        await updateReward({ ...payload, id: editingId, createdBy: existing?.createdBy ?? '' });
      } else {
        await addReward(payload);
      }
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = draft.title.trim().length > 0 && draft.cost.trim().length > 0 && !submitting;

  return (
    <div className="border-t border-purple-200 dark:border-purple-500/30 bg-purple-50/60 dark:bg-purple-500/10 px-6 py-5">
      <h3
        id={formTitleId}
        className="flex items-center gap-2 text-sm font-bold text-purple-700 dark:text-purple-200 mb-3"
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
            <div className="flex rounded-xl border border-purple-200 dark:border-purple-500/40 overflow-hidden">
              {(['realWorld', 'allowance'] as RewardType[]).map((t) => {
                const selected = draft.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, type: t }))}
                    aria-pressed={selected}
                    className={`flex-1 px-2 py-2 text-xs font-bold transition-colors ${
                      selected
                        ? 'bg-purple-500 text-white'
                        : 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-300'
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

        <label className="flex items-center gap-2 text-sm font-medium text-purple-700 dark:text-purple-200">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-purple-300 text-purple-500 focus:ring-purple-500/40"
            checked={draft.active}
            onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
          />
          Active (shown in the store)
        </label>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-purple-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
          >
            {editingId ? 'Save changes' : 'Add reward'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-purple-300 dark:border-purple-500/40 px-4 py-2 text-sm font-bold text-purple-600 dark:text-purple-300"
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
              className="flex items-center gap-3 rounded-xl bg-white dark:bg-slate-800 border border-purple-100 dark:border-purple-500/20 px-3 py-2"
            >
              <span className="text-xl" aria-hidden="true">{reward.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                  {reward.title}
                </p>
                <p className="text-xs text-purple-500 dark:text-purple-300">
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
                className="rounded-lg p-2 text-purple-500 hover:bg-purple-100 dark:hover:bg-purple-500/20"
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(reward)}
                aria-label={`Delete ${reward.title}`}
                className="rounded-lg p-2 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20"
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
            void deleteReward(pendingDelete.id);
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
  const { members } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const titleId = useId();

  const kids = members.filter((m) => m.role === 'kid');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-lg"
      className="bg-brand-50 dark:bg-slate-700/50"
      ariaLabelledBy={titleId}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-brand-800 text-white shrink-0">
        <div>
          <h2 id={titleId} className="text-xl font-bold">Rewards Store</h2>
          <p className="text-xs text-brand-300">Lifetime Points: {totalPoints}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>
      </div>

      {/* Grid */}
      <div className="p-6 scroll-contain-y grid grid-cols-2 gap-4">
          {rewardsInventory.map(reward => {
            const canAfford = totalPoints >= reward.cost;

            return (
              <div
                key={reward.id}
                className={`flex flex-col p-4 bg-white dark:bg-slate-800 rounded-xl border border-brand-100 dark:border-slate-700 shadow-xs transition-all ${
                  !canAfford ? 'opacity-60 grayscale-[0.5]' : 'hover:border-habit-gold/50'
                }`}
              >
                <div className="text-4xl mb-3 self-center">{reward.icon}</div>
                <h3 className="font-bold text-brand-800 dark:text-slate-100 text-sm text-center mb-1">{reward.title}</h3>
                <p className="text-xs font-bold text-habit-gold text-center mb-4">{reward.cost} pts</p>

                <button
                  onClick={() => {
                    if (canAfford) redeemReward(reward.id);
                  }}
                  disabled={!canAfford}
                  className={`mt-auto py-2 rounded-lg text-xs font-bold transition-transform active:scale-95 ${
                    canAfford
                      ? 'bg-brand-800 text-white shadow-md hover:bg-brand-700'
                      : 'bg-brand-100 dark:bg-slate-700/50 text-brand-400 dark:text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {canAfford ? 'Redeem' : 'Locked'}
                </button>
              </div>
            );
          })}
      </div>

      {/* Plan 080d — parent-facing reward management. Dormant: only shown when
          Kid Mode is enabled; otherwise the modal is the read-only store above. */}
      {kidModeEnabled && <RewardManagementPanel kids={kids} />}
    </Modal>
  );
};

export default RewardsModal;
