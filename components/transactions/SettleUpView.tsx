import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRight, Check, Mail, Scale } from 'lucide-react';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { sendSplitInvite } from '@/utils/splitInvite';
import {
  computeExternalOwed,
  computeMemberBalances,
  memberDisplayName,
  splitParticipantKey,
} from '@/utils/settlement';
import { Transaction } from '@/types/schema';

/**
 * F-MONEY-13 Settle-Up view. Renders the netted who-owes-whom balance across
 * every unsettled split transaction, plus a section for account-less people
 * owed by email. "Mark settled" clears every share behind a pair; "Send invite"
 * dispatches the (currently stubbed) email and stamps the shares as invited.
 *
 * Rendered on the Money → Accounts tab. Purely an overlay on transaction data —
 * settling never moves any money.
 */
const SettleUpView: React.FC = () => {
  const { transactions, markSplitSettled, setTransactionSplit } = useFinance();
  const { members, currentUser, household } = useHouseholdCore();
  const fmt = useFormatCurrency();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const balances = useMemo(() => computeMemberBalances(transactions, members), [transactions, members]);
  const external = useMemo(() => computeExternalOwed(transactions), [transactions]);

  const hasAnything = balances.length > 0 || external.length > 0;

  // Every unsettled participant share behind a member pair, so "Mark settled"
  // can flip them all. A pair is settled by clearing shares in BOTH directions.
  const sharesForPair = (a: string, b: string): Array<{ txId: string; key: string }> => {
    const out: Array<{ txId: string; key: string }> = [];
    for (const tx of transactions) {
      const payer = tx.createdBy;
      if (!payer || !tx.splitWith) continue;
      if (payer !== a && payer !== b) continue;
      for (const share of tx.splitWith) {
        if (share.settled || !share.memberId) continue;
        const debtor = share.memberId;
        const isThisPair =
          (payer === a && debtor === b) || (payer === b && debtor === a);
        if (isThisPair) out.push({ txId: tx.id, key: splitParticipantKey(share) });
      }
    }
    return out;
  };

  const settlePair = async (a: string, b: string) => {
    const key = `${a}|${b}`;
    setBusyKey(key);
    try {
      const shares = sharesForPair(a, b);
      await Promise.all(shares.map(s => markSplitSettled(s.txId, s.key, true)));
      toast.success('Settled up');
    } catch {
      // markSplitSettled already toasts on failure.
    } finally {
      setBusyKey(null);
    }
  };

  // Stamp every unsettled share for an external email with invitedAt, and fire
  // the (stubbed) invite. Rebuilds each transaction's splitWith via
  // setTransactionSplit since the invite marker lives on the participant.
  const sendInvite = async (email: string, amount: number) => {
    setBusyKey(`email:${email}`);
    try {
      const result = await sendSplitInvite({
        email,
        amount,
        payerName: currentUser?.displayName ?? 'A household member',
        currency: household?.currency,
      });
      if (result.status === 'rejected') {
        toast.error(result.reason ?? 'Could not send invite');
        return;
      }
      const nowIso = new Date().toISOString();
      const affected = transactions.filter(
        (tx: Transaction) => tx.splitWith?.some(p => p.email?.trim().toLowerCase() === email && !p.settled),
      );
      await Promise.all(
        affected.map(tx => {
          const next = (tx.splitWith ?? []).map(p =>
            p.email?.trim().toLowerCase() === email && !p.settled ? { ...p, invitedAt: nowIso } : p,
          );
          return setTransactionSplit(tx.id, next);
        }),
      );
      toast.success(
        result.status === 'deferred'
          ? 'Invite recorded (email delivery not configured yet)'
          : 'Invite sent',
      );
    } catch {
      toast.error('Could not send invite');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="surface-section p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Scale size={18} className="text-accent-600 dark:text-accent-400" />
        <h3 className="text-base font-semibold text-brand-700 dark:text-brand-100">Settle Up</h3>
      </div>

      {!hasAnything ? (
        <EmptyState
          icon={<Scale />}
          title="All settled up"
          description="Split an expense from any transaction to start tracking who owes whom."
        />
      ) : (
        <div className="space-y-5">
          {balances.length > 0 && (
            <ul className="divide-y divide-brand-100 dark:divide-brand-700">
              {balances.map(b => {
                const key = `${b.fromMemberId}|${b.toMemberId}`;
                const youAreCreditor = b.toMemberId === currentUser?.uid;
                const youAreDebtor = b.fromMemberId === currentUser?.uid;
                const fromName = youAreDebtor ? 'You' : memberDisplayName(b.fromMemberId, members);
                const toName = youAreCreditor ? 'you' : memberDisplayName(b.toMemberId, members);
                return (
                  <li key={key} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-brand-700 dark:text-brand-100">
                        <span className="font-semibold">{fromName}</span>
                        {/* The arrow is decorative — without this, AT (and DOM
                            text) reads "Jordanyou" with no relation between
                            the names. */}
                        <span className="sr-only"> owes </span>
                        <ArrowRight size={13} className="inline mx-1.5 text-brand-400 align-middle" aria-hidden="true" />
                        <span className="font-semibold">{toName}</span>
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-money-neg dark:text-money-negDark">
                        {fmt(b.amount)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<Check size={14} />}
                      isLoading={busyKey === key}
                      disabled={busyKey !== null}
                      onClick={() => settlePair(b.fromMemberId, b.toMemberId)}
                    >
                      Mark settled
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          {external.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-400">
                Owed by people outside your household
              </p>
              <ul className="divide-y divide-brand-100 dark:divide-brand-700">
                {external.map(e => {
                  const key = `email:${e.email}`;
                  return (
                    <li key={key} className="flex items-center gap-3 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-700 dark:text-brand-100 truncate">
                          {e.name || e.email}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-money-neg dark:text-money-negDark">
                          {fmt(e.amount)}
                          {e.invited && <span className="ml-2 text-xs font-normal text-brand-400">Invite pending</span>}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Mail size={14} />}
                        isLoading={busyKey === key}
                        disabled={busyKey !== null}
                        onClick={() => sendInvite(e.email, e.amount)}
                      >
                        {e.invited ? 'Resend invite' : 'Send invite'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SettleUpView;
