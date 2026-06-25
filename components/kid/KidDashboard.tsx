import React, { useCallback, useMemo, useState } from 'react';
import { Check, Flame, Gift, Lock, LogOut, PiggyBank, Sparkles, Star, Trophy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useHouseholdCore, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatCurrency } from '@/utils/formatCurrency';
import { getLocalDateString } from '@/utils/dateHelpers';
import { calculateChallengeProgress } from '@/utils/challengeCalculator';
import { verifyKidPin } from '@/utils/kidPin';
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
 * Theme: purple, matching the kid avatars in ProfileMenu. Scope notes:
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
    <div className="min-h-dvh bg-linear-to-b from-purple-50 to-brand-50 dark:from-brand-900 dark:to-slate-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-4 pt-6 pb-12 space-y-6">
        {/* Header: who you are + exit */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-extrabold text-white shrink-0 shadow-md"
              style={{ backgroundColor: activeKid.avatarColor ?? '#7c3aed' }}
            >
              {activeKid.avatarEmoji ?? activeKid.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-300">
                Hi there
              </p>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-white truncate">
                {activeKid.displayName}
              </h1>
            </div>
          </div>
          <button
            onClick={handleExitClick}
            className="flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-slate-800/80 px-3.5 py-2 text-sm font-bold text-slate-600 dark:text-slate-200 shadow-sm ring-1 ring-black/5 active:scale-95 transition-transform"
            aria-label="Done — back to parent"
          >
            {hasPin ? <Lock className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
            Done
          </button>
        </header>

        {/* Points + allowance */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-linear-to-br from-amber-400 to-orange-500 p-4 text-white shadow-lg">
            <div className="flex items-center gap-1.5 text-amber-50">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-xs font-bold uppercase tracking-wide">Points</span>
            </div>
            <p className="mt-1 text-4xl font-black tabular-nums">{points.total.toLocaleString()}</p>
            <p className="text-xs font-semibold text-amber-50/90">{points.weekly} this week</p>
          </div>
          <div className="rounded-3xl bg-linear-to-br from-emerald-400 to-green-600 p-4 text-white shadow-lg">
            <div className="flex items-center gap-1.5 text-emerald-50">
              <PiggyBank className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wide">Saved up</span>
            </div>
            <p className="mt-1 text-3xl font-black tabular-nums">{allowance}</p>
            <p className="text-xs font-semibold text-emerald-50/90">your allowance</p>
          </div>
        </section>

        {/* Family Challenge (Plan 080e) — only when one is active */}
        {activeChallenge && challengeProgress && (
          <section>
            <div className="rounded-3xl bg-linear-to-br from-purple-500 to-indigo-600 p-5 text-white shadow-lg">
              <div className="flex items-center gap-2 text-purple-100">
                <Trophy className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wide">Family challenge</span>
              </div>
              <h2 className="mt-1 text-lg font-extrabold leading-tight">{activeChallenge.title}</h2>
              {activeChallenge.description && (
                <p className="mt-0.5 text-sm text-purple-100/90">{activeChallenge.description}</p>
              )}

              {/* Overall progress bar */}
              <div
                className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/20"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(challengeProgress.progress)}
                aria-label={`Family challenge progress: ${Math.round(challengeProgress.progress)}% complete`}
              >
                <div
                  className="h-full rounded-full bg-linear-to-r from-amber-300 to-orange-400 transition-all duration-700"
                  style={{ width: `${challengeProgress.progress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-purple-100">
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
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white">
            <Check className="w-5 h-5 text-purple-500" />
            My chores
          </h2>
          {myChores.length === 0 ? (
            <div className="rounded-3xl bg-white/70 dark:bg-slate-800/60 p-8 text-center ring-1 ring-black/5">
              <Sparkles className="w-8 h-8 mx-auto text-purple-400" />
              <p className="mt-2 font-bold text-slate-700 dark:text-slate-200">No chores yet!</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
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
                      className={`w-full flex items-center gap-4 rounded-3xl p-4 text-left shadow-sm ring-1 transition-all active:scale-[0.98] ${
                        done
                          ? 'bg-purple-500 text-white ring-purple-600'
                          : 'bg-white/90 dark:bg-slate-800/80 text-slate-900 dark:text-white ring-black/5'
                      }`}
                      aria-pressed={done}
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                          done ? 'bg-white/25' : 'bg-purple-100 dark:bg-purple-500/20'
                        }`}
                      >
                        <Check
                          className={`h-6 w-6 ${done ? 'text-white' : 'text-purple-500'}`}
                          strokeWidth={3}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-bold">{h.title}</span>
                        <span
                          className={`flex items-center gap-2 text-sm font-semibold ${
                            done ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'
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
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white">
            <Gift className="w-5 h-5 text-purple-500" />
            Reward store
          </h2>
          {rewardsInventory.length === 0 ? (
            <div className="rounded-3xl bg-white/70 dark:bg-slate-800/60 p-8 text-center ring-1 ring-black/5">
              <Gift className="w-8 h-8 mx-auto text-purple-400" />
              <p className="mt-2 font-bold text-slate-700 dark:text-slate-200">No rewards yet!</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
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
                    className="flex items-center gap-3 rounded-3xl bg-white/90 dark:bg-slate-800/80 p-4 shadow-sm ring-1 ring-black/5"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-500/20 text-xl">
                      {r.icon || '🎁'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-slate-900 dark:text-white">
                        {r.title}
                      </p>
                      <p className="flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                        <Star className="h-3.5 w-3.5 fill-current" />
                        {r.cost} pts
                      </p>
                    </div>
                    {alreadyRequested ? (
                      <span className="rounded-full bg-purple-100 dark:bg-purple-500/20 px-3 py-2 text-center text-xs font-bold text-purple-600 dark:text-purple-300">
                        Requested
                      </span>
                    ) : canAfford ? (
                      <button
                        onClick={() => handleRequestReward(r)}
                        className="rounded-full bg-purple-500 px-4 py-2 text-sm font-bold text-white shadow-sm active:scale-95 transition-transform"
                      >
                        Request
                      </button>
                    ) : (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2 text-center text-xs font-bold text-slate-500 dark:text-slate-300">
                        {r.cost - points.total} more
                      </span>
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
            className="w-full max-w-xs rounded-3xl bg-white dark:bg-slate-800 p-6 shadow-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-500/20">
                <Lock className="h-6 w-6 text-purple-500" />
              </div>
              <h3 className="mt-3 text-lg font-extrabold text-slate-900 dark:text-white">
                Grown-up check
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
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
                className={`w-full rounded-xl border-2 bg-white dark:bg-slate-900 px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-slate-900 dark:text-white outline-none ${
                  pinError
                    ? 'border-rose-400 focus:border-rose-500'
                    : 'border-slate-200 dark:border-slate-700 focus:border-purple-500'
                }`}
                aria-label="Parent PIN"
                aria-invalid={pinError}
              />
              {pinError && (
                <p className="text-center text-sm font-semibold text-rose-500">
                  That PIN isn&apos;t right — try again.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-700 px-4 py-3 text-sm font-bold text-slate-600 dark:text-slate-200 active:scale-95 transition-transform"
                >
                  Stay
                </button>
                <button
                  type="submit"
                  disabled={pinInput.length < 4}
                  className="flex-1 rounded-xl bg-purple-500 px-4 py-3 text-sm font-bold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-50"
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
