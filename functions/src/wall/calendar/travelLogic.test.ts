import { describe, expect, it } from "vitest";
import {
  TRAVEL_LOOKAHEAD_MS,
  TRAVEL_RECHECK_MS,
  homeAddress,
  needsTravelCheck,
  routableLocation,
  routeMinutes,
  routesRequestBody,
  travelModeOf,
} from "./travelLogic";

const MIN = 60_000;

describe("routableLocation", () => {
  it("keeps real places", () => {
    expect(routableLocation(" Orono  Middle School, 685 Old Crystal Bay Rd ")).toBe("Orono Middle School, 685 Old Crystal Bay Rd");
    expect(routableLocation("Target")).toBe("Target");
  });

  it("drops calls, links and placeholders", () => {
    for (const loc of [undefined, "", "TBD", "Zoom", "https://meet.google.com/abc", "Microsoft Teams Meeting", "online", "x"]) {
      expect(routableLocation(loc)).toBeNull();
    }
  });
});

describe("needsTravelCheck", () => {
  const start = 1_000 * MIN;
  it("looks up first within four hours", () => {
    expect(needsTravelCheck(start, start - TRAVEL_LOOKAHEAD_MS - MIN, null)).toBe(false);
    expect(needsTravelCheck(start, start - TRAVEL_LOOKAHEAD_MS + MIN, null)).toBe(true);
  });

  it("looks again once inside ~95 minutes, only once", () => {
    const firstCheck = start - 3 * 60 * MIN;
    expect(needsTravelCheck(start, start - 2 * 60 * MIN, firstCheck)).toBe(false);
    expect(needsTravelCheck(start, start - TRAVEL_RECHECK_MS + MIN, firstCheck)).toBe(true);
    const recheck = start - 90 * MIN;
    expect(needsTravelCheck(start, start - 75 * MIN, recheck)).toBe(false);
  });

  it("never for an event that started", () => {
    expect(needsTravelCheck(start, start, null)).toBe(false);
  });
});

describe("Routes request and response", () => {
  it("drives with live traffic", () => {
    expect(routesRequestBody("1 Home St", "School", "drive", "2026-10-05T21:00:00Z")).toEqual({
      origin: { address: "1 Home St" },
      destination: { address: "School" },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    });
  });

  it("plans transit to arrive on time", () => {
    expect(routesRequestBody("a", "b", "transit", "2026-10-05T21:00:00Z")).toMatchObject({ travelMode: "TRANSIT", arrivalTime: "2026-10-05T21:00:00Z" });
    expect(routesRequestBody("a", "b", "bike", "x")).toEqual({ origin: { address: "a" }, destination: { address: "b" }, travelMode: "BICYCLE" });
  });

  it("reads the duration in whole minutes", () => {
    expect(routeMinutes({ routes: [{ duration: "1261s" }] })).toBe(22);
    expect(routeMinutes({ routes: [{ duration: "20s" }] })).toBe(1);
    expect(routeMinutes({ routes: [] })).toBeNull();
    expect(routeMinutes({})).toBeNull();
    expect(routeMinutes(null)).toBeNull();
  });
});

describe("homeAddress / travelModeOf", () => {
  it("tidies an address", () => {
    expect(homeAddress("  123  Main St\nOrono, MN ")).toBe("123 Main St Orono, MN");
    expect(homeAddress("")).toBeNull();
    expect(homeAddress("x".repeat(201))).toBeNull();
  });

  it("defaults to driving", () => {
    expect(travelModeOf("walk")).toBe("walk");
    expect(travelModeOf("teleport")).toBe("drive");
  });
});
