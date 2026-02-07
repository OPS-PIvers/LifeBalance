import React, { useMemo } from 'react';
import { Transaction, CURRENCY_FORMAT_OPTIONS } from '../../types/schema';
import { Plus, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

interface SmartTransactionShortcutsProps {
  transactions: Transaction[];
  onAddTransaction: (tx: Transaction) => Promise<void>;
}

export const SmartTransactionShortcuts: React.FC<SmartTransactionShortcutsProps> = ({
  transactions,
  onAddTransaction
}) => {
  const shortcuts = useMemo(() => {
    // 1. Filter manual transactions
    // We only want to shortcut items the user manually types that are not recurring
    const manualTx = transactions.filter(t => t.source === 'manual' && !t.isRecurring);

    // 2. Count frequencies
    const counts = new Map<string, { count: number; tx: Transaction }>();

    manualTx.forEach(tx => {
      // Key includes merchant, category, and amount (rounded to 2 decimals for safety)
      const key = `${tx.merchant.toLowerCase().trim()}|${tx.category}|${tx.amount.toFixed(2)}`;

      if (!counts.has(key)) {
        counts.set(key, { count: 0, tx });
      }
      const entry = counts.get(key)!;
      entry.count += 1;
    });

    // 3. Sort by count desc and take top 5 unique shortcuts
    // Filter out items with count < 2 (must have happened at least twice to be a "habit")
    return Array.from(counts.values())
      .filter(entry => entry.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(entry => entry.tx);
  }, [transactions]);

  if (shortcuts.length === 0) return null;

  const handleShortcutClick = async (tx: Transaction) => {
    const toastId = toast.loading('Adding transaction...');
    try {
        // Destructure to remove ID and dynamic fields
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...txData } = tx;

        // Clone and reset dynamic fields
        const newTx = {
            ...txData,
            id: 'temp-id', // Placeholder to satisfy TS, ignored by addTransaction
            date: new Date().toISOString().split('T')[0], // Today
            status: 'verified', // Assume verified if reusing a shortcut
            isRecurring: false,
            source: 'manual',
            autoCategorized: false, // Explicitly false for manual shortcuts
            payPeriodId: undefined, // Let context handle
            relatedHabitIds: [],
            // Clear specific fields
            notes: undefined,
        } as Transaction;

        await onAddTransaction(newTx);

        toast.success(
            <div className="flex flex-col">
                <span className="font-bold">Added: {tx.merchant}</span>
                <span className="text-xs opacity-90">${tx.amount.toFixed(2)}</span>
            </div>,
            { id: toastId }
        );
    } catch (error) {
        console.error("Shortcut failed", error);
        toast.error("Failed to add transaction", { id: toastId });
    }
  };

  return (
    <div className="flex flex-col gap-2 mb-4 animate-in slide-in-from-top-2 duration-500">
      <div className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1 ml-1">
        <Zap size={12} className="text-amber-400 fill-amber-400" />
        <span>Quick Add</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1">
        {shortcuts.map((tx) => (
          <button
            key={`${tx.merchant}-${tx.category}-${tx.amount}`}
            onClick={() => handleShortcutClick(tx)}
            aria-label={`Add ${tx.merchant} for $${tx.amount.toFixed(2)}`}
            className="flex items-center gap-3 px-3 py-2 bg-white border border-brand-100 rounded-xl shadow-sm hover:shadow-md hover:border-brand-200 active:scale-95 transition-all whitespace-nowrap group"
          >
            <div className="flex flex-col items-start">
                <span className="text-sm font-bold text-slate-700 group-hover:text-brand-700 max-w-[120px] truncate">
                    {tx.merchant}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                    ${tx.amount.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}
                </span>
            </div>
            <div className="w-6 h-6 rounded-full bg-brand-50 flex items-center justify-center text-brand-400 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors">
                <Plus size={14} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
