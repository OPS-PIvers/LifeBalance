/**
 * Pure helpers for wall-display pairing (docs/plans/wall-display-kiosk.md §4.1).
 * Kept free of firebase-admin so they're unit-testable on their own.
 */
import { createHash, randomInt } from "crypto";

/** How long a pairing code stays valid. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Codes that may be outstanding (pending, unexpired) per household. */
export const MAX_PENDING_PAIRINGS = 3;
/** Failed redeem attempts allowed per caller (IP) per window. */
export const MAX_FAILURES_PER_CALLER = 10;
/** Failed redeem attempts allowed across ALL callers per window. */
export const MAX_FAILURES_GLOBAL = 200;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

export const DISPLAY_NAME_MAX = 40;

/** 6 digits, never starting with 0 (so it can't lose a digit when typed as a number). */
export function generatePairingCode(): string {
  return String(randomInt(100000, 1000000));
}

export function isPairingCode(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{5}$/.test(value);
}

/** Doc id for `wallPairings/{hash}`: the code itself is never stored. */
export function hashPairingCode(code: string): string {
  return createHash("sha256").update(`wall-pairing:${code}`).digest("hex");
}

/** Throttle doc id for a caller, so raw IPs aren't stored either. */
export function hashCaller(ip: string): string {
  return createHash("sha256").update(`wall-caller:${ip}`).digest("hex").slice(0, 32);
}

/** The Firebase Auth uid a display signs in as. Never a member uid. */
export function displayUid(did: string): string {
  return `display_${did}`;
}

export interface DisplayClaims {
  display: true;
  hid: string;
  did: string;
}

export function displayClaims(hid: string, did: string): DisplayClaims {
  return { display: true, hid, did };
}

export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > DISPLAY_NAME_MAX) return null;
  return name;
}

export interface FailureWindow {
  count: number;
  windowStart: number; // ms
}

/**
 * Advances a fixed-window failure counter: a window older than
 * FAILURE_WINDOW_MS restarts at zero.
 */
export function currentWindow(raw: unknown, now: number): FailureWindow {
  if (typeof raw === "object" && raw !== null) {
    const { count, windowStart } = raw as { count?: unknown; windowStart?: unknown };
    if (typeof count === "number" && typeof windowStart === "number" && now - windowStart < FAILURE_WINDOW_MS) {
      return { count, windowStart };
    }
  }
  return { count: 0, windowStart: now };
}
