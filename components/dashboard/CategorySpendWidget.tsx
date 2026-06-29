import React from 'react';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useDashboardTransactionStats } from '@/hooks/useDashboardTransactionStats';
import SectionActionLink from '@/components/ui/SectionActionLink';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import ProgressBar from '@/components/ui/ProgressBar';

export const CategorySpendWidget: React.FC = () => {
  const { monthTotalSpent, monthCategoryItems } = useDashboardTransactionStats();
  const fmt = useFormatCurrency();

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
        <SectionActionLink to="/budget">Details</SectionActionLink>
      }
    >
      <SurfaceList>
        {monthCategoryItems.map((item, idx) => (
          <Row key={item.name} className="flex-col items-stretch gap-2">
            <div className="flex justify-between text-xs font-semibold text-brand-700 dark:text-brand-200">
              <span>{item.name}</span>
              <span className="font-mono tabular-nums text-brand-900 dark:text-brand-50">{fmt(item.amount, { decimals: 0 })}</span>
            </div>
            <ProgressBar
              value={item.percentage}
              barClassName={barColor(idx)}
              ariaLabel={`${item.name}: ${Math.round(item.percentage)}% of spending`}
              className="h-1.5 bg-brand-100 dark:bg-brand-700"
            />
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
};
