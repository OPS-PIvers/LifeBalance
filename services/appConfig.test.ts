import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDoc, setDoc } from 'firebase/firestore';

vi.mock('@/firebase.config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...a: unknown[]) => ({ path: a.join('/') })),
  getDoc: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(undefined),
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

describe('getPlaidEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const importFresh = async () => (await import('./appConfig')).getPlaidEnabled;

  it('returns true only when plaidEnabled is explicitly true', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { plaidEnabled: true }));
    await expect((await importFresh())()).resolves.toBe(true);
  });

  it('returns false (dormant) when absent, explicitly false, non-boolean, or doc missing', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { openSignup: true }));
    await expect((await importFresh())()).resolves.toBe(false);
    vi.resetModules();
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { plaidEnabled: false }));
    await expect((await importFresh())()).resolves.toBe(false);
    vi.resetModules();
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { plaidEnabled: 'true' }));
    await expect((await importFresh())()).resolves.toBe(false);
    vi.resetModules();
    vi.mocked(getDoc).mockResolvedValue(snapshot(false));
    await expect((await importFresh())()).resolves.toBe(false);
  });

  it('fails closed (returns false) when getDoc rejects', async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error('firestore unreachable'));
    await expect((await importFresh())()).resolves.toBe(false);
  });
});

describe('setAppFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the single flag to app_config/global with merge (never clobbering the others)', async () => {
    const { setAppFlag } = await import('./appConfig');
    await setAppFlag('openSignup', true);

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, data, options] = vi.mocked(setDoc).mock.calls[0]!;
    // doc() is mocked to echo its args as a path; assert it targets the global
    // app-config document (the leading segment is the stubbed db handle).
    expect((ref as { path: string }).path).toMatch(/app_config\/global$/);
    // Only the flipped key is written...
    expect(data).toEqual({ openSignup: true });
    // ...with merge so sibling flags on the doc survive.
    expect(options).toEqual({ merge: true });
  });

  it('can write a false value (disabling a flag) with merge', async () => {
    const { setAppFlag, AI_ENABLED_FLAG_KEY } = await import('./appConfig');
    await setAppFlag(AI_ENABLED_FLAG_KEY, false);

    const [, data, options] = vi.mocked(setDoc).mock.calls[0]!;
    expect(data).toEqual({ [AI_ENABLED_FLAG_KEY]: false });
    expect(options).toEqual({ merge: true });
  });

  it('invalidates caches so the operator session re-reads its own write immediately', async () => {
    const mod = await import('./appConfig');

    // Prime the cache with a getDoc that reports billing OFF.
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { billingEnabled: false }));
    await expect(mod.getBillingEnabled()).resolves.toBe(false);
    expect(getDoc).toHaveBeenCalledTimes(1);

    // A second read within the TTL is served from cache (no fresh getDoc).
    await expect(mod.getBillingEnabled()).resolves.toBe(false);
    expect(getDoc).toHaveBeenCalledTimes(1);

    // Operator flips it ON; setAppFlag invalidates the cache.
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { billingEnabled: true }));
    await mod.setAppFlag('billingEnabled', true);

    // The next read performs a FRESH getDoc and reflects the new value.
    await expect(mod.getBillingEnabled()).resolves.toBe(true);
    expect(getDoc).toHaveBeenCalledTimes(2);
  });
});

describe('invalidateAppConfigCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces a fresh getDoc on the next getKidModeEnabled / getOpenSignup read', async () => {
    const mod = await import('./appConfig');

    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { kidModeEnabled: false, openSignup: false }));
    await expect(mod.getKidModeEnabled()).resolves.toBe(false);
    await expect(mod.getOpenSignup()).resolves.toBe(false);
    expect(getDoc).toHaveBeenCalledTimes(2);

    // Cached reads — no additional getDoc.
    await expect(mod.getKidModeEnabled()).resolves.toBe(false);
    await expect(mod.getOpenSignup()).resolves.toBe(false);
    expect(getDoc).toHaveBeenCalledTimes(2);

    // After invalidation both getters re-read from source.
    vi.mocked(getDoc).mockResolvedValue(snapshot(true, { kidModeEnabled: true, openSignup: true }));
    mod.invalidateAppConfigCaches();

    await expect(mod.getKidModeEnabled()).resolves.toBe(true);
    await expect(mod.getOpenSignup()).resolves.toBe(true);
    expect(getDoc).toHaveBeenCalledTimes(4);
  });
});
