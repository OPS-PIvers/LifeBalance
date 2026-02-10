import React, { useState, useMemo, useEffect } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Pencil, Check, Plus, X, Target, Star, GripVertical, Trash2 } from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import { Account } from '../../types/schema';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

interface AccountRowProps {
  account: Account;
  editingId: string | null;
  editValue: string;
  setEditValue: (val: string) => void;
  startEditing: (id: string, bal: number) => void;
  saveEditing: (id: string) => void;
  onDelete: (id: string) => void;
  onSetGoal: (id: string) => void;
}

const AccountRow: React.FC<AccountRowProps> = ({
  account,
  editingId,
  editValue,
  setEditValue,
  startEditing,
  saveEditing,
  onDelete,
  onSetGoal
}) => {
  const dragControls = useDragControls();
  const isLiability = account.type === 'credit';
  const isEditing = editingId === account.id;
  const isSavings = account.type === 'savings';
  const progress = account.monthlyGoal ? Math.min(100, (account.balance / account.monthlyGoal) * 100) : 0;
  const hitGoal = account.monthlyGoal && account.balance >= account.monthlyGoal;

  return (
    <Reorder.Item
      value={account}
      id={account.id}
      dragListener={false}
      dragControls={dragControls}
      className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm relative overflow-hidden mb-2 touch-manipulation list-none"
      whileDrag={{ scale: 1.02, zIndex: 10, boxShadow: "0 10px 20px rgba(0,0,0,0.1)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Drag Handle */}
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="cursor-grab active:cursor-grabbing text-brand-300 hover:text-brand-500 touch-none p-1 -ml-1"
            aria-label="Drag to reorder"
          >
            <GripVertical size={20} />
          </div>
          <div>
            <p className="font-bold text-brand-800">{account.name}</p>
            <span className={`text-xxs font-bold uppercase px-2 py-0.5 rounded-full ${
              isLiability ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
            }`}>
              {account.type}
            </span>
          </div>
          {isSavings && (
            <Button
              variant="subtle"
              size="icon-sm"
              onClick={() => onSetGoal(account.id)}
              className="hover:text-habit-gold hover:bg-yellow-50"
              aria-label={`Set savings goal for ${account.name}`}
            >
              <Target size={14} />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Delete button */}
          <Button
            variant="ghost-destructive"
            size="icon-sm"
            onClick={() => onDelete(account.id)}
            className="text-brand-300"
            aria-label={`Delete ${account.name} account`}
          >
            <Trash2 size={14} />
          </Button>

          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-24 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 text-right font-mono font-bold outline-none focus:ring-2 focus:ring-brand-500"
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
              <p className="text-xxs text-brand-300 group-hover:text-brand-500 flex justify-end items-center gap-1 transition-colors">
                Tap to edit <Pencil size={8} />
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Savings Goal Bar */}
      {isSavings && account.monthlyGoal && (
        <div className="mt-2 ml-7">
          <div className="flex justify-between text-xxs text-brand-400 mb-1">
            <span className="flex items-center gap-1">{hitGoal && <Star size={10} className="fill-habit-gold text-habit-gold"/>} {Math.round(progress)}% to goal</span>
            <span>Target: ${account.monthlyGoal.toLocaleString()}</span>
          </div>
          <div className="h-1.5 w-full bg-brand-100 rounded-full overflow-hidden">
            <div className="h-full bg-habit-gold transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </Reorder.Item>
  );
};

const BudgetAccounts: React.FC = () => {
  const { accounts, updateAccountBalance, addAccount, setAccountGoal, deleteAccount, reorderAccounts } = useHousehold();
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

  // Group and sort accounts
  const { assetAccounts, liabilityAccounts, assets, debts, netWorth } = useMemo(() => {
    const assetAccts = accounts
      .filter(a => a.type !== 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const liabilityAccts = accounts
      .filter(a => a.type === 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    const assetsTotal = assetAccts.reduce((sum, a) => sum + a.balance, 0);
    const debtsTotal = liabilityAccts.reduce((sum, a) => sum + a.balance, 0);

    return {
      assetAccounts: assetAccts,
      liabilityAccounts: liabilityAccts,
      assets: assetsTotal,
      debts: debtsTotal,
      netWorth: assetsTotal - debtsTotal
    };
  }, [accounts]);

  // Local state for Reorder
  const [localAssets, setLocalAssets] = useState<Account[]>(assetAccounts);
  const [localLiabilities, setLocalLiabilities] = useState<Account[]>(liabilityAccounts);

  useEffect(() => {
    setLocalAssets(assetAccounts);
  }, [assetAccounts]);

  useEffect(() => {
    setLocalLiabilities(liabilityAccounts);
  }, [liabilityAccounts]);

  const handleReorderAssets = (newOrder: Account[]) => {
    setLocalAssets(newOrder);
    reorderAccounts(newOrder.map(a => a.id));
  };

  const handleReorderLiabilities = (newOrder: Account[]) => {
    setLocalLiabilities(newOrder);
    reorderAccounts(newOrder.map(a => a.id));
  };

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

  const rowProps = {
    editingId,
    editValue,
    setEditValue,
    startEditing,
    saveEditing,
    onDelete: (id: string) => setDeletingId(id),
    onSetGoal: (id: string) => setIsGoalModalOpen(id),
  };

  return (
    <div className="space-y-6">
      {/* Net Worth Header */}
      <div className="bg-brand-800 rounded-2xl p-6 text-white shadow-lg text-center">
        <p className="text-brand-300 text-xs font-bold uppercase tracking-widest mb-1">Total Net Worth</p>
        <p className="text-4xl font-mono font-bold tracking-tight">
          ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex justify-center gap-6 mt-3 text-sm">
          <div>
            <span className="text-brand-400">Assets:</span>{' '}
            <span className="text-emerald-400 font-mono">${assets.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-brand-400">Liabilities:</span>{' '}
            <span className="text-rose-400 font-mono">${debts.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Assets Section */}
      {localAssets.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-600 uppercase tracking-wide">Assets</h3>
            <div className="flex-1 h-px bg-brand-100"></div>
            <span className="text-sm font-mono text-emerald-600">${assets.toLocaleString()}</span>
          </div>
          <Reorder.Group axis="y" values={localAssets} onReorder={handleReorderAssets} className="space-y-2">
            {localAssets.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                {...rowProps}
              />
            ))}
          </Reorder.Group>
        </div>
      )}

      {/* Liabilities Section */}
      {localLiabilities.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-600 uppercase tracking-wide">Liabilities</h3>
            <div className="flex-1 h-px bg-brand-100"></div>
            <span className="text-sm font-mono text-rose-600">${debts.toLocaleString()}</span>
          </div>
          <Reorder.Group axis="y" values={localLiabilities} onReorder={handleReorderLiabilities} className="space-y-2">
            {localLiabilities.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                {...rowProps}
              />
            ))}
          </Reorder.Group>
        </div>
      )}

      {/* Empty State */}
      {accounts.length === 0 && (
        <div className="text-center py-8 text-brand-400">
          <p>No accounts yet. Add your first account below.</p>
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
            <h3 id="add-account-title" className="font-bold text-lg text-brand-800">Add Account</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsAddModalOpen(false)}
              aria-label="Close"
            >
              <X size={20} className="text-brand-400" />
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
            <h3 id="set-goal-title" className="font-bold text-lg text-brand-800">Set Savings Goal</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsGoalModalOpen(null)}
              aria-label="Close"
            >
              <X size={20} className="text-brand-400" />
            </Button>
          </div>
          <p className="text-sm text-brand-500 mb-4">
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
              <h3 id="delete-account-title" className="font-bold text-lg text-brand-800">Delete Account?</h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => !isDeleting && setDeletingId(null)}
                className="text-brand-400 hover:text-brand-600"
                aria-label="Close"
                disabled={isDeleting}
              >
                <X size={20} />
              </Button>
            </div>
            <p id="delete-account-desc" className="text-sm text-brand-500 mb-6">
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
