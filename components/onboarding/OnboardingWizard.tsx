import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Check, Home, Sparkles, Users, Wallet, PartyPopper, ArrowRight, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinance, useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getPresetHabitsByCategory, type PresetHabit } from '@/data/presetHabits';
import { buildCheckingAccount, presetToHabit } from '@/utils/onboardingSeed';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import { cn } from '@/utils/cn';

/** Wizard steps, in order. */
const STEPS = ['welcome', 'balance', 'habits', 'invite', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Header title shown for each step. */
const STEP_TITLES: Record<Step, string> = {
  welcome: 'Welcome',
  balance: 'Starting balance',
  habits: 'Pick a few habits',
  invite: 'Invite your partner',
  done: 'All set!',
};

/** Maximum starter habits a user can pre-select. */
const MAX_STARTER_HABITS = 3;

/**
 * Curated, approachable positive starter presets, sourced from the same
 * `getPresetHabitsByCategory()` catalog used everywhere else. We surface a small
 * hand-picked set (rather than the full 60+ accordion) so a brand-new user can
 * pick 2–3 in seconds. Any id missing from the catalog is silently skipped.
 */
const STARTER_PRESET_IDS = [
  'preset_make_bed',
  'preset_drink_water',
  'preset_exercise_30',
  'preset_reading_30',
  'preset_veggies_dinner',
  'preset_meditate',
  'preset_dishes',
  'preset_walk_dog',
];

/**
 * First-run onboarding wizard.
 *
 * Full-page route (not a modal): for a brand-new household creator it IS the
 * screen. It seeds a little starter data — a checking balance and a couple of
 * habits — so the dashboard isn't empty, then invites a partner and finishes.
 *
 * Gating: ProtectedRoute already redirects to /setup when there's no household,
 * so here we only guard the "already onboarded" case (a returning user can't get
 * stuck on this route). The wizard is reached from the household-creation flow,
 * never from a dashboard load, so existing households never see it.
 */
const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const { addAccount } = useFinance();
  const { addHabit } = useGamification();
  // householdId guarding lives in ProtectedRoute (-> /setup) and in each context
  // method, so the wizard reads only what it renders.
  const { householdSettings, completeOnboarding } = useHouseholdCore();

  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<Step>('welcome');
  const [balanceInput, setBalanceInput] = useState('');
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Build the curated starter list once from the shared catalog.
  const starterPresets = useMemo<PresetHabit[]>(() => {
    const byCategory = getPresetHabitsByCategory();
    const all = Object.values(byCategory).flat();
    const byId = new Map(all.map((p) => [p.id, p]));
    return STARTER_PRESET_IDS.map((id) => byId.get(id)).filter(
      (p): p is PresetHabit => p !== undefined,
    );
  }, []);

  const householdName = householdSettings?.name?.trim() || 'your household';
  const inviteCode = householdSettings?.inviteCode ?? '';

  // Move focus to the new step's heading so screen-reader and keyboard users
  // follow the flow (mirrors how the app's modals manage focus).
  const focusHeading = useCallback(() => {
    // Defer to the next frame so the heading for the new step has mounted.
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const goToStep = useCallback(
    (next: Step) => {
      setStep(next);
      focusHeading();
    },
    [focusHeading],
  );

  /** Finish (or skip) the wizard: persist the flag, then land on the dashboard. */
  const finish = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await completeOnboarding();
    } catch (error) {
      // Don't trap the user on the wizard if the flag write fails; surface it
      // and continue to the dashboard regardless.
      console.error('[OnboardingWizard] Failed to mark onboarding complete:', error);
      toast.error("Couldn't save setup progress, but you're all set.");
    } finally {
      navigate('/', { replace: true });
    }
  }, [completeOnboarding, isSubmitting, navigate]);

  /** Seed the checking account from the entered dollar amount, then advance. */
  const submitBalance = useCallback(async () => {
    if (isSubmitting) return;
    const trimmed = balanceInput.trim();
    const parsed = trimmed === '' ? 0 : Number(trimmed);

    // Allow $0 / skip; only block genuinely invalid input.
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Enter a balance of $0 or more.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (parsed > 0) {
        await addAccount(buildCheckingAccount(parsed));
      }
    } catch (error) {
      // A single seeding failure should not block onboarding.
      console.error('[OnboardingWizard] Failed to add checking account:', error);
      toast.error("Couldn't add your account, but you can add it later in Budget.");
    } finally {
      setIsSubmitting(false);
      goToStep('habits');
    }
  }, [addAccount, balanceInput, goToStep, isSubmitting]);

  /** Create each selected starter habit, then advance. */
  const submitHabits = useCallback(async () => {
    if (isSubmitting) return;
    const chosen = starterPresets.filter((p) => selectedPresetIds.has(p.id));

    setIsSubmitting(true);
    try {
      // Sequential so a single failure is isolated (addHabit toasts its own
      // success); selecting none is allowed and simply advances.
      for (const preset of chosen) {
        try {
          await addHabit(presetToHabit(preset));
        } catch (error) {
          console.error(`[OnboardingWizard] Failed to add habit "${preset.title}":`, error);
          toast.error(`Couldn't add "${preset.title}". You can add it later in Habits.`);
        }
      }
    } finally {
      setIsSubmitting(false);
      goToStep('invite');
    }
  }, [addHabit, goToStep, isSubmitting, selectedPresetIds, starterPresets]);

  const togglePreset = useCallback((id: string) => {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_STARTER_HABITS) {
        next.add(id);
      } else {
        toast(`Pick up to ${MAX_STARTER_HABITS} to start — you can add more later.`);
      }
      return next;
    });
  }, []);

  // A returning/already-onboarded user must never get stuck here. Checked after
  // all hooks so the hook order stays stable across renders (rules-of-hooks).
  if (householdSettings?.onboardingComplete === true) {
    return <Navigate to="/" replace />;
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-dvh bg-linear-to-br from-brand-100 via-brand-50 to-money-50 dark:from-brand-900 dark:via-brand-900 dark:to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8" role="dialog" aria-labelledby={titleId} aria-modal="true">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === stepIndex ? 'w-6 bg-brand-600 dark:bg-brand-400' : 'w-1.5 bg-brand-200 dark:bg-slate-700',
              )}
            />
          ))}
        </div>

        {/* Heading (focus target on each step) */}
        <div className="text-center mb-6">
          <h1
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-brand-800 dark:text-slate-100 outline-hidden"
          >
            {STEP_TITLES[step]}
          </h1>
        </div>

        {/* ===== STEP 1: WELCOME ===== */}
        {step === 'welcome' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl">
                <Home className="w-8 h-8 text-white" aria-hidden="true" />
              </div>
              <p className="text-brand-600 dark:text-slate-300">
                Welcome! Let&apos;s set up <span className="font-semibold text-brand-800 dark:text-slate-100">{householdName}</span> in
                about a minute. We&apos;ll add a starting balance and a couple of habits so your dashboard isn&apos;t empty.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="lg" className="w-full" rightIcon={<ArrowRight size={18} />} onClick={() => goToStep('balance')}>
                Get started
              </Button>
              <Button variant="ghost" className="w-full" onClick={finish} disabled={isSubmitting}>
                Skip for now
              </Button>
            </div>
          </div>
        )}

        {/* ===== STEP 2: CHECKING BALANCE ===== */}
        {step === 'balance' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-money-pos/15 text-money-pos rounded-2xl">
                <Wallet className="w-7 h-7" aria-hidden="true" />
              </div>
              <p className="text-brand-600 dark:text-slate-300 text-sm">
                What&apos;s the current balance of your main checking account? This powers your Safe-to-Spend number. You can
                change it anytime.
              </p>
            </div>
            <Input
              label="Checking balance"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              icon={<span className="text-base font-semibold">$</span>}
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" leftIcon={<ArrowLeft size={18} />} onClick={() => goToStep('welcome')} disabled={isSubmitting}>
                Back
              </Button>
              <Button className="flex-1" rightIcon={<ArrowRight size={18} />} onClick={submitBalance} isLoading={isSubmitting}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ===== STEP 3: STARTER HABITS ===== */}
        {step === 'habits' && (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-habit-streak/15 text-habit-streak rounded-2xl">
                <Sparkles className="w-7 h-7" aria-hidden="true" />
              </div>
              <p className="text-brand-600 dark:text-slate-300 text-sm">
                Pick up to {MAX_STARTER_HABITS} habits to track. You can add, edit, or remove habits anytime.
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="sr-only">Choose up to {MAX_STARTER_HABITS} starter habits</legend>
              {starterPresets.map((preset) => {
                const checked = selectedPresetIds.has(preset.id);
                return (
                  <label
                    key={preset.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors',
                      checked
                        ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-700/30'
                        : 'border-brand-100 dark:border-slate-700 hover:bg-brand-50/50 dark:hover:bg-slate-700/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => togglePreset(preset.id)}
                    />
                    <span
                      className={cn(
                        'w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors',
                        checked
                          ? 'bg-money-pos border-money-pos text-white'
                          : 'border-brand-200 dark:border-slate-600 text-transparent',
                      )}
                      aria-hidden="true"
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-sm text-brand-800 dark:text-slate-100 truncate">
                        {preset.title}
                      </span>
                      <span className="block text-xxs text-brand-400 dark:text-slate-400">{preset.category} · {preset.period}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="flex items-center gap-2">
              <Button variant="ghost" leftIcon={<ArrowLeft size={18} />} onClick={() => goToStep('balance')} disabled={isSubmitting}>
                Back
              </Button>
              <Button className="flex-1" rightIcon={<ArrowRight size={18} />} onClick={submitHabits} isLoading={isSubmitting}>
                {selectedPresetIds.size > 0 ? `Add ${selectedPresetIds.size} & continue` : 'Skip for now'}
              </Button>
            </div>
          </div>
        )}

        {/* ===== STEP 4: INVITE PARTNER ===== */}
        {step === 'invite' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-100 dark:bg-slate-700/50 text-brand-600 dark:text-slate-300 rounded-2xl">
                <Users className="w-7 h-7" aria-hidden="true" />
              </div>
              <p className="text-brand-600 dark:text-slate-300 text-sm">
                LifeBalance is better together. Share this code so your partner can join {householdName}.
              </p>
            </div>

            {inviteCode ? (
              <HouseholdInviteCard inviteCode={inviteCode} />
            ) : (
              <p className="text-center text-sm text-brand-400 dark:text-slate-400">
                Your invite code will be available in Settings.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button variant="ghost" leftIcon={<ArrowLeft size={18} />} onClick={() => goToStep('habits')} disabled={isSubmitting}>
                Back
              </Button>
              <Button className="flex-1" rightIcon={<ArrowRight size={18} />} onClick={() => goToStep('done')}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ===== STEP 5: DONE ===== */}
        {step === 'done' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-money-pos rounded-2xl">
                <PartyPopper className="w-8 h-8 text-white" aria-hidden="true" />
              </div>
              <p className="text-brand-600 dark:text-slate-300">
                You&apos;re all set! Your dashboard is ready. You can fine-tune accounts, budgets, and habits anytime.
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={finish} isLoading={isSubmitting}>
              Go to dashboard
            </Button>
          </div>
        )}

        {/* Persistent skip affordance (hidden on the final step, which is itself the finish) */}
        {step !== 'done' && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={finish}
              disabled={isSubmitting}
              className="text-xs font-medium text-brand-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-slate-300 disabled:opacity-50"
            >
              Skip setup
            </button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default OnboardingWizard;
