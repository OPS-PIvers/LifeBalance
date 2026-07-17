
import React, { useState, useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Pencil, Check, Plus, Target, Star, GripVertical, Trash2, MoreVertical, Landmark, CreditCard, Banknote, Archive, ArchiveRestore, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { Account } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { computeNetWorth } from '@/utils/netWorth';
import { shouldOfferBalanceAdoption } from '@/utils/plaidBalance';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import { SurfaceList, Row } from '@/components/ui/Section';
import SavingsGoals from '@/components/budget/SavingsGoals';

const BudgetAccounts: React.FC = () => {
  const { accounts, updateAccountBalance, addAccount, setAccountGoal, setAccountCardLast4, deleteAccount, archiveAccount, unarchiveAccount, reorderAccounts } = useFinance();
  const [showArchived, setShowArchived] = useState(false);
  const fmt = useFormatCurrency();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Add Account Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('checking');
  const [newBalance, setNewBalance] = useState('');
  const [newCardLast4, setNewCardLast4] = useState('');

  // Set Goal Modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState<string | null>(null);
  const [goalAmount, setGoalAmount] = useState('');

  // Set Card Digits Modal (id of the account being tagged, or null)
  const [isCardModalOpen, setIsCardModalOpen] = useState<string | null>(null);
  const [cardDigits, setCardDigits] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mobile Actions
  const [actionAccount, setActionAccount] = useState<Account | null>(null);

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Group and sort accounts. Archived accounts (F-MONEY-08) are excluded from
  // the active lists and net worth — they're a display-only history section.
  const { assetAccounts, liabilityAccounts, archivedAccounts, assets, debts, netWorth } = useMemo(() => {
    const activeAccounts = accounts.filter(a => !a.archived);
    const assetAccts = activeAccounts
      .filter(a => a.type !== 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const liabilityAccts = activeAccounts
      .filter(a => a.type === 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const archivedAccts = accounts
      .filter(a => a.archived)
      .sort((a, b) => a.name.localeCompare(b.name));

    const { totalAssets, totalLiabilities, netWorth: net } = computeNetWorth(activeAccounts);

    return {
      assetAccounts: assetAccts,
      liabilityAccounts: liabilityAccts,
      archivedAccounts: archivedAccts,
      assets: totalAssets,
      debts: totalLiabilities,
      netWorth: net
    };
  }, [accounts]);

  const handleAddAccount = () => {
    if (!newName || !newBalance) return;
    const isLiability = newType === 'credit';
    const relevantAccounts = isLiability ? liabilityAccounts : assetAccounts;
    const maxOrder = relevantAccounts.length > 0
      ? Math.max(...relevantAccounts.map(a => a.order ?? 0))
      : -1;

    // Keep only the last 4 digits so "...8899" and "8899" both store cleanly.
    // A partial (1-3 digit) entry would store a value that can never match an
    // incoming card, so reject it rather than saving something silently useless.
    const rawDigits = newCardLast4.replace(/\D/g, '');
    if (rawDigits && rawDigits.length < 4) {
      toast.error('Card digits must be the last 4 numbers');
      return;
    }
    const digits = rawDigits.slice(-4);
    const newAccount: Account = {
      id: crypto.randomUUID(),
      name: newName,
      type: newType,
      balance: parseFloat(newBalance),
      lastUpdated: new Date().toISOString(),
      order: maxOrder + 1,
      ...(digits ? { cardLast4: digits } : {}),
    };
    addAccount(newAccount);
    setIsAddModalOpen(false);
    setNewName('');
    setNewBalance('');
    setNewCardLast4('');
  };

  const handleSetGoal = async () => {
    if (isGoalModalOpen && goalAmount) {
      // Await the write and only close on success, so a failed Firestore write
      // surfaces an error (no unhandled rejection) and the user can retry
      // without losing the drawer.
      try {
        await setAccountGoal(isGoalModalOpen, parseFloat(goalAmount));
        setIsGoalModalOpen(null);
        setGoalAmount('');
      } catch (error) {
        console.error('Failed to set savings goal', error);
        toast.error('Failed to set goal. Please try again.');
      }
    }
  };

  const handleSetCard = async () => {
    if (isCardModalOpen) {
      // Reject a partial entry here (before saving) and keep the drawer open so
      // the user doesn't lose what they typed. An empty input is allowed — it
      // clears the tag (setAccountCardLast4 handles the deleteField).
      const rawDigits = cardDigits.replace(/\D/g, '');
      if (rawDigits && rawDigits.length < 4) {
        toast.error('Card digits must be the last 4 numbers');
        return;
      }
      // Await the write and only close on success, so a failed Firestore write
      // surfaces an error (no unhandled rejection) and the drawer stays open to
      // retry.
      try {
        await setAccountCardLast4(isCardModalOpen, cardDigits);
        setIsCardModalOpen(null);
        setCardDigits('');
      } catch (error) {
        console.error('Failed to save card digits', error);
        toast.error('Failed to save card digits. Please try again.');
      }
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingId || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAccount(deletingId);
      setDeletingId(null);
    } catch (error) {
      console.error('Failed to delete account', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveAccount = async (id: string) => {
    try {
      await archiveAccount(id);
    } catch (error) {
      console.error('Failed to archive account', error);
      toast.error('Failed to archive account. Please try again.');
    }
  };

  const handleUnarchiveAccount = async (id: string) => {
    try {
      await unarchiveAccount(id);
    } catch (error) {
      console.error('Failed to unarchive account', error);
      toast.error('Failed to unarchive account. Please try again.');
    }
  };

  const startEditing = (id: string, currentBalance: number) => {
    setEditingId(id);
    setEditValue(currentBalance.toString());
  };

  const saveEditing = (id: string) => {
    const num = parseFloat(editValue);
    if (!isNaN(num)) {
      updateAccountBalance(id, num);
    }
    setEditingId(null);
  };

  // Adopt the advisory Plaid balance for an account: writes through the
  // NORMAL balance-update path (same as manual editing) so history/alerts
  // fire correctly — never a direct Firestore write. The manual `balance`
  // field remains authoritative; this just syncs it to match the bank.
  const handleAdoptPlaidBalance = (account: Account) => {
    if (typeof account.plaidBalanceCurrent !== 'number') return;
    updateAccountBalance(account.id, roundMoney(account.plaidBalanceCurrent));
    track('plaid_balance_adopted');
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, accountId: string) => {
    setDraggedId(accountId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', accountId);
  };

  const handleDragOver = (e: React.DragEvent, accountId: string) => {
    e.preventDefault();
    if (draggedId !== accountId) {
      setDragOverId(accountId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string, isLiabilityGroup: boolean) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const relevantAccounts = isLiabilityGroup ? liabilityAccounts : assetAccounts;
    const draggedAccount = relevantAccounts.find(a => a.id === draggedId);

    // Only allow reordering within same group
    if (!draggedAccount) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Reorder
    const newOrder = relevantAccounts.filter(a => a.id !== draggedId);
    const targetIndex = newOrder.findIndex(a => a.id === targetId);
    newOrder.splice(targetIndex, 0, draggedAccount);

    // Save new order
    reorderAccounts(newOrder.map(a => a.id));

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const renderAccountRow = (account: Account, isLiabilityGroup: boolean) => {
    const isLiability = account.type === 'credit';
    const isEditing = editingId === account.id;
    const isSavings = account.type === 'savings';
    const progress = account.monthlyGoal ? Math.min(100, (account.balance / account.monthlyGoal) * 100) : 0;
    const hitGoal = account.monthlyGoal && account.balance >= account.monthlyGoal;
    const isDragging = draggedId === account.id;
    const isDragOver = dragOverId === account.id;

    return (
      <Row
        key={account.id}
        draggable
        onDragStart={(e) => handleDragStart(e, account.id)}
        onDragOver={(e) => handleDragOver(e, account.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, account.id, isLiabilityGroup)}
        onDragEnd={handleDragEnd}
        className={`flex-col items-stretch gap-2 transition-[opacity,transform,background-color] duration-(--duration-base) ease-(--ease-standard) ${
          isDragging ? 'opacity-50 scale-95' : ''
        } ${isDragOver ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing text-brand-300 dark:text-brand-500 hover:text-brand-500 dark:hover:text-brand-400 touch-none shrink-0">
              <GripVertical size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-brand-900 dark:text-brand-100 truncate">{account.name}</p>
              <div className="flex items-center gap-1.5">
                <Badge variant={isLiability ? 'danger' : 'success'} size="sm" className="uppercase">
                  {account.type}
                </Badge>
                {account.cardLast4 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-brand-500 dark:text-brand-400">
                    <CreditCard size={11} aria-hidden />
                    ···{account.cardLast4}
                  </span>
                )}
              </div>
            </div>
            {isSavings && (
              <Button
                variant="subtle"
                size="icon-sm"
                onClick={() => setIsGoalModalOpen(account.id)}
                className="hover:text-habit-gold hover:bg-warm-50 dark:hover:bg-warm-500/15 hidden sm:flex shrink-0"
                aria-label={`Set savings goal for ${account.name}`}
              >
                <Target size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Archive button (Desktop) */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleArchiveAccount(account.id)}
              className="text-brand-300 dark:text-brand-500 hidden sm:flex"
              aria-label={`Archive ${account.name} account`}
            >
              <Archive size={14} />
            </Button>

            {/* Delete button (Desktop) */}
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              onClick={() => setDeletingId(account.id)}
              className="text-brand-300 dark:text-brand-500 hidden sm:flex"
              aria-label={`Delete ${account.name} account`}
            >
              <Trash2 size={14} />
            </Button>

            {/* Mobile Actions (replacing small buttons) */}
            <div className="sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActionAccount(account)}
                className="text-brand-300 dark:text-brand-450"
                aria-label={`Options for ${account.name}`}
              >
                <MoreVertical size={20} />
              </Button>
            </div>

            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-24 bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-700 rounded-btn px-2 py-1 text-right font-mono font-bold outline-hidden focus:ring-2 focus:ring-accent-500/40 dark:text-brand-100"
                  autoFocus
                />
                <Button
                  variant="primary"
                  size="icon-sm"
                  onClick={() => saveEditing(account.id)}
                  aria-label="Save balance"
                >
                  <Check size={16} />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startEditing(account.id, account.balance)}
                className="group cursor-pointer text-right focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-800 rounded-btn"
                aria-label={`Edit balance for ${account.name}`}
              >
                <p className={`font-mono tabular-nums font-bold text-lg ${isLiability ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark'}`}>
                  {fmt(account.balance)}
                </p>
                <p className="text-xxs text-brand-300 dark:text-brand-450 group-hover:text-brand-500 dark:group-hover:text-brand-400 flex justify-end items-center gap-1 transition-colors">
                  Tap to edit <Pencil size={8} />
                </p>
              </button>
            )}
          </div>
        </div>

        {/* Savings Goal Bar */}
        {isSavings && account.monthlyGoal && (
          <div className="ml-7">
            <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450 mb-1">
              <span className="flex items-center gap-1">{hitGoal && <Star size={10} className="fill-habit-gold text-habit-gold"/>} {Math.round(progress)}% to goal</span>
              <span>Target: {fmt(account.monthlyGoal)}</span>
            </div>
            <ProgressBar
              value={progress}
              className="h-1.5 bg-brand-100 dark:bg-brand-700"
              barClassName="bg-habit-gold"
              ariaLabel={`${Math.round(progress)}% to goal`}
            />
          </div>
        )}

        {/* Advisory Plaid balance chip — only when a linked bank balance has
            diverged from the manual balance by more than the threshold. */}
        {shouldOfferBalanceAdoption(account) && (
          <div className="ml-7">
            <button
              type="button"
              onClick={() => handleAdoptPlaidBalance(account)}
              className="inline-flex items-center gap-1.5 text-xxs font-medium text-accent-700 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/30 hover:bg-accent-100 dark:hover:bg-accent-900/50 rounded-full px-2.5 py-1 transition-colors"
            >
              <Banknote size={11} aria-hidden />
              Update to bank balance {fmt(account.plaidBalanceCurrent ?? 0)}
            </button>
          </div>
        )}
      </Row>
    );
  };

  return (
    <div className="space-y-6">
      {/* Net Worth — compact stat row (was an oversized p-8 hero; Assets/
          Liabilities totals are repeated in the section headers below, so this
          keeps only the headline figure — UX audit Batch 3). */}
      <div className="bg-accent-600 dark:bg-accent-700 rounded-lg px-5 py-4 text-white shadow-raised flex items-center justify-between">
        <p className="font-display text-xs font-semibold uppercase tracking-widest text-white/70">Total Net Worth</p>
        <p className="text-2xl font-mono font-bold tracking-tight tabular-nums">
          {fmt(netWorth)}
        </p>
      </div>

      {/* Assets Section */}
      {assetAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <h3 className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200 uppercase tracking-wide">Assets</h3>
            <div className="flex-1 h-px bg-brand-200 dark:bg-brand-700"></div>
            <span className="text-sm font-mono tabular-nums text-money-pos dark:text-money-posDark">{fmt(assets)}</span>
          </div>
          <SurfaceList>
            {assetAccounts.map(account => renderAccountRow(account, false))}
          </SurfaceList>
        </div>
      )}

      {/* Liabilities Section */}
      {liabilityAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <h3 className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200 uppercase tracking-wide">Liabilities</h3>
            <div className="flex-1 h-px bg-brand-200 dark:bg-brand-700"></div>
            <span className="text-sm font-mono tabular-nums text-money-neg dark:text-money-negDark">{fmt(debts)}</span>
          </div>
          <SurfaceList>
            {liabilityAccounts.map(account => renderAccountRow(account, true))}
          </SurfaceList>
        </div>
      )}

      {/* Add Account Button — rendered when at least one account exists, positioned
          directly after the Liabilities section. When zero accounts exist, the
          EmptyState below provides the primary action. */}
      {(assetAccounts.length > 0 || liabilityAccounts.length > 0) && (
        <Button
          variant="dashed"
          size="sm"
          onClick={() => setIsAddModalOpen(true)}
          className="w-full py-2.5 rounded-card"
          leftIcon={<Plus size={16} />}
        >
          Add Account
        </Button>
      )}

      {/* Savings Goals (Plan 24) — near the existing per-account monthlyGoal
          affordance above, per the design spike. */}
      <SavingsGoals />

      {/* Archived Accounts (F-MONEY-08) — collapsed history section. Hidden
          from active lists/net worth/Safe-to-Spend, but transactions tagged
          to these accounts still resolve correctly. */}
      {archivedAccounts.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            aria-controls="archived-accounts-list"
            className="flex w-full items-center gap-1.5 px-1 text-left text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-800 rounded-btn"
          >
            <Archive size={12} aria-hidden />
            Archived accounts ({archivedAccounts.length})
            <ChevronDown
              size={14}
              className={cn(
                'transition-transform duration-(--duration-base) ease-(--ease-standard)',
                showArchived && 'rotate-180'
              )}
            />
          </button>
          {showArchived && (
            <SurfaceList id="archived-accounts-list">
              {archivedAccounts.map(account => (
                <Row key={account.id} className="items-center justify-between gap-3 opacity-70">
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-700 dark:text-brand-300 truncate">{account.name}</p>
                    <Badge variant={account.type === 'credit' ? 'danger' : 'success'} size="sm" className="uppercase">
                      {account.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="font-mono tabular-nums font-bold text-sm text-brand-500 dark:text-brand-400">
                      {fmt(account.balance)}
                    </p>
                    <Button
                      variant="subtle"
                      size="icon-sm"
                      onClick={() => handleUnarchiveAccount(account.id)}
                      aria-label={`Unarchive ${account.name} account`}
                    >
                      <ArchiveRestore size={14} />
                    </Button>
                  </div>
                </Row>
              ))}
            </SurfaceList>
          )}
        </div>
      )}

      {/* Empty State */}
      {assetAccounts.length === 0 && liabilityAccounts.length === 0 && (
        <EmptyState
          variant="surface"
          icon={<Landmark size={28} />}
          title="No accounts yet"
          description="Add your checking, savings, and credit accounts to track your net worth."
          action={
            <Button
              variant="primary"
              onClick={() => setIsAddModalOpen(true)}
              leftIcon={<Plus size={18} />}
            >
              Add Account
            </Button>
          }
        />
      )}

      {/* Add Account Drawer */}
      <Drawer
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Account"
      >
        <div className="space-y-4">
          <Input
            placeholder="Account Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <Select
            value={newType}
            onChange={(e) => setNewType(e.target.value as Account['type'])}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit Card</option>
          </Select>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Current Balance"
            value={newBalance}
            onChange={e => setNewBalance(e.target.value)}
            className="font-mono"
          />
          {newType !== 'savings' && (
            <div>
              <Input
                inputMode="numeric"
                placeholder="Card last 4 digits (optional)"
                value={newCardLast4}
                onChange={e => setNewCardLast4(e.target.value)}
                maxLength={19}
                className="font-mono"
              />
              <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
                Lets bank-alert Shortcuts (e.g. Wells Fargo emails) route purchases to this account.
              </p>
            </div>
          )}
          <Button
            onClick={handleAddAccount}
            className="w-full py-3 mt-2"
          >
            Save Account
          </Button>
        </div>
      </Drawer>

      {/* Goal Drawer */}
      <Drawer
        isOpen={!!isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(null)}
        title="Set Savings Goal"
      >
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
          What is your target balance for this account?
        </p>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Goal Amount"
          value={goalAmount}
          onChange={e => setGoalAmount(e.target.value)}
          className="font-mono mb-4"
          autoFocus
        />
        <Button
          onClick={handleSetGoal}
          className="w-full py-3"
        >
          Set Goal
        </Button>
      </Drawer>

      {/* Card Digits Drawer */}
      <Drawer
        isOpen={!!isCardModalOpen}
        onClose={() => setIsCardModalOpen(null)}
        title="Card Last 4 Digits"
      >
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
          Enter the last 4 digits of the card tied to this account. Bank-alert
          Shortcuts (e.g. Wells Fargo purchase emails) use this to route
          transactions to the right account. Leave blank to clear.
        </p>
        <Input
          inputMode="numeric"
          placeholder="e.g. 8899"
          value={cardDigits}
          onChange={e => setCardDigits(e.target.value)}
          maxLength={19}
          className="font-mono mb-4"
          autoFocus
        />
        <Button
          onClick={handleSetCard}
          className="w-full py-3"
        >
          Save
        </Button>
      </Drawer>

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionAccount}
        onClose={() => setActionAccount(null)}
        title={actionAccount?.name || 'Account Options'}
      >
        <div className="space-y-3 pb-6">
          {actionAccount && (
            <>
              {/* Edit Balance Action */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Pencil className="text-brand-500" />}
                onClick={() => {
                  startEditing(actionAccount.id, actionAccount.balance);
                  setActionAccount(null);
                }}
              >
                Edit Balance
              </Button>

              {/* Set Savings Goal (if applicable) */}
              {actionAccount.type === 'savings' && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-lg py-4"
                  leftIcon={<Target className="text-brand-500" />}
                  onClick={() => {
                    setIsGoalModalOpen(actionAccount.id);
                    setActionAccount(null);
                  }}
                >
                  Set Savings Goal
                </Button>
              )}

              {/* Set / edit card last-4 (debit & credit cards) */}
              {actionAccount.type !== 'savings' && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-lg py-4"
                  leftIcon={<CreditCard className="text-brand-500" />}
                  onClick={() => {
                    setCardDigits(actionAccount.cardLast4 ?? '');
                    setIsCardModalOpen(actionAccount.id);
                    setActionAccount(null);
                  }}
                >
                  {actionAccount.cardLast4 ? 'Edit Card Digits' : 'Add Card Digits'}
                </Button>
              )}

              <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />

              {/* Archive Action */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Archive className="text-brand-500" />}
                onClick={() => {
                  handleArchiveAccount(actionAccount.id);
                  setActionAccount(null);
                }}
              >
                Archive Account
              </Button>

              {/* Delete Action */}
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  setDeletingId(actionAccount.id);
                  setActionAccount(null);
                }}
              >
                Delete Account
              </Button>

              {/* Cancel */}
              <Button
                variant="ghost"
                className="w-full justify-center py-4"
                onClick={() => setActionAccount(null)}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </Drawer>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => { if (!isDeleting) setDeletingId(null); }}
        onConfirm={handleDeleteAccount}
        title="Delete Account?"
        message="Are you sure you want to delete this account? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />
    </div>
  );
};

export default BudgetAccounts;