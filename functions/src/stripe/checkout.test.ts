/**
 * Tests for the callable `createcheckoutsession` Cloud Function (Plan 050a).
 *
 * Mirrors geminiProxy.test.ts: `onCall(opts, handler)` returns the raw handler;
 * `HttpsError` records its `code`; `defineSecret().value()` is stubbed; the Stripe
 * SDK and firebase-admin Firestore are mocked. A small path→data store drives the
 * member / household / app_config reads.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "HttpsError";
    }
  }
  return { MockHttpsError };
});

vi.mock("firebase-functions/v2/https", () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({ value: () => "test-secret" }),
}));
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    customers = { create: stripeMock.customersCreate };
    checkout = { sessions: { create: stripeMock.sessionsCreate } };
  },
}));

const adminMock = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const db = {
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      }),
    })),
  };
  return { db, store };
});
vi.mock("firebase-admin", () => ({
  firestore: () => adminMock.db,
}));

import { createcheckoutsession } from "./checkout";

type Callable = (request: unknown) => Promise<unknown>;
const call = (request: unknown) =>
  (createcheckoutsession as unknown as Callable)(request);

const AUTH = { uid: "u1" };
const baseData = {
  householdId: "hh_1",
  successUrl: "https://app.test/billing?ok=1",
  cancelUrl: "https://app.test/billing?canceled=1",
};

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.store.clear();
  // Default happy-path world: u1 is an admin of hh_1, price configured, no customer yet.
  adminMock.store.set("households/hh_1/members/u1", { role: "admin" });
  adminMock.store.set("households/hh_1", { name: "Home" });
  adminMock.store.set("app_config/global", { stripePriceId: "price_123" });
  stripeMock.customersCreate.mockResolvedValue({ id: "cus_new" });
  stripeMock.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s1" });
});

describe("createcheckoutsession", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(call({ data: baseData })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing householdId with invalid-argument", async () => {
    await expect(
      call({ auth: AUTH, data: { ...baseData, householdId: undefined } })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a missing successUrl with invalid-argument", async () => {
    await expect(
      call({ auth: AUTH, data: { ...baseData, successUrl: undefined } })
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a caller who is not an admin of the household", async () => {
    adminMock.store.set("households/hh_1/members/u1", { role: "member" });
    await expect(call({ auth: AUTH, data: baseData })).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects when billing is not configured (no stripePriceId)", async () => {
    adminMock.store.set("app_config/global", {});
    await expect(call({ auth: AUTH, data: baseData })).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("creates a customer + session and returns the checkout url for a new subscriber", async () => {
    const result = await call({ auth: AUTH, data: baseData });

    expect(stripeMock.customersCreate).toHaveBeenCalledWith({
      metadata: { householdId: "hh_1" },
    });
    expect(stripeMock.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_new",
        client_reference_id: "hh_1",
        line_items: [{ price: "price_123", quantity: 1 }],
        success_url: baseData.successUrl,
        cancel_url: baseData.cancelUrl,
      })
    );
    expect(result).toEqual({ url: "https://checkout.stripe.test/s1" });
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    adminMock.store.set("households/hh_1", {
      name: "Home",
      subscription: { stripeCustomerId: "cus_existing" },
    });

    const result = await call({ auth: AUTH, data: baseData });

    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing" })
    );
    expect(result).toEqual({ url: "https://checkout.stripe.test/s1" });
  });
});
