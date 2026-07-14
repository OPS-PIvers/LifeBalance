import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, deriveKey } from "./crypto";

const HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars
const PASSPHRASE = "any sufficiently random operator secret";

describe("apiKeys/crypto", () => {
  describe("round-trip", () => {
    it("decrypts what it encrypted (hex key)", () => {
      const plain = "lb_abc123_0123456789abcdef0123456789abcdef";
      const payload = encryptSecret(plain, HEX_KEY);
      expect(decryptSecret(payload, HEX_KEY)).toBe(plain);
    });

    it("decrypts what it encrypted (passphrase secret hashed to 32 bytes)", () => {
      const plain = "lb_xyz789_fedcba9876543210fedcba9876543210";
      const payload = encryptSecret(plain, PASSPHRASE);
      expect(decryptSecret(payload, PASSPHRASE)).toBe(plain);
    });

    it("produces a versioned 4-part payload", () => {
      const payload = encryptSecret("secret", HEX_KEY);
      const parts = payload.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
    });

    it("uses a fresh IV each call, so identical plaintext encrypts differently", () => {
      const a = encryptSecret("same", HEX_KEY);
      const b = encryptSecret("same", HEX_KEY);
      expect(a).not.toBe(b);
      // ...but both decrypt back to the same plaintext.
      expect(decryptSecret(a, HEX_KEY)).toBe("same");
      expect(decryptSecret(b, HEX_KEY)).toBe("same");
    });
  });

  describe("integrity / failure modes", () => {
    it("throws when decrypting with the wrong secret", () => {
      const payload = encryptSecret("secret", HEX_KEY);
      expect(() => decryptSecret(payload, "the-wrong-secret")).toThrow();
    });

    it("throws when the ciphertext has been tampered with", () => {
      const payload = encryptSecret("secret", HEX_KEY);
      const [v, iv, ct, tag] = payload.split(":");
      // Flip a byte in the ciphertext segment.
      const tampered = Buffer.from(ct!, "base64");
      tampered[0] = tampered[0]! ^ 0xff;
      const bad = [v, iv, tampered.toString("base64"), tag].join(":");
      expect(() => decryptSecret(bad, HEX_KEY)).toThrow();
    });

    it("throws on a malformed payload", () => {
      expect(() => decryptSecret("not-a-valid-payload", HEX_KEY)).toThrow(
        "Malformed ciphertext payload"
      );
    });

    it("throws on an unknown version prefix", () => {
      const payload = encryptSecret("secret", HEX_KEY);
      const withBadVersion = payload.replace(/^v1:/, "v2:");
      expect(() => decryptSecret(withBadVersion, HEX_KEY)).toThrow(
        "Malformed ciphertext payload"
      );
    });
  });

  describe("deriveKey", () => {
    it("uses a 64-hex secret as the raw 32-byte key", () => {
      expect(deriveKey(HEX_KEY)).toEqual(Buffer.from(HEX_KEY, "hex"));
      expect(deriveKey(HEX_KEY)).toHaveLength(32);
    });

    it("hashes a non-hex secret to a stable 32-byte key", () => {
      const first = deriveKey(PASSPHRASE);
      const second = deriveKey(PASSPHRASE);
      expect(first).toHaveLength(32);
      expect(first).toEqual(second);
    });
  });
});
