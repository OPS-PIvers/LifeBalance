import React, { useMemo, useState, useCallback } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { BucketPeriodSnapshot } from '@/types/schema';
import { format, parseISO } from 'date-fns';
import { roundMoney } from '@/utils/money';
import { ChevronDown, ChevronUp, History, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import ProgressBar from '@/components/ui/ProgressBar';
import { generateCsvExport } from '@/utils/exportUtils';
import toast from 'react-hot-toast';

interface PeriodGroup {
  periodId: string;
  startDate: string;
  endDate: string;
  snapshots: BucketPeriodSnapshot[];
  totalLimit: number;
  totalSpent: number;
  totalPending: number;
  transactionCount: number;
}

const BudgetHistory: React.FC = () => {
  const {
    bucketHistory,
    hasMoreBucketHistory,
    isLoadingOlderBucketHistory,
    loadAllBucketHistory,
  } = useFinance();
  const fmt = useFormatCurrency();
  const [expandedPeriodId, setExpandedPeriodId] = useState<string | null>(null);

  const historyGroups = useMemo(() => {
    const groups = new Map<string, PeriodGroup>();

    bucketHistory.forEach(snapshot => {
      if (!groups.has(snapshot.periodId)) {
        groups.set(snapshot.periodId, {
          periodId: snapshot.periodId,
          startDate: snapshot.periodStartDate,
          endDate: snapshot.periodEndDate,
          snapshots: [],
          totalLimit: 0,
          totalSpent: 0,
          totalPending: 0,
          transactionCount: 0
        });
      }

      const group = groups.get(snapshot.periodId)!;
      group.snapshots.push(snapshot);
      group.totalLimit = roundMoney(group.totalLimit + snapshot.limit);
      group.totalSpent = roundMoney(group.totalSpent + snapshot.totalSpent);
      group.totalPending = roundMoney(group.totalPending + snapshot.totalPending);
      group.transactionCount += snapshot.transactionCount;
    });

    return Array.from(groups.values()).sort((a, b) =>
      // startDate is a zero-padded ISO yyyy-MM-dd string, so lexical order matches
      // chronological order. Plain >/< beats localeCompare (no V8 collation cost)
      // and avoids the Date allocation the old comparator made per pair. (desc)
      b.startDate > a.startDate ? 1 : b.startDate < a.startDate ? -1 : 0
    );
  }, [bucketHistory]);

  const toggleExpand = (periodId: string) => {
    setExpandedPeriodId(prev => prev === periodId ? null : periodId);
  };

  const handleExport = useCallback(() => {
    if (bucketHistory.length === 0) {
      toast.error('No history to export');
      return;
    }

    try {
      const exportData = bucketHistory.map(snapshot => {
        const savings = snapshot.limit - snapshot.totalSpent;
        const utilization = snapshot.limit > 0
          ? ((snapshot.totalSpent / snapshot.limit) * 100).toFixed(1)
          : 'N/A';

        return {
          'Period Start': snapshot.periodStartDate,
          'Period End': snapshot.periodEndDate,
          'Bucket Name': snapshot.bucketName,
          'Limit': snapshot.limit,
          'Spent': snapshot.totalSpent,
          'Pending': snapshot.totalPending,
          'Savings/Overspend': savings,
          'Utilization (%)': utilization,
          'Transaction Count': snapshot.transactionCount
        };
      });

      // Sort by Period Start (desc) then Bucket Name
      exportData.sort((a, b) => {
        const dateDiff = b['Period Start'].localeCompare(a['Period Start']);
        if (dateDiff !== 0) return dateDiff;
        return a['Bucket Name'].localeCompare(b['Bucket Name']);
      });

      generateCsvExport(exportData, 'budget-history');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export history');
    }
  }, [bucketHistory]);

  const getProgressColor = (spent: number, limit: number) => {
    if (limit === 0) return 'bg-money-neg';
    const ratio = spent / limit;
    if (ratio >= 1) return 'bg-money-neg';
    if (ratio >= 0.85) return 'bg-warm-500';
    return 'bg-money-pos';
  };

  if (historyGroups.length === 0) {
    return (
      <Section title="Period history">
        <EmptyState
          variant="surface"
          icon={<History size={28} />}
          title="No history yet"
          description="Budget snapshots are created automatically when you approve a new paycheck."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Period history"
      action={
        <Button
          onClick={handleExport}
          disabled={bucketHistory.length === 0}
          variant="secondary"
          size="sm"
          leftIcon={<Download size={16} />}
        >
          Export CSV
        </Button>
      }
    >
      <div className="space-y-3">
        {historyGroups.map(group => {
          const isExpanded = expandedPeriodId === group.periodId;
          const savings = group.totalLimit - group.totalSpent;
          const percentUsed = group.totalLimit > 0
            ? Math.min(100, Math.max(0, (group.totalSpent / group.totalLimit) * 100))
            : 100;

          return (
            <div key={group.periodId} className="surface-section overflow-hidden">
              <button
                onClick={() => toggleExpand(group.periodId)}
                className="w-full text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-2xl"
                aria-expanded={isExpanded}
              >
                <div className="p-5 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <h3 className="font-semibold text-brand-900 dark:text-brand-100 text-base">
                        {format(parseISO(group.startDate), 'MMM d')} – {format(parseISO(group.endDate), 'MMM d, yyyy')}
                      </h3>
                      <p className="text-xs text-brand-400 dark:text-brand-500 font-medium mt-0.5">
                        {group.transactionCount} transactions
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-base font-bold tabular-nums ${savings >= 0 ? 'text-money-pos' : 'text-money-neg'}`}>
                        {savings >= 0 ? '+' : ''}{fmt(savings)}
                      </div>
                      <p className="text-xxs text-brand-400 dark:text-brand-500">
                        {savings >= 0 ? 'saved' : 'overspent'}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium text-brand-600 dark:text-brand-300">
                      <span className="font-mono tabular-nums">{fmt(group.totalSpent)} spent</span>
                      <span className="font-mono tabular-nums">{fmt(group.totalLimit)} limit</span>
                    </div>
                    <ProgressBar
                      value={percentUsed}
                      className="h-2 bg-brand-100 dark:bg-brand-700"
                      barClassName={getProgressColor(group.totalSpent, group.totalLimit)}
                      ariaLabel={`${Math.round(percentUsed)}% of limit used`}
                    />
                  </div>

                  <div className="flex justify-center pt-3 text-brand-400 dark:text-brand-500">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-brand-200 dark:border-brand-700 p-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
                  <h4 className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider">
                    Bucket breakdown
                  </h4>
                  {group.snapshots
                    .slice()
                    .sort((a, b) => (b.limit - b.totalSpent) - (a.limit - a.totalSpent))
                    .map(bucket => {
                      const bucketSavings = bucket.limit - bucket.totalSpent;
                      const bucketPercent = bucket.limit > 0
                        ? Math.min(100, Math.max(0, (bucket.totalSpent / bucket.limit) * 100))
                        : 100;

                      return (
                        <div key={bucket.id} className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-brand-700 dark:text-brand-200">{bucket.bucketName}</span>
                            <span className={`text-sm font-mono tabular-nums font-bold ${bucketSavings >= 0 ? 'text-money-pos' : 'text-money-neg'}`}>
                              {fmt(bucket.totalSpent)} <span className="text-brand-300 dark:text-brand-500 font-normal">/ {fmt(bucket.limit)}</span>
                            </span>
                          </div>
                          <ProgressBar
                            value={bucketPercent}
                            className="h-1.5 bg-brand-100 dark:bg-brand-700"
                            barClassName={getProgressColor(bucket.totalSpent, bucket.limit)}
                            ariaLabel={`${Math.round(bucketPercent)}% of limit used`}
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}

        {/* Load older periods beyond the live window */}
        {hasMoreBucketHistory && (
          <div className="pt-1 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadAllBucketHistory}
              disabled={isLoadingOlderBucketHistory}
              leftIcon={isLoadingOlderBucketHistory ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
            >
              {isLoadingOlderBucketHistory ? 'Loading…' : 'Load older periods'}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
};

export default BudgetHistory;
