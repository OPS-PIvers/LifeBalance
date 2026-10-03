import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { getLocalDateString } from '@/utils/dateHelpers';

// These tests `await import('./geminiService')`, pulling in a heavy module graph
// (Gemini SDK mock + firebase). Under the full-repo parallel run the first such
// import per file can exceed the 5s default, so raise the per-test timeout.
vi.setConfig({ testTimeout: 30000 });

// Hoist the mock function so it can be referenced inside vi.mock
const { generateContentMock } = vi.hoisted(() => {
  return { generateContentMock: vi.fn() };
});

// Mock firebase config to prevent crash
vi.mock('@/firebase.config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  // doc(...).withConverter(...) is used by the quota reads (finding 6.1).
  doc: vi.fn(() => ({ withConverter: vi.fn().mockReturnThis() })),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ aiEnabled: true, aiUsage: { dailyCount: 0, lastResetDate: getLocalDateString() } })
  }),
  runTransaction: vi.fn().mockImplementation(async (_db, fn) => {
    const today = getLocalDateString();
    const mockTxn = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ aiUsage: { dailyCount: 0, lastResetDate: today } }),
      }),
      update: vi.fn(),
    };
    await fn(mockTxn);
  }),
  updateDoc: vi.fn(),
  increment: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn(),
}));

// Mock the GoogleGenAI library
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      constructor() {
        return {
          models: {
            generateContent: generateContentMock
          }
        };
      }
    },
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      ARRAY: 'ARRAY',
      NUMBER: 'NUMBER',
      BOOLEAN: 'BOOLEAN'
    }
  };
});

// Plan 050b: geminiService reads getBillingEnabled() to decide whether the AI quota
// uses the legacy 100/day cap (billing off) or the per-plan cap (billing on). Mock it
// so both states are deterministic. (vitest hoists vi.mock/vi.hoisted to the top.)
const { getBillingEnabledMock } = vi.hoisted(() => ({ getBillingEnabledMock: vi.fn() }));
vi.mock('./appConfig', () => ({
  getBillingEnabled: getBillingEnabledMock,
}));

const CTX = {
  memberNames: ['Sam', 'Alex'],
  catalogNames: ['Milk', 'Eggs'],
  today: '2026-10-03',
  timeZone: 'America/Chicago',
};

type Client = NonNullable<Parameters<typeof import('./geminiService').parseWallVoiceText>[3]>;
// Same cast as geminiService.test.ts: the mock implements only generateContent.
const client = (): Client => ({ models: { generateContent: generateContentMock } }) as unknown as Client;

describe('wall voice', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getBillingEnabledMock.mockResolvedValue(false);
  });

  it('parseWallVoiceText returns the parsed intent and falls back to the input transcript', async () => {
    const { parseWallVoiceText } = await import('./geminiService');
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ intent: 'add_shopping', items: [{ name: 'Milk' }, { name: ' ' }] }),
    });
    const result = await parseWallVoiceText('hh1', 'add milk', CTX, client());
    expect(result).toEqual({ transcript: 'add milk', intent: 'add_shopping', items: [{ name: 'Milk' }] });
    const req = generateContentMock.mock.calls[0]?.[0] as { contents: { parts: { text: string }[] } };
    const prompt = req.contents.parts[0]?.text ?? '';
    expect(prompt).toContain('Sam, Alex');
    expect(prompt).toContain('2026-10-03');
    expect(prompt).toContain('add milk');
  });

  it('parseWallVoiceAudio sends the audio inline ahead of the instructions', async () => {
    const { parseWallVoiceAudio } = await import('./geminiService');
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        transcript: 'remind Sam to feed the cat tomorrow',
        intent: 'add_todo',
        todo: { text: 'Feed the cat', assigneeName: 'Sam', due: 'tomorrow' },
      }),
    });
    const result = await parseWallVoiceAudio('hh1', 'AAAA', 'audio/mp4', CTX, client());
    expect(result.todo).toEqual({ text: 'Feed the cat', assigneeName: 'Sam', due: 'tomorrow' });
    const req = generateContentMock.mock.calls[0]?.[0] as {
      contents: { parts: { inlineData?: { mimeType: string; data: string } }[] };
    };
    expect(req.contents.parts[0]?.inlineData).toEqual({ mimeType: 'audio/mp4', data: 'AAAA' });
  });

  it('parseWallVoiceAudio rejects oversized, empty or non-audio input without calling the model', async () => {
    const { parseWallVoiceAudio, WALL_VOICE_MAX_AUDIO_BASE64_CHARS } = await import('./geminiService');
    await expect(
      parseWallVoiceAudio('hh1', 'a'.repeat(WALL_VOICE_MAX_AUDIO_BASE64_CHARS + 1), 'audio/mp4', CTX, client())
    ).rejects.toThrow(/too long/);
    await expect(parseWallVoiceAudio('hh1', '', 'audio/mp4', CTX, client())).rejects.toThrow(/No audio/);
    await expect(parseWallVoiceAudio('hh1', 'AAAA', 'image/png', CTX, client())).rejects.toThrow(/format/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
