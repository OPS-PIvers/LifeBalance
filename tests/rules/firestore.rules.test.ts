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
  arrayUnion,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
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

// 2G.1: dashboardLayout/dashboardHidden (F-XCUT-02) and anyNotificationsEnabled were added to
// HouseholdMember but never added to the self-update allowlist. changedKeys() excludes
// newly-ADDED keys (they land in addedKeys()), so a member's FIRST write of a field succeeds
// vacuously even when the field is missing from the allowlist — only a SECOND write (a change)
// actually exercises the allowlist. Every pair below proves both halves: the add (which passed
// even on the old, broken rules) and the change (which is the actual regression).
describe('member self-update allowlist (2G.1 — dashboard/notification fields)', () => {
  it('a non-admin can add dashboardLayout/dashboardHidden for the first time', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        dashboardLayout: ['streak', 'calendar'],
        dashboardHidden: ['weather'],
      }),
    );
  });

  it('a non-admin can change an existing dashboardLayout/dashboardHidden', async () => {
    const bobDb = dbFor(BOB);
    const bobRef = doc(bobDb, 'households', H1, 'members', BOB);
    await assertSucceeds(
      updateDoc(bobRef, {
        dashboardLayout: ['streak', 'calendar'],
        dashboardHidden: ['weather'],
      }),
    );
    await assertSucceeds(
      updateDoc(bobRef, {
        dashboardLayout: ['calendar', 'streak'],
        dashboardHidden: [],
      }),
    );
  });

  it('a non-admin can add then change anyNotificationsEnabled', async () => {
    const bobDb = dbFor(BOB);
    const bobRef = doc(bobDb, 'households', H1, 'members', BOB);
    await assertSucceeds(updateDoc(bobRef, { anyNotificationsEnabled: true }));
    await assertSucceeds(updateDoc(bobRef, { anyNotificationsEnabled: false }));
  });

  // Forward-add for the not-yet-shipped 2F.1/2F.2 member-visibility feature (no TypeScript
  // field exists yet) — allowlisting now means that feature ships with no rules PR later.
  it('a non-admin can add then change hiddenKeys and homeScreen', async () => {
    const bobDb = dbFor(BOB);
    const bobRef = doc(bobDb, 'households', H1, 'members', BOB);
    await assertSucceeds(
      updateDoc(bobRef, { hiddenKeys: ['todos'], homeScreen: 'money' }),
    );
    await assertSucceeds(
      updateDoc(bobRef, { hiddenKeys: ['todos', 'meals'], homeScreen: 'habits' }),
    );
  });

  it('a non-admin updating only displayName (none of the five fields present) still succeeds', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        displayName: 'Bobby',
      }),
    );
  });

  // Validation for the five newly-allowlisted fields: allowlisting a key is not the same as
  // validating it. Without a type/size check, the allowlist alone would let a member bloat
  // their own member doc toward Firestore's 1MiB cap — and because the members collection is
  // synced to every device in the household via onSnapshot, that cost lands on everyone, not
  // just the writer.
  it('rejects an oversized homeScreen string', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        homeScreen: 'x'.repeat(65),
      }),
    );
  });

  it('rejects an over-cap dashboardLayout list', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        dashboardLayout: Array(101).fill('x'),
      }),
    );
  });

  it('rejects an over-cap hiddenKeys list', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        hiddenKeys: Array(101).fill('x'),
      }),
    );
  });

  it('rejects a non-list dashboardLayout', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        dashboardLayout: 'nope',
      }),
    );
  });

  it('rejects a non-bool anyNotificationsEnabled', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        anyNotificationsEnabled: 'yes',
      }),
    );
  });

  it('a non-admin still cannot write a genuinely forbidden key (role)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        role: 'admin',
      }),
    );
  });

  // Escalation regressions: BOB's seeded doc is exactly { displayName, role } (see seed()
  // above), so each of these keys is ABSENT — a first-time ADD. Under changedKeys(), an add
  // of an absent key produces an EMPTY changed-keys set, so hasOnly() passed vacuously and the
  // write was allowed regardless of the allowlist. affectedKeys() closes that hole: the add is
  // now governed by the same allowlist as a change. These must all still fail post-fix.
  //
  // NOTE: 'points' USED to be one of these cases. Per-member habit points added a
  // deliberate, tightly-bounded exception (Case 4 in firestore.rules) — see the
  // dedicated describe block below, which pins both what it now allows and every
  // escalation it must still refuse.
  it('a non-admin cannot ADD allowanceCents for the first time (escalation regression)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        allowanceCents: 100000,
      }),
    );
  });

  it('a non-admin cannot ADD isManaged/managedByUid for the first time (escalation regression)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        isManaged: true,
        managedByUid: BOB,
      }),
    );
  });

  it('a non-admin cannot ADD an arbitrary junk key (storage-abuse regression)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        someUnknownField: 'x'.repeat(1000),
      }),
    );
  });

  it('a non-admin cannot REMOVE an existing field via deleteField (escalation regression)', async () => {
    // deleteField() puts the key in removedKeys(); affectedKeys() is the union of
    // added/changed/removed, so a removal of 'role' must be denied exactly like a change to it
    // would be — even though 'role' is never in the self-update allowlist.
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        role: deleteField(),
      }),
    );
  });
});

