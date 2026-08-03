/**
 * ARCH-1 — composes a full `WeeklyRecap`-shaped object for a requested ISO
 * week from LIVE client state, so the app never has to wait for Monday
 * morning's server generation (`functions/src/recap/index.ts`, protected —
 * a parallel PR owns it) to show a week's numbers.
 *
 * This module is deliberately thin: all the actual scoring/spend math lives
 * in the protected `utils/recapAssembly.ts` (CORE-1) and is reused verbatim
 * — this file only (a) decides whether enough transaction history is loaded
 * to trust the money figures, and (b) wraps `assembleWeeklyRecap`'s output
 * into the fields a `WeeklyRecap` needs beyond what that function computes
 * (id/isoWeek/generatedAt/narrative/narrativeSource/premium — exactly the
 * fields `assembleWeeklyRecap`'s own doc comment says callers must add).
 *
 * 🛡️ SHAPE-AGNOSTIC. A parallel PR is changing `WeeklyRecap`'s DATA FIELDS
 * (`utils/recapAssembly.ts` itself). This module never lists out or assumes
 * which numeric fields exist beyond what `AssembledRecap` already returns —
 * it spreads that object wholesale, so a field added/removed on the other
 * side of that PR flows through here for free.
 *
 * 🛡️ NARRATIVE HONESTY. A derived recap has never been through Gemini (or
 * even the template narrative generator) — there is nothing true to put in
 * `narrative`. `premium` is set to `false` (never `true`) specifically so
 * `WeeklyRecapDrawer`/`RecapDeck`'s existing premium-gated narrative section
 * (protected — this task does not touch it) renders its EXISTING graceful
 * fallback ("Unlock your personal recap with Premium") instead of an empty
 * `<p>` tag — `premium: true` with an empty `narrative` would render visible
 * blank space, which is exactly the "confidently wrong" failure mode this
 * whole feature is trying to avoid. See ARCH-1's PR description for the full
 * reasoning and the scope boundary that makes this the only lever available.
 */
import { assembleWeeklyRecap, shiftDay, type DataAssemblyInput } from '@/utils/recapAssembly';
import type { RecapWeekRange } from '@/utils/recapWeek';
import type { WeeklyRecap } from '@/types/schema';

export type DerivedRecapInput = Pick<
  DataAssemblyInput,
  'transactions' | 'habits' | 'members' | 'calendarItems'
>;

/**
 * Builds a derived `WeeklyRecap` for `range` from live client arrays. Pure —
 * callers are responsible for only calling this once the transactions the
 * money figures depend on are actually loaded (`transactionsCoverWeek`
 * below); this function has no way to know whether `input.transactions` is
 * complete for the requested range and will happily sum whatever it's given.
 */
export function deriveWeeklyRecap(range: RecapWeekRange, input: DerivedRecapInput): WeeklyRecap {
  const assembled = assembleWeeklyRecap({
    ...input,
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
  });
  return {
    id: range.isoWeek,
    isoWeek: range.isoWeek,
    generatedAt: new Date().toISOString(),
    narrative: '',
    narrativeSource: 'template',
    premium: false,
    ...assembled,
  };
}

/**
 * Does the live transaction set already cover everything `range`'s money
 * figures need (its own week PLUS the prior week the deltas compare
 * against)? Mirrors the household context's transaction-windowing contract
 * (`utils/listenerWindows.ts`):
 *
 *  - `transactionWindowStart === null` — period tracking is off, so the
 *    context never windows at all; everything is already loaded.
 *  - `!hasMoreTransactions` — either there was never more to load, or a
 *    prior `loadAllTransactions()` call (own or another consumer's) already
 *    finished; either way the merged transaction list is complete back to
 *    the true beginning of history.
 *  - otherwise, only covered if the live window's lower bound already
 *    reaches back to (at least) the PRIOR week's Monday — the earliest date
 *    `assembleWeeklyRecap`'s prior-week comparison reads.
 *
 * A `false` result is the caller's signal to trigger `loadAllTransactions()`
 * and hold off deriving — never to derive anyway and show a confidently
 * wrong (likely zero) money figure for the missing history.
 */
export function transactionsCoverWeek(
  range: RecapWeekRange,
  transactionWindowStart: string | null,
  hasMoreTransactions: boolean
): boolean {
  if (transactionWindowStart === null) return true;
  if (!hasMoreTransactions) return true;
  const priorWeekStart = shiftDay(range.weekStart, -7);
  return priorWeekStart >= transactionWindowStart;
}
