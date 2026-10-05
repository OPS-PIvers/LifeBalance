/**
 * updateHouseholdTravel against a small in-memory Firestore: which events get
 * a Routes lookup, what's stored, cleanup, and the error shown in Settings.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-admin", () => ({ firestore: { FieldValue: { delete: () => "__delete__" } } }));
vi.mock("../googleAuth", () => ({ getGoogleAccessToken: async () => "token" }));

import { homeKeyOf, updateHouseholdTravel, type TravelDeps } from "./travel";
import type * as admin from "firebase-admin";

function fakeDb(seed: Record<string, Record<string, unknown>>) {
  const store = new Map(Object.entries(seed));
  const apply = (path: string, d: Record<string, unknown>, merge: boolean) => {
    const next: Record<string, unknown> = merge ? { ...(store.get(path) ?? {}) } : {};
    for (const [k, v] of Object.entries(d)) {
      if (v === "__delete__") delete next[k];
      else next[k] = v;
    }
    store.set(path, next);
  };
  const docRef = (path: string) => ({
    id: path.split("/").pop() ?? "",
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => apply(path, d, Boolean(o?.merge)),
  });
  const children = (path: string) =>
    [...store.keys()].filter((p) => p.startsWith(`${path}/`) && p.split("/").length === path.split("/").length + 1);
  const snap = (paths: string[]) => ({
    docs: paths.map((p) => ({ id: p.split("/").pop() ?? "", data: () => store.get(p) ?? {} })),
  });
  const db = {
    doc: docRef,
    collection: (path: string) => ({
      doc: (id: string) => docRef(`${path}/${id}`),
      get: async () => snap(children(path)),
      where: (field: string, _op: string, values: unknown[]) => ({
        get: async () => snap(children(path).filter((p) => values.includes(store.get(p)?.[field]))),
      }),
    }),
    batch: () => {
      const dels: string[] = [];
      return {
        delete: (ref: { id: string }) => dels.push(ref.id),
        commit: async () => {
          for (const id of dels) for (const p of [...store.keys()]) if (p.endsWith(`/wallTravel/${id}`)) store.delete(p);
        },
      };
    },
  };
  return { db: db as unknown as admin.firestore.Firestore, store };
}

const H = "households/h1";
const NOW = new Date("2026-10-05T19:00:00Z"); // 2 pm Chicago

function seed(extra: Record<string, Record<string, unknown>> = {}) {
  return {
    [`${H}/calendarFeedSecrets/_home`]: { address: "1 Home St, Orono, MN" },
    [`${H}/wallSettings/config`]: { timeZone: "America/Chicago" },
    [`${H}/calendarFeeds/kids`]: { alerts: true, travelMode: "drive" },
    [`${H}/calendarFeeds/work`]: { alerts: false },
    [`${H}/wallEvents/soccer`]: { feedId: "kids", date: "2026-10-05", allDay: false, start: "2026-10-05T16:00:00-05:00", location: "Orono Fields" },
    [`${H}/wallEvents/zoom`]: { feedId: "kids", date: "2026-10-05", allDay: false, start: "2026-10-05T16:00:00-05:00", location: "Zoom" },
    [`${H}/wallEvents/meeting`]: { feedId: "work", date: "2026-10-05", allDay: false, start: "2026-10-05T16:00:00-05:00", location: "Office" },
    [`${H}/wallEvents/late`]: { feedId: "kids", date: "2026-10-06", allDay: false, start: "2026-10-06T09:00:00-05:00", location: "School" },
    ...extra,
  };
}

function routes(response: { status: number; body: unknown }) {
  const fetch = vi.fn(async () => ({
    ok: response.status === 200,
    status: response.status,
    json: async () => response.body,
    text: async () => JSON.stringify(response.body),
  }));
  return { fetch: fetch as unknown as TravelDeps["fetch"], calls: fetch, token: async () => "t" };
}

describe("updateHouseholdTravel", () => {
  it("looks up only alert calendars' real places within four hours", async () => {
    const { db, store } = fakeDb(seed());
    const deps = routes({ status: 200, body: { routes: [{ duration: "1320s" }] } });
    await expect(updateHouseholdTravel(db, "h1", NOW, deps)).resolves.toEqual({ checked: 1 });
    expect(deps.calls).toHaveBeenCalledTimes(1);
    const body = JSON.parse((deps.calls.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ origin: { address: "1 Home St, Orono, MN" }, destination: { address: "Orono Fields" }, travelMode: "DRIVE" });
    expect(store.get(`${H}/wallTravel/soccer`)).toMatchObject({ minutes: 22, mode: "drive", start: "2026-10-05T16:00:00-05:00", homeKey: homeKeyOf("1 Home St, Orono, MN") });
    // The stored doc never carries the address or the place.
    expect(JSON.stringify(store.get(`${H}/wallTravel/soccer`))).not.toMatch(/Home St|Orono Fields/);
  });

  it("doesn't ask again until the event is close, then rechecks once", async () => {
    const { db } = fakeDb(seed());
    const deps = routes({ status: 200, body: { routes: [{ duration: "600s" }] } });
    await updateHouseholdTravel(db, "h1", NOW, deps);
    await updateHouseholdTravel(db, "h1", new Date(NOW.getTime() + 15 * 60_000), deps);
    expect(deps.calls).toHaveBeenCalledTimes(1);
    await updateHouseholdTravel(db, "h1", new Date("2026-10-05T19:30:00Z"), deps); // 90 min before
    expect(deps.calls).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a home address", async () => {
    const s = seed();
    delete s[`${H}/calendarFeedSecrets/_home`];
    const { db } = fakeDb(s);
    const deps = routes({ status: 200, body: {} });
    await expect(updateHouseholdTravel(db, "h1", NOW, deps)).resolves.toEqual({ checked: 0 });
    expect(deps.calls).not.toHaveBeenCalled();
  });

  it("records a place Google can't route as no time, and a disabled API for Settings", async () => {
    const one = fakeDb(seed());
    await updateHouseholdTravel(one.db, "h1", NOW, routes({ status: 404, body: {} }));
    expect(one.store.get(`${H}/wallTravel/soccer`)).toMatchObject({ minutes: null });

    const two = fakeDb(seed());
    await updateHouseholdTravel(two.db, "h1", NOW, routes({ status: 403, body: { error: "SERVICE_DISABLED" } }));
    expect(two.store.get(`${H}/wallSettings/config`)?.travelError).toMatch(/Routes API/);
    expect(two.store.has(`${H}/wallTravel/soccer`)).toBe(false);
    // Fixed: the next good lookup clears it.
    await updateHouseholdTravel(two.db, "h1", NOW, routes({ status: 200, body: { routes: [{ duration: "60s" }] } }));
    expect(two.store.get(`${H}/wallSettings/config`)?.travelError).toBeUndefined();
  });

  it("forgets finished events", async () => {
    const { db, store } = fakeDb(seed({ [`${H}/wallTravel/old`]: { minutes: 5, start: "2026-10-05T08:00:00-05:00" } }));
    await updateHouseholdTravel(db, "h1", NOW, routes({ status: 200, body: { routes: [{ duration: "60s" }] } }));
    expect(store.has(`${H}/wallTravel/old`)).toBe(false);
  });
});
