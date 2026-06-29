import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Section } from '@/components/ui/Section';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { RewardItem, HouseholdMember } from '@/types/schema';
import {
  type RewardDraft,
  EMPTY_REWARD_DRAFT,
  draftFromReward,
  buildRewardPayload,
} from '@/utils/rewardDraft';

const labelClass =
  'block text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300 mb-1';

/**
 * Reward management (create / edit / delete) for the rewards center. Available to
 * EVERY household — the underlying addReward/updateReward/deleteReward mutations
 * are not Kid-Mode-gated, so a normal household can build its own points store.
 *
 * Kid-Mode-only fields (reward type, allowance amount, target kid) are shown only
 * when `kidModeEnabled` — a normal household just sets title / icon / cost / active,
 * and buildRewardPayload defaults the type to 'realWorld'. The "Active" toggle is
 * available to everyone (hide a reward from the store without deleting it).
 *
 * (Dissolved from the former RewardsModal's RewardManagementPanel; the form was
 * previously reachable only in Kid Mode.)
 */
export interface RewardManagerPanelProps {
  /** Managed kids (for the "target kid" select) — empty for normal households. */
  kids: HouseholdMember[];
  /** Show the Kid-Mode reward-kind fields (type / allowance / target kid). */
  kidModeEnabled: boolean;
}

const RewardManagerPanel: React.FC<RewardManagerPanelProps> = ({ kids, kidModeEnabled }) => {
  const { rewardsInventory, addReward, updateReward, deleteReward } = useGamification();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_REWARD_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RewardItem | null>(null);
  const formTitleId = useId();

  const closeForm = () => {
    setDraft(EMPTY_REWARD_DRAFT);
    setEditingId(null);
    setFormOpen(false);
  };

  const beginCreate = () => {
    setDraft(EMPTY_REWARD_DRAFT);
    setEditingId(null);
    setFormOpen(true);
  };

  const beginEdit = (reward: RewardItem) => {
    setDraft(draftFromReward(reward));
    setEditingId(reward.id);
    setFormOpen(true);
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
        closeForm();
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
      closeForm();
    } catch {
      // Error toast is surfaced by the context method; keep the form populated.
    } finally {
      setSubmitting(false);
    }
  };

  // Gate on buildRewardPayload — the single source of truth for validity — so the
  // submit button is disabled for an invalid draft (negative/non-numeric cost or
  // allowance) instead of silently no-opping. (buildRewardPayload already rejects
  // a negative cost, so a negative-cost reward can never be saved, defence-in-depth
  // against a points exploit; this just reflects that in the button state.)
  const canSubmit =
    draft.title.trim().length > 0 &&
    draft.cost.trim().length > 0 &&
    buildRewardPayload(draft) !== null &&
    !submitting;

  return (
    <Section
      title="Manage rewards"
      action={
        !formOpen ? (
          <button
            type="button"
            onClick={beginCreate}
            className="flex items-center gap-1 rounded-btn bg-warm-500 hover:bg-warm-600 px-3 py-1.5 text-xs font-bold text-white transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) active:scale-95 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            <Plus size={14} />
            Add reward
          </button>
        ) : null
      }
    >
      {formOpen && (
        <div className="surface-section p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h3 id={formTitleId} className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100">
              {editingId ? 'Edit reward' : 'New reward'}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Cancel"
              className="rounded-btn p-1.5 text-brand-400 hover:bg-brand-100 dark:text-brand-500 dark:hover:bg-brand-700/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} aria-labelledby={formTitleId} className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Input
                label="Title"
                type="text"
                value={draft.title}
                maxLength={100}
                placeholder="Movie Night"
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <div className="w-20">
                <Input
                  label="Icon"
                  type="text"
                  className="text-center"
                  value={draft.icon}
                  maxLength={8}
                  onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
                />
              </div>
            </div>

            <div className={kidModeEnabled ? 'grid grid-cols-2 gap-3' : ''}>
              <Input
                label="Cost (points)"
                type="number"
                min={0}
                value={draft.cost}
                placeholder="50"
                onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
              />

              {/* Kid-Mode-only: reward type (real-world vs allowance IOU). */}
              {kidModeEnabled && (
                <div>
                  <span className={labelClass}>Type</span>
                  <SegmentedControl
                    tone="warm"
                    name="Reward type"
                    value={draft.type}
                    onChange={(t) => setDraft((d) => ({ ...d, type: t }))}
                    options={[
                      { value: 'realWorld', label: 'Real-world' },
                      { value: 'allowance', label: 'Allowance' },
                    ]}
                  />
                </div>
              )}
            </div>

            {/* Kid-Mode-only: allowance amount (only for allowance rewards). */}
            {kidModeEnabled && draft.type === 'allowance' && (
              <Input
                label="Allowance amount ($)"
                type="number"
                min={0}
                step="0.01"
                value={draft.allowanceDollars}
                placeholder="5.00"
                onChange={(e) => setDraft((d) => ({ ...d, allowanceDollars: e.target.value }))}
              />
            )}

            {/* Kid-Mode-only: target a specific kid (else available to all kids). */}
            {kidModeEnabled && (
              <Select
                label="Target kid"
                value={draft.targetMemberId}
                onChange={(e) => setDraft((d) => ({ ...d, targetMemberId: e.target.value }))}
              >
                <option value="">All kids</option>
                {kids.map((kid) => (
                  <option key={kid.uid} value={kid.uid}>
                    {kid.displayName}
                  </option>
                ))}
              </Select>
            )}

            <div className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-200">
              <Switch
                tone="warm"
                aria-label="Active (shown in the store)"
                checked={draft.active}
                onCheckedChange={(checked) => setDraft((d) => ({ ...d, active: checked }))}
              />
              Active (shown in the store)
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 rounded-btn bg-warm-500 hover:bg-warm-600 px-4 py-2 text-sm font-bold text-white transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) active:scale-95 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
              >
                {editingId ? 'Save changes' : 'Add reward'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-btn border border-brand-300 dark:border-brand-600 px-4 py-2 text-sm font-bold text-brand-600 dark:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Existing rewards with edit/delete controls */}
      {rewardsInventory.length > 0 ? (
        <ul className="space-y-2">
          {rewardsInventory.map((reward) => (
            <li
              key={reward.id}
              className="flex items-center gap-3 surface-section px-3 py-2.5"
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
      ) : (
        !formOpen && (
          <p className="px-1 text-xs text-brand-500 dark:text-brand-400">
            No rewards yet — add one your household can spend points on.
          </p>
        )
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
    </Section>
  );
};

export default RewardManagerPanel;
