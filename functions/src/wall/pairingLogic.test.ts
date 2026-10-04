import { describe, expect, it } from "vitest";
import {
  FAILURE_WINDOW_MS,
  currentWindow,
  displayClaims,
  displayUid,
  generatePairingCode,
  hashCaller,
  hashPairingCode,
  isPairingCode,
  normalizeDisplayName,
} from "./pairingLogic";

describe("pairing codes", () => {
  it("generates 6-digit codes that never start with 0", () => {
    for (let i = 0; i < 500; i++) {
      const code = generatePairingCode();
      expect(isPairingCode(code)).toBe(true);
    }
  });

  it("validates the code shape", () => {
    expect(isPairingCode("482913")).toBe(true);
    expect(isPairingCode("082913")).toBe(false);
    expect(isPairingCode("48291")).toBe(false);
    expect(isPairingCode("48291a")).toBe(false);
    expect(isPairingCode(482913)).toBe(false);
  });

  it("hashes deterministically and never echoes the code", () => {
    expect(hashPairingCode("482913")).toBe(hashPairingCode("482913"));
    expect(hashPairingCode("482913")).not.toContain("482913");
    expect(hashPairingCode("482913")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCaller("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("display identity", () => {
  it("builds the uid and claims", () => {
    expect(displayUid("abc")).toBe("display_abc");
    expect(displayClaims("H1", "d1")).toEqual({ display: true, hid: "H1", did: "d1" });
  });

  it("normalizes names", () => {
    expect(normalizeDisplayName("  Kitchen   iPad ")).toBe("Kitchen iPad");
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("x".repeat(41))).toBeNull();
    expect(normalizeDisplayName(5)).toBeNull();
  });
});

describe("currentWindow", () => {
  it("keeps a live window and restarts a stale or malformed one", () => {
    const now = 1_000_000_000;
    expect(currentWindow({ count: 3, windowStart: now - 1000 }, now)).toEqual({ count: 3, windowStart: now - 1000 });
    expect(currentWindow({ count: 3, windowStart: now - FAILURE_WINDOW_MS }, now)).toEqual({ count: 0, windowStart: now });
    expect(currentWindow(undefined, now)).toEqual({ count: 0, windowStart: now });
  });
});
