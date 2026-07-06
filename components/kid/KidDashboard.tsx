import React, { useCallback, useMemo, useState } from 'react';
import { Check, Flame, Gift, Lock, LogOut, PiggyBank, Sparkles, Star, Trophy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHouseholdCore, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatCurrency } from '@/utils/formatCurrency';
import { getLocalDateString } from '@/utils/dateHelpers';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { verifyKidPin } from '@/utils/kidPin';
import ProgressBar from '@/components/ui/ProgressBar';
import { Badge } from '@/components/ui/Badge';
import type { Habit, RewardItem } from '@/types/schema';

/**
 * KidDashboard — the simplified, scoped surface shown while a parent is acting as
 * a managed kid (Plan 080b). It REPLACES the whole parent shell (rendered by
 * MainLayout when the active member is a kid), so finance, Settings, AI capture,
 * other members' data, and the bottom-nav are all simply absent — there is no
 * navigation out of this view except the "Done" exit (PIN-gated when set).
 *
 * Everything here is doubly dormant: it only mounts when `kidModeEnabled` is on
 * AND a parent has switched into a kid. Writes execute in the parent's
 * authenticated session (Principle 2), so no kid credential is ever required.
 *
 * Theme: warm-amber (the redesign's secondary accent for household/gamification
 * warmth), matching the kid avatars in ProfileMenu. Surfaces are grouped-flat
 * (solid + hairline), no glass/gradient. Scope notes:
 *  - Chores are habits with `assignedTo === kidUid`; the assignment UI + per-kid
 *    point crediting land in 080c (so this list is empty until then).
 *  - The reward "Request" button is a friendly stub here; the real
 *    request → parent-approval → points/allowance flow lands in 080d.
 */
