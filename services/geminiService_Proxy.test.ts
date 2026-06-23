/**
 * Tests for the Gemini transport switch (roadmap B1 / Plan 014, stage 1).
 *
 * geminiService routes its single raw model call either through the client SDK
 * (`@google/genai`'s generateContent) or, when VITE_USE_GEMINI_PROXY === 'true',
 * through the `geminiproxy` Cloud Function (`firebase/functions` httpsCallable).
 *
 * The flag is read into a module-level const at evaluation time, so each test
 * stubs `import.meta.env` and `vi.resetModules()` BEFORE dynamically importing
 * the service, forcing a fresh evaluation with the desired flag value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MealSuggestionRequest } from './geminiService';

// The AI flow imports a heavy module graph; raise the per-test timeout.
vi.setConfig({ testTimeout: 30000 });

// ---------------------------------------------------------------------------
// Hoisted mocks for both transports.
// ---------------------------------------------------------------------------

const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }));
const { httpsCallableMock, callableInvokeMock } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  callableInvokeMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      return { models: { generateContent: generateContentMock } };
    }
  },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
}));

// firebase/functions: httpsCallable(functions, name) -> (req) => Promise<{ data }>
vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('@/firebase.config', () => ({
  db: {},
  functions: { __isFunctions: true },
}));

// Firestore mock so the quota check/increment + audit logging are no-ops.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ withConverter: vi.fn().mockReturnThis() })),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => true, data: () => ({ aiEnabled: true }) })),
  runTransaction: vi.fn().mockImplementation(async (_db, fn) => {
    const mockTxn = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ aiUsage: { dailyCount: 0, lastResetDate: '2026-01-01' } }),
      }),
      update: vi.fn(),
    };
    await fn(mockTxn);
  }),
  collection: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve({ id: 'mock-doc-id' })),
  serverTimestamp: vi.fn(),
}));

const MEAL_JSON = JSON.stringify({
  name: 'Quick Pasta',
  description: 'Simple pasta dish',
  ingredients: [{ name: 'Pasta', quantity: '200g' }],
  instructions: ['Boil pasta'],
  recipeUrl: 'http://example.com/pasta',
  tags: ['Quick'],
  reasoning: 'Quick to prepare',
});

const REQUEST: MealSuggestionRequest = { cheap: false, quick: true, new: false, previousMeals: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  // httpsCallable returns a callable that resolves to the firebase { data } envelope.
  httpsCallableMock.mockReturnValue(callableInvokeMock);
  callableInvokeMock.mockResolvedValue({ data: { text: MEAL_JSON } });
  generateContentMock.mockResolvedValue({ text: MEAL_JSON });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('geminiService transport switch', () => {
  it('uses the direct SDK path when the proxy flag is OFF (default)', async () => {
    vi.stubEnv('VITE_USE_GEMINI_PROXY', '');
    const { suggestMeal } = await import('./geminiService');

    const result = await suggestMeal('hh', { ...REQUEST });

    expect(result.name).toBe('Quick Pasta');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(httpsCallableMock).not.toHaveBeenCalled();
    expect(callableInvokeMock).not.toHaveBeenCalled();
  });

  it('routes through the geminiproxy callable when the proxy flag is ON', async () => {
    vi.stubEnv('VITE_USE_GEMINI_PROXY', 'true');
    const { suggestMeal } = await import('./geminiService');

    const result = await suggestMeal('hh', { ...REQUEST });

    // Same parsed result the caller expects, regardless of transport.
    expect(result.name).toBe('Quick Pasta');

    // The direct SDK path was NOT used; the proxy callable was.
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(httpsCallableMock).toHaveBeenCalledTimes(1);
    expect(httpsCallableMock).toHaveBeenCalledWith(
      { __isFunctions: true },
      'geminiproxy',
    );

    // The callable received the assembled { model, contents, config } request.
    expect(callableInvokeMock).toHaveBeenCalledTimes(1);
    const sentReq = callableInvokeMock.mock.calls[0]![0] as {
      model: string;
      contents: { parts: unknown[] };
      config: { responseMimeType: string };
    };
    expect(typeof sentReq.model).toBe('string');
    expect(sentReq.model.length).toBeGreaterThan(0);
    expect(Array.isArray(sentReq.contents.parts)).toBe(true);
    expect(sentReq.config.responseMimeType).toBe('application/json');
  });

  it('still uses the direct SDK path when a test client is injected, even with the flag ON', async () => {
    vi.stubEnv('VITE_USE_GEMINI_PROXY', 'true');
    const { suggestMeal } = await import('./geminiService');

    const injectedGenerate = vi.fn().mockResolvedValue({ text: MEAL_JSON });
    const injectedClient = { models: { generateContent: injectedGenerate } } as unknown as
      Parameters<typeof suggestMeal>[2];

    const result = await suggestMeal('hh', { ...REQUEST }, injectedClient);

    expect(result.name).toBe('Quick Pasta');
    // The injected client was used; the proxy was bypassed.
    expect(injectedGenerate).toHaveBeenCalledTimes(1);
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it('works through the proxy with no client API key in the bundle (stage-2 security state)', async () => {
    // Simulate the production stage-2 state: proxy ON and the client key removed
    // from the build, so geminiService's module-level apiKey resolves to "".
    vi.stubEnv('VITE_USE_GEMINI_PROXY', 'true');
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    const { suggestMeal } = await import('./geminiService');

    const result = await suggestMeal('hh', { ...REQUEST });

    // No client key, yet the call still succeeds via the proxy — validateApiKey
    // must NOT block the proxy path, otherwise removing the key would break AI.
    expect(result.name).toBe('Quick Pasta');
    expect(httpsCallableMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
