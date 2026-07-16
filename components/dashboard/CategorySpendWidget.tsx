import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useDashboardTransactionStats } from '@/hooks/useDashboardTransactionStats';
import SectionActionLink from '@/components/ui/SectionActionLink';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import ProgressBar from '@/components/ui/ProgressBar';
import { cn } from '@/utils/cn';

export const CategorySpendWidget: React.FC = () => {
  const { monthTotalSpent, monthCategoryItems, monthCategoryTransactions } =
    useDashboardTransactionStats();
  const fmt = useFormatCurrency();
  // Per-row disclosure: only one category's transaction list is open at a time
  // (mirrors CreditCardActivityWidget's expandedId pattern).
  const [expandedName, setExpandedName] = useState<string | null>(null);

  if (monthTotalSpent === 0) return null;

  // Ranked evergreen ramp — the money domain color, deepest for the top spend.
  const barColor = (idx: number) =>
    idx === 0 ? 'bg-accent-600' :
    idx === 1 ? 'bg-accent-500' :
    idx === 2 ? 'bg-accent-400' : 'bg-brand-300 dark:bg-brand-600';

  return (
    <Section
      title="Top spending this month"
      action={
        <SectionActionLink to="/budget" state={{ tab: 'trends' }}>Trends</SectionActionLink>
      }
    >
      <SurfaceList>
        {monthCategoryItems.map((item, idx) => {
          const isExpanded = expandedName === item.name;
          const detailId = `category-spend-detail-${idx}`;
          const txns = monthCategoryTransactions[item.name] ?? [];
          return (
            <Row key={item.name} className="flex-col items-stretch gap-2">
              <button
                type="button"
                onClick={() => setExpandedName(prev => (prev === item.name ? null : item.name))}
                aria-expanded={isExpanded}
                aria-controls={detailId}
                className="flex w-full flex-col items-stretch gap-2 text-left rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-700 dark:text-brand-200">
                  <span className="truncate">{item.name}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono tabular-nums text-brand-900 dark:text-brand-50">{fmt(item.amount)}</span>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={cn(
                        'text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </span>
                </span>
                <ProgressBar
                  value={item.percentage}
                  barClassName={barColor(idx)}
                  ariaLabel={`${item.name}: ${Math.round(item.percentage)}% of spending`}
                  className="h-1.5 bg-brand-100 dark:bg-brand-700"
                />
              </button>

              {isExpanded && (
                <ul
                  id={detailId}
                  className="flex flex-col gap-1.5 pt-1 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
                >
                  {txns.map(tx => (
                    <li key={tx.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 flex items-baseline gap-2">
                        <span className="truncate font-medium text-brand-700 dark:text-brand-200">{tx.merchant}</span>
                        <span className="shrink-0 text-brand-400 dark:text-brand-450">{format(parseISO(tx.date), 'MMM d')}</span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums font-semibold text-brand-900 dark:text-brand-50">
                        {fmt(tx.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
          );
        })}
      </SurfaceList>
    </Section>
  );
};
