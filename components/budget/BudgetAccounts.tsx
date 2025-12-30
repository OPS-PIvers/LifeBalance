
import React, { useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Pencil, Check, Plus, X, Target, Star } from 'lucide-react';
import { Account } from '../../types/schema';

const BudgetAccounts: React.FC = () => {
  const { accounts, updateAccountBalance, addAccount, setAccountGoal } = useHousehold();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  
  // Add Account Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('checking');
  const [newBalance, setNewBalance] = useState('');

  // Set Goal Modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState<string | null>(null); // accountId
  const [goalAmount, setGoalAmount] = useState('');

  const assets = accounts.filter(a => a.type !== 'credit').reduce((sum, a) => sum + a.balance, 0);
  const debts = accounts.filter(a => a.type === 'credit').reduce((sum, a) => sum + a.balance, 0);
  const netWorth = assets - debts;

  const handleAddAccount = () => {
    if (!newName || !newBalance) return;
    const newAccount: Account = {
      id: crypto.randomUUID(),
      name: newName,
      type: newType,
      balance: parseFloat(newBalance),
      lastUpdated: new Date().toISOString()
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

  return (
    <div className="space-y-6">
      {/* Net Worth Header */}
      <div className="bg-brand-800 rounded-2xl p-6 text-white shadow-lg text-center">
        <p className="text-brand-300 text-xs font-bold uppercase tracking-widest mb-1">Total Net Worth</p>
        <p className="text-4xl font-mono font-bold tracking-tight">
          ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Accounts List */}
      <div className="space-y-3">
        {accounts.map(account => {
          const isLiability = account.type === 'credit';
          const isEditing = editingId === account.id;
          const isSavings = account.type === 'savings';
          const progress = account.monthlyGoal ? Math.min(100, (account.balance / account.monthlyGoal) * 100) : 0;
          const hitGoal = account.monthlyGoal && account.balance >= account.monthlyGoal;

          return (
            <div key={account.id} className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="font-bold text-brand-800">{account.name}</p>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      isLiability ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      {isLiability ? 'Liability' : 'Asset'}
                    </span>
                  </div>
                  {isSavings && (
                    <button 
                      onClick={() => setIsGoalModalOpen(account.id)}
                      className="p-1.5 rounded-full bg-brand-50 text-brand-400 hover:text-habit-gold hover:bg-yellow-50 transition-colors"
                    >
                      <Target size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
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
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  ) : (
                    <div 
                      onClick={() => startEditing(account.id, account.balance)}
                      className="group cursor-pointer text-right"
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
                <div className="mt-2">
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
        })}
      </div>

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
    </div>
  );
};

export default BudgetAccounts;
