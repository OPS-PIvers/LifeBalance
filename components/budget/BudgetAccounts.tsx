
import React, { useState, useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { Pencil, Check, Plus, X, Target, Star, GripVertical, Trash2, MoreVertical, Landmark } from 'lucide-react';
import { Account } from '@/types/schema';
import { sumMoney, subtractMoney } from '@/utils/money';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

const BudgetAccounts: React.FC = () => {
  const { accounts, updateAccountBalance, addAccount, setAccountGoal, deleteAccount, reorderAccounts } = useFinance();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Add Account Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('checking');
  const [newBalance, setNewBalance] = useState('');

  // Set Goal Modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState<string | null>(null);
  const [goalAmount, setGoalAmount] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mobile Actions
  const [actionAccount, setActionAccount] = useState<Account | null>(null);

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Group and sort accounts
  const { assetAccounts, liabilityAccounts, assets, debts, netWorth } = useMemo(() => {
    const assetAccts = accounts
      .filter(a => a.type !== 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const liabilityAccts = accounts
      .filter(a => a.type === 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    const assetsTotal = sumMoney(assetAccts.map(a => a.balance));
    const debtsTotal = sumMoney(liabilityAccts.map(a => a.balance));

    return {
      assetAccounts: assetAccts,
      liabilityAccounts: liabilityAccts,
      assets: assetsTotal,
      debts: debtsTotal,
      netWorth: subtractMoney(assetsTotal, debtsTotal)
    };
  }, [accounts]);

  const handleAddAccount = () => {
    if (!newName || !newBalance) return;
    const isLiability = newType === 'credit';
    const relevantAccounts = isLiability ? liabilityAccounts : assetAccounts;
    const maxOrder = relevantAccounts.length > 0
      ? Math.max(...relevantAccounts.map(a => a.order ?? 0))
      : -1;

    const newAccount: Account = {
      id: crypto.randomUUID(),
      name: newName,
      type: newType,
      balance: parseFloat(newBalance),
      lastUpdated: new Date().toISOString(),
      order: maxOrder + 1
    };
    addAccount(newAccount);
    setIsAddModalOpen(false);
    setNewName('');
    setNewBalance('');
  };

  const handleSetGoal = () => {
    if (isGoalModalOpen && goalAmount) {
      setAccountGoal(isGoalModalOpen, parseFloat(goalAmount));
      setIsGoalModalOpen(null);
      setGoalAmount('');
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

  const renderAccountCard = (account: Account, isLiabilityGroup: boolean) => {
    const isLiability = account.type === 'credit';
    const isEditing = editingId === account.id;
    const isSavings = account.type === 'savings';
    const progress = account.monthlyGoal ? Math.min(100, (account.balance / account.monthlyGoal) * 100) : 0;
    const hitGoal = account.monthlyGoal && account.balance >= account.monthlyGoal;
    const isDragging = draggedId === account.id;
    const isDragOver = dragOverId === account.id;

    return (
      <div
        key={account.id}
        draggable
        onDragStart={(e) => handleDragStart(e, account.id)}
        onDragOver={(e) => handleDragOver(e, account.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, account.id, isLiabilityGroup)}
        onDragEnd={handleDragEnd}
        className={`bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl p-5 rounded-2xl ring-1 ring-black/5 shadow-glass relative overflow-hidden transition-all duration-200 ${
          isDragging ? 'opacity-50 scale-95' : ''
        } ${isDragOver ? 'border-brand-500 border-2' : 'border-transparent'}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing text-brand-300 dark:text-slate-600 hover:text-brand-500 dark:hover:text-slate-400 touch-none">
              <GripVertical size={18} />
            </div>
            <div>
              <p className="font-bold text-brand-800 dark:text-slate-100">{account.name}</p>
              <span className={`text-xxs font-bold uppercase px-2 py-0.5 rounded-full ${
                isLiability ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
              }`}>
                {account.type}
              </span>
            </div>
            {isSavings && (
              <Button
                variant="subtle"
                size="icon-sm"
                onClick={() => setIsGoalModalOpen(account.id)}
                className="hover:text-habit-gold hover:bg-yellow-50 dark:hover:bg-yellow-500/15 hidden sm:flex"
                aria-label={`Set savings goal for ${account.name}`}
              >
                <Target size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Delete button (Desktop) */}
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              onClick={() => setDeletingId(account.id)}
              className="text-brand-300 dark:text-slate-600 hidden sm:flex"
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
                className="text-brand-300 dark:text-slate-500"
                aria-label={`Options for ${account.name}`}
              >
                <MoreVertical size={20} />
              </Button>
            </div>

            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-24 bg-brand-50 dark:bg-slate-700/50 border border-brand-200 dark:border-slate-700 rounded-lg px-2 py-1 text-right font-mono font-bold outline-none focus:ring-2 focus:ring-brand-500 dark:text-slate-100"
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
              <div
                onClick={() => startEditing(account.id, account.balance)}
                className="group cursor-pointer text-right"
                role="button"
                tabIndex={0}
                aria-label={`Edit balance for ${account.name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    startEditing(account.id, account.balance);
                  }
                }}
              >
                <p className={`font-mono font-bold text-lg ${isLiability ? 'text-money-neg' : 'text-money-pos'}`}>
                  ${account.balance.toLocaleString()}
                </p>
                <p className="text-xxs text-brand-300 dark:text-slate-500 group-hover:text-brand-500 dark:group-hover:text-slate-400 flex justify-end items-center gap-1 transition-colors">
                  Tap to edit <Pencil size={8} />
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Savings Goal Bar */}
        {isSavings && account.monthlyGoal && (
          <div className="mt-2 ml-7">
            <div className="flex justify-between text-xxs text-brand-400 dark:text-slate-500 mb-1">
              <span className="flex items-center gap-1">{hitGoal && <Star size={10} className="fill-habit-gold text-habit-gold"/>} {Math.round(progress)}% to goal</span>
              <span>Target: ${account.monthlyGoal.toLocaleString()}</span>
            </div>
            <div className="h-1.5 w-full bg-brand-100 dark:bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full bg-habit-gold transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Net Worth Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-8 text-white shadow-glass-deep ring-1 ring-white/10 text-center">
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Net Worth</p>
        <p className="text-4xl font-mono font-bold tracking-tight">
          ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex justify-center gap-6 mt-3 text-sm">
          <div>
            <span className="text-slate-400">Assets:</span>{' '}
            <span className="text-emerald-400 font-mono">${assets.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-slate-400">Liabilities:</span>{' '}
            <span className="text-rose-400 font-mono">${debts.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Assets Section */}
      {assetAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-600 dark:text-slate-300 uppercase tracking-wide">Assets</h3>
            <div className="flex-1 h-px bg-brand-100 dark:bg-slate-700"></div>
            <span className="text-sm font-mono text-emerald-600">${assets.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {assetAccounts.map(account => renderAccountCard(account, false))}
          </div>
        </div>
      )}

      {/* Liabilities Section */}
      {liabilityAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-600 dark:text-slate-300 uppercase tracking-wide">Liabilities</h3>
            <div className="flex-1 h-px bg-brand-100 dark:bg-slate-700"></div>
            <span className="text-sm font-mono text-rose-600">${debts.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {liabilityAccounts.map(account => renderAccountCard(account, true))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {accounts.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-12 px-6 bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl ring-1 ring-black/5 shadow-glass rounded-2xl">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center mb-4">
            <Landmark size={28} className="text-slate-400 dark:text-slate-500" />
          </div>
          <h3 className="text-lg font-bold text-brand-800 dark:text-slate-100">No accounts yet</h3>
          <p className="text-sm text-brand-500 dark:text-slate-400 mt-1 max-w-xs">
            Add your checking, savings, and credit accounts to track your net worth.
          </p>
          <Button
            variant="primary"
            onClick={() => setIsAddModalOpen(true)}
            className="mt-5"
            leftIcon={<Plus size={18} />}
          >
            Add Account
          </Button>
        </div>
      )}

       {/* Add Account Button */}
       <Button
        variant="dashed"
        onClick={() => setIsAddModalOpen(true)}
        className="w-full py-4 rounded-2xl"
        leftIcon={<Plus size={20} />}
      >
        Add Account
      </Button>

      {/* Add Account Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        ariaLabelledBy="add-account-title"
      >
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 id="add-account-title" className="font-bold text-lg text-brand-800 dark:text-slate-100">Add Account</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsAddModalOpen(false)}
              aria-label="Close"
            >
              <X size={20} className="text-brand-400 dark:text-slate-500" />
            </Button>
          </div>

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
              placeholder="Current Balance"
              value={newBalance}
              onChange={e => setNewBalance(e.target.value)}
              className="font-mono"
            />
            <Button
              onClick={handleAddAccount}
              className="w-full py-3 mt-2"
            >
              Save Account
            </Button>
          </div>
        </div>
      </Modal>

      {/* Goal Modal */}
      <Modal
        isOpen={!!isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(null)}
        ariaLabelledBy="set-goal-title"
      >
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 id="set-goal-title" className="font-bold text-lg text-brand-800 dark:text-slate-100">Set Savings Goal</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsGoalModalOpen(null)}
              aria-label="Close"
            >
              <X size={20} className="text-brand-400 dark:text-slate-500" />
            </Button>
          </div>
          <p className="text-sm text-brand-500 dark:text-slate-400 mb-4">
            What is your target balance for this account?
          </p>
          <Input
            type="number"
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
        </div>
      </Modal>

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

              <div className="h-px bg-gray-100 dark:bg-slate-700 my-2" />

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

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <Modal
          isOpen={true}
          onClose={() => !isDeleting && setDeletingId(null)}
          disableBackdropClose={isDeleting}
          ariaLabelledBy="delete-account-title"
          ariaDescribedBy="delete-account-desc"
        >
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 id="delete-account-title" className="font-bold text-lg text-brand-800 dark:text-slate-100">Delete Account?</h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => !isDeleting && setDeletingId(null)}
                className="text-brand-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-slate-300"
                aria-label="Close"
                disabled={isDeleting}
              >
                <X size={20} />
              </Button>
            </div>
            <p id="delete-account-desc" className="text-sm text-brand-500 dark:text-slate-400 mb-6">
              Are you sure you want to delete this account? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setDeletingId(null)}
                className="flex-1 py-3"
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                className="flex-1 py-3"
                disabled={isDeleting}
                isLoading={isDeleting}
                leftIcon={!isDeleting ? <Trash2 size={18} /> : undefined}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default BudgetAccounts;