import React, { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { httpsCallable } from 'firebase/functions';
import { Landmark } from 'lucide-react';
import toast from 'react-hot-toast';
import { functions } from '@/firebase.config';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Button } from '@/components/ui/Button';

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

  const onSuccess = useCallback(
    async (publicToken: string) => {
      if (!householdId) return;
      try {
        setBusy(true);
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

  return (
    <div className="surface-section p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-accent-50 text-accent-700 dark:bg-accent-800/40 dark:text-accent-200 flex items-center justify-center shrink-0">
          <Landmark size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold tracking-tight text-brand-900 dark:text-brand-50">
            Connect a bank
          </h3>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">
            Securely link an account via Plaid. New transactions sync into your review queue automatically — no manual entry.
          </p>
          <Button
            variant="primary"
            onClick={handleConnect}
            isLoading={busy}
            disabled={!householdId}
            className="mt-3"
          >
            Connect a bank
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConnectBankCard;
