/**
 * Wall display pairing callables (docs/plans/wall-display-kiosk.md §4.1, §4.5).
 *
 *   createwallpairing  (admin)  → { code, expiresAt, did }
 *   redeemwallpairing  (no auth) → { token, householdId, displayId }
 *   revokewalldisplay  (admin)  → { ok }
 *
 * A paired iPad signs in with a custom token as uid `display_{did}`, carrying
 * claims { display: true, hid, did }. It is NOT a household member: it gets
 * no members/{uid} doc and never an `admin` claim. firestore.rules grant it a
 * narrow allowlist via isDisplayOf(hid), which also requires
 * displays/{did}.status == 'active', so revoking takes effect on the very
 * next request.
 *
 * Brute force: codes are looked up by hash, so a wrong guess never touches a
 * real code's record. Guessing is bounded instead by a per-caller and a
 * global failure window (pairingLogic.ts); with at most a few live codes out
 * of 900,000 and 200 global failures an hour, a guess campaign has no
 * realistic chance inside a code's 10-minute life.
 */
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_CALLER,
  MAX_PENDING_PAIRINGS,
  PAIRING_TTL_MS,
  currentWindow,
  displayClaims,
  displayUid,
  generatePairingCode,
  hashCaller,
  hashPairingCode,
  isPairingCode,
  normalizeDisplayName,
} from "./pairingLogic";

const HOUSEHOLD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const THROTTLE = "wallPairingThrottle";

function requireHouseholdId(raw: unknown): string {
  if (typeof raw !== "string" || !HOUSEHOLD_ID_RE.test(raw)) {
    throw new HttpsError("invalid-argument", "A householdId is required.");
  }
  return raw;
}

/** Caller must be signed in as an admin member of the household (mirrors deletehousehold). */
async function requireAdmin(request: CallableRequest, householdId: string): Promise<string> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  if (request.auth.token.display === true) {
    throw new HttpsError("permission-denied", "A wall display can't manage displays.");
  }
  const member = await admin.firestore().doc(`households/${householdId}/members/${request.auth.uid}`).get();
  if (!member.exists || member.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Only a household admin can manage wall displays.");
  }
  return request.auth.uid;
}

const toMillis = (v: unknown): number =>
  v instanceof admin.firestore.Timestamp ? v.toMillis() : typeof v === "number" ? v : 0;

export const createwallpairing = onCall(
  { cors: true },
  async (request): Promise<{ code: string; expiresAt: string; did: string }> => {
    const data = (request.data ?? {}) as { householdId?: unknown; name?: unknown };
    const householdId = requireHouseholdId(data.householdId);
    const uid = await requireAdmin(request, householdId);
    const name = normalizeDisplayName(data.name);
    if (!name) {
      throw new HttpsError("invalid-argument", "Give the display a name (up to 40 characters).");
    }

    const db = admin.firestore();
    const now = Date.now();
    const displays = db.collection(`households/${householdId}/displays`);

    // Pending displays whose code expired are abandoned setups: remove them so
    // they neither count against the cap nor clutter Settings.
    const pending = await displays.where("status", "==", "pending").get();
    let live = 0;
    for (const doc of pending.docs) {
      if (toMillis(doc.data().pairingExpiresAt) > now) live++;
      else await doc.ref.delete();
    }
    if (live >= MAX_PENDING_PAIRINGS) {
      throw new HttpsError(
        "resource-exhausted",
        "There are already 3 codes waiting to be used. Use or cancel one first."
      );
    }

    const expiresAt = admin.firestore.Timestamp.fromMillis(now + PAIRING_TTL_MS);
    const displayRef = displays.doc();

    // A code collision with another live code is astronomically rare, but
    // create() fails rather than overwriting, so retry with a fresh code.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generatePairingCode();
      const pairingRef = db.doc(`wallPairings/${hashPairingCode(code)}`);
      const existing = await pairingRef.get();
      if (existing.exists && toMillis(existing.data()?.expiresAt) > now) continue;
      const batch = db.batch();
      batch.set(pairingRef, { hid: householdId, did: displayRef.id, expiresAt });
      batch.set(displayRef, {
        name,
        status: "pending",
        createdBy: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        pairingExpiresAt: expiresAt,
      });
      await batch.commit();
      return { code, expiresAt: expiresAt.toDate().toISOString(), did: displayRef.id };
    }
    throw new HttpsError("unavailable", "Couldn't make a code. Try again.");
  }
);

/** Records one failed redeem; throws resource-exhausted when a window is full. */
async function checkThrottle(callerKey: string, recordFailure: boolean): Promise<void> {
  const db = admin.firestore();
  const now = Date.now();
  const callerRef = db.doc(`${THROTTLE}/${callerKey}`);
  const globalRef = db.doc(`${THROTTLE}/_global`);
  await db.runTransaction(async (txn) => {
    const [callerSnap, globalSnap] = await Promise.all([txn.get(callerRef), txn.get(globalRef)]);
    const caller = currentWindow(callerSnap.data(), now);
    const global = currentWindow(globalSnap.data(), now);
    if (caller.count >= MAX_FAILURES_PER_CALLER || global.count >= MAX_FAILURES_GLOBAL) {
      throw new HttpsError("resource-exhausted", "Too many tries. Wait a while, then make a new code on your phone.");
    }
    if (recordFailure) {
      txn.set(callerRef, { count: caller.count + 1, windowStart: caller.windowStart });
      txn.set(globalRef, { count: global.count + 1, windowStart: global.windowStart });
    }
  });
}