// Per-member habit points (stage 1). A completion is credited by whoever taps, on
// whichever phone, so ANY member must be able to move ANY member's points — and
// the midnight rollover writes every member's daily/weekly from whichever device
// is awake. Case 4 in firestore.rules grants exactly that and nothing else.
//
// Every test here runs as BOB, a PLAIN (non-admin) member: ALICE is an admin and
// Case 2 (isAdminOf) is a blanket bypass, so testing as her would prove nothing.
describe('per-member points writes (non-admin)', () => {
  it('a member can credit their OWN points', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        points: { daily: 10, weekly: 10, total: 10 },
      }),
    );
  });

  it("a member can credit ANOTHER member's points (Paul's phone credits Jen)", async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 10, weekly: 10, total: 10 },
      }),
    );
  });

  it('a member can stamp the per-member reset markers alongside points', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 0, weekly: 25, total: 100 },
        lastDailyPointsReset: FIXED_DATE,
        lastWeeklyPointsReset: FIXED_DATE,
      }),
    );
  });

  it('a member of ANOTHER household still cannot touch these points', async () => {
    await assertFails(
      updateDoc(doc(dbFor(CAROL), 'households', H1, 'members', BOB), {
        points: { daily: 999, weekly: 999, total: 999 },
      }),
    );
  });

  it('rejects a non-numeric points bucket', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 'lots', weekly: 1, total: 1 },
      }),
    );
  });

  it('rejects a non-map points value', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: 999,
      }),
    );
  });

  it('rejects an oversized reset marker', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 1, weekly: 1, total: 1 },
        lastDailyPointsReset: 'x'.repeat(11),
      }),
    );
  });

  // The grant is bounded by the KEY SET, so smuggling a privileged field into the
  // same write must fail even though 'points' itself is now allowed. Each of these
  // keys is ABSENT from BOB's seeded doc, so they are first-time ADDs — the exact
  // shape that slipped through changedKeys() before affectedKeys() replaced it.
  it('cannot smuggle role into a points write', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        points: { daily: 1, weekly: 1, total: 1 },
        role: 'admin',
      }),
    );
  });

  it('cannot smuggle allowanceCents into a points write', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 1, weekly: 1, total: 1 },
        allowanceCents: 100000,
      }),
    );
  });

  it('cannot smuggle isManaged/managedByUid into a points write', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 1, weekly: 1, total: 1 },
        isManaged: true,
        managedByUid: BOB,
      }),
    );
  });

  it('cannot smuggle an arbitrary junk key into a points write', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', ALICE), {
        points: { daily: 1, weekly: 1, total: 1 },
        someUnknownField: 'x'.repeat(1000),
      }),
    );
  });

  it('cannot remove a privileged field alongside a points write', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'members', BOB), {
        points: { daily: 1, weekly: 1, total: 1 },
        role: deleteField(),
      }),
    );
  });
});

