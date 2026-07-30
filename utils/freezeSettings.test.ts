import { describe, it, expect } from 'vitest';
import type { FreezeBank, Household, HouseholdMember } from '@/types/schema';
import { FREEZE_MAX_TOKENS } from '@/utils/freezeBank';
import {
  CEREMONY_TONE_CHOICES,
  DEFAULT_CEREMONY_TONE,
  DEFAULT_FREEZE_MODE,
  FREEZE_MODE_CHOICES,
  freezeBankMemberIds,
  isPerMemberFreeze,
  memberFreezeBank,
  memberFreezeBankPatch,
  memberFreezeRefill,
  newMemberFreezeBank,
  resolveCeremonyTone,
  resolveFreezeMode,
  visibleFreezeBank,
} from './freezeSettings';

// Stage 6 — the two household admin settings. The load-bearing property under
// test throughout is the INERTNESS CONTRACT: an absent (or corrupt) field must
// resolve to the behaviour that already shipped.

const PAUL = 'uid-paul';
const JEN = 'uid-jen';

const bank = (overrides: Partial<FreezeBank> = {}): FreezeBank => ({
  tokens: 2,
  maxTokens: 2,
  lastRolloverDate: '2026-07-01',
  lastRolloverMonth: '2026-07',
  history: [],
  ...overrides,
});

const household = (overrides: Partial<Household> = {}) =>
  overrides as Household;

describe('resolveFreezeMode', () => {
  it('defaults to the pre-setting behaviour when absent', () => {
    expect(DEFAULT_FREEZE_MODE).toBe('shared');
    expect(resolveFreezeMode(undefined)).toBe('shared');
    expect(resolveFreezeMode(null)).toBe('shared');
    expect(resolveFreezeMode(household())).toBe('shared');
  });

  it('returns each stored mode verbatim', () => {
    expect(resolveFreezeMode(household({ freezeMode: 'per_member' }))).toBe('per_member');
    expect(resolveFreezeMode(household({ freezeMode: 'freeze_both' }))).toBe('freeze_both');
    expect(resolveFreezeMode(household({ freezeMode: 'shared' }))).toBe('shared');
  });

  it('degrades an unrecognised stored value to the default, never to per_member', () => {
    // A client-writable doc can hold anything; a typo must land on today's
    // behaviour rather than silently switching the household's freeze economy.
    const rogue = { freezeMode: 'per-member' } as unknown as Household;
    expect(resolveFreezeMode(rogue)).toBe('shared');
  });
});

describe('isPerMemberFreeze', () => {
  it('is true ONLY for per_member — shared and freeze_both are the same mechanics', () => {
    expect(isPerMemberFreeze('per_member')).toBe(true);
    expect(isPerMemberFreeze('shared')).toBe(false);
    expect(isPerMemberFreeze('freeze_both')).toBe(false);
  });
});

describe('resolveCeremonyTone', () => {
  it('defaults to household_first when absent', () => {
    expect(DEFAULT_CEREMONY_TONE).toBe('household_first');
    expect(resolveCeremonyTone(undefined)).toBe('household_first');
    expect(resolveCeremonyTone(household())).toBe('household_first');
  });

  it('returns each stored tone verbatim and degrades garbage to the default', () => {
    expect(resolveCeremonyTone(household({ ceremonyTone: 'podium' }))).toBe('podium');
    expect(resolveCeremonyTone(household({ ceremonyTone: 'adaptive' }))).toBe('adaptive');
    expect(resolveCeremonyTone({ ceremonyTone: 'PODIUM' } as unknown as Household))
      .toBe('household_first');
  });
});

describe('the admin picker choices', () => {
  it('offer every mode and every tone exactly once, each with an explanation', () => {
    expect(FREEZE_MODE_CHOICES.map(c => c.value).sort())
      .toEqual(['freeze_both', 'per_member', 'shared']);
    expect(CEREMONY_TONE_CHOICES.map(c => c.value).sort())
      .toEqual(['adaptive', 'household_first', 'podium']);
    for (const choice of [...FREEZE_MODE_CHOICES, ...CEREMONY_TONE_CHOICES]) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.description.length).toBeGreaterThan(0);
    }
  });
});

describe('freezeBankMemberIds', () => {
  it('is the adults — a managed kid has no per-member chain to protect', () => {
    const members = [
      { uid: PAUL },
      { uid: JEN },
      { uid: 'kid_1', isManaged: true },
    ] as HouseholdMember[];
    expect(freezeBankMemberIds(members)).toEqual([PAUL, JEN]);
  });
});

