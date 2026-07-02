import React, { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { httpsCallable } from 'firebase/functions';
import { Landmark } from 'lucide-react';
import toast from 'react-hot-toast';
import { getFunctionsInstance } from '@/firebase.config';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * "Connect a bank (Plaid)" entry. Rendered ONLY when the `plaidEnabled` flag is
 * on (the parent gates it), and lazy-loaded so `react-plaid-link` stays out of
 * the boot bundle. Flow: call the `plaidcreatelinktoken` callable → open Plaid
 * Link → on success call `plaidexchangepublictoken` (the server stores the
 * access token; the client never sees it).
 *
 * The callable names are the deployed (lowercased) function names — they must
 * match functions/src/plaid exactly.
 */
const ConnectBankCard: React.FC = () => {
  const { householdId } = useHouseholdCore();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      if (!householdId) return;
      try {
        setBusy(true);
        const functions = await getFunctionsInstance();
        const exchange = httpsCallable(functions, 'plaidexchangepublictoken');
        await exchange({ householdId, publicToken });
        toast.success('Bank connected — new transactions will appear in your review queue.');
      } catch {
        toast.error('Could not finish connecting your bank.');
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    [householdId],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      void onSuccess(publicToken);
    },
    onExit: () => {
      setLinkToken(null);
      setBusy(false);
    },
  });

  // Open Link as soon as a token arrives and the SDK is ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const handleConnect = async () => {
    if (!householdId) return;
    try {
      setBusy(true);
      const functions = await getFunctionsInstance();
      const createLink = httpsCallable<{ householdId: string }, { linkToken: string }>(
        functions,
        'plaidcreatelinktoken',
      );
      const { data } = await createLink({ householdId });
      setLinkToken(data.linkToken);
    } catch {
      toast.error('Could not start bank connection.');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!householdId) return;
    try {
      setDisconnecting(true);
      const functions = await getFunctionsInstance();
      const disconnect = httpsCallable<{ householdId: string }, { removed: number }>(
        functions,
        'plaiddisconnectbank',
      );
      const { data } = await disconnect({ householdId });
      toast.success(
        data.removed > 0
          ? `Disconnected ${data.removed} bank connection${data.removed > 1 ? 's' : ''}.`
          : 'No bank connections to remove.',
      );
    } catch {
      toast.error('Could not disconnect your bank.');
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  const connectDisabled = !householdId || busy || disconnecting;
  const disconnectDisabled = !householdId || busy || disconnecting;

  return (
    <Section title="Bank">
      <SurfaceList>
        <Row
          interactive
          role="button"
          tabIndex={connectDisabled ? -1 : 0}
          aria-disabled={connectDisabled}
          onClick={() => { if (!connectDisabled) handleConnect(); }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !connectDisabled) {
              e.preventDefault();
              handleConnect();
            }
          }}
          className={connectDisabled ? 'opacity-60 pointer-events-none' : undefined}
          aria-label="Connect a bank via Plaid"
        >
          <div className="w-10 h-10 rounded-full bg-accent-50 text-accent-700 dark:bg-accent-800/40 dark:text-accent-200 flex items-center justify-center shrink-0">
            <Landmark size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-brand-900 dark:text-brand-50 text-sm tracking-tight">
              Connect a bank
            </p>
            <p className="text-xs text-brand-500 dark:text-brand-400">
              {busy
                ? 'Connecting…'
                : 'Securely link an account via Plaid — transactions sync automatically.'}
            </p>
          </div>
        </Row>

        <Row
          interactive
          role="button"
          tabIndex={disconnectDisabled ? -1 : 0}
          aria-disabled={disconnectDisabled}
          onClick={() => { if (!disconnectDisabled) setConfirmDisconnect(true); }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !disconnectDisabled) {
              e.preventDefault();
              setConfirmDisconnect(true);
            }
          }}
          className={disconnectDisabled ? 'opacity-60 pointer-events-none' : undefined}
          aria-label="Disconnect bank"
        >
          <span className="flex-1 text-sm font-medium text-money-neg dark:text-money-neg">
            Disconnect bank
          </span>
        </Row>
      </SurfaceList>

      <ConfirmDialog
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect bank?"
        message="This removes all linked bank connections for your household and stops transactions from syncing. You can reconnect any time."
        confirmLabel="Disconnect"
        isConfirming={disconnecting}
      />
    </Section>
  );
};

export default ConnectBankCard;
