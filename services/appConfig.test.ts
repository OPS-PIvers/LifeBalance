import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDoc } from 'firebase/firestore';

vi.mock('@/firebase.config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...a: unknown[]) => ({ path: a.join('/') })),
  getDoc: vi.fn(),
}));

/** Build a Firestore-doc-snapshot stand-in. */
const snapshot = (exists: boolean, data: Record<string, unknown> = {}) =>
  ({ exists: () => exists, data: () => data }) as unknown as Awaited<ReturnType<typeof getDoc>>;

describe('getOpenSignup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // appConfig caches the in-flight promise across calls; reset module state so
    // each test reads a fresh value from its own mocked getDoc.
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const importFresh = async () => (await import('./appConfig')).getOpenSignup;

  it('returns true when the doc has openSignup: true', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { openSignup: true }));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(true);
  });

  it('returns false when openSignup is explicitly false', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { openSignup: false }));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(false);
  });

  it('returns false when the openSignup field is absent', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { aiEnabled: true }));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(false);
  });

  it('returns false when the config doc does not exist', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(false));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(false);
  });

  it('fails closed (returns false) when getDoc rejects', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('firestore unreachable'));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(false);
  });

  it('treats a non-boolean truthy value as not-open (strict === true)', async () => {
    // Guards against an operator setting openSignup: "true" (a string) and
    // accidentally throwing signup open. Only the boolean true opens it.
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { openSignup: 'true' }));
    const getOpenSignup = await importFresh();
    await expect(getOpenSignup()).resolves.toBe(false);
  });
});

describe('getBillingEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const importFresh = async () => (await import('./appConfig')).getBillingEnabled;

  it('returns true when the doc has billingEnabled: true', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { billingEnabled: true }));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(true);
  });

  it('returns false when billingEnabled is explicitly false', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { billingEnabled: false }));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(false);
  });

  it('returns false (dormant) when the billingEnabled field is absent', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { openSignup: true }));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(false);
  });

  it('returns false when the config doc does not exist', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(false));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(false);
  });

  it('fails closed (returns false) when getDoc rejects', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('firestore unreachable'));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(false);
  });

  it('treats a non-boolean truthy value as off (strict === true)', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { billingEnabled: 'true' }));
    const getBillingEnabled = await importFresh();
    await expect(getBillingEnabled()).resolves.toBe(false);
  });
});
