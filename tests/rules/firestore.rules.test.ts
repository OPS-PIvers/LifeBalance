/**
 * Firestore Security Rules unit tests.
 *
 * These run against the Firestore emulator (started by `pnpm test:rules`, which
 * wraps this suite in `firebase emulators:exec --only firestore`). They load the
 * real `firestore.rules` from the repo root and assert the security-critical
 * properties of the rule set so that a future rules change can't silently open a
 * hole. A bad rules deploy makes ALL household data unreadable (the deploy is
 * atomic with no staging — see plans/PRD.md §2), so this is the guardrail that
 * must pass before any `firestore.rules` edit reaches `main`.
 *
 * Run:  pnpm test:rules
 *
 * Convention: test globals are imported explicitly from 'vitest' (matching the
 * rest of the suite) rather than relying on `globals: true`, so `tsc --noEmit`
 * stays clean under the project's strict config.
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';

// The emulator treats any `demo-*` project as offline-only (no real credentials,
// never touches production). Must match the --project flag in `test:rules`.
const PROJECT_ID = 'demo-lifebalance';
const HOST = '127.0.0.1';
const PORT = 8080;

// --- Test principals -------------------------------------------------------
const ALICE = 'alice-uid'; // admin + member of H1
const BOB = 'bob-uid'; //   plain member of H1
const CAROL = 'carol-uid'; // member of H2 (a different household)
const DAVE = 'dave-uid'; //  authenticated but belongs to no household
const KID = 'kid-leo'; //   managed (login-less) child profile in H1 — never in memberUids

const H1 = 'household-1';
const H2 = 'household-2';
const INVITE_CODE = 'INVITE1'; // resolves to H1
const FIXED_DATE = '2026-06-22'; // stable date string for aiUsage assertions

let testEnv: RulesTestEnvironment;

// rules-unit-testing@5's RulesTestContext.firestore() is *typed* as the legacy
// compat `firebase.firestore.Firestore`, but at runtime it returns a modular
// Firestore that the app's `firebase/firestore` functions (doc/setDoc/...)
// operate on directly — this is the documented v9 usage pattern. The compat and
// modular declarations don't structurally overlap, so bridge the type once here
// at the boundary; the runtime object is the right one.
type EmulatorFirestore = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;
function asFirestore(db: EmulatorFirestore): Firestore {
  return db as unknown as Firestore;
}

/** Firestore handle for a given principal (null uid = unauthenticated). */
function dbFor(uid: string | null): Firestore {
  const context = uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext();
  return asFirestore(context.firestore());
}

/** Seed baseline data with rules bypassed, so each test starts from a known state. */
async function seed(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = asFirestore(ctx.firestore());

    await setDoc(doc(db, 'households', H1), {
      name: 'Test Household',
      memberUids: [ALICE, BOB],
      createdBy: ALICE,
      inviteCode: INVITE_CODE,
      createdAt: '2026-01-01T00:00:00.000Z',
      aiUsage: { dailyCount: 2, lastResetDate: FIXED_DATE },
    });
    await setDoc(doc(db, 'households', H1, 'members', ALICE), {
      displayName: 'Alice',
      role: 'admin',
    });
    await setDoc(doc(db, 'households', H1, 'members', BOB), {
      displayName: 'Bob',
      role: 'member',
    });
    // Plan 080: a login-less managed kid profile (in the members subcollection but
    // NOT in memberUids, so it holds no household credential).
    await setDoc(doc(db, 'households', H1, 'members', KID), {
      uid: KID,
      displayName: 'Leo',
      role: 'kid',
      isManaged: true,
      managedByUid: ALICE,
      points: { daily: 0, weekly: 0, total: 0 },
      allowanceCents: 0,
    });
    await setDoc(doc(db, 'households', H1, 'transactions', 'txn-seed'), {
      amount: 10,
      merchant: 'Seed Store',
      category: 'Groceries',
      date: '2026-06-01',
      status: 'verified',
    });
    await setDoc(doc(db, 'households', H1, 'apiKeys', 'key-seed'), {
      hashedKey: 'hash',
      keyPrefix: 'lb_pre',
      name: 'iOS Shortcut',
      status: 'active',
      permissions: ['habit'],
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: ALICE,
      usageCount: 0,
    });

    await setDoc(doc(db, 'households', H2), {
      name: 'Other Household',
      memberUids: [CAROL],
      createdBy: CAROL,
      inviteCode: 'OTHER1',
    });
    await setDoc(doc(db, 'households', H2, 'members', CAROL), {
      displayName: 'Carol',
      role: 'admin',
    });

    await setDoc(doc(db, 'inviteCodes', INVITE_CODE), { householdId: H1 });
  });
}

