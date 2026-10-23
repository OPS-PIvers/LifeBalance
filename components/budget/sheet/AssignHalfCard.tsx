import React, { useMemo } from 'react';
import { addDays, parseISO, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useExpandedCalendarItems, useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/Button';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import { fundedHalfId, halfOf, halfTitle } from '@/utils/payPeriodHalves';
import { seedHalfPlan, summarizeHalf } from '@/utils/halfPlan';

interface AssignHalfCardProps {
  /** The paycheck's date; the card shows the half that paycheck funds. */
  date: string;
  /** Called before leaving for the Sheet, e.g. to close the drawer. */
  onOpen: () => void;
}

/**
 * The payday step for a household that plans on the Sheet: where this half
 * stands (Left to assign, from its saved plan or last month's copy) and the
 * way into the Sheet to give every dollar a job.
 */
const AssignHalfCard: React.FC<AssignHalfCardProps> = ({ date, onOpen }) => {
  const { halfPlans, buckets } = useFinance();
  const navigate = useNavigate();
  const fmt = useFormatCurrency();
  const half = useMemo(() => halfOf(fundedHalfId(date)), [date]);
  const [start, end] = useMemo(() => [subDays(parseISO(half.start), 20), addDays(parseISO(half.end), 20)], [half.start, half.end]);
  const expanded = useExpandedCalendarItems(start, end);

  const view = useMemo(() => {
    const plan = halfPlans.find(p => p.id === half.id) ?? seedHalfPlan(half.id, halfPlans, () => 'seed');
    const summary = summarizeHalf(half, expanded, plan, new Set(buckets.map(b => b.id)));
    return { title: halfTitle(half), summary };
  }, [expanded, half, halfPlans, buckets]);

  const left = view.summary.leftToAssign;

  return (
    <Section title="Assign this half">
      <SurfaceList>
        <Row dense className="justify-between text-sm">
          <span>{view.title} paychecks</span>
          <span className="font-mono tabular-nums">{fmt(view.summary.paycheckTotal)}</span>
        </Row>
        <Row dense className="justify-between text-sm">
          <span>Bills due</span>
          <span className="font-mono tabular-nums">{fmt(view.summary.billTotal)}</span>
        </Row>
        <Row className="justify-between">
          <span className="font-display">Left to assign</span>
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              left === 0 ? 'text-money-pos dark:text-money-posDark' : left < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-warm-700 dark:text-warm-300'
            )}
          >
            {fmt(left)}
          </span>
        </Row>
      </SurfaceList>
      <Button
        className="mt-3 w-full"
        onClick={() => {
          onOpen();
          navigate('/budget', { state: { tab: 'sheet' } });
        }}
      >
        {left === 0 ? 'Review this half' : 'Give every dollar a job'}
      </Button>
    </Section>
  );
};

export default AssignHalfCard;
