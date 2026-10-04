import { signInWithCustomToken } from 'firebase/auth';
import { auth, getFunctionsInstance } from '@/firebase.config';
import { setWallDevice } from '@/utils/wall/wallDevice';

/**
 * Redeems a 6-digit pairing code (functions/src/wall/pairing.ts) and signs
 * this device in as the display. AuthContext then sees the display claims
 * and the app renders only the wall.
 */
export async function redeemPairingCode(code: string): Promise<void> {
  const [{ httpsCallable }, functions] = await Promise.all([import('firebase/functions'), getFunctionsInstance()]);
  const redeem = httpsCallable<{ code: string; userAgent: string }, { token: string }>(functions, 'redeemwallpairing');
  const { data } = await redeem({ code, userAgent: navigator.userAgent });
  setWallDevice(true);
  await signInWithCustomToken(auth, data.token);
}

/** The server's message for a callable error, or a generic one. */
export function pairingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code.includes('unavailable') || code.includes('deadline') || code.includes('internal') || !message) {
    return "Couldn't reach LifeBalance. Check the Wi-Fi and try again.";
  }
  return message;
}
