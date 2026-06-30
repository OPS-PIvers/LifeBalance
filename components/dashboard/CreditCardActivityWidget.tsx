import React, { useMemo } from 'react';
import { CreditCard, ArrowDownCircle } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { sumMoney, subtractMoney } from '@/utils/money';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
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
          <CreditCard size={14} className="text-money-neg" aria-hidden="true" />
          Credit card activity
        </span>
      }
    >
      <SurfaceList>
        {activity.map(({ account, charges, payments, net, balance }) => (
          <Row key={account.id} className="flex-col items-stretch gap-2">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100 truncate">
                  {account.name}
                </p>
                <p className="text-xs text-brand-400 dark:text-brand-500">
                  Balance{' '}
                  <span className="font-mono tabular-nums font-semibold text-money-neg">{fmt(balance)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPayDown(account.id)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-money-bgPos dark:bg-money-pos/15 px-3 py-1.5 text-xs font-semibold text-money-pos border border-money-pos/30 active:scale-95 transition-transform duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-money-pos/40"
              >
                <ArrowDownCircle size={14} aria-hidden="true" />
                Pay down
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-brand-400 dark:text-brand-500">Charged</span>
                <span className="font-mono tabular-nums font-semibold text-money-neg">+{fmt(charges)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-brand-400 dark:text-brand-500">Paid</span>
                <span className="font-mono tabular-nums font-semibold text-money-pos">-{fmt(payments)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-brand-400 dark:text-brand-500">Net</span>
                <span className={`font-mono tabular-nums font-bold ${net > 0 ? 'text-money-neg' : net < 0 ? 'text-money-pos' : 'text-brand-500 dark:text-brand-400'}`}>
                  {net > 0 ? '+' : net < 0 ? '-' : ''}{fmt(Math.abs(net))}
                </span>
              </div>
            </div>
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
});

CreditCardActivityWidget.displayName = 'CreditCardActivityWidget';
