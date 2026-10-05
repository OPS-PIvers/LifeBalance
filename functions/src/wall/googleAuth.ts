/**
 * An OAuth access token for Google APIs (Text-to-Speech, Routes) from the
 * function's own service account, so these APIs need enabling but no API key.
 */
import * as admin from "firebase-admin";

let cached: { token: string; expiresAt: number } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const { access_token: token, expires_in: expiresIn } = await admin.credential.applicationDefault().getAccessToken();
  cached = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}