beforeAll(async () => {
  // Silence the noisy "permission denied" Firestore logs that assertFails expects.
  setLogLevel('error');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      // Resolve relative to cwd (the repo root, where `pnpm test:rules` runs).
      rules: readFileSync('firestore.rules', 'utf8'),
      host: HOST,
      port: PORT,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

describe('unauthenticated access', () => {
  it('cannot read a household document', async () => {
    await assertFails(getDoc(doc(dbFor(null), 'households', H1)));
  });

  it('cannot read a household subcollection (transactions)', async () => {
    await assertFails(
      getDoc(doc(dbFor(null), 'households', H1, 'transactions', 'txn-seed')),
    );
  });

  it('cannot write a habit', async () => {
    await assertFails(
      setDoc(doc(dbFor(null), 'households', H1, 'habits', 'h'), {
        title: 'Read',
        category: 'Health',
      }),
    );
  });
});

describe('non-member access (authenticated, no membership)', () => {
  it('cannot read the household document', async () => {
    await assertFails(getDoc(doc(dbFor(DAVE), 'households', H1)));
  });

  it('cannot read household transactions', async () => {
    await assertFails(
      getDoc(doc(dbFor(DAVE), 'households', H1, 'transactions', 'txn-seed')),
    );
  });

  it('cannot create a habit in a household it does not belong to', async () => {
    await assertFails(
      setDoc(doc(dbFor(DAVE), 'households', H1, 'habits', 'h'), {
        title: 'Sneaky',
        category: 'Health',
      }),
    );
  });

  it('cannot read an arbitrary (catch-all) subcollection', async () => {
    await assertFails(getDoc(doc(dbFor(DAVE), 'households', H1, 'lists', 'x')));
  });
});

describe('cross-household isolation', () => {
  it("a member of H2 cannot read H1's household document", async () => {
    await assertFails(getDoc(doc(dbFor(CAROL), 'households', H1)));
  });

  it("a member of H2 cannot read H1's transactions", async () => {
    await assertFails(
      getDoc(doc(dbFor(CAROL), 'households', H1, 'transactions', 'txn-seed')),
    );
  });
});

describe('member access', () => {
  it('can read its own household document', async () => {
    await assertSucceeds(getDoc(doc(dbFor(BOB), 'households', H1)));
  });

  it('can read household transactions', async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'txn-seed')),
    );
  });

  it('can read a generic (catch-all) subcollection', async () => {
    await assertSucceeds(getDoc(doc(dbFor(BOB), 'households', H1, 'lists', 'x')));
  });

  it('can create a well-formed transaction', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'txn-new'), {
        amount: 25.5,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: '2026-06-22',
        status: 'pending_review',
      }),
    );
  });

  it('can create a transaction carrying possibleDuplicateOf (Plan 03 dedup flag)', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'txn-possible-dup'), {
        amount: 25.5,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: '2026-06-22',
        status: 'pending_review',
        possibleDuplicateOf: 'txn-seed',
      }),
    );
  });

  it('rejects a transaction whose possibleDuplicateOf is its own id', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'txn-self-dup'), {
        amount: 25.5,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: '2026-06-22',
        status: 'pending_review',
        possibleDuplicateOf: 'txn-self-dup',
      }),
    );
  });

  it('rejects a transaction whose possibleDuplicateOf exceeds the length cap', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'txn-bad-dup'), {
        amount: 25.5,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: '2026-06-22',
        status: 'pending_review',
        possibleDuplicateOf: 'x'.repeat(101),
      }),
    );
  });

  it('can create a well-formed habit', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-new'), {
        title: 'Read 30 minutes',
        category: 'Health',
      }),
    );
  });
});