const KidDashboard: React.FC = () => {
  const { members, activeMemberId, exitToParent, household } = useHouseholdCore();
  const { habits, toggleHabit, rewardsInventory, requestRedemption, activeChallenge } =
    useGamification();

  const activeKid = useMemo(
    () => members.find((m) => m.uid === activeMemberId),
    [members, activeMemberId],
  );

  const today = useMemo(() => getLocalDateString(), []);

  // Reward ids this kid already has a pending request for, so the store can show
  // a "Requested" state and not let them double-request the same reward.
  const pendingRewardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of household?.pendingRedemptions ?? []) {
      if (r.memberId === activeKid?.uid) ids.add(r.rewardId);
    }
    return ids;
  }, [household?.pendingRedemptions, activeKid?.uid]);

  const myChores = useMemo(
    () => (activeKid ? habits.filter((h) => h.assignedTo === activeKid.uid) : []),
    [habits, activeKid],
  );

  // Plan 080e — the shared Family Challenge. Shows the active challenge's overall
  // progress (via the same util the parent widget uses) so a kid sees the family
  // goal. Renders nothing when there is no active challenge. Doubly dormant: this
  // whole surface only mounts under Kid Mode + acting-as-kid.
  const challengeHabits = useMemo(
    () =>
      activeChallenge ? habits.filter((h) => activeChallenge.relatedHabitIds.includes(h.id)) : [],
    [activeChallenge, habits],
  );

  const challengeProgress = useMemo(
    () => (activeChallenge ? calculateChallengeProgress(activeChallenge, challengeHabits) : null),
    [activeChallenge, challengeHabits],
  );

  // Total completions logged toward the challenge this month, across its shared
  // (household-wide) habits. Challenge/family habits aren't assigned per-kid, so
  // this is a FAMILY total — not the acting kid's individual count — and the badge
  // below is labelled truthfully as such (it would be misleading to show it as
  // "You: N"). Simple, friendly encouragement only.
  const familyCompletions = useMemo(() => {
    if (!activeChallenge) return 0;
    const monthKey = activeChallenge.month;
    return challengeHabits.reduce(
      (sum, h) => sum + h.completedDates.filter((d) => d.startsWith(monthKey)).length,
      0,
    );
  }, [activeChallenge, challengeHabits]);

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const pinModalRef = useFocusTrap<HTMLDivElement>(showPinModal);

  const hasPin = Boolean(household?.kidModePinHash);

  const handleExitClick = useCallback(() => {
    if (hasPin) {
      setPinInput('');
      setPinError(false);
      setShowPinModal(true);
    } else {
      exitToParent();
    }
  }, [hasPin, exitToParent]);

  const handlePinSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const ok = await verifyKidPin(pinInput, household?.kidModePinHash);
      if (ok) {
        setShowPinModal(false);
        exitToParent();
      } else {
        setPinError(true);
        setPinInput('');
      }
    },
    [pinInput, household?.kidModePinHash, exitToParent],
  );

  const handleToggleChore = useCallback(
    async (h: Habit) => {
      const done = h.completedDates.includes(today);
      try {
        await toggleHabit(h.id, done ? 'down' : 'up');
      } catch {
        // toggleHabit surfaces its own error toast.
      }
    },
    [toggleHabit, today],
  );

  const handleRequestReward = useCallback(
    async (r: RewardItem) => {
      if (!activeKid) return;
      // Guard against a double-request for the same reward (the button is also
      // swapped to a non-interactive "Requested" pill below).
      if (pendingRewardIds.has(r.id)) {
        toast(`You already asked for "${r.title}" — hang tight! ⏳`, { icon: '⏳' });
        return;
      }
      try {
        await requestRedemption(r.id, activeKid.uid);
      } catch {
        // requestRedemption surfaces its own error toast.
      }
    },
    [activeKid, pendingRewardIds, requestRedemption],
  );

  // The gate in MainLayout guarantees a kid is active, but guard anyway so a stale
  // activeMemberId (e.g. a just-removed kid) can't crash the surface.
  if (!activeKid) return null;

  const points = activeKid.points ?? { daily: 0, weekly: 0, total: 0 };
  const allowance = formatCurrency((activeKid.allowanceCents ?? 0) / 100, {
    currency: household?.currency,
  });

  return (
    <div className="min-h-dvh bg-brand-50 dark:bg-brand-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-4 pt-6 pb-12 space-y-6">
        {/* Header: who you are + exit */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-extrabold text-white shrink-0"
              style={{ backgroundColor: activeKid.avatarColor ?? '#b87a29' }}
            >
              {activeKid.avatarEmoji ?? activeKid.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300">
                Hi there
              </p>
              <h1 className="font-display text-xl font-semibold text-brand-900 dark:text-white truncate">
                {activeKid.displayName}
              </h1>
            </div>
          </div>
          <button
            onClick={handleExitClick}
            className="flex items-center gap-1.5 rounded-btn bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 px-4 min-h-11 text-sm font-bold text-brand-600 dark:text-brand-200 active:scale-95 transition-transform duration-(--duration-fast) ease-(--ease-standard)"
            aria-label="Done — back to parent"
          >
            {hasPin ? <Lock className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
            Done
          </button>
        </header>

        {/* Points + allowance */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-warm-600 p-4 text-white shadow-raised">
            <div className="flex items-center gap-1.5 text-warm-50">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-xs font-bold uppercase tracking-wide">Points</span>
            </div>
            <p className="mt-1 font-mono text-4xl font-black tabular-nums">
              {points.total.toLocaleString()}
            </p>
            <p className="text-xs font-semibold text-warm-50">{points.weekly} this week</p>
          </div>
          <div className="rounded-lg bg-accent-600 p-4 text-white shadow-raised">
            <div className="flex items-center gap-1.5 text-accent-50">
              <PiggyBank className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wide">Saved up</span>
            </div>
            <p className="mt-1 font-mono text-3xl font-black tabular-nums">{allowance}</p>
            <p className="text-xs font-semibold text-accent-50/90">your allowance</p>
          </div>
        </section>

        {/* Family Challenge (Plan 080e) — only when one is active */}
        {activeChallenge && challengeProgress && (
          <section>
            <div className="rounded-lg bg-warm-600 p-5 text-white shadow-raised">
              <div className="flex items-center gap-2 text-warm-100">
                <Trophy className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">Family challenge</span>
              </div>
              <h2 className="font-display mt-1 text-lg font-semibold leading-tight">
                {activeChallenge.title}
              </h2>
              {activeChallenge.description && (
                <p className="mt-0.5 text-sm text-warm-100/90">{activeChallenge.description}</p>
              )}

              {/* Overall progress bar */}
              <ProgressBar
                value={challengeProgress.progress}
                barClassName="bg-warm-200"
                ariaLabel={`Family challenge progress: ${Math.round(challengeProgress.progress)}% complete`}
                className="mt-3 h-2.5 bg-white/20"
              />
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-warm-100">
                <span>{Math.round(challengeProgress.progress)}% as a family</span>
                {familyCompletions > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    {familyCompletions} done together
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Chores */}
        <section>
          <h2 className="font-display mb-3 flex items-center gap-2 text-lg font-semibold text-brand-900 dark:text-white">
            <Check className="w-5 h-5 text-warm-500" />
            My chores
          </h2>
          {myChores.length === 0 ? (
            <div className="surface-section p-8 text-center">
              <Sparkles className="w-8 h-8 mx-auto text-warm-400" />
              <p className="font-display mt-2 font-semibold text-brand-700 dark:text-brand-200">
                No chores yet!
              </p>
              <p className="text-sm text-brand-500 dark:text-brand-400">
                A grown-up will add some for you soon.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {myChores.map((h) => {
                const done = h.completedDates.includes(today);
                return (
                  <li key={h.id}>
                    <button
                      onClick={() => handleToggleChore(h)}
                      className={`w-full flex items-center gap-4 rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${
                        done
                          ? 'bg-warm-500 text-white border-warm-600'
                          : 'bg-white dark:bg-brand-800 text-brand-900 dark:text-white border-brand-200 dark:border-brand-700'
                      }`}
                      aria-pressed={done}
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                          done ? 'bg-white/25' : 'bg-warm-100 dark:bg-warm-500/20'
                        }`}
                      >
                        <Check
                          className={`h-6 w-6 ${done ? 'text-white' : 'text-warm-600 dark:text-warm-300'}`}
                          strokeWidth={3}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-bold">{h.title}</span>
                        <span
                          className={`flex items-center gap-2 text-sm font-semibold ${
                            done ? 'text-white/80' : 'text-brand-500 dark:text-brand-400'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-current" />
                            {h.basePoints} pts
                          </span>
                          {h.streakDays > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Flame className="h-3.5 w-3.5" />
                              {h.streakDays}
                            </span>
                          )}
                        </span>
                      </span>
                      {done && <span className="text-sm font-black uppercase">Done!</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Reward store */}
        <section>
          <h2 className="font-display mb-3 flex items-center gap-2 text-lg font-semibold text-brand-900 dark:text-white">
            <Gift className="w-5 h-5 text-warm-500" />
            Reward store
          </h2>
          {rewardsInventory.length === 0 ? (
            <div className="surface-section p-8 text-center">
              <Gift className="w-8 h-8 mx-auto text-warm-400" />
              <p className="font-display mt-2 font-semibold text-brand-700 dark:text-brand-200">
                No rewards yet!
              </p>
              <p className="text-sm text-brand-500 dark:text-brand-400">
                Earn points while a grown-up sets up the store.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rewardsInventory.map((r) => {
                const canAfford = points.total >= r.cost;
                const alreadyRequested = pendingRewardIds.has(r.id);
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-2xl bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 p-4"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warm-100 dark:bg-warm-500/20 text-xl">
                      {r.icon || '🎁'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-brand-900 dark:text-white">
                        {r.title}
                      </p>
                      <p className="flex items-center gap-1 text-sm font-semibold text-warm-600 dark:text-warm-300">
                        <Star className="h-3.5 w-3.5 fill-current" />
                        {r.cost} pts
                      </p>
                    </div>
                    {alreadyRequested ? (
                      <Badge variant="warning" size="md" className="px-3 min-h-11">
                        Requested
                      </Badge>
                    ) : canAfford ? (
                      <button
                        onClick={() => handleRequestReward(r)}
                        className="rounded-full bg-warm-600 px-5 min-h-11 text-sm font-bold text-white active:scale-95 transition-transform duration-(--duration-fast) ease-(--ease-standard) hover:bg-warm-700"
                      >
                        Request
                      </button>
                    ) : (
                      <Badge variant="neutral" size="md" className="px-3 min-h-11">
                        {r.cost - points.total} more
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Parent PIN gate to exit (Netflix-Kids pattern) */}
      {showPinModal && (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Enter parent PIN to exit"
        >
          <div
            ref={pinModalRef}
            className="w-full max-w-xs rounded-lg bg-white dark:bg-brand-800 p-6 shadow-raised"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warm-100 dark:bg-warm-500/20">
                <Lock className="h-6 w-6 text-warm-600 dark:text-warm-300" />
              </div>
              <h3 className="font-display mt-3 text-lg font-semibold text-brand-900 dark:text-white">
                Grown-up check
              </h3>
              <p className="mt-1 text-sm text-brand-500 dark:text-brand-400">
                Enter the PIN to leave {activeKid.displayName}&apos;s view.
              </p>
            </div>
            <form onSubmit={handlePinSubmit} className="mt-4 space-y-3">
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                autoComplete="current-password"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setPinError(false);
                }}
                className={`w-full rounded-btn border-2 bg-white dark:bg-brand-900 px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-brand-900 dark:text-white outline-none ${
                  pinError
                    ? 'border-money-neg focus:border-money-neg'
                    : 'border-brand-200 dark:border-brand-700 focus:border-warm-500'
                }`}
                aria-label="Parent PIN"
                aria-invalid={pinError}
              />
              {pinError && (
                <p className="text-center text-sm font-semibold text-money-neg dark:text-money-negDark">
                  That PIN isn&apos;t right — try again.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 rounded-btn bg-brand-100 dark:bg-brand-700 px-4 py-3 text-sm font-bold text-brand-600 dark:text-brand-200 active:scale-95 transition-transform"
                >
                  Stay
                </button>
                <button
                  type="submit"
                  disabled={pinInput.length < 4}
                  className="flex-1 rounded-btn bg-warm-500 px-4 py-3 text-sm font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                >
                  Exit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default KidDashboard;
