
import React from 'react';
import { X, Wallet, Receipt, CreditCard } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfToday, endOfMonth, parseISO, isAfter, isBefore } from 'date-fns';

interface SafeToSpendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SafeToSpendModal: React.FC<SafeToSpendModalProps> = ({ isOpen, onClose }) => {
  const { accounts, buckets, calendarItems, safeToSpend, transactions } = useHousehold();

  if (!isOpen) return null;

  // Re-calculate the breakdown for display (logic mirrors HouseholdContext)
  
  // 1. Checking
  const checkingAccounts = accounts.filter(a => a.type === 'checking');
  const totalChecking = checkingAccounts.reduce((sum, a) => sum + a.balance, 0);

  // 2. Bills
  const today = startOfToday();
  const endOfMonthDate = endOfMonth(today);
  const unpaidBillsItems = calendarItems.filter(item => {
    const itemDate = parseISO(item.date);
    const isCoveredByBucket = buckets.some(b => 
        item.title.toLowerCase().includes(b.name.toLowerCase()) || 
        b.name.toLowerCase().includes(item.title.toLowerCase())
    );
    return (
      item.type === 'expense' &&
      !item.isPaid &&
      (isAfter(itemDate, today) || itemDate.getTime() === today.getTime()) &&
      (isBefore(itemDate, endOfMonthDate) || itemDate.getTime() === endOfMonthDate.getTime()) &&
      !isCoveredByBucket
    );
  });
  const totalUnpaidBills = unpaidBillsItems.reduce((sum, i) => sum + i.amount, 0);

  // 3. Buckets
  const bucketBreakdown = buckets.map(b => {
    const remaining = Math.max(0, b.limit - b.spent);
    return { ...b, remaining };
  }).filter(b => b.remaining > 0);
  
  const totalBucketLiability = bucketBreakdown.reduce((sum, b) => sum + b.remaining, 0);

  // Pending Adjustment Display (Just for transparency)
  const pendingSpend = transactions
      .filter(t => t.status === 'pending_review')
      .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 bg-brand-50">
          <h2 className="text-lg font-bold text-brand-800">Safe to Spend Breakdown</h2>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          
          {/* Top Line: Checking Balance */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                <Wallet size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-brand-400 uppercase">Checking Balance</p>
                <p className="text-sm text-brand-500">Available Cash</p>
              </div>
            </div>
            <span className="text-lg font-mono font-bold text-brand-800">
              ${totalChecking.toLocaleString()}
            </span>
          </div>

          <hr className="border-brand-100" />

          {/* Reserved: Bills */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-rose-600">
                <div className="flex items-center gap-2">
                  <Receipt size={16} />
                  <span className="font-bold text-sm">Reserved for Bills</span>
                </div>
                <span className="font-mono font-bold">-${totalUnpaidBills.toLocaleString()}</span>
             </div>
             {unpaidBillsItems.length > 0 && (
               <div className="pl-6 space-y-1">
                 {unpaidBillsItems.map(bill => (
                   <div key={bill.id} className="flex justify-between text-xs text-brand-400">
                     <span>{bill.title} ({bill.date.split('-')[2]})</span>
                     <span>${bill.amount}</span>
                   </div>
                 ))}
               </div>
             )}
          </div>

          {/* Reserved: Buckets */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-brand-600">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} />
                  <span className="font-bold text-sm">Allocated to Buckets</span>
                </div>
                <span className="font-mono font-bold">
                  -${Math.max(0, totalBucketLiability - pendingSpend).toLocaleString()}
                </span>
             </div>
             
             {bucketBreakdown.length > 0 ? (
               <div className="pl-6 space-y-1 max-h-32 overflow-y-auto pr-2 no-scrollbar">
                 {bucketBreakdown.map(b => (
                   <div key={b.id} className="flex justify-between text-xs text-brand-400">
                     <span>{b.name}</span>
                     <span>${b.remaining}</span>
                   </div>
                 ))}
               </div>
             ) : (
               <p className="pl-6 text-xs text-brand-300 italic">No remaining bucket funds.</p>
             )}
          </div>

          <div className="bg-brand-50 rounded-xl p-4 border border-brand-100 flex items-center justify-between">
            <span className="font-bold text-brand-800">Safe to Spend</span>
            <span className={`text-2xl font-mono font-bold ${safeToSpend >= 0 ? 'text-money-pos' : 'text-money-neg'}`}>
              ${Math.abs(safeToSpend).toLocaleString()}
            </span>
          </div>
          
          <p className="text-[10px] text-center text-brand-400">
            This is your true liquid cash after accounting for all bills and bucket commitments. Savings accounts are excluded.
          </p>

        </div>
      </div>
    </div>
  );
};

export default SafeToSpendModal;
