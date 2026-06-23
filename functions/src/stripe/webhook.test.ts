/**
 * HTTP-layer tests for the `stripewebhook` Cloud Function (Plan 050a).
 *
 * Mirrors index.test.ts's mocking style: `onRequest(opts, handler)` returns the raw
 * handler so we call it as `(req, res)`. The Stripe SDK is mocked so we control
 * `webhooks.constructEvent` (throw = bad signature; return = a verified event), and
 * firebase-admin exposes a reconfigurable mock Firestore so we assert the write.
 * The event→patch mapping itself is covered purely in subscriptionEvent.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const constructEventMock = vi.hoisted(() => vi.fn());
vi.mock("stripe", () => ({
  default: class {
    webhooks = { constructEvent: constructEventMock };
  },
}));

vi.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: (_name: string) => ({ value: () => "test-secret" }),
}));
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const adminMock = vi.hoisted(() => {
  const setMock = vi.fn();
  const docGetMock = vi.fn();
  const whereGetMock = vi.fn();
  const docRef = { get: docGetMock, set: setMock };
  const chain: Record<string, unknown> = {};
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.get = whereGetMock;
  const collectionRef = {
    doc: vi.fn(() => docRef),
    where: chain.where,
    limit: chain.limit,
    get: whereGetMock,
  };
  const db = { collection: vi.fn(() => collectionRef) };
  return { db, setMock, docGetMock, whereGetMock, docRef };
});

vi.mock("firebase-admin", () => ({
  firestore: () => adminMock.db,
}));

// Import AFTER mocks are registered.
import { stripewebhook } from "./webhook";

type Handler = (req: unknown, res: unknown) => Promise<void>;

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): { send(b: unknown): void; json(b: unknown): void };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return {
        send: (b: unknown) => {
          res.body = b;
        },
        json: (b: unknown) => {
          res.body = b;
        },
      };
    },
  };
  return res;
}

const postReq = (over: Record<string, unknown> = {}) => ({
  method: "POST",
  headers: { "stripe-signature": "sig_123" },
  rawBody: Buffer.from("{}"),
  ...over,
});

const call = (req: unknown, res: unknown) =>
  (stripewebhook as unknown as Handler)(req, res);

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.docGetMock.mockResolvedValue({ exists: true });
  adminMock.whereGetMock.mockResolvedValue({ docs: [{ ref: adminMock.docRef }] });
});

describe("stripewebhook", () => {
  it("rejects a non-POST request with 405 and never verifies", async () => {
    const res = makeRes();
    await call({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("rejects a request missing the stripe-signature header with 400", async () => {
    const res = makeRes();
    await call(postReq({ headers: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with 400 and never writes", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = makeRes();
    await call(postReq(), res);
    expect(res.statusCode).toBe(400);
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });

  it("writes the parsed patch to the household resolved by client_reference_id", async () => {
    constructEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "hh_1",
          customer: "cus_1",
          subscription: "sub_1",
        },
      },
    });
    const res = makeRes();
    await call(postReq(), res);
    expect(res.statusCode).toBe(200);
    expect(adminMock.setMock).toHaveBeenCalledWith(
      {
        subscription: {
          plan: "premium",
          status: "active",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
        },
      },
      { merge: true }
    );
  });

  it("resolves the household by stripeCustomerId for subscription events", async () => {
    constructEventMock.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } },
    });
    const res = makeRes();
    await call(postReq(), res);
    expect(res.statusCode).toBe(200);
    expect(adminMock.whereGetMock).toHaveBeenCalled();
    expect(adminMock.setMock).toHaveBeenCalledWith(
      { subscription: { plan: "free", status: "canceled" } },
      { merge: true }
    );
  });

  it("acks an unhandled event type with 200 and does not write", async () => {
    constructEventMock.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: {} },
    });
    const res = makeRes();
    await call(postReq(), res);
    expect(res.statusCode).toBe(200);
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });

  it("acks with 200 (no retry storm) when no household matches the customer", async () => {
    adminMock.whereGetMock.mockResolvedValue({ docs: [] });
    constructEventMock.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_unknown", status: "canceled" } },
    });
    const res = makeRes();
    await call(postReq(), res);
    expect(res.statusCode).toBe(200);
    expect(adminMock.setMock).not.toHaveBeenCalled();
  });
});
