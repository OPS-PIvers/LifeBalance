import React, { useMemo, useState } from 'react';
import { CreditCard, ArrowDownCircle, ChevronDown } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { sumMoney, subtractMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { Button } from '@/components/ui/Button';
import type { Account } from '@/types/schema';

interface CreditCardActivity {
  account: Account;
  /** Σ amount of this period's charges tagged to this card (raises the balance). */
  charges: number;
  /** Σ amount of this period's payments toward this card (lowers the balance). */
  payments: number;
  /** charges − payments: how much the card's balance moved this period. */
  net: number;
  /** Current outstanding balance (debt owed), stored positive. */
  balance: number;
}

interface CreditCardActivityWidgetProps {
  /** Open the capture form pre-tagged to this card in payment mode. */
  onPayDown: (accountId: string) => void;
}

/**
 * CreditCardActivityWidget — a compact at-a-glance view of how much each credit
 * card has been charged vs. paid down THIS PAY PERIOD, so balances don't balloon
 * unnoticed (card charges intentionally never touch Safe-to-Spend).
 *
 * Period: the current pay period (`tx.payPeriodId === currentPeriodId`), falling
 * back to all-time when paycheck tracking is off — consistent with buckets and
 * the rest of the budget. Both verified and pending transactions count: this is
 * an activity log to surface the balloon early, not a balance reconciliation.
 *
 * Dormant by default: self-nulls when the household has no credit accounts, so
 * dropping it into the Dashboard stack is a zero-behavior-change addition.
 */
export const CreditCardActivityWidget: React.FC<CreditCardActivityWidgetProps> = React.memo(({ onPayDown }) => {
  const { accounts, transactions, currentPeriodId } = useFinance();
  const fmt = useFormatCurrency();
  // Per-card disclosure: the Charged/Paid/Net detail line is collapsed by
  // default; only one card's detail is open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activity = useMemo<CreditCardActivity[]>(() => {
    const cards = accounts.filter(a => a.type === 'credit');
    return cards.map(account => {
      const cardTxns = transactions.filter(
        tx => tx.accountId === account.id && (!currentPeriodId || tx.payPeriodId === currentPeriodId)
      );
      const charges = sumMoney(cardTxns.filter(tx => tx.creditPayment !== true).map(tx => tx.amount));
      const payments = sumMoney(cardTxns.filter(tx => tx.creditPayment === true).map(tx => tx.amount));
      return {
        account,
        charges,
        payments,
        net: subtractMoney(charges, payments),
        balance: account.balance,
      };
    });
  }, [accounts, transactions, currentPeriodId]);

  if (activity.length === 0) return null;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CreditCard size={14} className="text-money-neg dark:text-money-negDark" aria-hidden="true" />
          Credit card activity
        </span>
      }
    >
      <SurfaceList>
        {activity.map(({ account, charges, payments, net, balance }) => {
          const isExpanded = expandedId === account.id;
          const detailId = `cc-activity-detail-${account.id}`;
          return (
            <Row key={account.id} className="flex-col items-stretch gap-2">
              <div className="flex items-center justify-between gap-2">
                {/* Name/balance block toggles this card's detail line; the Pay
                    down button sits OUTSIDE the toggle so it never expands. */}
                <button
                  type="button"
                  onClick={() => setExpandedId(prev => (prev === account.id ? null : account.id))}
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                  className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-brand-900 dark:text-brand-100">
                      {account.name}
                    </span>
                    <span className="block text-xs text-brand-400 dark:text-brand-450">
                      Balance{' '}
                      <span className="font-mono tabular-nums font-semibold text-money-neg dark:text-money-negDark">{fmt(balance)}</span>
                    </span>
                  </span>
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className={cn(
                      'shrink-0 text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                      isExpanded && 'rotate-180'
                    )}
                  />
                </button>
                <Button
                  type="button"
                  variant="positive"
                  size="sm"
                  onClick={() => onPayDown(account.id)}
                  className="shrink-0"
                  leftIcon={<ArrowDownCircle size={14} aria-hidden="true" />}
                >
                  Pay down
                </Button>
              </div>

              {isExpanded && (
                <div
                  id={detailId}
                  className="flex items-center justify-between gap-2 text-xs animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-brand-400 dark:text-brand-450">Charged</span>
                    <span className="font-mono tabular-nums font-semibold text-money-neg dark:text-money-negDark">+{fmt(charges)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-brand-400 dark:text-brand-450">Paid</span>
                    <span className="font-mono tabular-nums font-semibold text-money-pos dark:text-money-posDark">-{fmt(payments)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-brand-400 dark:text-brand-450">Net</span>
                    <span className={`font-mono tabular-nums font-bold ${net > 0 ? 'text-money-neg dark:text-money-negDark' : net < 0 ? 'text-money-pos dark:text-money-posDark' : 'text-brand-500 dark:text-brand-400'}`}>
                      {net > 0 ? '+' : net < 0 ? '-' : ''}{fmt(Math.abs(net))}
                    </span>
                  </div>
                </div>
              )}
            </Row>
          );
        })}
      </SurfaceList>
    </Section>
  );
});

CreditCardActivityWidget.displayName = 'CreditCardActivityWidget';