describe('subscription writes (Plan 051 — entitlement is server-truth)', () => {
  // Only the Stripe webhook (Admin SDK, which bypasses these rules) may set the
  // `subscription` block. No client write may add or change it, or a user could
  // trivially unlock premium by editing their own household document.
  const PREMIUM = { plan: 'premium', status: 'active' };

  it('denies a member adding a subscription via household update', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1), { subscription: PREMIUM }),
    );
  });

  it('denies even an admin changing subscription via household update', async () => {
    await assertFails(
      updateDoc(doc(dbFor(ALICE), 'households', H1), { subscription: PREMIUM }),
    );
  });

  it('still allows a normal household update that does not touch subscription', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1), { name: 'Renamed Household' }),
    );
  });

  it('denies creating a household pre-loaded with a subscription', async () => {
    await assertFails(
      setDoc(doc(dbFor(DAVE), 'households', 'dave-house'), {
        name: 'Dave House',
        subscription: PREMIUM,
      }),
    );
  });

  it('still allows creating a household without a subscription', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(DAVE), 'households', 'dave-house-2'), { name: 'Dave House' }),
    );
  });
});

describe('member cap (Plan 051 — server-side, billing-gated, grandfathered)', () => {
  const PREMIUM = { plan: 'premium', status: 'active' };

  // Seed DAVE as a real member doc in H1 so isMemberOf(DAVE) holds, letting DAVE
  // add himself to memberUids — the growth vector the cap guards. H1 seeds
  // memberUids [ALICE, BOB] = exactly the free cap of 2, so adding DAVE = 3.
  async function seedDaveMember(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'members', DAVE), {
        displayName: 'Dave',
        role: 'member',
      });
    });
  }
  async function setBilling(enabled: boolean): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'app_config', 'global'), { billingEnabled: enabled });
    });
  }
  async function setHouseholdSubscription(sub: object): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1), { subscription: sub }, { merge: true });
    });
  }

  it('billing dormant: a 3rd member can be added (no enforcement — current prod behavior)', async () => {
    await seedDaveMember();
    // No app_config/global doc → billingLive() is false → cap is inert.
    await assertSucceeds(
      updateDoc(doc(dbFor(DAVE), 'households', H1), { memberUids: [ALICE, BOB, DAVE] }),
    );
  });

  it('billing live + free plan at cap: adding a 3rd member is denied', async () => {
    await seedDaveMember();
    await setBilling(true);
    await assertFails(
      updateDoc(doc(dbFor(DAVE), 'households', H1), { memberUids: [ALICE, BOB, DAVE] }),
    );
  });

  it('billing live + premium plan: adding a 3rd member is allowed (cap 20)', async () => {
    await seedDaveMember();
    await setBilling(true);
    await setHouseholdSubscription(PREMIUM);
    await assertSucceeds(
      updateDoc(doc(dbFor(DAVE), 'households', H1), { memberUids: [ALICE, BOB, DAVE] }),
    );
  });

  it('billing live + subscription explicitly null: treated as free (no rule error)', async () => {
    // Guards the null-parent path: get(['subscription','plan']) must resolve to the
    // free cap rather than erroring on a null `subscription` map.
    await seedDaveMember();
    await setBilling(true);
    await setHouseholdSubscription(null as unknown as object);
    await assertFails(
      updateDoc(doc(dbFor(DAVE), 'households', H1), { memberUids: [ALICE, BOB, DAVE] }),
    );
  });

  it('billing live + free plan: a non-growth update (rename) still succeeds', async () => {
    await setBilling(true);
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1), { name: 'Renamed Household' }),
    );
  });

  it('billing live: an already-over-cap household can still shrink (grandfathered)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(
        doc(db, 'households', H1),
        { memberUids: [ALICE, BOB, DAVE] },
        { merge: true },
      );
      await setDoc(doc(db, 'households', H1, 'members', DAVE), {
        displayName: 'Dave',
        role: 'member',
      });
    });
    await setBilling(true);
    // DAVE removes himself: newSize (2) <= oldSize (3) → allowed despite being over cap.
    await assertSucceeds(
      updateDoc(doc(dbFor(DAVE), 'households', H1), { memberUids: [ALICE, BOB] }),
    );
  });
});

