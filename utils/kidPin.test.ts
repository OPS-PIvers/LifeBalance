import { describe, it, expect } from 'vitest';
import { hashKidPin, verifyKidPin, isValidPinFormat } from './kidPin';

describe('isValidPinFormat', () => {
  it('accepts 4-6 digit PINs', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('12345')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
  });

  it('rejects too-short, too-long, and non-numeric PINs', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('12 4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
  });
});

describe('hashKidPin', () => {
  it('produces a versioned v1:<salt>:<digest> string', async () => {
    const hash = await hashKidPin('1234');
    const parts = hash.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
    // 16-byte salt -> 32 hex chars; SHA-256 digest -> 64 hex chars.
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a fresh salt each call, so the same PIN hashes differently', async () => {
    const a = await hashKidPin('4321');
    const b = await hashKidPin('4321');
    expect(a).not.toBe(b);
  });

  it('throws on a malformed PIN', async () => {
    await expect(hashKidPin('12')).rejects.toThrow(/Invalid PIN/);
    await expect(hashKidPin('abcd')).rejects.toThrow(/Invalid PIN/);
  });
});

describe('verifyKidPin', () => {
  it('verifies a PIN against its own hash', async () => {
    const hash = await hashKidPin('2468');
    expect(await verifyKidPin('2468', hash)).toBe(true);
  });

  it('rejects the wrong PIN', async () => {
    const hash = await hashKidPin('2468');
    expect(await verifyKidPin('1357', hash)).toBe(false);
  });

  it('rejects a null/empty/garbage stored hash without throwing', async () => {
    expect(await verifyKidPin('1234', null)).toBe(false);
    expect(await verifyKidPin('1234', undefined)).toBe(false);
    expect(await verifyKidPin('1234', '')).toBe(false);
    expect(await verifyKidPin('1234', 'not-a-valid-hash')).toBe(false);
    expect(await verifyKidPin('1234', 'v2:abc:def')).toBe(false); // unknown scheme
  });

  it('rejects a malformed PIN even against a real hash', async () => {
    const hash = await hashKidPin('1234');
    expect(await verifyKidPin('12', hash)).toBe(false);
    expect(await verifyKidPin('', hash)).toBe(false);
  });
});
