/**
 * Unit tests for `composeBankSyncSummaryBody` — the pure push-body composer
 * pulled out of the `bankEmailSync` HTTP handler so the multi-day catch-up
 * window's reporting logic is testable without mocking a full Firestore
 * batch.
 *
 * `bankEmailSync.ts` calls `admin.firestore()` and `onRequest(...)` at module
 * load (for the exported `db` and the handler registration), so both need the
 * same minimal mock `apiKeyValidation.test.ts`/`index.test.ts` use — nothing
 * here ever calls into either one, since `composeBankSyncSummaryBody` takes
 * plain data and returns a string.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("firebase-admin", () => {
  const firestore = Object.assign(() => ({}), {
    FieldValue: {
      serverTimestamp: () => "TS",
      increment: (n: number) => ({ __inc: n }),
      arrayUnion: (...items: unknown[]) => ({ __union: items }),
      arrayRemove: (...items: unknown[]) => ({ __remove: items }),
    },
  });
  return { firestore };
});

import { composeBankSyncSummaryBody, type SyncTallyCounts } from "./bankEmailSync";
import type { NoSpendHabitFire } from "./noSpendFire";

const ZERO_COUNTS: SyncTallyCounts = { created: 0, confirmed: 0, filled: 0, billsPaid: 0 };

const fire = (over: Partial<NoSpendHabitFire> = {}): NoSpendHabitFire => ({
  habitId: "h1",
  title: "No spend day",
  scope: "day",
  pointsEarned: 10,
  streak: 1,
  ...over,
});

describe("composeBankSyncSummaryBody", () => {
  describe("most recent judged day is CLEAN", () => {
    it("announces the fire(s) and never mentions the ordinary counts line", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: true,
        allFired: [fire({ pointsEarned: 10, streak: 1 })],
        counts: { created: 5, confirmed: 0, filled: 0, billsPaid: 0 },
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).toBe("No spend day logged +10 pts. Balance: $100.00");
      expect(body).not.toContain("new,");
    });

    it("says nothing unplanned left the account when no habit is wired up", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: true,
        allFired: [],
        counts: ZERO_COUNTS,
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).toBe("Nothing unplanned left your account. Balance: $100.00");
    });
  });

  describe("most recent judged day is DIRTY, with fires on an EARLIER judged day", () => {
    // This is the bug report's scenario: Tuesday's email judges Saturday
    // (clean, fires), Sunday (clean, weekend fires), and Monday (dirty). The
    // most recent day (Monday) is dirty, but the fires must still be announced.
    it("prepends the fires sentence ahead of the counts line", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [fire({ title: "No spend day", pointsEarned: 10 }), fire({ title: "Clean weekend", pointsEarned: 15 })],
        counts: { created: 5, confirmed: 0, filled: 0, billsPaid: 0 },
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).toBe("2 habits logged +25 pts. 5 new. Balance: $100.00");
    });

    // The exact trap flagged: calling the unconditional `describeNoSpendFires`
    // form here would assert a no-spend day that demonstrably didn't happen.
    it("never claims 'Nothing unplanned left your account' when the day was dirty", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [],
        counts: { created: 5, confirmed: 0, filled: 0, billsPaid: 0 },
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).not.toContain("Nothing unplanned");
      expect(body).toBe("5 new, 0 confirmed, 0 filled, 0 bills paid. Balance: $100.00");
    });

    it("condenses the counts line to nonzero categories only when combined with a fires sentence", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [fire()],
        counts: { created: 3, confirmed: 0, filled: 0, billsPaid: 1 },
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).toBe("No spend day logged +10 pts. 3 new, 1 bill paid. Balance: $100.00");
    });

    it("omits the counts line entirely when every count is zero, keeping the fires sentence", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [fire()],
        counts: ZERO_COUNTS,
        ruleSummary: "",
        balanceSummary: "Balance: $100.00",
      });
      expect(body).toBe("No spend day logged +10 pts. Balance: $100.00");
    });

    it("keeps the balance summary last and intact alongside a rule summary", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [fire()],
        counts: { created: 2, confirmed: 1, filled: 0, billsPaid: 0 },
        ruleSummary: "Rules: 1 categorized. ",
        balanceSummary: "Balance: $1,234.56",
      });
      expect(body).toBe(
        "No spend day logged +10 pts. 2 new, 1 confirmed. Rules: 1 categorized. Balance: $1,234.56"
      );
      expect(body.endsWith("Balance: $1,234.56")).toBe(true);
    });
  });

  describe("most recent judged day is DIRTY, with no fires anywhere in the run", () => {
    it("is byte-for-byte the pre-catch-up counts line (regression guard)", () => {
      const body = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: false,
        allFired: [],
        counts: { created: 12, confirmed: 2, filled: 1, billsPaid: 1 },
        ruleSummary: "",
        balanceSummary: "Balance: $500.00",
      });
      expect(body).toBe("12 new, 2 confirmed, 1 filled, 1 bills paid. Balance: $500.00");
    });
  });
});
