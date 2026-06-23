import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { functions } from '@/firebase.config';
import { httpsCallable } from 'firebase/functions';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/utils/entitlements';
import { Sparkles, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  householdId: string;
}

interface CheckoutRequest {
  householdId: string;
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutResult {
  url: string | null;
}

/** Premium benefits shown on the paywall, derived from the entitlement limit tables. */
const BENEFITS: string[] = [
  `${PREMIUM_LIMITS.aiDailyCap} AI actions per day (up from ${FREE_LIMITS.aiDailyCap})`,
  `Up to ${PREMIUM_LIMITS.maxMembers} household members (up from ${FREE_LIMITS.maxMembers})`,
  'Weekly recap & proactive insights',
  'Extended history',
];

/**
 * Upgrade paywall (Plan 050b). Reachable only when billing is live (`billingEnabled`),
 * so it stays dormant by default. "Continue to checkout" creates a Stripe Checkout
 * session via the `createcheckoutsession` Cloud Function and redirects to it.
 */
const PaywallModal: React.FC<PaywallModalProps> = ({ isOpen, onClose, householdId }) => {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleUpgrade = async () => {
    setIsRedirecting(true);
    try {
      // HashRouter app — return to /settings after checkout.
      const returnUrl = `${window.location.origin}/#/settings`;
      const createCheckout = httpsCallable<CheckoutRequest, CheckoutResult>(
        functions,
        'createcheckoutsession'
      );
      const { data } = await createCheckout({
        householdId,
        successUrl: returnUrl,
        cancelUrl: returnUrl,
      });
      if (data?.url) {
        window.location.href = data.url;
        return; // leaving the page; keep the spinner until navigation
      }
      toast.error('Could not start checkout. Please try again.');
      setIsRedirecting(false);
    } catch (error) {
      console.error('createcheckoutsession failed:', error);
      toast.error('Could not start checkout. Please try again.');
      setIsRedirecting(false);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Upgrade to Premium">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-600 shrink-0">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Unlock more AI, more members, and premium features for your whole household.
          </p>
        </div>

        <ul className="space-y-2.5">
          {BENEFITS.map((benefit) => (
            <li
              key={benefit}
              className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200"
            >
              <Check className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" aria-hidden="true" />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isRedirecting}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={handleUpgrade}
            isLoading={isRedirecting}
            leftIcon={<Sparkles className="w-4 h-4" />}
          >
            Continue to checkout
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default PaywallModal;
