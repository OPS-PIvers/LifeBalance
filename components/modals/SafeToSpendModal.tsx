/* eslint-disable */

import React, { useState } from 'react';
import { X, Wallet, Receipt, CreditCard, ChevronDown, ChevronUp } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfToday, endOfMonth, parseISO, isAfter, isBefore, format } from 'date-fns';
import { getTransactionsForBucket } from '../../utils/bucketSpentCalculator';
import { findNextPaycheckDate } from '../../utils/safeToSpendCalculator';
import { expandCalendarItems } from '../../utils/calendarRecurrence';
import { CalendarItem } from '../../types/schema';

interface SafeToSpendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SafeToSpendModal: React.FC<SafeToSpendModalProps> = ({ isOpen, onClose }) => {
  const {
    accounts,
    buckets,
    calendarItems,
    safeToSpend,
    transactions,
    bucketSpentMap,
    currentPeriodId,
  } = useHousehold();

  if (!isOpen) return null;

  // Re-calculate the breakdown for display (logic mirrors safeToSpendCalculator)

  // 1. Checking
  const checkingAccounts = accounts.filter(a => a.type === 'checking');
  const totalChecking = checkingAccounts.reduce((sum, a) => sum + a.balance, 0);

  // 2. Bills (paycheck-based date range)
  let unpaidBillsItems: CalendarItem[] = [];
  let totalUnpaidBills = 0;
  let rangeLabel = '';

  if (!currentPeriodId) {
    // No paycheck tracking enabled
    rangeLabel = 'No paycheck tracking';
  } else {
    const paycheckA = parseISO(currentPeriodId);
    const paycheckBDate = findNextPaycheckDate(calendarItems, currentPeriodId);

    let rangeEndDate: Date;
    if (paycheckBDate) {
      rangeEndDate = parseISO(paycheckBDate);
      rangeLabel = `Until next paycheck (${format(rangeEndDate, 'MMM d')})`;
    } else {
      rangeEndDate = endOfMonth(paycheckA);
      rangeLabel = `Until end of month (${format(rangeEndDate, 'MMM d')})`;
    }

    // Expand recurring items to show all instances
    const expandedItems = expandCalendarItems(calendarItems, paycheckA, rangeEndDate);

    unpaidBillsItems = expandedItems.filter(item => {
      const itemDate = parseISO(item.date);
      const isCoveredByBucket = buckets.some(b =>
        item.title.toLowerCase().includes(b.name.toLowerCase()) ||
        b.name.toLowerCase().includes(item.title.toLowerCase())
      );
      return (
        item.type === 'expense' &&
        !item.isPaid &&
        isAfter(itemDate, paycheckA) &&
        (isBefore(itemDate, rangeEndDate) || itemDate.getTime() === rangeEndDate.getTime()) &&
        !isCoveredByBucket
      );
    });
    totalUnpaidBills = unpaidBillsItems.reduce((sum, i) => sum + i.amount, 0);
  }

  // 3. Buckets (for informational display only)
  const bucketBreakdown = buckets.map(b => {
    const spent = bucketSpentMap.get(b.id) || { verified: 0, pending: 0 };
    const remaining = Math.max(0, b.limit - spent.verified);
    const bucketTxs = getTransactionsForBucket(b.name, transactions, currentPeriodId);
    return { ...b, spent, remaining, transactions: bucketTxs };
  }).filter(b => b.remaining > 0);

  const totalBucketLiability = bucketBreakdown.reduce((sum, b) => sum + b.remaining, 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 bg-brand-50 shrink-0">
          <h2 className="text-lg font-bold text-brand-800">Safe to Spend Breakdown</h2>
          <button onClick={onClose} className="p-2 text-brand-400 hover:bg-brand-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
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
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Reserved for Bills</span>
                    <span className="text-[10px] text-brand-400">{rangeLabel}</span>
                  </div>
                </div>
                <span className="font-mono font-bold">-${totalUnpaidBills.toLocaleString()}</span>
             </div>
             {unpaidBillsItems.length > 0 && (
               <div className="pl-6 space-y-1">
                 {unpaidBillsItems.map(bill => (
                   <div key={bill.id} className="flex justify-between text-xs text-brand-400">
                     <span>{bill.title} ({format(parseISO(bill.date), 'MMM d')})</span>
                     <span>${bill.amount}</span>
                   </div>
                 ))}
               </div>
             )}
          </div>

          {/* Informational: Bucket Balances */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-brand-500">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} />
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Bucket Balances</span>
                    <span className="text-[10px] text-brand-400">For reference only</span>
                  </div>
                </div>
                <span className="font-mono font-bold text-brand-600">
                  ${totalBucketLiability.toLocaleString()}
                </span>
             </div>

             {bucketBreakdown.length > 0 ? (
               <div className="pl-6 space-y-3 max-h-64 overflow-y-auto pr-2">
                 {bucketBreakdown.map(b => {
                   const spent = b.spent.verified + b.spent.pending;
                   const percent = b.limit > 0 ? Math.min(100, (spent / b.limit) * 100) : 0;
                   const isOverspent = spent > b.limit;

                   return (
                     <div key={b.id} className="space-y-1">
                       <div className="flex justify-between items-center text-xs text-brand-400">
                         <div className="flex items-center gap-2">
                           <span>{b.name}</span>
                           {b.spent.pending > 0 && (
                             <span className="text-[10px] text-amber-600">
                               ({b.spent.pending} pending)
                             </span>
                           )}
                         </div>
                         <span className="font-mono">${b.remaining.toFixed(2)}</span>
                       </div>

                       {/* Meter */}
                       <div
                         className="h-1.5 w-full bg-brand-100 rounded-full overflow-hidden"
                         role="progressbar"
                         aria-valuemin={0}
                         aria-valuemax={100}
                         aria-valuenow={Math.round(percent)}
                         aria-label={`Spending for ${b.name}: ${Math.round(percent)}% used`}
                       >
                         <div
                           className={`h-full rounded-full ${isOverspent ? 'bg-money-neg' : b.color}`}
                           style={{ width: `${percent}%` }}
                         />
                       </div>
                     </div>
                   );
                 })}
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
            This is your available cash after accounting for bills due before your next paycheck. Bucket balances are shown for reference and do not reduce your safe-to-spend amount.
          </p>

        </div>
      </div>
    </div>
  );
};

export default SafeToSpendModal;
