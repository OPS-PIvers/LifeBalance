import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { Button } from '@/components/ui/Button';
import { roundMoney } from '@/utils/money';
import type { Transaction } from '@/types/schema';

type PricedTransaction = Transaction & { billPriceChange: NonNullable<Transaction['billPriceChange']> };

const hasPriceChange = (t: Transaction): t is PricedTransaction => t.billPriceChange !== undefined;

/**
 * "This bill came in at a different price" — leads the Action Queue area.
 *
 * The nightly bank sync settles a bill at whatever the bank actually charged
 * and stamps `Transaction.billPriceChange` with the amount the bill was planned
 * at. Nothing is left to approve: the bill is paid and the balance is the
 * bank's own. What is left is noticing the difference — and, when it cost more,
 * deciding where the extra comes from (trim a flexible bucket, or move money in
 * from savings). So each row is an acknowledgement, with a shortcut to the
 * buckets for the over-budget case.
 */
export const BillPriceChangeCard: React.FC = () => {
  const { transactions, acknowledgeBillPriceChange } = useFinance();
  const fmt = useFormatCurrency();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const changes = useMemo(
    () => transactions.filter(hasPriceChange).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [transactions],
  );

  if (changes.length === 0) return null;

  const acknowledge = async (id: string) => {
    setBusyId(id);
    try {
      await acknowledgeBillPriceChange(id);
    } catch {
      // The mutation already toasted; the row simply stays.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section className="mb-4" title="Bills that changed price">
      <SurfaceList>
        {changes.map(tx => {
          const { billTitle, scheduledAmount } = tx.billPriceChange;
          const delta = roundMoney(tx.amount - scheduledAmount);
          const costMore = delta > 0;
          const Icon = costMore ? TrendingUp : TrendingDown;
          return (
            <Row key={tx.id} className="flex-col items-stretch gap-2">
              <div className="flex items-start gap-3">
                <Icon
                  size={18}
                  aria-hidden="true"
                  className={costMore
                    ? 'mt-0.5 shrink-0 text-money-neg dark:text-money-negDark'
                    : 'mt-0.5 shrink-0 text-money-pos dark:text-money-posDark'}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-800 dark:text-brand-100">
                    {billTitle} came in at {fmt(tx.amount)}
                  </p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">
                    {fmt(Math.abs(delta))} {costMore ? 'more' : 'less'} than the {fmt(scheduledAmount)} planned.
                    {costMore
                      ? ' Safe to Spend already reflects it — cover it from a flexible bucket or savings.'
                      : ' The difference is back in Safe to Spend.'}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {costMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/budget', { state: { tab: 'buckets' } })}
                  >
                    Adjust budget
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={busyId === tx.id}
                  disabled={busyId === tx.id}
                  onClick={() => void acknowledge(tx.id)}
                  aria-label={`Got it — ${billTitle} price change`}
                >
                  Got it
                </Button>
              </div>
            </Row>
          );
        })}
      </SurfaceList>
    </Section>
  );
};

export default BillPriceChangeCard;
