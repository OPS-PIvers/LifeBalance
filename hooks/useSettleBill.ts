import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useFinance } from '@/contexts/FirebaseHouseholdContext';

/** One "this charge IS that bill" request, before an account is resolved. */
export interface SettleBillRequest {
  transactionId: string;
  /** Plain calendar-item doc id, or a synthetic `templateId_instance_date` id. */
  calendarItemId: string;
  /**
   * The amount to settle at, when the host has a LIVE one the stored row hasn't
   * seen — the review form's amount field, where a mis-OCR'd 379.10 may have
   * just been corrected to 37.91. Co-committed onto the transaction by the
   * mutation, so the row, the bill and the balance all move together. Omit
   * (calendar-side settle, which has no editable amount) to use the stored one.
   */
  amount?: number;
}

export interface SettleBillApi {
  /**
   * Start a settle. When the transaction already carries a live account tag the
   * mutation runs straight away; otherwise `needsAccount` flips true and the
   * host is expected to render an `AccountPicker` wired to
   * `confirmAccount`/`cancel`.
   */
  begin: (request: SettleBillRequest) => void;
  /** A write is in flight — disable the affordance. */
  busy: boolean;
  /** True while waiting for the host's AccountPicker to return a choice. */
  needsAccount: boolean;
  confirmAccount: (accountId: string) => void;
  cancel: () => void;
}

/**
 * Shared driver for `settleBillWithTransaction`'s ONE unavoidable piece of
 * interaction state: which account the money moved out of.
 *
 * This write moves real money, so the account is never silently guessed (see
 * TODO.md 2H(a) decision 6) — an untagged transaction has to be confirmed. Both
 * entry points need that identical two-step, so it lives here rather than being
 * hand-rolled twice: the Action Queue's transaction review sheet
 * (`SettleBillSection`) and the Money calendar's Edit Event drawer
 * (`BudgetCalendar`).
 *
 * Resolution happens inside `begin` — an event handler — deliberately, so there
 * is no set-state-in-effect and no window in which a stale request could fire.
 */
export function useSettleBill(onSettled?: () => void): SettleBillApi {
  const { accounts, transactions, settleBillWithTransaction } = useFinance();
  const [pending, setPending] = useState<SettleBillRequest | null>(null);
  const [busy, setBusy] = useState(false);

  // `onSettled` is a real dependency (both call sites pass an inline arrow, so
  // it changes every render). That only re-creates the returned handlers, which
  // nothing memoizes on and no effect depends on — the alternative, a
  // latest-value ref written during render, is exactly the stale-closure trap
  // this repo's lint rules forbid.
  const run = useCallback(async (request: SettleBillRequest, accountId?: string) => {
    setBusy(true);
    try {
      const settled = await settleBillWithTransaction(
        request.transactionId,
        request.calendarItemId,
        accountId,
        request.amount,
      );
      // A `false` return means a guard refused and NOTHING was written — the
      // mutation has already explained why, so don't claim success.
      if (settled) {
        setPending(null);
        onSettled?.();
      }
    } catch (error) {
      console.error('[useSettleBill] Failed to settle bill:', error);
      toast.error('Failed to link this transaction to the bill');
    } finally {
      setBusy(false);
    }
  }, [settleBillWithTransaction, onSettled]);

  const begin = useCallback((request: SettleBillRequest) => {
    const tx = transactions.find(t => t.id === request.transactionId);
    // An existing tag (including a credit card — a bill CAN be charged to one)
    // is the user's own prior statement about where this money moved, so it is
    // used as-is. A tag pointing at a since-deleted account is not.
    const tagged = tx?.accountId ? accounts.find(a => a.id === tx.accountId) : undefined;
    if (tagged) {
      void run(request);
      return;
    }
    setPending(request);
  }, [transactions, accounts, run]);

  const confirmAccount = useCallback((accountId: string) => {
    if (pending) void run(pending, accountId);
  }, [pending, run]);

  const cancel = useCallback(() => setPending(null), []);

  return useMemo(
    () => ({ begin, busy, needsAccount: pending !== null, confirmAccount, cancel }),
    [begin, busy, pending, confirmAccount, cancel],
  );
}