// `completedBy` (date → member uid → count) rides the SAME habit writes
// `completedDates` always has, so the habits rule needs no new grant — only a
// type guard so the field can't be turned into something no reader survives.
describe('habit completedBy attribution', () => {
  const habitDoc = {
    title: 'Exercise',
    category: 'Health',
    count: 1,
    totalCount: 1,
    completedDates: ['2026-06-22'],
  };

  it('a member can write attribution alongside completedDates', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-attr'), {
        ...habitDoc,
        completedBy: { '2026-06-22': { [BOB]: 1, [ALICE]: 2 } },
      }),
    );
  });

  it('a member can credit another member on an existing habit', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(asFirestore(ctx.firestore()), 'households', H1, 'habits', 'habit-attr2'),
        habitDoc,
      );
    });
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-attr2'), {
        [`completedBy.2026-06-22.${ALICE}`]: 1,
      }),
    );
  });

  it('rejects a non-map completedBy', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-attr3'), {
        ...habitDoc,
        completedBy: 'nope',
      }),
    );
  });

  it('a member of another household still cannot write attribution', async () => {
    await assertFails(
      setDoc(doc(dbFor(CAROL), 'households', H1, 'habits', 'habit-attr4'), {
        ...habitDoc,
        completedBy: { '2026-06-22': { [CAROL]: 1 } },
      }),
    );
  });
});

// `frozenDatesBy` (date → the uids that date's freeze was spent for) rides the
// SAME habit writes `frozenDates` always has, so — exactly like `completedBy`
// above — the rule adds only a type guard, no new grant.
describe('habit frozenDatesBy per-member freezes', () => {
  const habitDoc = {
    title: 'Exercise',
    category: 'Health',
    count: 1,
    totalCount: 1,
    completedDates: ['2026-06-22'],
  };

  it('a member can write per-member freezes alongside frozenDates', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-frz'), {
        ...habitDoc,
        frozenDates: ['2026-06-21'],
        frozenDatesBy: { '2026-06-21': [BOB, ALICE] },
      }),
    );
  });

  it('a member can add another member to an existing day via a dot path', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(asFirestore(ctx.firestore()), 'households', H1, 'habits', 'habit-frz2'),
        habitDoc,
      );
    });
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-frz2'), {
        'frozenDatesBy.2026-06-21': [ALICE],
      }),
    );
  });

  it('rejects a non-map frozenDatesBy', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'habits', 'habit-frz3'), {
        ...habitDoc,
        frozenDatesBy: ['2026-06-21'],
      }),
    );
  });

  it('a member of another household still cannot write per-member freezes', async () => {
    await assertFails(
      setDoc(doc(dbFor(CAROL), 'households', H1, 'habits', 'habit-frz4'), {
        ...habitDoc,
        frozenDatesBy: { '2026-06-21': [CAROL] },
      }),
    );
  });
});

