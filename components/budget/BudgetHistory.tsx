import React, { useMemo, useState } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { BucketPeriodSnapshot } from '../../types/schema';
import { format, parseISO } from 'date-fns';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import Card from '../ui/Card';

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

  const getProgressColor = (spent: number, limit: number) => {
    const ratio = spent / limit;
    if (ratio >= 1) return 'bg-money-neg';
    if (ratio >= 0.85) return 'bg-amber-500';
    return 'bg-money-safe';
  };

  if (historyGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-brand-400">
        <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mb-4">
          <History size={32} className="text-brand-300" />
        </div>
        <h3 className="text-lg font-bold text-brand-600">No History Yet</h3>
        <p className="text-center max-w-xs mt-2 text-sm">
          Budget snapshots are created automatically when you approve a new paycheck.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {historyGroups.map(group => {
        const isExpanded = expandedPeriodId === group.periodId;
        const savings = group.totalLimit - group.totalSpent;
        const percentUsed = Math.min(100, Math.max(0, (group.totalSpent / group.totalLimit) * 100));

        return (
          <Card key={group.periodId} className="overflow-hidden border border-brand-100 shadow-sm">
            <button
              onClick={() => toggleExpand(group.periodId)}
              className="w-full text-left"
            >
              <div className="p-4 bg-white hover:bg-gray-50 transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <h3 className="font-bold text-brand-800 text-lg">
                      {format(parseISO(group.startDate), 'MMM d')} - {format(parseISO(group.endDate), 'MMM d, yyyy')}
                    </h3>
                    <p className="text-xs text-brand-400 font-medium">
                      {group.transactionCount} transactions
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${savings >= 0 ? 'text-money-safe' : 'text-money-neg'}`}>
                      {savings >= 0 ? '+' : ''}${savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-brand-400">
                      {savings >= 0 ? 'saved' : 'overspent'}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-brand-600">
                    <span>${group.totalSpent.toLocaleString()} spent</span>
                    <span>${group.totalLimit.toLocaleString()} limit</span>
                  </div>
                  <div className="h-3 bg-brand-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${getProgressColor(group.totalSpent, group.totalLimit)}`}
                      style={{ width: `${percentUsed}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="px-4 py-2 bg-brand-50 border-t border-brand-100 flex justify-center">
                {isExpanded ? (
                  <ChevronUp size={16} className="text-brand-400" />
                ) : (
                  <ChevronDown size={16} className="text-brand-400" />
                )}
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="bg-brand-50/50 p-4 border-t border-brand-100 space-y-3">
                <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-2">
                  Bucket Breakdown
                </h4>
                {group.snapshots.sort((a, b) => (b.limit - b.totalSpent) - (a.limit - a.totalSpent)).map(bucket => {
                  const bucketSavings = bucket.limit - bucket.totalSpent;
                  const bucketPercent = Math.min(100, Math.max(0, (bucket.totalSpent / bucket.limit) * 100));

                  return (
                    <div key={bucket.id} className="bg-white p-3 rounded-xl border border-brand-100 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-brand-700">{bucket.bucketName}</span>
                        <span className={`text-sm font-bold ${bucketSavings >= 0 ? 'text-money-safe' : 'text-money-neg'}`}>
                          ${bucket.totalSpent.toLocaleString()} <span className="text-brand-300 font-normal">/ ${bucket.limit.toLocaleString()}</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-brand-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getProgressColor(bucket.totalSpent, bucket.limit)}`}
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
      })}
    </div>
  );
};

export default BudgetHistory;
