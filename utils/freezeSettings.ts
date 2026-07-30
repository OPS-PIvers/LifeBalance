/**
 * Per-member habit points — stage 6: the two household admin settings.
 *
 * This module is the SINGLE source of truth for resolving `Household.freezeMode`
 * and `Household.ceremonyTone`, for the copy the Settings control renders, and
 * for the per-member freeze-bank storage shape.
 *
 * 🛡️ THE INERTNESS CONTRACT. Both fields are absent on every existing
 * household, and both resolvers map "absent" onto the behaviour that already
 * ships:
 *
 *   - `freezeMode` absent ⇒ `'shared'` ⇒ `autoApplyFreezes` takes the exact
 *     pre-stage-6 code path (one household bank, `Habit.frozenDates`, which
 *     bridges every member's chain).
 *   - `ceremonyTone` absent ⇒ `'household_first'`, the Ivers default, which is
 *     what stage 5's ceremony will render when it lands.
 *
 * An unrecognised stored value resolves to the same default rather than
 * throwing: these are free-text strings on a client-writable doc, and a typo
 * must degrade to today's behaviour, never to a crash or to a third mode.
 *
 * 🛡️ WRITE DISCIPLINE for `freezeBanksByMember`. A member's bank is never
 * written as part of a whole-map `{ freezeBanksByMember: … }` payload. Every
 * write goes through `memberFreezeBankPatch`, which emits dot paths under
 * `freezeBanksByMember.<uid>`: `tokens` absolute (matching how the shared bank
 * has always been written), `history` via `arrayUnion` (so two devices adding
 * different entries both survive). A stale device therefore cannot wipe another
 * member's bank, nor another entry in its own history.
 */
import type {
  CeremonyTone,
  FreezeBank,
  FreezeBankHistoryEntry,
  FreezeMode,
  Household,
  HouseholdMember,
} from '@/types/schema';
import { FREEZE_MAX_TOKENS } from '@/utils/freezeBank';
import { getLocalDateString } from '@/utils/dateHelpers';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Freeze mode
// ---------------------------------------------------------------------------

/** Absent `freezeMode` behaves as this — i.e. exactly what shipped before. */
export const DEFAULT_FREEZE_MODE: FreezeMode = 'shared';

export const FREEZE_MODES: readonly FreezeMode[] = ['shared', 'freeze_both', 'per_member'];

/** One admin-picker row: the value, its label, and its single explanatory line. */
export interface SettingChoice<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const FREEZE_MODE_CHOICES: readonly SettingChoice<FreezeMode>[] = [
  {
    value: 'shared',
    label: 'One shared bank',
    description: 'Two freezes a month for the household — a freeze protects everyone that day.',
  },
  {
    value: 'freeze_both',
    label: 'Shared bank, freeze us both',
    description: 'Same bank, stated on purpose: one freeze covers every person on that habit.',
  },
  {
    value: 'per_member',
    label: 'A bank each',
    description: 'Everyone gets their own two freezes, and a freeze only protects that person.',
  },
];

export const resolveFreezeMode = (
  household?: Pick<Household, 'freezeMode'> | null,
): FreezeMode => {
  const stored = household?.freezeMode;
  return stored && FREEZE_MODES.includes(stored) ? stored : DEFAULT_FREEZE_MODE;
};

/**
 * Does this mode give each member their own bank and their own frozen dates?
 *
 * The ONLY branch `autoApplyFreezes` / `rolloverFreezeBankTokens` dispatch on —
 * `'shared'` and `'freeze_both'` are deliberately the same mechanics (the
 * second is the first, chosen rather than defaulted into).
 */
export const isPerMemberFreeze = (mode: FreezeMode): boolean => mode === 'per_member';

// ---------------------------------------------------------------------------
// Ceremony tone
// ---------------------------------------------------------------------------

/** Absent `ceremonyTone` behaves as this (the Ivers default). */
export const DEFAULT_CEREMONY_TONE: CeremonyTone = 'household_first';

export const CEREMONY_TONES: readonly CeremonyTone[] = ['podium', 'household_first', 'adaptive'];

export const CEREMONY_TONE_CHOICES: readonly SettingChoice<CeremonyTone>[] = [
  {
    value: 'household_first',
    label: 'Household first',
    description: 'Open on what you did together; the standings follow underneath.',
  },
  {
    value: 'podium',
    label: 'Podium',
    description: 'Open on the head-to-head — who won the week, and by how much.',
  },
  {
    value: 'adaptive',
    label: 'Read the room',
    description: 'Crown a runaway week, keep a close one about the household.',
  },
];

export const resolveCeremonyTone = (
  household?: Pick<Household, 'ceremonyTone'> | null,
): CeremonyTone => {
  const stored = household?.ceremonyTone;
  return stored && CEREMONY_TONES.includes(stored) ? stored : DEFAULT_CEREMONY_TONE;
};

// ---------------------------------------------------------------------------
// Per-member freeze banks
// ---------------------------------------------------------------------------

