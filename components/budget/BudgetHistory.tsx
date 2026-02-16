import React, { useMemo, useState, useCallback } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { BucketPeriodSnapshot } from '../../types/schema';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronUp, History, Download } from 'lucide-react';
import Card from '../ui/Card';
import { Button } from '../ui/Button';
import { generateCsvExport } from '../../utils/exportUtils';
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
  const { bucketHistory } = useHousehold();
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
      group.totalLimit += snapshot.limit;
      group.totalSpent += snapshot.totalSpent;
      group.totalPending += snapshot.totalPending;
      group.transactionCount += snapshot.transactionCount;
    });

    return Array.from(groups.values()).sort((a, b) =>
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
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
    if (ratio >= 0.85) return 'bg-amber-500';
    return 'bg-money-safe';
  };

  return (
    <div className="space-y-6 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex justify-between items-center px-2">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">History</h2>
        <Button
          onClick={handleExport}
          disabled={bucketHistory.length === 0}
          variant="secondary"
          size="sm"
          leftIcon={<Download size={16} />}
          className="rounded-xl shadow-sm border-slate-200"
        >
          Export CSV
        </Button>
      </div>

      {historyGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
            <History size={32} className="text-slate-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-600">No History Yet</h3>
          <p className="text-center max-w-xs mt-2 text-sm text-slate-400">
            Budget snapshots are created automatically when you approve a new paycheck.
          </p>
        </div>
      ) : (
        historyGroups.map(group => {
        const isExpanded = expandedPeriodId === group.periodId;
        const savings = group.totalLimit - group.totalSpent;
        const percentUsed = group.totalLimit > 0
          ? Math.min(100, Math.max(0, (group.totalSpent / group.totalLimit) * 100))
          : 100;

        return (
          <Card key={group.periodId} className="overflow-hidden border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl bg-white/80 backdrop-blur-xl">
            <button
              onClick={() => toggleExpand(group.periodId)}
              className="w-full text-left"
            >
              <div className="p-6 bg-white/0 hover:bg-white/40 transition-colors">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg tracking-tight">
                      {format(parseISO(group.startDate), 'MMM d')} - {format(parseISO(group.endDate), 'MMM d, yyyy')}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium mt-1">
                      {group.transactionCount} transactions
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold font-mono tracking-tight ${savings >= 0 ? 'text-money-safe' : 'text-money-neg'}`}>
                      {savings >= 0 ? '+' : ''}${savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-slate-400">
                      {savings >= 0 ? 'saved' : 'overspent'}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium text-slate-500">
                    <span>${group.totalSpent.toLocaleString()} spent</span>
                    <span>${group.totalLimit.toLocaleString()} limit</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${getProgressColor(group.totalSpent, group.totalLimit)}`}
                      style={{ width: `${percentUsed}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="px-4 py-2 bg-slate-50/50 border-t border-slate-100/50 flex justify-center hover:bg-slate-100/50 transition-colors">
                {isExpanded ? (
                  <ChevronUp size={16} className="text-slate-400" />
                ) : (
                  <ChevronDown size={16} className="text-slate-400" />
                )}
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="bg-slate-50/50 p-6 border-t border-slate-100/50 space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Bucket Breakdown
                </h4>
                {group.snapshots.sort((a, b) => (b.limit - b.totalSpent) - (a.limit - a.totalSpent)).map(bucket => {
                  const bucketSavings = bucket.limit - bucket.totalSpent;
                  const bucketPercent = bucket.limit > 0
                    ? Math.min(100, Math.max(0, (bucket.totalSpent / bucket.limit) * 100))
                    : 100;

                  return (
                    <div key={bucket.id} className="bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-slate-100/50 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-slate-700 tracking-tight">{bucket.bucketName}</span>
                        <span className={`text-sm font-bold font-mono ${bucketSavings >= 0 ? 'text-money-safe' : 'text-money-neg'}`}>
                          ${bucket.totalSpent.toLocaleString()} <span className="text-slate-300 font-normal">/ ${bucket.limit.toLocaleString()}</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressColor(bucket.totalSpent, bucket.limit)}`}
                          style={{ width: `${bucketPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      }))}
    </div>
  );
};

export default BudgetHistory;
