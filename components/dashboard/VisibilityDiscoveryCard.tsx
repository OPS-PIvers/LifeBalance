import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Eye, ChevronRight } from 'lucide-react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Section } from '@/components/ui/Section';
import { isVisibilityDiscoveryDismissed, dismissVisibilityDiscovery } from '@/utils/visibilityDiscovery';

/**
 * One-time "What I see" discovery nudge (2F.3, TODO §2F). The per-member
 * visibility editor (Settings → Modules → "What I see") has no other
 * discovery path — a member would never stumble into it. Dismissible, never
 * reappears once dismissed (see `utils/visibilityDiscovery.ts` for the
 * per-member localStorage flag). A brand-new household creator who goes
 * through the onboarding wizard's own visibility step sees this same ground
 * covered there, so `OnboardingWizard` marks this flag on finishing (or
 * skipping) — this card only ever surfaces for someone who never went through
 * that step (a joining member, or an existing member from before 2F.3).
 */
export const VisibilityDiscoveryCard: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useHouseholdCore();
  const [dismissed, setDismissed] = useState(false);

  if (!currentUser) return null;
  if (dismissed || isVisibilityDiscoveryDismissed(currentUser.uid)) return null;

  const dismiss = () => {
    dismissVisibilityDiscovery(currentUser.uid);
    setDismissed(true);
  };

  const open = () => {
    dismiss();
    navigate('/settings?section=modules');
  };

  return (
    <Section
      title="Make it yours"
      action={
        <button
          onClick={dismiss}
          className="flex items-center justify-center min-h-11 min-w-11 -m-3 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-full"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      }
    >
      <button
        onClick={open}
        className="w-full text-left surface-section p-4 flex items-center gap-3 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.99] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
      >
        <div className="w-10 h-10 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center shrink-0">
          <Eye className="w-5 h-5 text-accent-700 dark:text-accent-300" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-brand-900 dark:text-brand-100">Hide what you don&apos;t use</p>
          <p className="text-xs text-brand-500 dark:text-brand-400">
            Settings → What I see lets you tailor your own nav and Home screen.
          </p>
        </div>
        <ChevronRight size={16} className="text-brand-400 dark:text-brand-450 shrink-0" aria-hidden="true" />
      </button>
    </Section>
  );
};

export default VisibilityDiscoveryCard;
