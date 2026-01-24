import React, { useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { generateSmartShortcuts } from '@/utils/predictivePatterns';
import { Sparkles, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Transaction } from '@/types/schema';
import { format } from 'date-fns';

export const SmartShortcutsWidget: React.FC = () => {
  const { transactions, addTransaction, deleteTransaction } = useHousehold();

  const shortcuts = useMemo(() => {
    return generateSmartShortcuts(transactions);
  }, [transactions]);

  if (shortcuts.length === 0) return null;

  const handleAdd = async (shortcut: typeof shortcuts[0]) => {
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      amount: shortcut.amount,
      merchant: shortcut.merchant,
      category: shortcut.category,
      date: format(new Date(), 'yyyy-MM-dd'),
      status: 'verified',
      isRecurring: false,
      source: 'manual',
      autoCategorized: false
    };

    try {
      await addTransaction(newTx);

      // Custom Toast with Undo
      toast((t) => (
        <div className="flex items-center gap-2">
           <span>Added <b>{shortcut.merchant}</b></span>
           <button
             onClick={() => {
               deleteTransaction(newTx.id);
               toast.dismiss(t.id);
             }}
             className="px-2 py-1 bg-gray-200 rounded text-xs font-bold hover:bg-gray-300"
           >
             Undo
           </button>
        </div>
      ), { icon: '✅' });

    } catch (e) {
      toast.error('Failed to add transaction');
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-top-4">
       <div className="flex items-center gap-2 mb-2">
         <Sparkles size={14} className="text-violet-500" />
         <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Suggested for you</h3>
       </div>
       <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
         {shortcuts.map((s, i) => (
           <button
             key={i}
             onClick={() => handleAdd(s)}
             className="flex items-center gap-3 p-3 bg-white border border-brand-100 rounded-xl shadow-sm min-w-[160px] hover:border-violet-200 hover:shadow-md transition-all active:scale-95"
           >
             <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 font-bold text-xs shrink-0">
               {s.merchant.charAt(0)}
             </div>
             <div className="text-left">
               <p className="font-bold text-brand-800 text-sm truncate max-w-[100px]">{s.merchant}</p>
               <p className="text-xs text-brand-500 font-mono">${s.amount.toFixed(2)}</p>
             </div>
             <Plus size={16} className="ml-auto text-brand-300" />
           </button>
         ))}
       </div>
    </div>
  );
};