describe('input validation', () => {
  it('rejects a transaction with a non-numeric amount', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'bad-amount'), {
        amount: 'twenty',
        merchant: 'Store',
        category: 'Misc',
        date: '2026-06-22',
      }),
    );
  });

  it('rejects a transaction missing the required merchant field', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'transactions', 'no-merchant'), {
        amount: 5,
        category: 'Misc',
        date: '2026-06-22',
      }),
    );
  });

  it('rejects a habit whose title exceeds the length cap', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'too-long'), {
        title: 'x'.repeat(101),
        category: 'Health',
      }),
    );
  });
});

describe('privilege-escalation prevention', () => {
  it('a member cannot promote themselves to admin', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        role: 'admin',
      }),
    );
  });

  it('a member can update their own display name', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        displayName: 'Bobby',
      }),
    );
  });

  it('an admin can change another member’s role', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(ALICE), 'households', H1, 'members', BOB), {
        role: 'admin',
      }),
    );
  });
});

describe('immutable household fields', () => {
  it('a member cannot rewrite createdBy', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1), { createdBy: BOB }),
    );
  });

  it('a member cannot rewrite the invite code', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1), { inviteCode: 'HACKED' }),
    );
  });
});

describe('AI usage quota integrity', () => {
  it('allows incrementing the daily count by exactly one', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1), {
        aiUsage: { dailyCount: 3, lastResetDate: FIXED_DATE },
      }),
    );
  });

  it('denies jumping the daily count by more than one', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1), {
        aiUsage: { dailyCount: 99, lastResetDate: FIXED_DATE },
      }),
    );
  });
});

describe('API keys are admin-only', () => {
  it('a non-admin member cannot read API keys', async () => {
    await assertFails(
      getDoc(doc(dbFor(BOB), 'households', H1, 'apiKeys', 'key-seed')),
    );
  });

  it('an admin can read API keys', async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(ALICE), 'households', H1, 'apiKeys', 'key-seed')),
    );
  });
});

describe('invite codes', () => {
  it('an authenticated user can fetch a single invite code by id', async () => {
    await assertSucceeds(getDoc(doc(dbFor(DAVE), 'inviteCodes', INVITE_CODE)));
  });

  it('listing/enumerating invite codes is denied', async () => {
    await assertFails(getDocs(collection(dbFor(DAVE), 'inviteCodes')));
  });

  it('invite codes cannot be modified', async () => {
    await assertFails(
      updateDoc(doc(dbFor(ALICE), 'inviteCodes', INVITE_CODE), {
        householdId: H2,
      }),
    );
  });
});

describe('joining via invite code', () => {
  it('a new user can join as a non-admin member with a valid invite code', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(DAVE), 'households', H1, 'members', DAVE), {
        displayName: 'Dave',
        role: 'member',
        inviteCode: INVITE_CODE,
      }),
    );
  });

  it('a new user cannot self-assign the admin role while joining', async () => {
    await assertFails(
      setDoc(doc(dbFor(DAVE), 'households', H1, 'members', DAVE), {
        displayName: 'Dave',
        role: 'admin',
        inviteCode: INVITE_CODE,
      }),
    );
  });
});

