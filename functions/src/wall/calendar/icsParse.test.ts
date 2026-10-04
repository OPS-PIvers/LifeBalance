import { describe, expect, it } from "vitest";
import { IcsParseError, expandIcs, normalizeTzid, type ExpandOptions } from "./icsParse";

const CHICAGO_VTIMEZONE = `BEGIN:VTIMEZONE
TZID:America/Chicago
X-LIC-LOCATION:America/Chicago
BEGIN:DAYLIGHT
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
TZNAME:CDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
TZNAME:CST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

const cal = (...parts: string[]): string =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...parts, "END:VCALENDAR"].join("\r\n");

const opts = (over: Partial<ExpandOptions> = {}): ExpandOptions => ({
  feedId: "f1",
  ownerKey: "uid-a",
  source: "feed",
  timeZone: "America/Chicago",
  windowStart: "2026-10-01",
  windowEnd: "2026-12-31",
  ...over,
});

describe("expandIcs", () => {
  it("keeps a weekly Google series at 9:00 local across the November DST change", () => {
    // Google secret-address style: VTIMEZONE + IANA TZID.
    const text = cal(
      CHICAGO_VTIMEZONE,
      "BEGIN:VEVENT",
      "UID:soccer@google.com",
      "DTSTART;TZID=America/Chicago:20261021T090000",
      "DTEND;TZID=America/Chicago:20261021T100000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "SUMMARY:Soccer practice",
      "LOCATION:Field 3",
      "END:VEVENT"
    );
    const { rows } = expandIcs(text, opts());
    expect(rows.map((r) => [r.date, r.start, r.end])).toEqual([
      ["2026-10-21", "2026-10-21T09:00:00-05:00", "2026-10-21T10:00:00-05:00"],
      ["2026-10-28", "2026-10-28T09:00:00-05:00", "2026-10-28T10:00:00-05:00"],
      ["2026-11-04", "2026-11-04T09:00:00-06:00", "2026-11-04T10:00:00-06:00"],
      ["2026-11-11", "2026-11-11T09:00:00-06:00", "2026-11-11T10:00:00-06:00"],
    ]);
    expect(rows[0]).toMatchObject({ title: "Soccer practice", location: "Field 3", allDay: false, ownerKey: "uid-a", feedId: "f1", source: "feed" });
  });

  it("applies EXDATE, moved overrides and cancelled overrides", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:piano",
      "DTSTART;TZID=America/Chicago:20261005T160000",
      "DTEND;TZID=America/Chicago:20261005T163000",
      "RRULE:FREQ=WEEKLY;UNTIL=20261031T000000Z",
      "EXDATE;TZID=America/Chicago:20261012T160000",
      "SUMMARY:Piano",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:piano",
      "RECURRENCE-ID;TZID=America/Chicago:20261019T160000",
      "DTSTART;TZID=America/Chicago:20261020T170000",
      "DTEND;TZID=America/Chicago:20261020T173000",
      "SUMMARY:Piano (moved)",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:piano",
      "RECURRENCE-ID;TZID=America/Chicago:20261026T160000",
      "DTSTART;TZID=America/Chicago:20261026T160000",
      "STATUS:CANCELLED",
      "SUMMARY:Piano",
      "END:VEVENT"
    );
    const { rows } = expandIcs(text, opts());
    expect(rows.map((r) => [r.date, r.start?.slice(11, 16), r.title])).toEqual([
      ["2026-10-05", "16:00", "Piano"],
      ["2026-10-20", "17:00", "Piano (moved)"],
    ]);
  });

  it("converts another zone's events into the household zone (iCloud public link)", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:call",
      "DTSTART;TZID=America/New_York:20261110T090000",
      "DTEND;TZID=America/New_York:20261110T100000",
      "SUMMARY:Call with grandma",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:late",
      "DTSTART:20261111T043000Z",
      "DTEND:20261111T053000Z",
      "SUMMARY:Late UTC",
      "END:VEVENT"
    );
    const { rows } = expandIcs(text, opts());
    expect(rows.map((r) => [r.title, r.date, r.start])).toEqual([
      ["Call with grandma", "2026-11-10", "2026-11-10T08:00:00-06:00"],
      // 04:30Z is the previous evening in Chicago.
      ["Late UTC", "2026-11-10", "2026-11-10T22:30:00-06:00"],
    ]);
  });

  it("gives a multi-day all-day event one row per day, clipped to the window (school ICS)", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:break",
      "DTSTART;VALUE=DATE:20261125",
      "DTEND;VALUE=DATE:20261130",
      "SUMMARY:Thanksgiving break",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:edge",
      "DTSTART;VALUE=DATE:20260929",
      "DTEND;VALUE=DATE:20261002",
      "SUMMARY:Starts before the window",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:oneday",
      "DTSTART;VALUE=DATE:20261009",
      "SUMMARY:No school",
      "END:VEVENT"
    );
    const { rows } = expandIcs(text, opts());
    const byTitle = (t: string) => rows.filter((r) => r.title === t).map((r) => r.date);
    expect(byTitle("Thanksgiving break")).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(byTitle("Starts before the window")).toEqual(["2026-10-01"]);
    expect(byTitle("No school")).toEqual(["2026-10-09"]);
    expect(rows.every((r) => r.allDay && r.start === undefined)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("reads Outlook's Windows zone names and floating times", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:outlook",
      'DTSTART;TZID="Eastern Standard Time":20261201T120000',
      'DTEND;TZID="Eastern Standard Time":20261201T130000',
      "SUMMARY:Lunch",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:floating",
      "DTSTART:20261202T180000",
      "SUMMARY:Floating dinner",
      "END:VEVENT"
    );
    const { rows } = expandIcs(text, opts());
    expect(rows.map((r) => [r.title, r.start])).toEqual([
      ["Lunch", "2026-12-01T11:00:00-06:00"],
      ["Floating dinner", "2026-12-02T18:00:00-06:00"],
    ]);
  });

  it("falls back to the file's VTIMEZONE for an unknown TZID", () => {
    const text = cal(
      CHICAGO_VTIMEZONE.replace(/America\/Chicago/g, "Custom Zone"),
      "BEGIN:VEVENT",
      "UID:custom",
      "DTSTART;TZID=Custom Zone:20261103T090000",
      "SUMMARY:Custom",
      "END:VEVENT"
    );
    expect(expandIcs(text, opts()).rows[0]?.start).toBe("2026-11-03T09:00:00-06:00");
  });

  it("shows private events as Busy without a location", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:p",
      "DTSTART:20261105T150000Z",
      "CLASS:PRIVATE",
      "SUMMARY:Doctor",
      "LOCATION:Clinic",
      "END:VEVENT"
    );
    const [row] = expandIcs(text, opts()).rows;
    expect(row?.title).toBe("Busy");
    expect(row?.location).toBeUndefined();
  });

  it("caps the rows and reports truncation", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:daily",
      "DTSTART:20200101T150000Z",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Meds",
      "END:VEVENT"
    );
    const capped = expandIcs(text, opts({ maxRows: 10 }));
    expect(capped.rows).toHaveLength(10);
    expect(capped.truncated).toBe(true);
    // An old, open-ended daily series still reaches the window.
    const full = expandIcs(text, opts());
    expect(full.rows[0]?.date).toBe("2026-10-01");
    expect(full.rows.at(-1)?.date).toBe("2026-12-31");
    expect(full.truncated).toBe(false);
  });

  it("gives re-syncs the same ids, and different feeds different ids", () => {
    const text = cal("BEGIN:VEVENT", "UID:x", "DTSTART:20261105T150000Z", "SUMMARY:X", "END:VEVENT");
    const a = expandIcs(text, opts()).rows[0]?.id;
    expect(expandIcs(text, opts()).rows[0]?.id).toBe(a);
    expect(expandIcs(text, opts({ feedId: "f2" })).rows[0]?.id).not.toBe(a);
  });

  it("rejects files that aren't calendars", () => {
    expect(() => expandIcs("<html>login</html>", opts())).toThrow(IcsParseError);
  });
});

describe("normalizeTzid", () => {
  it("handles IANA, vendor-prefixed, Windows and unknown names", () => {
    expect(normalizeTzid("America/Chicago")).toBe("America/Chicago");
    expect(normalizeTzid("/mozilla.org/20050126_1/America/New_York")).toBe("America/New_York");
    expect(normalizeTzid("Pacific Standard Time")).toBe("America/Los_Angeles");
    expect(normalizeTzid("Custom Zone")).toBeNull();
    expect(normalizeTzid(undefined)).toBeNull();
  });
});
