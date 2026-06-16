import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Hoist the mock function so it can be referenced inside vi.mock
const { generateContentMock } = vi.hoisted(() => {
  return { generateContentMock: vi.fn() };
});

// These tests `await import('./geminiService')`, pulling in a heavy module graph;
// raise the per-test timeout so the first import per file doesn't flake the 5s
// default under the full-repo parallel run.
vi.setConfig({ testTimeout: 30000 });

vi.mock('@/firebase.config', () => ({ db: {} }));

// Track update calls so we can assert quota refund behavior.
const { txnUpdateMock } = vi.hoisted(() => ({ txnUpdateMock: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ withConverter: vi.fn().mockReturnThis() })),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ aiEnabled: true }),
  }),
  runTransaction: vi.fn().mockImplementation(async (_db, fn) => {
    const today = new Date().toISOString().split('T')[0];
    const mockTxn = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ aiUsage: { dailyCount: 1, lastResetDate: today } }),
      }),
      update: txnUpdateMock,
    };
    await fn(mockTxn);
  }),
  collection: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve({ id: 'mock-doc-id' })),
  serverTimestamp: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      return { models: { generateContent: generateContentMock } };
    }
  },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

const VALID_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('geminiService hardening - JSON validation (finding 1.1)', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-key';
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a valid AI response through unchanged', async () => {
    const { generateInsight } = await import('./geminiService');
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ text: 'Good insight', actions: [] }) });

    const result = await generateInsight('hh', [], []);
    expect(result.text).toBe('Good insight');
  });

  it('rejects a hallucinated/wrong-typed AI response with a distinct message', async () => {
    const { generateInsight } = await import('./geminiService');
    // `text` is required to be a string; the model returned a number.
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ text: 123 }) });

    await expect(generateInsight('hh', [], []))
      .rejects.toThrow(/unexpected response/);
  });

  it('rejects unparseable (non-JSON) AI output', async () => {
    const { generateInsight } = await import('./geminiService');
    generateContentMock.mockResolvedValue({ text: 'sorry, I cannot do that' });

    await expect(generateInsight('hh', [], []))
      .rejects.toThrow(/unexpected response/);
  });

  it('refunds the quota unit when a response is rejected', async () => {
    const { generateInsight } = await import('./geminiService');
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ text: 123 }) });

    await expect(generateInsight('hh', [], [])).rejects.toThrow();
    // The refund transaction decrements aiUsage back down.
    expect(txnUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      { aiUsage: { dailyCount: 0, lastResetDate: expect.any(String) } },
    );
  });
});

describe('geminiService hardening - image guard (finding 1.2)', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-key';
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid image before calling Gemini (no quota spent)', async () => {
    const { analyzeReceipt } = await import('./geminiService');
    const { runTransaction } = await import('firebase/firestore');

    await expect(analyzeReceipt('hh', 'not-a-valid-image-!!!'))
      .rejects.toThrow(/not valid base64|too short|empty/);

    // Neither the quota transaction nor Gemini should have been touched.
    expect(runTransaction).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('accepts a valid image and reaches Gemini', async () => {
    const { analyzeReceipt } = await import('./geminiService');
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ merchant: 'Target', amount: 25, category: 'Shopping' }),
    });

    const result = await analyzeReceipt('hh', VALID_IMAGE);
    expect(result.merchant).toBe('Target');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

describe('geminiService hardening - graceful degradation', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-key';
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parseMagicAction returns unknown on a malformed AI response (no throw)', async () => {
    const { parseMagicAction } = await import('./geminiService');
    // Missing required `data` object — validator throws, function degrades.
    generateContentMock.mockResolvedValue({ text: JSON.stringify({ type: 'transaction', confidence: 1 }) });

    const result = await parseMagicAction('hh', 'spent 5', {
      categories: [], groceryCategories: [], todayDate: '2026-01-01',
    });
    expect(result).toEqual({ type: 'unknown', confidence: 0, data: {} });
  });
});