describe('rewards (Plan 080d — additive Kid-Mode reward fields)', () => {
  // The reward rule's isValidReward() was expanded additively to permit the
  // optional kid-reward fields (type/allowanceCents/targetMemberId/active)
  // alongside the original 4. Ownership (createdBy == auth.uid) and the
  // create-time hasOnly() allow-list are still enforced.
  it('a member can create a reward with the new kid fields', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-allowance'), {
        title: '$5 Allowance',
        cost: 100,
        icon: 'piggy-bank',
        createdBy: BOB,
        type: 'allowance',
        allowanceCents: 500,
        targetMemberId: KID,
        active: true,
      }),
    );
  });

  it('a legacy 4-field reward still validates', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-legacy'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
      }),
    );
  });

  it('a reward with a stray unlisted field is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-stray'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        junkField: 'nope',
      }),
    );
  });

  it('a reward whose createdBy is not the caller is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-spoof'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: ALICE,
      }),
    );
  });

  it('a reward with an invalid type is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-bogus-type'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        type: 'bogus',
      }),
    );
  });

  it('a reward with a non-numeric allowanceCents is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-bad-cents'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        type: 'allowance',
        allowanceCents: 'lots', // not a number → isValidOptionalNumber fails
      }),
    );
  });

  it('a reward with a non-bool active is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-bad-active'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        active: 'yes', // not a bool → `active is bool` fails
      }),
    );
  });

  it('a reward with an over-128-char targetMemberId is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-long-target'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        targetMemberId: 'k'.repeat(129), // exceeds the 128-char optional-string cap
      }),
    );
  });

  it('a member can update an existing reward’s active/type', async () => {
    // Seed a reward (rules-allowed create), then mutate the additive kid fields.
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-upd'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        type: 'realWorld',
        active: true,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-upd'), {
        type: 'allowance',
        active: false,
      }),
    );
  });

  it('an update that changes createdBy is rejected (immutable)', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-immutable'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
      }),
    );
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-immutable'), {
        createdBy: ALICE, // touching the immutable owner field → rejected
      }),
    );
  });
});

describe('managed kid profiles (Plan 080 — login-less child member docs)', () => {
  // A kid is a member doc (role 'kid', isManaged true) a PARENT creates and
  // manages. It is never added to memberUids, so it holds no household credential.
  const newKid = {
    uid: 'kid-mia',
    displayName: 'Mia',
    role: 'kid',
    isManaged: true,
    managedByUid: BOB,
    points: { daily: 0, weekly: 0, total: 0 },
    allowanceCents: 0,
  };

  it('a parent (plain member) can create a managed kid profile', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'members', 'kid-mia'), newKid),
    );
  });

  it('a parent can update a kid’s points', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
        points: { daily: 5, weekly: 5, total: 5 },
      }),
    );
  });

  it('a parent can rename a kid profile', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
        displayName: 'Leo the Great',
      }),
    );
  });

  it('a parent can remove a kid profile', async () => {
    await assertSucceeds(
      deleteDoc(doc(dbFor(BOB), 'households', H1, 'members', KID)),
    );
  });

  it('a non-member (other household) cannot create a kid here', async () => {
    // Override uid to match the path so the failure is specifically authorization,
    // not the new uid==memberId check.
    await assertFails(
      setDoc(doc(dbFor(CAROL), 'households', H1, 'members', 'kid-x'), { ...newKid, uid: 'kid-x' }),
    );
  });

  it('the kid path cannot forge a real member doc for someone else', async () => {
    // role 'member' + isManaged false → not a managed-kid create; and memberId is
    // not the caller, so the self-create path does not apply either.
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'members', 'victim-uid'), {
        displayName: 'Victim',
        role: 'member',
        isManaged: false,
      }),
    );
  });

  it('the kid path cannot mint an admin member', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'members', 'fake-admin'), {
        displayName: 'Sneaky',
        role: 'admin',
        isManaged: true,
        points: { daily: 0, weekly: 0, total: 0 },
      }),
    );
  });

  it('a parent cannot escalate a kid into an admin', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
        role: 'admin',
      }),
    );
  });

  it('a parent cannot un-manage a kid (flip isManaged off)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
        isManaged: false,
      }),
    );
  });

  it('a kid id is not in memberUids, so it cannot read the household document', async () => {
    // Even if a principal somehow authenticated as the kid's id, the household-doc
    // read gate is `uid in memberUids`, which the kid is never part of.
    await assertFails(getDoc(doc(dbFor(KID), 'households', H1)));
  });

  // Plan 080a-1b hardening (gemini-code-assist review on #680): uid integrity,
  // immutability of uid/joinedAt, and no stray keys on managed-kid writes.
  it('rejects a kid create whose uid field does not match the doc id', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'members', 'kid-mia'), { ...newKid, uid: 'kid-mismatched' }),
    );
  });

  it('a parent cannot change a kid’s uid', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), { uid: 'kid-hacked' }),
    );
  });

  it('a parent cannot write a stray field to a kid doc', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), { junkField: 'nope' }),
    );
  });
});

