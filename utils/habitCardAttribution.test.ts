import { describe, it, expect } from 'vitest';
import { Account, Habit } from '@/types/schema';
import {
  currentMemberPredicate,
  resolveCardFireAttribution,
} from '@/utils/habitCardAttribution';

/**
 * ATTR-1 — the rule deciding WHO a transaction-fired habit completion credits.
 *
 * The household-credit case is the one most likely to regress and the one with
 * the worst failure mode (blaming one spouse for the liquor store), so it is
 * asserted from several angles rather than once.
 */

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const GHOST = 'uid-departed';

const roster = currentMemberPredicate([{ uid: ALICE }, { uid: BOB }]);

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  title: 'Go into Target',
  category: 'Finance',
  type: 'negative',
  scoringType: 'incremental',
  period: 'daily',
  basePoints: 10,
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-08-01T00:00:00.000Z',
  ...over,
});

const account = (cardOwners?: Record<string, string>): Pick<Account, 'cardOwners'> =>
  cardOwners ? { cardOwners } : {};

const ALICES_CARD = account({ '8899': ALICE });

describe('resolveCardFireAttribution', () => {
  it('credits the owner of the card that produced the transaction', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit({ creditMode: 'members' }),
        account: ALICES_CARD,
        cardLast4: '8899',
        isCurrentMember: roster,
      }),
    ).toBe(ALICE);
  });

  it('credits the owner even when `creditMode` is absent (the default is per-member)', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: ALICES_CARD,
        cardLast4: '8899',
        isCurrentMember: roster,
      }),
    ).toBe(ALICE);
  });

  it('normalizes a masked card form, so "...8899" resolves like "8899"', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: ALICES_CARD,
        cardLast4: '...8899',
        isCurrentMember: roster,
      }),
    ).toBe(ALICE);
  });

  // 🏁 THE RULE MOST LIKELY TO REGRESS.
  it('credits NOBODY for a creditMode: "household" habit, whoever holds the card', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit({ title: 'Go to liquor store', creditMode: 'household' }),
        account: ALICES_CARD,
        cardLast4: '8899',
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it('household credit outranks a card owned by a perfectly valid member', () => {
    const shared = habit({ title: 'Grocery Store', creditMode: 'household' });
    const bobsCard = account({ '4444': BOB });
    expect(
      resolveCardFireAttribution({
        habit: shared, account: bobsCard, cardLast4: '4444', isCurrentMember: roster,
      }),
    ).toBeNull();
    // …and the SAME transaction still credits a per-member habit.
    expect(
      resolveCardFireAttribution({
        habit: habit({ creditMode: 'members' }),
        account: bobsCard, cardLast4: '4444', isCurrentMember: roster,
      }),
    ).toBe(BOB);
  });

  it('credits nobody for an ASSIGNED chore — creditMode is inert there', () => {
    for (const creditMode of ['household', 'members', undefined] as const) {
      expect(
        resolveCardFireAttribution({
          habit: habit({ assignedTo: BOB, ...(creditMode ? { creditMode } : {}) }),
          account: ALICES_CARD,
          cardLast4: '8899',
          isCurrentMember: roster,
        }),
      ).toBeNull();
    }
  });

  it('credits nobody when the card carries no owner tag', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: ALICES_CARD,
        cardLast4: '1234', // a different card on the same account
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it('credits nobody when the account has no cardOwners map at all', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(), account: account(), cardLast4: '8899', isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it('credits nobody when the transaction carries no cardLast4 (every legacy row)', () => {
    for (const cardLast4 of [undefined, null, '', 'no digits here']) {
      expect(
        resolveCardFireAttribution({
          habit: habit(), account: ALICES_CARD, cardLast4, isCurrentMember: roster,
        }),
      ).toBeNull();
    }
  });

  it('credits nobody when the account is missing entirely', () => {
    for (const acct of [undefined, null]) {
      expect(
        resolveCardFireAttribution({
          habit: habit(), account: acct, cardLast4: '8899', isCurrentMember: roster,
        }),
      ).toBeNull();
    }
  });

  // 🛡️ The security finding: `cardOwners` is member-writable and the accounts
  // rules carry no key allowlist, so the roster is the only authority.
  it('credits nobody when cardOwners names a uid that is NOT a current member', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: account({ '8899': GHOST }),
        cardLast4: '8899',
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });

  it('credits nobody when cardOwners holds arbitrary junk rather than a uid', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: account({ '8899': 'not-a-uid-at-all' }),
        cardLast4: '8899',
        isCurrentMember: roster,
      }),
    ).toBeNull();
  });
});

describe('currentMemberPredicate', () => {
  it('recognises every uid on the roster and nothing else', () => {
    const isMember = currentMemberPredicate([{ uid: ALICE }, { uid: BOB }]);
    expect(isMember(ALICE)).toBe(true);
    expect(isMember(BOB)).toBe(true);
    expect(isMember(GHOST)).toBe(false);
    expect(isMember('')).toBe(false);
  });

  // 🛡️ Fails CLOSED, deliberately unlike `useHabitActions`' `isLiveMember`:
  // an unknown roster must credit nobody rather than trust an unvalidated map.
  it('credits nobody when the roster is empty, absent or null', () => {
    for (const members of [[], undefined, null]) {
      expect(currentMemberPredicate(members)(ALICE)).toBe(false);
    }
  });

  it('a fail-closed roster makes the whole resolver decline', () => {
    expect(
      resolveCardFireAttribution({
        habit: habit(),
        account: ALICES_CARD,
        cardLast4: '8899',
        isCurrentMember: currentMemberPredicate([]),
      }),
    ).toBeNull();
  });
});
