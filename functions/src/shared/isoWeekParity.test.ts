/**
 * 🛡️ THE PIN BETWEEN THE TWO ISO-WEEK COPIES.
 *
 * `isoWeekIdForDate` exists twice: server-side here in
 * `functions/src/shared/isoWeek.ts`, and client-side in `utils/recapWeek.ts`
 * (ARCH-1). That duplication is FORCED, not lazy — `functions/tsconfig.json`
 * sets `rootDir: "src"`, so server SOURCE structurally cannot import `@/…`.
 *
 * It matters more than a typical duplicated helper: the SERVER's copy is what
 * NAMES the recap documents (`households/{id}/recaps/{isoWeek}`), and the
 * CLIENT's copy is what decides which id to look one up by, which week the
 * archive offers, and which week auto-opens. A one-week divergence at a year
 * boundary would make the client derive a brand-new recap for a week the
 * server had already written a real, AI-narrated document for.
 *
 * Functions TESTS have no `rootDir` constraint — they are excluded from
 * `functions/tsconfig.json` and run under the ROOT vitest config, where the
 * `@/` alias resolves (same trick as `recap/parity.test.ts`). So this file
 * imports BOTH copies and asserts identical output over a shared date table.
 *
 * 🛡️ FIXTURES ARE LITERAL DATES, never offsets from "today" — a
 * weekday-dependent date fixture has blocked a production deploy in this repo
 * before (runners are UTC, so the date can roll between the CI run and the
 * deploy run).
 */
import { describe, expect, it } from "vitest";

import { isoWeekIdForDate } from "./isoWeek";
import { isoWeekIdForDate as clientIsoWeekIdForDate } from "@/utils/recapWeek";

/**
 * `[localDate, expectedIsoWeekId]`. Every row is checked against BOTH copies,
 * so this table pins the two together AND pins their shared answer — a
 * matching pair of wrong answers still fails.
 */
const CASES: Array<[string, string]> = [
  // --- Plain mid-year weeks, Monday → Sunday edges -------------------------
  ["2026-06-29", "2026-W27"], // Monday, opens the week
  ["2026-06-30", "2026-W27"],
  ["2026-07-04", "2026-W27"],
  ["2026-07-05", "2026-W27"], // Sunday, closes the week
  ["2026-07-06", "2026-W28"], // next Monday, week rolls

  // --- 2026 is a 53-WEEK ISO year (it starts on a Thursday) ---------------
  // The reviewer hand-checked this block; it is the case a naive
  // "calendar year + week number" implementation gets wrong.
  ["2026-12-27", "2026-W52"], // Sunday closing W52
  ["2026-12-28", "2026-W53"], // Monday opening the 53rd week
  ["2026-12-31", "2026-W53"], // still 2026 by both calendars
  ["2027-01-01", "2026-W53"], // calendar year 2027, ISO week-year 2026
  ["2027-01-03", "2026-W53"], // Sunday closing W53
  ["2027-01-04", "2027-W01"], // Monday opening 2027's first week

  // --- The other direction: a December date whose ISO week-year is NEXT ----
  ["2025-12-28", "2025-W52"], // Sunday closing 2025-W52
  ["2025-12-29", "2026-W01"], // Monday — ISO week-year jumps a year early
  ["2025-12-31", "2026-W01"],
  ["2026-01-01", "2026-W01"],
  ["2026-01-04", "2026-W01"], // Sunday closing 2026-W01
  ["2026-01-05", "2026-W02"],

  // --- A year that starts ON Monday (no borrowed week at all) -------------
  ["2024-01-01", "2024-W01"],
  ["2023-12-31", "2023-W52"],

  // --- A leap year's Feb 29 -----------------------------------------------
  ["2024-02-29", "2024-W09"],
];

describe("isoWeekIdForDate — server/client parity", () => {
  it.each(CASES)("%s → %s (both copies)", (localDate, expected) => {
    expect(isoWeekIdForDate(localDate)).toBe(expected);
    expect(clientIsoWeekIdForDate(localDate)).toBe(expected);
  });

  it("agrees on every day across the 2026-W53 → 2027-W01 boundary", () => {
    // Belt-and-braces sweep: 21 consecutive days spanning the 53-week
    // rollover, asserting only that the two copies AGREE (the table above
    // pins the values themselves). A boundary-arithmetic change that this
    // table happens not to cover still fails here.
    for (let day = 20; day <= 40; day++) {
      const date = new Date(Date.UTC(2026, 11, day)); // Dec 20 2026 → Jan 9 2027
      const localDate = date.toISOString().slice(0, 10);
      expect(clientIsoWeekIdForDate(localDate)).toBe(isoWeekIdForDate(localDate));
    }
  });
});