describe('server-only collections', () => {
  it('clients cannot create pendingItems (voice-command intake is Admin-SDK only)', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'pendingItems', 'p'), {
        text: 'buy milk',
        source: 'voice',
        processed: false,
      }),
    );
  });
});

describe('recaps (weekly recap docs — written only by Cloud Functions)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'recaps', '2026-W25'), {
        weekOf: '2026-W25',
        summary: 'Great week!',
        createdAt: '2026-06-22T00:00:00.000Z',
      });
    });
  });

  it('a household member can read a recap doc', async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(BOB), 'households', H1, 'recaps', '2026-W25')),
    );
  });

  it('a member cannot create a recap doc', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'recaps', '2026-W26'), {
        weekOf: '2026-W26',
        summary: 'Sneaky client write',
      }),
    );
  });

  it('a member cannot update a recap doc', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'recaps', '2026-W25'), {
        summary: 'Edited by client',
      }),
    );
  });

  it('a member cannot delete a recap doc', async () => {
    await assertFails(
      deleteDoc(doc(dbFor(BOB), 'households', H1, 'recaps', '2026-W25')),
    );
  });

  it('a non-member cannot read a recap doc', async () => {
    await assertFails(
      getDoc(doc(dbFor(CAROL), 'households', H1, 'recaps', '2026-W25')),
    );
  });
});

describe('savings goals (Plan 24 — sinking funds, decoupled from Safe-to-Spend)', () => {
  const GOAL = 'goal-seed';
  const ISO = '2026-06-22T00:00:00.000Z';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'savingsGoals', GOAL), {
        name: 'Vacation',
        targetAmount: 1000,
        savedAmount: 100,
        createdAt: ISO,
      });
    });
  });

  it('a member can read a savings goal', async () => {
    await assertSucceeds(
      getDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', GOAL)),
    );
  });

  it('a member can create a well-formed savings goal', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', 'goal-new'), {
        name: 'New Car',
        targetAmount: 5000,
        savedAmount: 0,
        createdAt: ISO,
      }),
    );
  });

  it('rejects a create with a negative targetAmount', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', 'goal-bad'), {
        name: 'Bad Goal',
        targetAmount: -5,
        savedAmount: 0,
        createdAt: ISO,
      }),
    );
  });

  it('rejects a create carrying an unknown field (storage abuse)', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', 'goal-extra'), {
        name: 'Sneaky',
        targetAmount: 100,
        savedAmount: 0,
        createdAt: ISO,
        injected: 'x'.repeat(5000),
      }),
    );
  });

  it('a member can contribute (update savedAmount)', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', GOAL), {
        savedAmount: 250,
      }),
    );
  });

  it('rejects mutating the immutable createdAt', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', GOAL), {
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
    );
  });

  it('rejects an update carrying an unknown field (storage abuse)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', GOAL), {
        injected: 'x'.repeat(5000),
      }),
    );
  });

  it('a member can delete a savings goal', async () => {
    await assertSucceeds(
      deleteDoc(doc(dbFor(BOB), 'households', H1, 'savingsGoals', GOAL)),
    );
  });

  it('a non-member cannot read a savings goal in another household', async () => {
    await assertFails(
      getDoc(doc(dbFor(CAROL), 'households', H1, 'savingsGoals', GOAL)),
    );
  });

  it('a non-member cannot write a savings goal in another household', async () => {
    await assertFails(
      updateDoc(doc(dbFor(CAROL), 'households', H1, 'savingsGoals', GOAL), {
        savedAmount: 999,
      }),
    );
  });
});