describe('memberFreezeBank', () => {
  it('seeds a full bank on read for a member who has never spent one', () => {
    const seeded = memberFreezeBank(household(), PAUL, new Date('2026-07-09T12:00:00'));
    expect(seeded.tokens).toBe(FREEZE_MAX_TOKENS);
    expect(seeded.maxTokens).toBe(FREEZE_MAX_TOKENS);
    expect(seeded.lastRolloverMonth).toBe('2026-07');
    expect(seeded.history).toEqual([]);
  });

  it('returns the stored bank when one exists', () => {
    const stored = bank({ tokens: 1 });
    expect(
      memberFreezeBank(household({ freezeBanksByMember: { [PAUL]: stored } }), PAUL),
    ).toBe(stored);
  });

  it('keeps members isolated — one member\'s bank never answers for another', () => {
    const h = household({ freezeBanksByMember: { [PAUL]: bank({ tokens: 0 }) } });
    expect(memberFreezeBank(h, PAUL).tokens).toBe(0);
    expect(memberFreezeBank(h, JEN).tokens).toBe(FREEZE_MAX_TOKENS);
  });
});

describe('visibleFreezeBank', () => {
  const shared = bank({ tokens: 2 });

  it('is the HOUSEHOLD bank in every shared mode, including the absent default', () => {
    expect(visibleFreezeBank(household(), shared, PAUL)).toBe(shared);
    expect(visibleFreezeBank(household({ freezeMode: 'shared' }), shared, PAUL)).toBe(shared);
    expect(visibleFreezeBank(household({ freezeMode: 'freeze_both' }), shared, PAUL)).toBe(shared);
  });

  it('is the acting member\'s own bank under per_member', () => {
    const mine = bank({ tokens: 1 });
    const h = household({ freezeMode: 'per_member', freezeBanksByMember: { [PAUL]: mine } });
    expect(visibleFreezeBank(h, shared, PAUL)).toBe(mine);
    expect(visibleFreezeBank(h, shared, JEN)!.tokens).toBe(FREEZE_MAX_TOKENS);
  });

  it('falls back to the household bank with no household doc or no acting member', () => {
    expect(visibleFreezeBank(null, shared, PAUL)).toBe(shared);
    expect(visibleFreezeBank(household({ freezeMode: 'per_member' }), shared, null)).toBe(shared);
  });
});

describe('memberFreezeBankPatch', () => {
  it('emits DOT PATHS scoped to one member — never a whole-map write', () => {
    const patch = memberFreezeBankPatch(PAUL, bank({ tokens: 1 }), { __arrayUnion: ['e1'] });
    expect(Object.keys(patch).sort()).toEqual([
      `freezeBanksByMember.${PAUL}.history`,
      `freezeBanksByMember.${PAUL}.lastRolloverDate`,
      `freezeBanksByMember.${PAUL}.lastRolloverMonth`,
      `freezeBanksByMember.${PAUL}.maxTokens`,
      `freezeBanksByMember.${PAUL}.tokens`,
    ]);
    // No key addresses the map itself, or any other member.
    for (const key of Object.keys(patch)) {
      expect(key.startsWith(`freezeBanksByMember.${PAUL}.`)).toBe(true);
    }
    expect(patch[`freezeBanksByMember.${PAUL}.tokens`]).toBe(1);
  });

  it('floors tokens at zero and omits history when no entry is supplied', () => {
    const patch = memberFreezeBankPatch(PAUL, bank({ tokens: -3 }));
    expect(patch[`freezeBanksByMember.${PAUL}.tokens`]).toBe(0);
    expect(`freezeBanksByMember.${PAUL}.history` in patch).toBe(false);
  });
});

describe('memberFreezeRefill', () => {
  const august = new Date('2026-08-03T09:00:00');

  it('is a no-op when the bank already rolled this month', () => {
    expect(memberFreezeRefill(PAUL, bank({ lastRolloverMonth: '2026-08' }), august, 'id')).toBeNull();
  });

  it('refills to the fixed max and logs the delta', () => {
    const refill = memberFreezeRefill(PAUL, bank({ tokens: 0 }), august, 'id-1');
    expect(refill!.bank.tokens).toBe(FREEZE_MAX_TOKENS);
    expect(refill!.bank.lastRolloverMonth).toBe('2026-08');
    expect(refill!.entry).toMatchObject({ id: 'id-1', type: 'rollover', amount: 2 });
  });

  it('clamps a legacy over-max bank down, labelling it honestly', () => {
    const refill = memberFreezeRefill(PAUL, bank({ tokens: 3, maxTokens: 3 }), august, 'id-2');
    expect(refill!.bank.tokens).toBe(FREEZE_MAX_TOKENS);
    expect(refill!.bank.maxTokens).toBe(FREEZE_MAX_TOKENS);
    expect(refill!.entry!.amount).toBe(-1);
    expect(refill!.entry!.notes).toContain('maximum');
  });

  it('writes no history entry when the bank is already full', () => {
    const refill = memberFreezeRefill(PAUL, bank({ tokens: 2 }), august, 'id-3');
    expect(refill!.entry).toBeNull();
    expect(refill!.bank.lastRolloverMonth).toBe('2026-08');
  });

  it('a freshly seeded bank needs no refill in the month it was seeded', () => {
    expect(memberFreezeRefill(PAUL, newMemberFreezeBank(august), august, 'id-4')).toBeNull();
  });
});
