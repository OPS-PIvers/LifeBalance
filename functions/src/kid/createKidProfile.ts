import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { randomUUID } from "crypto";
import { getMaxKidProfiles, type HouseholdEntitlementData } from "../entitlements";

/**
 * Callable: authoritatively create a managed (login-less) kid profile (Plan 080),
 * enforcing the per-plan `maxKidProfiles` cap SERVER-SIDE (Plan 051).
 *
 * The client's `addKidProfile` pre-check is UX only — a managed kid is a plain
 * `members/{id}` doc that is never in `memberUids`, so firestore.rules cannot count
 * them and a client-maintained counter would not be a real boundary. Only counting
 * on the server (which the client cannot lie to) is authoritative.
 *
 * Billing gate: while `billingEnabled` is off (dormant — current prod state) the cap
 * is INERT, exactly matching `addKidProfile` and the member cap in firestore.rules —
 * any number of profiles may be created and behavior is unchanged. Once billing is
 * live, a household at/over its plan's `maxKidProfiles` is rejected with
 * `resource-exhausted`. Grandfathering is implicit: an already-over-cap household is
 * only blocked from ADDING more, never from keeping what it has.
 *
 * Lowercased name to match the codebase convention (geminiproxy,
 * plaidcreatelinktoken). The client `httpsCallable` string must be exactly
 * "createkidprofile".
 */
export const createkidprofile = onCall(
  { cors: true },
  async (request): Promise<{ memberId: string }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const parentUid = request.auth.uid;
    const data = (request.data ?? {}) as {
      householdId?: unknown;
      displayName?: unknown;
      avatarColor?: unknown;
      avatarEmoji?: unknown;
    };

    const householdId = data.householdId;
    if (typeof householdId !== "string" || !householdId) {
      throw new HttpsError("invalid-argument", "A householdId is required.");
    }
    const displayName =
      typeof data.displayName === "string" ? data.displayName.trim() : "";
    if (!displayName) {
      throw new HttpsError("invalid-argument", "A displayName is required.");
    }
    if (displayName.length > 50) {
      throw new HttpsError(
        "invalid-argument",
        "displayName must be 50 characters or less."
      );
    }
    const avatarColor =
      typeof data.avatarColor === "string" ? data.avatarColor : undefined;
    const avatarEmoji =
      typeof data.avatarEmoji === "string" ? data.avatarEmoji : undefined;

    const db = admin.firestore();

    // The caller must be a member (parent) of the household — mirrors the
    // firestore.rules Case 4 `isMemberOf(householdId)` gate for kid creation.
    const parentMemberSnap = await db
      .doc(`households/${householdId}/members/${parentUid}`)
      .get();
    if (!parentMemberSnap.exists) {
      throw new HttpsError(
        "permission-denied",
        "You are not a member of this household."
      );
    }

    // Billing gate — the cap is only enforced while billing is live (parity with
    // the client's addKidProfile and the member cap in firestore.rules).
    let billingEnabled = false;
    try {
      const configSnap = await db.doc("app_config/global").get();
      billingEnabled =
        configSnap.exists && configSnap.data()?.billingEnabled === true;
    } catch (error) {
      // Fail closed to dormant (no cap) if config is unreachable — matches the
      // client's getBillingEnabled fail-closed direction.
      logger.warn(
        "createkidprofile: app_config read failed; treating billing as dormant:",
        error
      );
    }

    if (billingEnabled) {
      const householdSnap = await db.doc(`households/${householdId}`).get();
      const household = (householdSnap.data() ?? {}) as HouseholdEntitlementData;
      const managedSnap = await db
        .collection(`households/${householdId}/members`)
        .where("isManaged", "==", true)
        .get();
      if (managedSnap.size >= getMaxKidProfiles(household)) {
        throw new HttpsError(
          "resource-exhausted",
          "Kid profile limit reached. Upgrade to add more."
        );
      }
    }

    // A kid id is an unguessable, non-auth id that can never equal a real Firebase
    // Auth uid (matches utils/kidProfile.ts newKidMemberId). The doc shape matches
    // utils/kidProfile.ts buildKidMemberDoc so the client renders it identically.
    const memberId = `kid_${randomUUID()}`;
    await db.doc(`households/${householdId}/members/${memberId}`).set({
      uid: memberId,
      displayName,
      role: "kid",
      isManaged: true,
      managedByUid: parentUid,
      ...(avatarColor ? { avatarColor } : {}),
      ...(avatarEmoji ? { avatarEmoji } : {}),
      points: { daily: 0, weekly: 0, total: 0 },
      allowanceCents: 0,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { memberId };
  }
);