// The two stage-6 household settings ride the field-permissive household-doc
// update rule (like pendingRedemptions / merchantRules before them), so they
// need no rules change at all. Pinned so a future tightening of that rule can't
// silently start denying them.
describe('household freeze/ceremony settings', () => {
  it('a member can set freezeMode and ceremonyTone', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1), {
        freezeMode: 'per_member',
        ceremonyTone: 'podium',
      }),
    );
  });

  it('a member can spend from a per-member freeze bank via dot paths', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1), {
        [`freezeBanksByMember.${BOB}.tokens`]: 1,
        [`freezeBanksByMember.${BOB}.maxTokens`]: 2,
      }),
    );
  });

  it('a non-member cannot', async () => {
    await assertFails(
      updateDoc(doc(dbFor(CAROL), 'households', H1), { freezeMode: 'per_member' }),
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

  // Regression (F-HABITS-02): `unlockRequirement` — the streak-milestone gate
  // buildRewardPayload writes — was absent from isValidReward()'s hasOnly(), so
  // creating or editing a reward WITH a gate set failed outright. A reward
  // without a gate was unaffected (the field is omitted / deleteField()-ed),
  // which is why it went unnoticed.
  it('a member can create a reward gated on any habit’s streak', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-any'), {
        title: 'Steak Dinner',
        cost: 200,
        icon: 'beef',
        createdBy: BOB,
        type: 'realWorld',
        active: true,
        unlockRequirement: { streakDays: 30 },
      }),
    );
  });

  it('a member can create a reward gated on a specific habit’s streak', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-habit'), {
        title: 'New Book',
        cost: 120,
        icon: 'book',
        createdBy: BOB,
        unlockRequirement: { streakDays: 7, habitId: 'habit-1' },
      }),
    );
  });

  it('a member can add a streak gate to an existing reward', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-add'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-add'), {
        unlockRequirement: { streakDays: 14 },
      }),
    );
  });

  it('a member can clear a streak gate with deleteField()', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-clear'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        unlockRequirement: { streakDays: 14 },
      }),
    );
    // updateReward sends deleteField() when the gate is removed, so the key is
    // absent from the merged doc and the optional-field check passes.
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-clear'), {
        unlockRequirement: deleteField(),
      }),
    );
  });

  it('a reward whose unlockRequirement has a non-numeric streakDays is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-bad-days'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        unlockRequirement: { streakDays: 'thirty' },
      }),
    );
  });

  it('a reward whose unlockRequirement carries a stray inner key is rejected', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'rewards', 'rw-gate-stray'), {
        title: 'Movie Night',
        cost: 50,
        icon: 'film',
        createdBy: BOB,
        unlockRequirement: { streakDays: 30, junkField: 'nope' },
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

  // 2F.1/2F.3 whole-document-keys() lockout regression, since fixed structurally.
  // Case 3's guard used to run keys().hasOnly() against the ENTIRE resulting
  // document, not affectedKeys() — so once an admin (Case 2, a blanket bypass)
  // added a key Case 3's allowlist didn't know about, the kid's doc PERMANENTLY
  // carried that key and every later non-admin write (Case 3) failed, forever,
  // because the whole-document check saw an unrecognized key. Same failure shape
  // as 2G.1's changedKeys() bug, one layer over: there it was a first-write vs. a
  // later-write; here it was an admin's write vs. every later non-admin write.
  //
  // The rule now guards on `diff(resource.data).affectedKeys()` (what THIS write
  // touches) instead, matching Case 1's self-update branch, so it no longer
  // matters what untouched keys already sit on the document. The tests below
  // still cover 'hiddenKeys'/'homeScreen' directly (they're on the allowlist
  // because non-admin parents write them), but the load-bearing one is the
  // 'someFutureFeatureField' test further down: it plants a key that is NOT on
  // the allowlist and never will be, proving the fix is structural rather than
  // "we happened to list the right keys this time."
  describe('hiddenKeys/homeScreen do not lock a kid out of Case 3 (2F.1/2F.3 regression)', () => {
    it('REGRESSION: after an admin sets hiddenKeys on a kid, a non-admin parent can still edit the kid afterward', async () => {
      // Step 1: the admin sets hiddenKeys on the kid via Case 2 (isAdminOf), exactly
      // as the admin per-member visibility matrix (MemberVisibilityMatrix) does.
      await assertSucceeds(
        updateDoc(doc(dbFor(ALICE), 'households', H1, 'members', KID), {
          hiddenKeys: ['todos'],
        }),
      );

      // Step 2: a non-admin parent then makes an ordinary edit to the SAME kid via
      // Case 3 (e.g. updateKidProfile renaming the kid). On the OLD rules (Case 3's
      // hasOnly() missing 'hiddenKeys') this step FAILS, because the kid's document
      // now permanently contains a key Case 3 doesn't allowlist. On the fixed rules
      // it succeeds.
      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          displayName: 'Leo Renamed',
        }),
      );
    });

    it('a non-admin parent can set hiddenKeys directly on a kid', async () => {
      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          hiddenKeys: ['money'],
        }),
      );
    });

    it('a non-admin parent can set homeScreen directly on a kid', async () => {
      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          homeScreen: 'habits',
        }),
      );
    });

    it('the allowlist stays tight: a non-admin parent still cannot write an arbitrary unknown key to a kid doc', async () => {
      await assertFails(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          someUnknownField: 'nope',
        }),
      );
    });

    it('the allowlist stays tight: role still cannot be changed away from \'kid\' even alongside a valid hiddenKeys write', async () => {
      await assertFails(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          hiddenKeys: ['todos'],
          role: 'member',
        }),
      );
    });

    it('rejects an over-cap hiddenKeys list on a kid doc (Case 3 is still covered by the shared validation guards)', async () => {
      await assertFails(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          hiddenKeys: Array(101).fill('x'),
        }),
      );
    });

    it('an admin-planted unknown field does not lock non-admin parents out of a managed kid', async () => {
      // Step 1: the admin plants a field that is NOT on Case 3's allowlist and
      // never will be — a stand-in for any future HouseholdMember field, not one
      // of the specific keys this PR happens to allowlist. Succeeds via Case 2's
      // blanket bypass, exactly like 'hiddenKeys' did before it was allowlisted.
      await assertSucceeds(
        updateDoc(doc(dbFor(ALICE), 'households', H1, 'members', KID), {
          someFutureFeatureField: 'x',
        }),
      );

      // Step 2: a non-admin parent's ordinary Case 3 operations must all still
      // succeed afterward, despite the untracked field now sitting on the
      // document, because the guard is affectedKeys() (what THIS write touches),
      // not keys() of the whole document. On the old whole-document hasOnly(),
      // every one of these would now fail.
      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          displayName: 'Leo Renamed Again',
        }),
      );

      // This is the toggleHabit/actAs chore-crediting path — a parent acting as
      // the kid to complete a chore updates the kid's points map.
      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          points: { daily: 10, weekly: 10, total: 10 },
        }),
      );

      await assertSucceeds(
        updateDoc(doc(dbFor(BOB), 'households', H1, 'members', KID), {
          allowanceCents: 500,
        }),
      );
    });
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