describe('transaction comments (Plan 23 — author-only, nested under a transaction)', () => {
  const TXN = 'txn-seed'; // seeded by seed()
  const COMMENT = 'comment-seed';
  const ISO = '2026-06-22T00:00:00.000Z';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(
        doc(db, 'households', H1, 'transactions', TXN, 'comments', COMMENT),
        { authorUid: BOB, text: 'Seeded comment', createdAt: ISO },
      );
    });
  });

  it('a member can read comments on a transaction', async () => {
    await assertSucceeds(
      getDocs(
        collection(dbFor(ALICE), 'households', H1, 'transactions', TXN, 'comments'),
      ),
    );
  });

  it('a member can post a comment authored by themselves', async () => {
    await assertSucceeds(
      setDoc(
        doc(dbFor(ALICE), 'households', H1, 'transactions', TXN, 'comments', 'c-new'),
        { authorUid: ALICE, text: 'Looks right to me', createdAt: ISO },
      ),
    );
  });

  it('rejects posting a comment attributed to someone else', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(BOB), 'households', H1, 'transactions', TXN, 'comments', 'c-spoof'),
        { authorUid: ALICE, text: 'Not really Alice', createdAt: ISO },
      ),
    );
  });

  it('rejects a comment whose text exceeds 500 chars', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(BOB), 'households', H1, 'transactions', TXN, 'comments', 'c-long'),
        { authorUid: BOB, text: 'x'.repeat(501), createdAt: ISO },
      ),
    );
  });

  it('rejects a comment carrying an unknown field (storage abuse)', async () => {
    await assertFails(
      setDoc(
        doc(dbFor(BOB), 'households', H1, 'transactions', TXN, 'comments', 'c-extra'),
        { authorUid: BOB, text: 'hi', createdAt: ISO, injected: 'y'.repeat(5000) },
      ),
    );
  });

  it('comments are immutable — no update path', async () => {
    await assertFails(
      updateDoc(
        doc(dbFor(BOB), 'households', H1, 'transactions', TXN, 'comments', COMMENT),
        { text: 'edited' },
      ),
    );
  });

  it('the author can delete their own comment', async () => {
    await assertSucceeds(
      deleteDoc(
        doc(dbFor(BOB), 'households', H1, 'transactions', TXN, 'comments', COMMENT),
      ),
    );
  });

  it('a non-author member cannot delete the comment', async () => {
    await assertFails(
      deleteDoc(
        doc(dbFor(ALICE), 'households', H1, 'transactions', TXN, 'comments', COMMENT),
      ),
    );
  });

  it('a non-member cannot read comments in another household', async () => {
    await assertFails(
      getDocs(
        collection(dbFor(CAROL), 'households', H1, 'transactions', TXN, 'comments'),
      ),
    );
  });
});

describe('todos (Eisenhower importance + shared notes — additive optional fields)', () => {
  const TODO = 'todo-seed';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'todos', TODO), {
        text: 'Take out the trash',
        completeByDate: '2026-06-22',
        isCompleted: false,
        assignedTo: BOB,
        createdBy: BOB,
      });
    });
  });

  // Regression: the `isImportant` star-toggle field was absent from the todos
  // hasOnly() whitelist, so every create/update carrying it was rejected with
  // "Failed to save to-do." Both create and update must now accept it.
  it('a member can create an important to-do (isImportant: true)', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'todos', 'todo-important'), {
        text: 'Pay rent',
        completeByDate: '2026-07-01',
        isCompleted: false,
        assignedTo: BOB,
        isImportant: true,
        createdBy: BOB,
      }),
    );
  });

  it('a member can toggle importance on an existing to-do', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        isImportant: true,
      }),
    );
  });

  it('rejects a non-boolean isImportant', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        isImportant: 'yes',
      }),
    );
  });

  it('a member can save shared notes on a to-do', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        notes: 'Bins go out Tuesday night',
      }),
    );
  });

  it('rejects notes exceeding the 1000-char cap', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        notes: 'x'.repeat(1001),
      }),
    );
  });

  it('a member can set managed-kid completion points', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        points: 5,
      }),
    );
  });

  it('rejects an update carrying an unknown field (storage abuse)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        injected: 'x'.repeat(5000),
      }),
    );
  });
});
