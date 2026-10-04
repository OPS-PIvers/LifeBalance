/**
 * Caller checks shared by the wall callables (pairing and calendars).
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const HOUSEHOLD_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function requireHouseholdId(raw: unknown): string {
  if (typeof raw !== "string" || !HOUSEHOLD_ID_RE.test(raw)) {
    throw new HttpsError("invalid-argument", "A householdId is required.");
  }
  return raw;
}

/** Caller must be signed in as an admin member of the household (mirrors deletehousehold). */
export async function requireAdmin(request: CallableRequest, householdId: string): Promise<string> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  if (request.auth.token.display === true) {
    throw new HttpsError("permission-denied", "A wall display can't change wall settings.");
  }
  const member = await admin.firestore().doc(`households/${householdId}/members/${request.auth.uid}`).get();
  if (!member.exists || member.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Only a household admin can change this.");
  }
  return request.auth.uid;
}

/**
 * Caller is a member of the household, or an ACTIVE wall display paired to it
 * (the same test firestore.rules' isDisplayOf makes).
 */
export async function requireMemberOrDisplay(request: CallableRequest, householdId: string): Promise<void> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const db = admin.firestore();
  const token = request.auth.token;
  if (token.display === true) {
    const did = token.did;
    if (token.hid !== householdId || typeof did !== "string" || !HOUSEHOLD_ID_RE.test(did)) {
      throw new HttpsError("permission-denied", "This display belongs to another household.");
    }
    const display = await db.doc(`households/${householdId}/displays/${did}`).get();
    if (display.data()?.status !== "active") {
      throw new HttpsError("permission-denied", "This display has been unpaired.");
    }
    return;
  }
  const member = await db.doc(`households/${householdId}/members/${request.auth.uid}`).get();
  if (!member.exists) {
    throw new HttpsError("permission-denied", "You're not a member of this household.");
  }
}
