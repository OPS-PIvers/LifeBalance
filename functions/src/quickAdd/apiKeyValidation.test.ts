/**
 * Unit tests for the `hasScope` scope-check helper (apiKeyValidation.ts).
 *
 * `hasScope` is pure and Firestore-free, so no admin/firestore mocking is
 * needed here (contrast with getTodos.test.ts, which exercises the full
 * HTTP handler against a mocked Firestore). Mirrors the read-scope coverage
 * implied by getTodos's permission gating, extended to the new `bankSync`
 * scope added for the forthcoming bankEmailSync endpoint.
 */

import { describe, it, expect, vi } from "vitest";

// `hasScope` is pure, but the module also calls `admin.firestore()` at import
// time (for the exported `db`), so firebase-admin needs the same minimal mock
// getTodos.test.ts uses — otherwise import blows up with "no default app".
vi.mock("firebase-admin", () => {
  const firestore = Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => "TS", increment: (n: number) => ({ __inc: n }) },
  });
  return { firestore };
});

import { hasScope, ApiKeyPermissions } from "./apiKeyValidation";

const BASE_PERMS: ApiKeyPermissions = {
  habits: false,
  expenses: false,
  shoppingList: false,
  receiptScanning: false,
};

describe("hasScope", () => {
  it("returns false when permissions is undefined", () => {
    expect(hasScope(undefined, "read")).toBe(false);
    expect(hasScope(undefined, "bankSync")).toBe(false);
  });

  it("returns false when the scope is absent (legacy key)", () => {
    expect(hasScope(BASE_PERMS, "read")).toBe(false);
    expect(hasScope(BASE_PERMS, "bankSync")).toBe(false);
  });

  it("returns false when the scope is explicitly false", () => {
    const perms: ApiKeyPermissions = { ...BASE_PERMS, read: false, bankSync: false };
    expect(hasScope(perms, "read")).toBe(false);
    expect(hasScope(perms, "bankSync")).toBe(false);
  });

  it("returns true only for the scope explicitly enabled", () => {
    const perms: ApiKeyPermissions = { ...BASE_PERMS, bankSync: true };
    expect(hasScope(perms, "bankSync")).toBe(true);
    expect(hasScope(perms, "read")).toBe(false);
  });

  it("works for existing boolean (non-optional) scopes too", () => {
    const perms: ApiKeyPermissions = { ...BASE_PERMS, habits: true };
    expect(hasScope(perms, "habits")).toBe(true);
    expect(hasScope(perms, "expenses")).toBe(false);
  });
});
