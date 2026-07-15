import { describe, it, expect } from 'vitest';
import { isValidInviteEmail, sendSplitInvite } from '@/utils/splitInvite';

describe('isValidInviteEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidInviteEmail('a@b.com')).toBe(true);
    expect(isValidInviteEmail('  first.last@sub.domain.org ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidInviteEmail('nope')).toBe(false);
    expect(isValidInviteEmail('a@b')).toBe(false);
    expect(isValidInviteEmail('a b@c.com')).toBe(false);
    expect(isValidInviteEmail('')).toBe(false);
  });
});

describe('sendSplitInvite (stub)', () => {
  it('defers a valid request (no mail infra) rather than claiming a send', async () => {
    const r = await sendSplitInvite({ email: 'dan@x.com', amount: 12.5, payerName: 'Alex' });
    expect(r.status).toBe('deferred');
    expect(typeof r.at).toBe('string');
  });

  it('rejects an invalid email', async () => {
    const r = await sendSplitInvite({ email: 'bad', amount: 12.5, payerName: 'Alex' });
    expect(r.status).toBe('rejected');
  });

  it('rejects a non-positive amount', async () => {
    const r = await sendSplitInvite({ email: 'dan@x.com', amount: 0, payerName: 'Alex' });
    expect(r.status).toBe('rejected');
  });
});
