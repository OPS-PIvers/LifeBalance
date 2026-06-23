import React, { useMemo } from 'react';
import { Wallet, Receipt, CreditCard, Clock } from 'lucide-react';
import { useFinance, useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { endOfMonth, parseISO, isAfter, isBefore, format } from 'date-fns';
import { sumMoney, addMoney, subtractMoney } from '@/utils/money';
import { getTransactionsForBucket } from '@/utils/bucketSpentCalculator';
import { findNextPaycheckDate, sumPendingSpend } from '@/utils/safeToSpendCalculator';
import { CalendarItem } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';

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
  } = useFinance();
  const fmt = useFormatCurrency();

  // Re-calculate the breakdown for display (logic mirrors safeToSpendCalculator)

  // 1. Checking
  const checkingAccounts = accounts.filter(a => a.type === 'checking');
  const totalChecking = sumMoney(checkingAccounts.map(a => a.balance));

  // 2. Bills (paycheck-based date range)
  // Compute the expansion window up front so the shared (unconditional) memoized
  // expansion hook can be called per the rules of hooks. When no paycheck is
  // tracked we use a zero-width window (start === end) which yields no items.
  const { paycheckA, rangeEndDate, rangeLabel } = useMemo(() => {
    if (!currentPeriodId) {
      const epoch = new Date(0);
      return { paycheckA: epoch, rangeEndDate: epoch, rangeLabel: 'No paycheck tracking' };
    }
    const start = parseISO(currentPeriodId);
    const paycheckBDate = findNextPaycheckDate(calendarItems, currentPeriodId);
    if (paycheckBDate) {
      const end = parseISO(paycheckBDate);
      return { paycheckA: start, rangeEndDate: end, rangeLabel: `Until next paycheck (${format(end, 'MMM d')})` };
    }
    const end = endOfMonth(start);
    return { paycheckA: start, rangeEndDate: end, rangeLabel: `Until end of month (${format(end, 'MMM d')})` };
  }, [currentPeriodId, calendarItems]);

  // Expand recurring items to show all instances via the shared memoized helper.
  const expandedItems = useExpandedCalendarItems(paycheckA, rangeEndDate);

  const unpaidBillsItems: CalendarItem[] = useMemo(() => {
    if (!currentPeriodId) return [];
    return expandedItems.filter(item => {
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
  }, [currentPeriodId, expandedItems, buckets, paycheckA, rangeEndDate]);

  const totalUnpaidBills = sumMoney(unpaidBillsItems.map(i => i.amount));

  // 2b. Pending spend (un-cleared transactions in the current period). Computed
  //     with the same helper the canonical formula uses, so this itemized line
  //     reconciles with the safe-to-spend total below (income excluded).
  const pendingSpend = sumPendingSpend(transactions, currentPeriodId);

  // 3. Buckets (for informational display only)
  const bucketBreakdown = buckets.map(b => {
    const spent = bucketSpentMap.get(b.id) || { verified: 0, pending: 0 };
    const remaining = Math.max(0, subtractMoney(b.limit, spent.verified));
    const bucketTxs = getTransactionsForBucket(b.name, transactions, currentPeriodId);
    return { ...b, spent, remaining, transactions: bucketTxs };
  }).filter(b => b.remaining > 0);

  const totalBucketLiability = sumMoney(bucketBreakdown.map(b => b.remaining));

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Safe to Spend Breakdown"
    >
      <div className="space-y-6">
          
          {/* Top Line: Checking Balance */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 rounded-xl">
                <Wallet size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Checking Balance</p>
                <p className="text-sm text-brand-500 dark:text-slate-400">Available Cash</p>
              </div>
            </div>
            <span className="text-lg font-mono font-bold text-brand-800 dark:text-slate-100">
              {fmt(totalChecking)}
            </span>
          </div>

          <hr className="border-brand-100 dark:border-slate-700" />

          {/* Reserved: Bills */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-rose-600 dark:text-rose-300">
                <div className="flex items-center gap-2">
                  <Receipt size={16} />
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Reserved for Bills</span>
                    <span className="text-xxs text-brand-400 dark:text-slate-400">{rangeLabel}</span>
                  </div>
                </div>
                <span className="font-mono font-bold">-{fmt(totalUnpaidBills)}</span>
             </div>
             {unpaidBillsItems.length > 0 && (
               <div className="pl-6 space-y-1">
                 {unpaidBillsItems.map(bill => (
                   <div key={bill.id} className="flex justify-between text-xs text-brand-400 dark:text-slate-400">
                     <span>{bill.title} ({format(parseISO(bill.date), 'MMM d')})</span>
                     <span>{fmt(bill.amount)}</span>
                   </div>
                 ))}
               </div>
             )}
          </div>

          {/* Reserved: Pending (un-cleared) transactions */}
          {pendingSpend > 0 && (
            <div className="flex items-center justify-between text-amber-600 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <Clock size={16} />
                <div className="flex flex-col">
                  <span className="font-bold text-sm">Pending Transactions</span>
                  <span className="text-xxs text-brand-400 dark:text-slate-400">Spent but not yet cleared</span>
                </div>
              </div>
              <span className="font-mono font-bold">-{fmt(pendingSpend)}</span>
            </div>
          )}

          {/* Informational: Bucket Balances */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-brand-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} />
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Bucket Balances</span>
                    <span className="text-xxs text-brand-400 dark:text-slate-400">For reference only</span>
                  </div>
                </div>
                <span className="font-mono font-bold text-brand-600 dark:text-slate-300">
                  {fmt(totalBucketLiability)}
                </span>
             </div>

             {bucketBreakdown.length > 0 ? (
               <div className="pl-6 space-y-3 max-h-64 scroll-contain-y pr-2">
                 {bucketBreakdown.map(b => {
                   const spent = addMoney(b.spent.verified, b.spent.pending);
                   const percent = b.limit > 0 ? Math.min(100, (spent / b.limit) * 100) : 0;
                   const isOverspent = spent > b.limit;

                   return (
                     <div key={b.id} className="space-y-1">
                       <div className="flex justify-between items-center text-xs text-brand-400 dark:text-slate-400">
                         <div className="flex items-center gap-2">
                           <span>{b.name}</span>
                           {b.spent.pending > 0 && (
                             <span className="text-xxs text-amber-600 dark:text-amber-300">
                               ({b.spent.pending} pending)
                             </span>
                           )}
                         </div>
                         <span className="font-mono">{fmt(b.remaining)}</span>
                       </div>

                       {/* Meter */}
                       <div
                         className="h-1.5 w-full bg-brand-100 dark:bg-slate-700/50 rounded-full overflow-hidden"
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
               <p className="pl-6 text-xs text-brand-300 dark:text-slate-500 italic">No remaining bucket funds.</p>
             )}
          </div>

          <div className="bg-brand-50 dark:bg-slate-700/50 rounded-xl p-4 border border-brand-100 dark:border-slate-700 flex items-center justify-between">
            <span className="font-bold text-brand-800 dark:text-slate-100">Safe to Spend</span>
            <span className={`text-2xl font-mono font-bold ${safeToSpend >= 0 ? 'text-money-pos' : 'text-money-neg'}`}>
              {fmt(Math.abs(safeToSpend))}
            </span>
          </div>
          
          <p className="text-xxs text-center text-brand-400 dark:text-slate-400">
            This is your available cash after accounting for bills due before your next paycheck and pending (un-cleared) transactions. Bucket balances are shown for reference and do not reduce your safe-to-spend amount.
          </p>
      </div>
    </Drawer>
  );
};

export default SafeToSpendModal;
