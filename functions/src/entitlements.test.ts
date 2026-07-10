/**
 * Tests for the server-side entitlements helper (Plan 10).
 *
 * The cap numbers here are the contract mirrored from `utils/entitlements.ts` /
 * `services/geminiService.ts` — if one of these tests fails after a limit tune,
 * update BOTH packages, not just this file.
 */

import { describe, it, expect } from "vitest";
import {
  getAiDailyCap,
  LEGACY_AI_DAILY_QUOTA,
  FREE_AI_DAILY_CAP,
  PREMIUM_AI_DAILY_CAP,
} from "./entitlements";

describe("getAiDailyCap", () => {
  describe("billing dormant (billingEnabled = false)", () => {
    it("returns the legacy flat cap for a household with no subscription", () => {
      expect(getAiDailyCap({}, false)).toBe(LEGACY_AI_DAILY_QUOTA);
      expect(getAiDailyCap({}, false)).toBe(100);
    });

    it("returns the legacy flat cap even for an active premium subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "active" } },
          false
        )
      ).toBe(LEGACY_AI_DAILY_QUOTA);
    });

    it("returns the legacy flat cap even for a canceled subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "canceled" } },
          false
        )
      ).toBe(LEGACY_AI_DAILY_QUOTA);
    });
  });

  describe("billing live (billingEnabled = true)", () => {
    it("returns the free cap for a household with no subscription", () => {
      expect(getAiDailyCap({}, true)).toBe(FREE_AI_DAILY_CAP);
      expect(getAiDailyCap({}, true)).toBe(3);
    });

    it("returns the premium cap for an active premium subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "active" } },
          true
        )
      ).toBe(PREMIUM_AI_DAILY_CAP);
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "active" } },
          true
        )
      ).toBe(500);
    });

    it("returns the premium cap for a trialing subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "trialing" } },
          true
        )
      ).toBe(PREMIUM_AI_DAILY_CAP);
    });

    it("returns the premium cap for a past_due subscription (grace period)", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "past_due" } },
          true
        )
      ).toBe(PREMIUM_AI_DAILY_CAP);
    });

    it("returns the free cap for a canceled premium subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "canceled" } },
          true
        )
      ).toBe(FREE_AI_DAILY_CAP);
    });

    it("returns the free cap for an incomplete premium subscription", () => {
      expect(
        getAiDailyCap(
          { subscription: { plan: "premium", status: "incomplete" } },
          true
        )
      ).toBe(FREE_AI_DAILY_CAP);
    });

    it("returns the free cap when the plan is not premium regardless of status", () => {
      expect(
        getAiDailyCap({ subscription: { plan: "free", status: "active" } }, true)
      ).toBe(FREE_AI_DAILY_CAP);
    });

    it("tolerates malformed subscription shapes (raw Firestore data)", () => {
      expect(
        getAiDailyCap({ subscription: { plan: 42, status: null } }, true)
      ).toBe(FREE_AI_DAILY_CAP);
      expect(
        getAiDailyCap({ subscription: { plan: "premium", status: 7 } }, true)
      ).toBe(FREE_AI_DAILY_CAP);
    });
  });
});
