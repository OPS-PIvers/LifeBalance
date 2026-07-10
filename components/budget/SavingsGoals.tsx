import React, { useState, useMemo } from 'react';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { PiggyBank, Plus, Star, Trash2, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import { SavingsGoal } from '@/types/schema';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import ProgressBar from '@/components/ui/ProgressBar';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';

/**
 * Plan 24 (savings goals / sinking funds) — goals list + create/edit drawer +
 * manual "Add to goal" contribution, rendered in the Money → Accounts tab
 * (near the existing per-account monthlyGoal affordance, per the design spike).
 *
 * Buckets cap what you spend; goals track what you're saving toward — that
 * distinction is called out explicitly in the create drawer's copy below.
 *
 * v1 = manual contributions only. HARD INVARIANT: this component never reads
 * or writes an Account balance or a Transaction, so nothing here can feed
 * `utils/safeToSpendCalculator.ts`.
 */
const SavingsGoals: React.FC = () => {
  const { savingsGoals, addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, contributeToGoal } = useFinance();
  const { members } = useHouseholdCore();
  const fmt = useFormatCurrency();

  // Kid jars are set up here too — any managed (kid) member can own a goal.
  const kidMembers = useMemo(() => members.filter(m => m.isManaged), [members]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const [contributingGoal, setContributingGoal] = useState<SavingsGoal | null>(null);
  const [contributionAmount, setContributionAmount] = useState('');

  const [actionGoal, setActionGoal] = useState<SavingsGoal | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<SavingsGoal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetForm = () => {
    setName('');
    setTargetAmount('');
    setDueDate('');
    setOwnerId('');
  };

  const openCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const openEdit = (goal: SavingsGoal) => {
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setDueDate(goal.dueDate ?? '');
    setOwnerId(goal.ownerId ?? '');
    setEditingGoal(goal);
  };

  const handleSave = async () => {
    const parsedTarget = parseFloat(targetAmount);
    if (!name || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      toast.error('Enter a name and a target amount greater than zero.');
      return;
    }
    try {
      if (editingGoal) {
        await updateSavingsGoal(editingGoal.id, {
          name,
          targetAmount: parsedTarget,
          dueDate: dueDate || '',
          ownerId: ownerId || '',
        });
        setEditingGoal(null);
      } else {
        await addSavingsGoal({
          name,
          targetAmount: parsedTarget,
          savedAmount: 0,
          ...(dueDate ? { dueDate } : {}),
          ...(ownerId ? { ownerId } : {}),
        });
        setIsCreateOpen(false);
      }
      resetForm();
    } catch (error) {
      console.error('Failed to save savings goal', error);
      toast.error('Failed to save goal. Please try again.');
    }
  };

  const handleContribute = async () => {
    if (!contributingGoal) return;
    const amount = parseFloat(contributionAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    try {
      await contributeToGoal(contributingGoal.id, amount);
      setContributingGoal(null);
      setContributionAmount('');
    } catch (error) {
      console.error('Failed to contribute to savings goal', error);
      toast.error('Failed to add contribution. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!deletingGoal || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteSavingsGoal(deletingGoal.id);
      setDeletingGoal(null);
    } catch (error) {
      console.error('Failed to delete savings goal', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const ownerName = (id?: string) => members.find(m => m.uid === id)?.displayName;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h3 className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200 uppercase tracking-wide">Savings Goals</h3>
        <div className="flex-1 h-px bg-brand-200 dark:bg-brand-700"></div>
      </div>

      {savingsGoals.length === 0 ? (
        <EmptyState
          variant="surface"
          icon={<PiggyBank size={28} />}
          title="No savings goals yet"
          description="Buckets cap what you spend; goals track what you're saving toward. Set a target for something you're rallying the family around."
          action={
            <Button variant="primary" onClick={openCreate} leftIcon={<Plus size={18} />}>
              Add Savings Goal
            </Button>
          }
        />
      ) : (
        <>
          <SurfaceList>
            {savingsGoals.map((goal) => {
              const pct = goal.targetAmount > 0 ? Math.min(100, (goal.savedAmount / goal.targetAmount) * 100) : 0;
              const isDone = Boolean(goal.completedAt) || goal.savedAmount >= goal.targetAmount;
              return (
                <Row key={goal.id} className="flex-col items-stretch gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-900 dark:text-brand-100 truncate flex items-center gap-1.5">
                        {isDone && <Star size={14} className="fill-habit-gold text-habit-gold shrink-0" />}
                        {goal.name}
                      </p>
                      {goal.ownerId && (
                        <p className="text-xxs text-brand-400 dark:text-brand-450">
                          {ownerName(goal.ownerId) ?? 'Kid'}&apos;s jar
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => setContributingGoal(goal)}
                        disabled={isDone}
                      >
                        Add
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setActionGoal(goal)}
                        className="text-brand-300 dark:text-brand-450"
                        aria-label={`Options for ${goal.name}`}
                      >
                        <MoreVertical size={18} />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450 mb-1">
                      <span>{Math.round(pct)}% saved</span>
                      <span>{fmt(goal.savedAmount)} / {fmt(goal.targetAmount)}</span>
                    </div>
                    <ProgressBar
                      value={pct}
                      className="h-1.5 bg-brand-100 dark:bg-brand-700"
                      barClassName={isDone ? 'bg-habit-gold' : 'bg-accent-600'}
                      ariaLabel={`${Math.round(pct)}% saved toward ${goal.name}`}
                    />
                  </div>
                </Row>
              );
            })}
          </SurfaceList>

          <Button
            variant="dashed"
            size="sm"
            onClick={openCreate}
            className="w-full py-2.5 rounded-card"
            leftIcon={<Plus size={16} />}
          >
            Add Savings Goal
          </Button>
        </>
      )}

      {/* Create / Edit Drawer */}
      <Drawer
        isOpen={isCreateOpen || !!editingGoal}
        onClose={() => { setIsCreateOpen(false); setEditingGoal(null); resetForm(); }}
        title={editingGoal ? 'Edit Savings Goal' : 'New Savings Goal'}
      >
        <div className="space-y-4">
          <p className="text-sm text-brand-500 dark:text-brand-400">
            Buckets cap what you spend; goals track what you&apos;re saving toward.
          </p>
          <Input
            placeholder="Goal name (e.g. Christmas)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Target amount"
            value={targetAmount}
            onChange={e => setTargetAmount(e.target.value)}
            className="font-mono"
          />
          <Input
            type="date"
            placeholder="Due date (optional)"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          {kidMembers.length > 0 && (
            <Select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Shared household goal</option>
              {kidMembers.map(m => (
                <option key={m.uid} value={m.uid}>{m.displayName}&apos;s jar</option>
              ))}
            </Select>
          )}
          <Button onClick={handleSave} className="w-full py-3 mt-2">
            {editingGoal ? 'Save Changes' : 'Create Goal'}
          </Button>
        </div>
      </Drawer>

      {/* Contribute Drawer */}
      <Drawer
        isOpen={!!contributingGoal}
        onClose={() => { setContributingGoal(null); setContributionAmount(''); }}
        title={`Add to "${contributingGoal?.name ?? ''}"`}
      >
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
          A manual contribution — it doesn&apos;t touch any account balance.
        </p>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Amount"
          value={contributionAmount}
          onChange={e => setContributionAmount(e.target.value)}
          className="font-mono mb-4"
          autoFocus
        />
        <Button onClick={handleContribute} className="w-full py-3">
          Add Contribution
        </Button>
      </Drawer>

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionGoal}
        onClose={() => setActionGoal(null)}
        title={actionGoal?.name || 'Goal Options'}
      >
        <div className="space-y-3 pb-6">
          {actionGoal && (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                onClick={() => {
                  openEdit(actionGoal);
                  setActionGoal(null);
                }}
              >
                Edit Goal
              </Button>
              <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  setDeletingGoal(actionGoal);
                  setActionGoal(null);
                }}
              >
                Delete Goal
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-center py-4"
                onClick={() => setActionGoal(null)}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={!!deletingGoal}
        onClose={() => { if (!isDeleting) setDeletingGoal(null); }}
        onConfirm={handleDelete}
        title="Delete Savings Goal?"
        message="Are you sure you want to delete this goal? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />
    </div>
  );
};

export default SavingsGoals;