describe('meals (recipe library — additive optional fields)', () => {
  const MEAL = 'meal-seed';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'meals', MEAL), {
        name: 'Sheet Pan Chicken',
        description: 'Weeknight staple',
        ingredients: ['chicken thighs', 'potatoes'],
        instructions: ['Roast at 425 for 35 min'],
        tags: ['quick'],
        rating: 4,
        createdBy: BOB,
      });
    });
  });

  // Regression (F-MEALS-01): `estimatedCost` was added to the Meal schema and
  // written by MealPlanTab's saveMeal, but never joined the meals hasOnly()
  // allowlist — and because that allowlist covers the MERGED post-write
  // document, EVERY meal create and update was denied. There is no admin
  // bypass in this block (isMemberOf, not isAdminOf), so it failed for the
  // household owner too.
  it('a member can create a meal with an estimatedCost', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'meals', 'meal-cost'), {
        name: 'Taco Night',
        description: 'Cheap and fast',
        ingredients: ['tortillas', 'ground beef'],
        instructions: [],
        recipeUrl: '',
        tags: ['cheap'],
        rating: 0,
        estimatedCost: 18.5,
        createdBy: BOB,
      }),
    );
  });

  // THE ACTUAL PRODUCTION PATH: leaving the cost box blank does NOT drop the
  // key. sanitizeFirestoreData maps undefined -> null, so `estimatedCost: null`
  // is still a present key in request.resource.data.keys() and the write failed
  // even for a user who never typed a cost.
  it('a member can create a meal with a null estimatedCost (the sanitizer path)', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'meals', 'meal-null-cost'), {
        name: 'Leftovers',
        description: null,
        ingredients: [],
        instructions: [],
        recipeUrl: null,
        tags: [],
        rating: 0,
        estimatedCost: null,
        createdBy: BOB,
      }),
    );
  });

  it('a member can set an estimatedCost on an existing meal', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        estimatedCost: 24,
        updatedAt: '2026-06-22T00:00:00.000Z',
      }),
    );
  });

  it('a member can clear an estimatedCost back to null', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        estimatedCost: null,
      }),
    );
  });

  it('rejects a non-numeric estimatedCost', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        estimatedCost: 'twenty bucks',
      }),
    );
  });

  // `servings` exists on the Meal schema (RecipeModal scales quantities off it)
  // but no client writes it yet — allowlisted up front so the first one that
  // does isn't denied the same way estimatedCost was.
  it('a member can set a servings count', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        servings: 4,
      }),
    );
  });

  it('rejects a non-numeric servings', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        servings: 'four',
      }),
    );
  });

  // The allowlist still has to do its job: an unexpected field is storage abuse.
  it('rejects a meal carrying a genuinely unexpected field', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'meals', 'meal-stray'), {
        name: 'Taco Night',
        ingredients: [],
        tags: [],
        junkField: 'nope',
        createdBy: BOB,
      }),
    );
  });

  it('rejects a meal update carrying a genuinely unexpected field', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'meals', MEAL), {
        junkField: 'nope',
      }),
    );
  });

  it('a non-member cannot write to another household’s meals', async () => {
    await assertFails(
      setDoc(doc(dbFor(CAROL), 'households', H1, 'meals', 'meal-intruder'), {
        name: 'Not mine',
        ingredients: [],
        tags: [],
        createdBy: CAROL,
      }),
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

  // Regression guard, same shape as `isImportant` above: a field missing from
  // the todos hasOnly() allowlist makes EVERY write carrying it fail.
  it('a member can create a repeating to-do that auto-reschedules', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'todos', 'todo-auto-reschedule'), {
        text: 'Kitchen reset',
        completeByDate: '2026-07-28',
        isCompleted: false,
        assignedTo: BOB,
        recurrence: { frequency: 'weekly' },
        resetWhenExpired: true,
        createdBy: BOB,
      }),
    );
  });

  it('a member can toggle resetWhenExpired on an existing to-do', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        resetWhenExpired: true,
      }),
    );
  });

  it('a member can clear resetWhenExpired back to false', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        resetWhenExpired: false,
      }),
    );
  });

  it('rejects a non-boolean resetWhenExpired', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        resetWhenExpired: 'yes',
      }),
    );
  });

  // The same allowlist trap, but pre-existing: `approveTodo` clears
  // needsReview from the CLIENT, and request.resource.data is the merged
  // post-write doc, so every client write to a held-for-review capture was
  // denied until the key joined the allowlist.
  it('a member can approve a held-for-review capture (clears needsReview)', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        needsReview: false,
      }),
    );
  });

  it('rejects a non-boolean needsReview', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'todos', TODO), {
        needsReview: 'later',
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

// ---------------------------------------------------------------------------
// calendarItems — first coverage for this collection. The regression that
// prompted it: `bankDescriptorAliases` was written by `linkBankTransactionToBill`
// but was absent from BOTH calendarItem allowlists, so the update guard
// (`changed.difference(allowedKeys).intersection(data.keys())`) denied it. The
// mutation commits as ONE writeBatch, so the denial silently broke the entire
// shipped "Link to bill" button — the transaction was never recategorized and
// the bill was never marked paid. Note there is no isAdminOf bypass on this
// match, so it failed for admins too.
// ---------------------------------------------------------------------------
describe('calendar items (bill↔transaction alias learning)', () => {
  const BILL = 'bill-seed';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'calendarItems', BILL), {
        title: 'Centerpoint Energy',
        amount: 142,
        date: '2026-06-22',
        type: 'expense',
        isPaid: false,
        isRecurring: true,
        frequency: 'monthly',
      });
    });
  });

  it('a member can learn a bank descriptor alias (the shipped Link-to-bill write)', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: arrayUnion('CPENERGY MNGCO'),
      }),
    );
  });

  it('a member can mark the bill paid and learn the alias in one write', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        isPaid: true,
        amount: 37.91,
        bankDescriptorAliases: arrayUnion('CPENERGY MNGCO'),
      }),
    );
  });

  it('rejects a non-list bankDescriptorAliases', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: 'CPENERGY MNGCO',
      }),
    );
  });

  it('rejects an unbounded alias list (storage abuse)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: Array.from({ length: 51 }, (_, i) => `ALIAS-${i}`),
      }),
    );
  });

  it('accepts an alias list at exactly the cap (boundary)', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: Array.from({ length: 50 }, (_, i) => `ALIAS-${i}`),
      }),
    );
  });

  it('allows clearing the alias list (so a future unlink can retract one)', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: deleteField(),
      }),
    );
  });

  it('a member can create a calendar item carrying aliases', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', 'bill-new'), {
        title: 'Water Utility',
        amount: 60,
        date: '2026-06-25',
        type: 'expense',
        isPaid: false,
        bankDescriptorAliases: ['CITY WATER'],
      }),
    );
  });

  it('still rejects an update carrying an unknown field (storage abuse)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        injected: 'x'.repeat(5000),
      }),
    );
  });

  it('still prevents tampering with createdBy', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'calendarItems', BILL), {
        createdBy: CAROL,
      }),
    );
  });

  it("a non-member cannot learn an alias on another household's bill", async () => {
    await assertFails(
      updateDoc(doc(dbFor(CAROL), 'households', H1, 'calendarItems', BILL), {
        bankDescriptorAliases: arrayUnion('CPENERGY MNGCO'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// challenges — first coverage for this collection. Three live permission-denied
// bugs prompted it, ALL of them client-side (the rules were already correct):
//   1. `updateChallenge` spread the challenge straight off challengeConverter,
//      carrying the synthetic `id`, and wrote through a ref with no
//      .withConverter() — so toFirestore never ran to strip it and `id` landed
//      in request.resource.data.keys(), which hasOnly() has no entry for.
//      Editing ANY existing challenge was denied.
//   2. `markChallengeComplete` wrote completedAt: serverTimestamp(), but the
//      rule (and Challenge.completedAt) want an optional STRING.
//   3. The inline-create branch of `updateChallenge` wrote
//      createdAt: serverTimestamp() against isValidString.
// These cases pin the exact payload shapes the fixed client now sends, plus the
// broken shapes, so the client can't regress back onto a denied write.
// ---------------------------------------------------------------------------
describe('challenges (client write shapes must satisfy hasOnly + string timestamps)', () => {
  const CH = 'challenge-seed';

  // A fully rules-valid stored challenge. `update` validates the MERGED document,
  // so the seed itself has to satisfy every field validator or even a correct
  // partial update would be denied for the wrong reason.
  const storedChallenge = {
    month: '2026-07',
    title: 'July Push',
    description: 'Move daily',
    relatedHabitIds: ['hb1'],
    targetType: 'count',
    targetValue: 60,
    currentValue: 5,
    yearlyRewardLabel: 'Badge',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: ALICE,
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = asFirestore(ctx.firestore());
      await setDoc(doc(db, 'households', H1, 'challenges', CH), storedChallenge);
    });
  });

  // --- create (updateChallenge's inline-create branch + addChallenge) -------

  it('a member can create a challenge whose createdAt is an ISO string', async () => {
    await assertSucceeds(
      setDoc(doc(dbFor(BOB), 'households', H1, 'challenges', 'ch-new'), {
        ...storedChallenge,
        title: 'August Push',
        createdBy: BOB,
        createdAt: new Date().toISOString(),
      }),
    );
  });

  it('rejects a create whose createdAt is a serverTimestamp sentinel (bug 3)', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'challenges', 'ch-ts'), {
        ...storedChallenge,
        title: 'August Push',
        createdBy: BOB,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a create carrying the synthetic id field', async () => {
    await assertFails(
      setDoc(doc(dbFor(BOB), 'households', H1, 'challenges', 'ch-id'), {
        ...storedChallenge,
        id: 'ch-id',
        createdBy: BOB,
        createdAt: new Date().toISOString(),
      }),
    );
  });

  // --- update (the ChallengeHubModal edit path) ----------------------------

  it('a member can update a challenge with the exact payload the client now sends', async () => {
    // What makeUpdateChallenge builds today: the stored challenge minus `id`,
    // with the recomputed currentValue and the normalized target fields on top.
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        ...storedChallenge,
        title: 'July Push (edited)',
        currentValue: 12,
        targetValue: 60,
        targetType: 'count',
      }),
    );
  });

  it('rejects the same update once the converter-injected id rides along (bug 1)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        ...storedChallenge,
        id: CH, // synthetic — not in the hasOnly() allow-list
        title: 'July Push (edited)',
        currentValue: 12,
      }),
    );
  });

  it('rejects an update carrying the client-only isFamilyChallenge marker', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        isFamilyChallenge: true,
      }),
    );
  });

  // --- completion (markChallengeComplete) ----------------------------------

  it('a member can complete a challenge with an ISO-string completedAt', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        status: 'success',
        completedAt: new Date().toISOString(),
      }),
    );
  });

  it('a member can mark a challenge failed with an ISO-string completedAt', async () => {
    await assertSucceeds(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        status: 'failed',
        completedAt: new Date().toISOString(),
      }),
    );
  });

  it('rejects a completion whose completedAt is a serverTimestamp sentinel (bug 2)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        status: 'success',
        completedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects an unknown status value', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        status: 'complete', // not one of active|success|failed
      }),
    );
  });

  it('rejects an over-30-char completedAt (the string cap)', async () => {
    await assertFails(
      updateDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH), {
        status: 'success',
        completedAt: `${new Date().toISOString()}-padding-past-the-cap`,
      }),
    );
  });

  // --- isolation ------------------------------------------------------------

  it("a member of another household cannot complete H1's challenge", async () => {
    await assertFails(
      updateDoc(doc(dbFor(CAROL), 'households', H1, 'challenges', CH), {
        status: 'success',
        completedAt: new Date().toISOString(),
      }),
    );
  });

  it('a member can delete a challenge', async () => {
    await assertSucceeds(
      deleteDoc(doc(dbFor(BOB), 'households', H1, 'challenges', CH)),
    );
  });
});
