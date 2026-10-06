import { describe, expect, it } from "vitest";
import { VOICE_MISS_PAGE, expiryMs, isExpired, parseDeleteBody, sortMisses, toExportedMiss } from "./voiceMissesLogic";

const ts = (ms: number) => ({ toMillis: () => ms });

describe("voice miss export", () => {
  it("maps a stored miss to the export shape, guarding every field", () => {
    expect(
      toExportedMiss("m1", {
        kind: "undo", heard: "show dinner", free: "jarvis show dinner", alternative: "show dinner", engine: "device",
        view: "calendar:week", did: "Showed meals", displayId: "d1", appVersion: "wall-4", at: "2026-10-06T12:00:00.000Z", expireAt: ts(1),
      })
    ).toEqual({
      id: "m1", kind: "undo", heard: "show dinner", free: "jarvis show dinner", alternative: "show dinner", engine: "device",
      view: "calendar:week", did: "Showed meals", displayId: "d1", appVersion: "wall-4", at: "2026-10-06T12:00:00.000Z",
    });
    expect(toExportedMiss("m2", { heard: 5 })).toMatchObject({ heard: "", did: null, kind: "" });
  });

  it("knows an expired miss, and never treats a missing expiry as expired", () => {
    expect(expiryMs(ts(10))).toBe(10);
    expect(expiryMs("2026-01-01")).toBeNull();
    expect(isExpired({ expireAt: ts(10) }, 10)).toBe(true);
    expect(isExpired({ expireAt: ts(11) }, 10)).toBe(false);
    expect(isExpired({}, 10)).toBe(false);
  });

  it("sorts oldest first", () => {
    const m = (id: string, at: string) => toExportedMiss(id, { at });
    expect(sortMisses([m("b", "2026-10-06T02:00:00Z"), m("a", "2026-10-06T01:00:00Z"), m("c", "2026-10-06T01:00:00Z")]).map(x => x.id)).toEqual(["a", "c", "b"]);
  });
});

describe("parseDeleteBody", () => {
  it("accepts plain ids, deduplicated", () => {
    expect(parseDeleteBody({ delete: ["a", "b", "a"] })).toEqual({ ids: ["a", "b"] });
    expect(parseDeleteBody({ delete: [] })).toEqual({ ids: [] });
  });

  it.each([
    [null],
    ["delete"],
    [{}],
    [{ delete: "a" }],
    [{ delete: ["../apiKeys/k1"] }],
    [{ delete: ["households/h1/voiceMisses/a"] }],
    [{ delete: [7] }],
    [{ delete: Array.from({ length: VOICE_MISS_PAGE + 1 }, (_, i) => `m${i}`) }],
  ])("rejects %j", body => {
    expect(parseDeleteBody(body)).toHaveProperty("error");
  });
});
