
import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Pencil, Check, Plus, X, Target, Star, GripVertical, Trash2, Loader2 } from 'lucide-react';
import { Account } from '../../types/schema';
import { Modal } from '../ui/Modal';

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
        className={`bg-white p-4 rounded-2xl border shadow-sm relative overflow-hidden transition-all duration-200 ${
          isDragging ? 'opacity-50 scale-95' : ''
        } ${isDragOver ? 'border-brand-500 border-2' : 'border-brand-100'}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing text-brand-300 hover:text-brand-500 touch-none">
              <GripVertical size={18} />
            </div>
            <div>
              <p className="font-bold text-brand-800">{account.name}</p>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                isLiability ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
              }`}>
                {account.type}
              </span>
            </div>
            {isSavings && (
              <button
                onClick={() => setIsGoalModalOpen(account.id)}
                className="p-1.5 rounded-full bg-brand-50 text-brand-400 hover:text-habit-gold hover:bg-yellow-50 transition-colors"
                aria-label={`Set savings goal for ${account.name}`}
              >
                <Target size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Delete button */}
            <button
              onClick={() => setDeletingId(account.id)}
              className="p-1.5 rounded-full text-brand-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              aria-label={`Delete ${account.name} account`}
            >
              <Trash2 size={14} />
            </button>

            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-24 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1 text-right font-mono font-bold outline-none focus:ring-2 focus:ring-brand-500"
                  autoFocus
                />
                <button
                  onClick={() => saveEditing(account.id)}
                  className="p-1.5 bg-brand-800 text-white rounded-lg active:scale-95"
                  aria-label="Save balance"
                >
                  <Check size={16} />
                </button>
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
                <p className="text-[10px] text-brand-300 group-hover:text-brand-500 flex justify-end items-center gap-1 transition-colors">
                  Tap to edit <Pencil size={8} />
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Savings Goal Bar */}
        {isSavings && account.monthlyGoal && (
          <div className="mt-2 ml-7">
            <div className="flex justify-between text-[10px] text-brand-400 mb-1">
              <span className="flex items-center gap-1">{hitGoal && <Star size={10} className="fill-habit-gold text-habit-gold"/>} {Math.round(progress)}% to goal</span>
              <span>Target: ${account.monthlyGoal.toLocaleString()}</span>
            </div>
            <div className="h-1.5 w-full bg-brand-100 rounded-full overflow-hidden">
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
      {assetAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-600 uppercase tracking-wide">Assets</h3>
            <div className="flex-1 h-px bg-brand-100"></div>
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
            <h3 className="text-sm font-bold text-brand-600 uppercase tracking-wide">Liabilities</h3>
            <div className="flex-1 h-px bg-brand-100"></div>
            <span className="text-sm font-mono text-rose-600">${debts.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {liabilityAccounts.map(account => renderAccountCard(account, true))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {accounts.length === 0 && (
        <div className="text-center py-8 text-brand-400">
          <p>No accounts yet. Add your first account below.</p>
        </div>
      )}

       {/* Add Account Button */}
       <button
        onClick={() => setIsAddModalOpen(true)}
        className="w-full py-4 border-2 border-dashed border-brand-200 rounded-2xl flex items-center justify-center text-brand-400 font-bold hover:bg-brand-50 hover:border-brand-300 transition-colors"
      >
        <Plus size={20} className="mr-2" /> Add Account
      </button>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
           <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-brand-800">Add Account</h3>
              <button onClick={() => setIsAddModalOpen(false)}><X size={20} className="text-brand-400" /></button>
            </div>

            <div className="space-y-4">
               <input
                 type="text"
                 placeholder="Account Name"
                 value={newName}
                 onChange={e => setNewName(e.target.value)}
                 className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
              />
              <select
                value={newType}
                onChange={(e: any) => setNewType(e.target.value)}
                className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit Card</option>
              </select>
              <input
                 type="number"
                 placeholder="Current Balance"
                 value={newBalance}
                 onChange={e => setNewBalance(e.target.value)}
                 className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono"
              />
               <button
                 onClick={handleAddAccount}
                 className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl mt-2"
               >
                 Save Account
               </button>
            </div>
           </div>
        </div>
      )}

      {/* Goal Modal */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
           <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-brand-800">Set Savings Goal</h3>
              <button onClick={() => setIsGoalModalOpen(null)}><X size={20} className="text-brand-400" /></button>
            </div>
             <p className="text-sm text-brand-500 mb-4">
               What is your target balance for this account?
             </p>
             <input
                 type="number"
                 placeholder="Goal Amount"
                 value={goalAmount}
                 onChange={e => setGoalAmount(e.target.value)}
                 className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl font-mono mb-4"
                 autoFocus
              />
              <button
                 onClick={handleSetGoal}
                 className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl"
               >
                 Set Goal
               </button>
           </div>
        </div>
      )}

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
              <button
                onClick={() => !isDeleting && setDeletingId(null)}
                className="text-brand-400 hover:text-brand-600 transition-colors"
                aria-label="Close"
                disabled={isDeleting}
              >
                <X size={20} />
              </button>
            </div>
            <p id="delete-account-desc" className="text-sm text-brand-500 mb-6">
              Are you sure you want to delete this account? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-3 border border-brand-200 text-brand-600 font-bold rounded-xl hover:bg-brand-50 transition-colors disabled:opacity-50"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                className="flex-1 py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
                <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default BudgetAccounts;