/**
 * Who holds a per-member freeze bank: the ADULTS.
 *
 * A managed kid's habits are `assignedTo` chores whose points already route to
 * the kid's own member doc (Plan 080c) and which are excluded from the
 * attribution layer entirely (`habitFeedsMemberAttribution`), so they have no
 * per-member chain for a freeze to bridge. Kid Mode is also still dormant.
 */
export const freezeBankMemberIds = (
  members: Pick<HouseholdMember, 'uid' | 'isManaged'>[],
): string[] => members.filter(m => !m.isManaged).map(m => m.uid);

/** A fresh, full bank — what a member gets the first time they need one. */
export const newMemberFreezeBank = (now: Date = new Date()): FreezeBank => ({
  tokens: FREEZE_MAX_TOKENS,
  maxTokens: FREEZE_MAX_TOKENS,
  lastRolloverDate: getLocalDateString(now),
  lastRolloverMonth: format(now, 'yyyy-MM'),
  history: [],
});

/**
 * The bank `memberId` currently holds, seeding a full one when they have none.
 *
 * Seeding is READ-side and pure: a member who has never spent a freeze has no
 * stored node, and materialising one on read means no migration write is needed
 * when an admin flips the mode on.
 */
export const memberFreezeBank = (
  household: Pick<Household, 'freezeBanksByMember'> | null | undefined,
  memberId: string,
  now: Date = new Date(),
): FreezeBank => household?.freezeBanksByMember?.[memberId] ?? newMemberFreezeBank(now);

/**
 * The bank the UI should show for `memberId`.
 *
 * In every shared mode this is the household bank, unchanged — which is what
 * keeps the existing "2 / 2 freezes available" surfaces byte-identical while
 * `freezeMode` is absent. Only `'per_member'` swaps in the member's own bank,
 * so those surfaces stay truthful about the tokens actually being spent without
 * needing to know the setting exists.
 */
export const visibleFreezeBank = (
  household: Pick<Household, 'freezeMode' | 'freezeBanksByMember'> | null | undefined,
  sharedBank: FreezeBank | null,
  memberId: string | null | undefined,
  now: Date = new Date(),
): FreezeBank | null => {
  if (!household || !memberId) return sharedBank;
  if (!isPerMemberFreeze(resolveFreezeMode(household))) return sharedBank;
  return memberFreezeBank(household, memberId, now);
};

/** Dot-path prefix for one member's bank node. */
export const memberFreezeBankPath = (memberId: string): string =>
  `freezeBanksByMember.${memberId}`;

/**
 * The dot-path patch that persists one member's bank.
 *
 * `tokens` / the rollover markers are absolute (identical in spirit to the
 * shared bank's absolute `tokens` write, which is floored at 0 by its caller),
 * and each new history entry rides an `arrayUnion` sentinel supplied by the
 * caller — the caller owns the Firestore import, this module stays pure and
 * unit-testable. Passing no entries writes no `history` key at all.
 */
export const memberFreezeBankPatch = (
  memberId: string,
  bank: Pick<FreezeBank, 'tokens' | 'maxTokens' | 'lastRolloverDate' | 'lastRolloverMonth'>,
  historySentinel?: unknown,
): Record<string, unknown> => {
  const prefix = memberFreezeBankPath(memberId);
  const patch: Record<string, unknown> = {
    [`${prefix}.tokens`]: Math.max(0, bank.tokens),
    [`${prefix}.maxTokens`]: bank.maxTokens,
    [`${prefix}.lastRolloverDate`]: bank.lastRolloverDate,
    [`${prefix}.lastRolloverMonth`]: bank.lastRolloverMonth,
  };
  if (historySentinel !== undefined) patch[`${prefix}.history`] = historySentinel;
  return patch;
};

/**
 * The monthly refill applied to a member's bank, or `null` when it is already
 * current. Mirrors `rolloverFreezeBankTokens`' shared-bank math exactly: refill
 * to the fixed max, clamp a legacy over-max balance down, and stamp the month.
 */
export interface MemberFreezeRefill {
  memberId: string;
  bank: FreezeBank;
  entry: FreezeBankHistoryEntry | null;
}

export const memberFreezeRefill = (
  memberId: string,
  bank: FreezeBank,
  now: Date,
  entryId: string,
): MemberFreezeRefill | null => {
  const currentMonth = format(now, 'yyyy-MM');
  if (bank.lastRolloverMonth === currentMonth) return null;

  const tokensAdded = FREEZE_MAX_TOKENS - bank.tokens;
  const refilled: FreezeBank = {
    ...bank,
    tokens: FREEZE_MAX_TOKENS,
    maxTokens: FREEZE_MAX_TOKENS,
    lastRolloverDate: getLocalDateString(now),
    lastRolloverMonth: currentMonth,
  };

  return {
    memberId,
    bank: refilled,
    entry:
      tokensAdded === 0
        ? null
        : {
            id: entryId,
            type: 'rollover',
            amount: tokensAdded,
            date: getLocalDateString(now),
            notes:
              tokensAdded > 0
                ? `Monthly refill to ${FREEZE_MAX_TOKENS} freezes`
                : `Adjusted to the new ${FREEZE_MAX_TOKENS}-freeze maximum`,
            createdAt: now.toISOString(),
          },
  };
};
