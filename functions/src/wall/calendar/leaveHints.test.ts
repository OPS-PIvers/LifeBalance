import { describe, expect, it } from "vitest";
import { isoDurationMinutes, parseLeaveHints } from "./leaveHints";

const TZ = "America/Chicago";
// 5:30 PM Central, Oct 14 2026 (CDT, -05:00).
const START = Date.parse("2026-10-14T17:30:00-05:00");
const hints = (text: string) => parseLeaveHints(text, START, TZ);

describe("parseLeaveHints", () => {
  it.each([
    ["Leave at 5:15", "2026-10-14T17:15:00-05:00"],
    ["leave by 4:50 pm", "2026-10-14T16:50:00-05:00"],
    ["Please leave the house at 5", "2026-10-14T17:00:00-05:00"],
    ["Leave home by 16:45", "2026-10-14T16:45:00-05:00"],
    ["Bring cleats.<br>Leave @ 4:55<br>Snacks: Leo", "2026-10-14T16:55:00-05:00"],
    ["Depart at 4:40", "2026-10-14T16:40:00-05:00"],
  ])("reads a set leave time from %j", (text, at) => {
    expect(hints(text).leaveAt).toBe(at);
  });

  it.each([
    ["Leave at 6:15", "after the start"],
    ["Leave at 9:00 am", "more than six hours before"],
    ["Leave at 25:00", "not a time"],
  ])("ignores %j (%s)", (text) => {
    expect(hints(text).leaveAt).toBeUndefined();
  });

  it.each([
    ["20 min drive", 20],
    ["It's a 1 hr 15 min drive from home", 75],
    ["about 25 minutes away", 25],
    ["Drive: 35 min", 35],
    ["Travel time 40 minutes", 40],
    ["1h drive", 60],
  ])("reads the trip from %j", (text, min) => {
    expect(hints(text).travelMin).toBe(min);
  });

  it.each([
    ["Arrive 15 min early", 15],
    ["Be there 10 minutes early for warmups", 10],
    ["Please be there by 5:00", 30],
    ["Arrive by 5:00", 30],
    ["arrive by 4:45pm", 45],
    ["Tournament. Arrive by 3:00 for check-in", 150],
    ["Warm-ups at 5:10", 20],
    ["Check-in: 5:15pm", 15],
  ])("reads how early to arrive from %j", (text, min) => {
    expect(hints(text).earlyMin).toBe(min);
  });

  it("finds a leave time the evening before an early-morning start", () => {
    const early = Date.parse("2026-10-15T01:30:00-05:00");
    expect(parseLeaveHints("Leave at 11:30 pm", early, TZ).leaveAt).toBe("2026-10-14T23:30:00-05:00");
    expect(parseLeaveHints("Arrive by 12:45", early, TZ).earlyMin).toBe(45);
  });

  it("reads several hints from one description", () => {
    expect(hints("Away game. 30 min drive, arrive 20 minutes early.")).toEqual({ travelMin: 30, earlyMin: 20 });
  });

  it("finds nothing in an ordinary description", () => {
    expect(hints("Bring water and shin guards. Game is 60 minutes.")).toEqual({});
    expect(hints("Zoom link: https://zoom.us/j/123 · we'll leave the doc open")).toEqual({});
    expect(parseLeaveHints(null, START, TZ)).toEqual({});
    // "before" about something else isn't how early to arrive.
    expect(hints("Pickup is 10 min before the carpool line")).toEqual({});
    expect(hints("Be there 15 min before the start").earlyMin).toBe(15);
  });

  it("skips a bare 'early' with no number for a later one that has it", () => {
    expect(hints("Come early if you can. Coaches: 15 min early.").earlyMin).toBe(15);
  });
});

describe("isoDurationMinutes", () => {
  it.each([
    ["PT30M", 30],
    ["PT1H15M", 75],
    ["-PT45M", 45],
    ["PT90S", 2],
    [{ toString: () => "PT20M" }, 20],
  ])("reads %j", (raw, min) => {
    expect(isoDurationMinutes(raw)).toBe(min);
  });

  it.each(["", "P", "PT0M", "garbage", null, undefined, "P2D"])("rejects %j", (raw) => {
    expect(isoDurationMinutes(raw)).toBeNull();
  });
});