function callerKeyOf(request: CallableRequest): string {
  const ip = request.rawRequest?.ip ?? "unknown";
  return hashCaller(ip);
}

const WRONG_CODE = "That code didn't work. Check it, or make a new one on your phone.";

export const redeemwallpairing = onCall(
  { cors: true },
  async (request): Promise<{ token: string; householdId: string; displayId: string }> => {
    const data = (request.data ?? {}) as { code?: unknown; userAgent?: unknown };
    const callerKey = callerKeyOf(request);
    // Refuse up front once a window is full, before looking anything up.
    await checkThrottle(callerKey, false);

    if (!isPairingCode(data.code)) {
      await checkThrottle(callerKey, true);
      throw new HttpsError("invalid-argument", WRONG_CODE);
    }

    const db = admin.firestore();
    const pairingRef = db.doc(`wallPairings/${hashPairingCode(data.code)}`);
    const pairingSnap = await pairingRef.get();
    const pairing = pairingSnap.data() as { hid?: unknown; did?: unknown; expiresAt?: unknown } | undefined;
    if (
      !pairingSnap.exists ||
      !pairing ||
      typeof pairing.hid !== "string" ||
      typeof pairing.did !== "string" ||
      toMillis(pairing.expiresAt) <= Date.now()
    ) {
      await checkThrottle(callerKey, true);
      throw new HttpsError("not-found", WRONG_CODE);
    }
    const hid = pairing.hid;
    const did = pairing.did;
    const displayRef = db.doc(`households/${hid}/displays/${did}`);
    const displaySnap = await displayRef.get();
    if (!displaySnap.exists || displaySnap.data()?.status !== "pending") {
      await pairingRef.delete();
      throw new HttpsError("not-found", WRONG_CODE);
    }

    // Mint the identity BEFORE consuming the code, so an IAM misconfiguration
    // leaves the code usable once it's fixed.
    const uid = displayUid(did);
    const claims = displayClaims(hid, did);
    let token: string;
    try {
      try {
        await admin.auth().createUser({ uid, displayName: String(displaySnap.data()?.name ?? "Wall display") });
      } catch (error) {
        if ((error as { code?: string }).code !== "auth/uid-already-exists") throw error;
      }
      await admin.auth().setCustomUserClaims(uid, claims);
      token = await admin.auth().createCustomToken(uid, { ...claims });
    } catch (error) {
      logger.error("redeemwallpairing: minting the display identity failed", error);
      throw new HttpsError(
        "failed-precondition",
        "The server can't create display sign-ins yet. See docs/WALL_DISPLAY_RUNBOOK.md (Token Creator role)."
      );
    }

    // Consume the code and activate the display atomically; a concurrent
    // redeem of the same code loses here.
    await db.runTransaction(async (txn) => {
      const [p, d] = await Promise.all([txn.get(pairingRef), txn.get(displayRef)]);
      if (!p.exists || d.data()?.status !== "pending") {
        throw new HttpsError("not-found", WRONG_CODE);
      }
      txn.delete(pairingRef);
      txn.update(displayRef, {
        status: "active",
        pairedAt: admin.firestore.FieldValue.serverTimestamp(),
        pairingExpiresAt: admin.firestore.FieldValue.delete(),
        ...(typeof data.userAgent === "string" ? { userAgent: data.userAgent.slice(0, 300) } : {}),
      });
    });

    return { token, householdId: hid, displayId: did };
  }
);

export const revokewalldisplay = onCall(
  { cors: true },
  async (request): Promise<{ ok: true }> => {
    const data = (request.data ?? {}) as { householdId?: unknown; did?: unknown };
    const householdId = requireHouseholdId(data.householdId);
    await requireAdmin(request, householdId);
    if (typeof data.did !== "string" || !HOUSEHOLD_ID_RE.test(data.did)) {
      throw new HttpsError("invalid-argument", "A display id is required.");
    }
    const did = data.did;
    const db = admin.firestore();
    const displayRef = db.doc(`households/${householdId}/displays/${did}`);
    const snap = await displayRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "That display doesn't exist.");
    }

    // Rules check this status on every request, so the wall loses access now,
    // not when its ID token expires.
    if (snap.data()?.status === "pending") {
      await displayRef.delete();
    } else {
      await displayRef.update({ status: "revoked", revokedAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    const pairings = await db.collection("wallPairings").where("did", "==", did).get();
    await Promise.all(pairings.docs.map((d) => d.ref.delete()));

    const uid = displayUid(did);
    try {
      await admin.auth().revokeRefreshTokens(uid);
      await admin.auth().deleteUser(uid);
    } catch (error) {
      if ((error as { code?: string }).code !== "auth/user-not-found") {
        logger.warn("revokewalldisplay: auth cleanup failed (rules already deny access)", error);
      }
    }
    return { ok: true };
  }
);
