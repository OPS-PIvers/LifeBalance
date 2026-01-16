/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateInviteCode } from './inviteCodeGenerator';
import { getDoc } from 'firebase/firestore';

// Mock Firebase dependencies
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/firebase.config', () => ({
  db: {},
}));

describe('generateInviteCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to no collision
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as any);
  });

  it('should generate a code of length 6', async () => {
    const code = await generateInviteCode();
    expect(code).toHaveLength(6);
  });

  it('should use allowed characters', async () => {
    const code = await generateInviteCode();
    const allowedChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (const char of code) {
      expect(allowedChars).toContain(char);
    }
  });

  it('should use crypto.getRandomValues', async () => {
    const getRandomValuesSpy = vi.spyOn(crypto, 'getRandomValues');
    await generateInviteCode();
    expect(getRandomValuesSpy).toHaveBeenCalled();
    expect(getRandomValuesSpy.mock.calls[0][0]).toBeInstanceOf(Uint32Array);
  });

  it('should retry on collision', async () => {
    // First call returns exists=true (collision), second returns false (success)
    vi.mocked(getDoc)
      .mockResolvedValueOnce({ exists: () => true } as any)
      .mockResolvedValueOnce({ exists: () => false } as any);

    const code = await generateInviteCode();
    expect(code).toHaveLength(6);
    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('should throw error after max attempts', async () => {
    // Always return exists=true (collision)
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true } as any);

    await expect(generateInviteCode()).rejects.toThrow('Failed to generate unique invite code');
    expect(getDoc).toHaveBeenCalledTimes(10);
  });
});
