/**
 * Tests for the wall pairing callables, against a small in-memory stand-in for
 * firebase-admin's Firestore and Auth (path → data store, batches and
 * transactions applied immediately).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { MockHttpsError };
});

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const fake = vi.hoisted(() => {
  class Timestamp {
    constructor(private ms: number) {}
    static fromMillis(ms: number) { return new Timestamp(ms); }
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
  }
  const SERVER_TS = { __serverTs: true };
  const DELETE = { __delete: true };
  const store = new Map<string, Record<string, unknown>>();
  let autoId = 0;

  const applyUpdate = (path: string, patch: Record<string, unknown>) => {
    const cur = store.get(path);
    if (!cur) throw new Error(`update of missing doc ${path}`);
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (v === DELETE) delete next[k];
      else next[k] = v;
    }
    store.set(path, next);
  };

  const docRef = (path: string): {
    id: string; path: string;
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    set: (d: Record<string, unknown>) => Promise<void>;
    update: (d: Record<string, unknown>) => Promise<void>;
    delete: () => Promise<void>;
  } => ({
    id: path.split("/").pop() ?? "",
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (d) => { store.set(path, { ...d }); },
    update: async (d) => applyUpdate(path, d),
    delete: async () => { store.delete(path); },
  });

  const collection = (path: string) => ({
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    where: (field: string, _op: string, value: unknown) => ({
      get: async () => {
        const docs = [...store.entries()]
          .filter(([p, d]) => p.startsWith(`${path}/`) && p.split("/").length === path.split("/").length + 1 && d[field] === value)
          .map(([p, d]) => ({ id: p.split("/").pop(), ref: docRef(p), data: () => d }));
        return { docs, size: docs.length };
      },
    }),
  });

  type Ref = ReturnType<typeof docRef>;
  const db = {
    doc: docRef,
    collection,
    batch: () => {
      const ops: (() => Promise<void>)[] = [];
      return {
        set: (ref: Ref, d: Record<string, unknown>) => ops.push(() => ref.set(d)),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    runTransaction: async (fn: (txn: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: Ref) => ref.get(),
        set: (ref: Ref, d: Record<string, unknown>) => { store.set(ref.path, { ...d }); },
        update: (ref: Ref, d: Record<string, unknown>) => applyUpdate(ref.path, d),
        delete: (ref: Ref) => { store.delete(ref.path); },
      }),
  };

  const firestore = Object.assign(() => db, {
    Timestamp,
    FieldValue: { serverTimestamp: () => SERVER_TS, delete: () => DELETE },
  });

  const users = new Map<string, Record<string, unknown>>();
  const authMock = {
    createUser: vi.fn(async ({ uid }: { uid: string }) => {
      if (users.has(uid)) throw Object.assign(new Error("exists"), { code: "auth/uid-already-exists" });
      users.set(uid, {});
    }),
    setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown>) => { users.set(uid, { claims }); }),
    createCustomToken: vi.fn(async (uid: string) => `token-for-${uid}`),
    revokeRefreshTokens: vi.fn(async () => undefined),
    deleteUser: vi.fn(async (uid: string) => {
      if (!users.delete(uid)) throw Object.assign(new Error("nf"), { code: "auth/user-not-found" });
    }),
  };

  return { store, users, firestore, authMock, Timestamp, reset: () => { store.clear(); users.clear(); autoId = 0; } };
});

vi.mock("firebase-admin", () => ({ firestore: fake.firestore, auth: () => fake.authMock }));

import { createwallpairing, redeemwallpairing, revokewalldisplay } from "./pairing";
import { MAX_FAILURES_PER_CALLER, PAIRING_TTL_MS, hashPairingCode } from "./pairingLogic";

type Handler<T> = (request: unknown) => Promise<T>;
const create = createwallpairing as unknown as Handler<{ code: string; expiresAt: string; did: string }>;
const redeem = redeemwallpairing as unknown as Handler<{ token: string; householdId: string; displayId: string }>;
const revoke = revokewalldisplay as unknown as Handler<{ ok: true }>;

const HH = "H1";
const ADMIN = { uid: "admin1", token: {} };
const MEMBER = { uid: "member1", token: {} };
const raw = (ip = "1.1.1.1") => ({ rawRequest: { ip } });

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  fake.store.set(`households/${HH}/members/admin1`, { role: "admin" });
  fake.store.set(`households/${HH}/members/member1`, { role: "member" });
});

describe("createwallpairing", () => {
  it("rejects non-admins, displays and bad names", async () => {
    await expect(create({ data: { householdId: HH, name: "Kitchen" } })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(create({ auth: MEMBER, data: { householdId: HH, name: "Kitchen" } })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      create({ auth: { uid: "display_x", token: { display: true } }, data: { householdId: HH, name: "K" } })
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(create({ auth: ADMIN, data: { householdId: HH, name: "  " } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(create({ auth: ADMIN, data: { householdId: "a/b", name: "K" } })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("creates a pending display and a hashed pairing doc", async () => {
    const { code, did, expiresAt } = await create({ auth: ADMIN, data: { householdId: HH, name: "Kitchen iPad" } });
    expect(code).toMatch(/^[1-9]\d{5}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(fake.store.get(`households/${HH}/displays/${did}`)).toMatchObject({ name: "Kitchen iPad", status: "pending", createdBy: "admin1" });
    expect(fake.store.get(`wallPairings/${hashPairingCode(code)}`)).toMatchObject({ hid: HH, did });
    // The plain code is stored nowhere.
    expect(JSON.stringify([...fake.store.values()])).not.toContain(code);
  });

  it("caps live codes at 3 and clears expired pending displays", async () => {
    for (let i = 0; i < 3; i++) await create({ auth: ADMIN, data: { householdId: HH, name: `D${i}` } });
    await expect(create({ auth: ADMIN, data: { householdId: HH, name: "D4" } })).rejects.toMatchObject({ code: "resource-exhausted" });
    // Expire one: the next create removes it and succeeds.
    const [path, doc] = [...fake.store.entries()].find(([p]) => p.includes("/displays/")) ?? ["", {}];
    fake.store.set(path, { ...doc, pairingExpiresAt: fake.Timestamp.fromMillis(Date.now() - 1) });
    await expect(create({ auth: ADMIN, data: { householdId: HH, name: "D4" } })).resolves.toBeTruthy();
    expect(fake.store.has(path)).toBe(false);
  });
});

describe("redeemwallpairing", () => {
  it("activates the display and returns a display token with claims", async () => {
    const { code, did } = await create({ auth: ADMIN, data: { householdId: HH, name: "Kitchen iPad" } });
    const result = await redeem({ ...raw(), data: { code, userAgent: "iPad" } });
    expect(result).toEqual({ token: `token-for-display_${did}`, householdId: HH, displayId: did });
    expect(fake.authMock.setCustomUserClaims).toHaveBeenCalledWith(`display_${did}`, { display: true, hid: HH, did });
    expect(fake.store.get(`households/${HH}/displays/${did}`)).toMatchObject({ status: "active", userAgent: "iPad" });
    expect(fake.store.get(`households/${HH}/displays/${did}`)).not.toHaveProperty("pairingExpiresAt");
    expect(fake.store.has(`wallPairings/${hashPairingCode(code)}`)).toBe(false);
    // Never a member doc, never admin.
    expect(fake.store.has(`households/${HH}/members/display_${did}`)).toBe(false);
  });

  it("works only once", async () => {
    const { code } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    await redeem({ ...raw(), data: { code } });
    await expect(redeem({ ...raw(), data: { code } })).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects an expired code", async () => {
    const { code } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    const key = `wallPairings/${hashPairingCode(code)}`;
    const doc = fake.store.get(key) ?? {};
    fake.store.set(key, { ...doc, expiresAt: fake.Timestamp.fromMillis(Date.now() - PAIRING_TTL_MS) });
    await expect(redeem({ ...raw(), data: { code } })).rejects.toMatchObject({ code: "not-found" });
  });

  it("throttles a caller after repeated failures, even for a valid code", async () => {
    const { code } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    for (let i = 0; i < MAX_FAILURES_PER_CALLER; i++) {
      await expect(redeem({ ...raw("6.6.6.6"), data: { code: "111111" } })).rejects.toMatchObject({ code: "not-found" });
    }
    await expect(redeem({ ...raw("6.6.6.6"), data: { code } })).rejects.toMatchObject({ code: "resource-exhausted" });
    // Another caller is unaffected.
    await expect(redeem({ ...raw("2.2.2.2"), data: { code } })).resolves.toMatchObject({ householdId: HH });
  });

  it("keeps the code usable when minting the token fails (IAM not set up)", async () => {
    const { code } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    fake.authMock.createCustomToken.mockRejectedValueOnce(new Error("iam.serviceAccounts.signBlob denied"));
    await expect(redeem({ ...raw(), data: { code } })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(redeem({ ...raw(), data: { code } })).resolves.toMatchObject({ householdId: HH });
  });
});

describe("revokewalldisplay", () => {
  it("revokes an active display and deletes its auth user", async () => {
    const { code, did } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    await redeem({ ...raw(), data: { code } });
    await expect(revoke({ auth: MEMBER, data: { householdId: HH, did } })).rejects.toMatchObject({ code: "permission-denied" });
    await revoke({ auth: ADMIN, data: { householdId: HH, did } });
    expect(fake.store.get(`households/${HH}/displays/${did}`)).toMatchObject({ status: "revoked" });
    expect(fake.authMock.revokeRefreshTokens).toHaveBeenCalledWith(`display_${did}`);
    expect(fake.users.has(`display_${did}`)).toBe(false);
  });

  it("cancels a pending display and its code", async () => {
    const { code, did } = await create({ auth: ADMIN, data: { householdId: HH, name: "K" } });
    await revoke({ auth: ADMIN, data: { householdId: HH, did } });
    expect(fake.store.has(`households/${HH}/displays/${did}`)).toBe(false);
    expect(fake.store.has(`wallPairings/${hashPairingCode(code)}`)).toBe(false);
    await expect(redeem({ ...raw(), data: { code } })).rejects.toMatchObject({ code: "not-found" });
  });
});
