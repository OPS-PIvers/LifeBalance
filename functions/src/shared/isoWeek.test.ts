import { describe, it, expect } from "vitest";
import { isoWeekId } from "./isoWeek";

describe("isoWeekId", () => {
  it("computes a normal mid-year week", () => {
    // 2026-07-04 is a Saturday, ISO week 27 of 2026.
    const date = new Date("2026-07-04T12:00:00Z");
    expect(isoWeekId(date, "UTC")).toBe("2026-W27");
  });

  it("rolls Dec 31 into ISO week 1 of the next year when applicable", () => {
    // 2025-12-31 is a Wednesday, which per the ISO calendar falls in
    // week 1 of 2026 (the first week of 2026 contains Jan 1 (Thu), and
    // ISO weeks start Monday, so Dec 29-31 2025 belong to week 1 2026).
    const date = new Date("2025-12-31T12:00:00Z");
    expect(isoWeekId(date, "UTC")).toBe("2026-W01");
  });

  it("rolls Jan 1 into ISO week 52/53 of the prior year when applicable", () => {
    // 2027-01-01 is a Friday. ISO week-year for a Friday Jan 1 belongs to
    // the previous year's last week, since the week (Mon 2026-12-28 to
    // Sun 2027-01-03) is anchored by its Thursday (2026-12-31), which is
    // still in 2026.
    const date = new Date("2027-01-01T12:00:00Z");
    expect(isoWeekId(date, "UTC")).toBe("2026-W53");
  });

  it("shifts the day near a week boundary depending on timezone", () => {
    // 2026-07-05 00:30 UTC is still 2026-07-04 (Saturday, week 27) in
    // America/Los_Angeles (UTC-7 in July), but already Sunday 2026-07-05
    // (still week 27, ISO weeks run Mon-Sun) in UTC. Use a later boundary
    // that actually crosses a week: 2026-07-06 00:30 UTC (Monday, week 28
    // in UTC) is still 2026-07-05 (Sunday, week 27) in America/Los_Angeles.
    const date = new Date("2026-07-06T00:30:00Z");
    expect(isoWeekId(date, "UTC")).toBe("2026-W28");
    expect(isoWeekId(date, "America/Los_Angeles")).toBe("2026-W27");
  });
});
