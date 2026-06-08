import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Habit, Transaction } from '@/types/schema';

// Hoist the mock function
const { generateContentMock } = vi.hoisted(() => {
  return { generateContentMock: vi.fn() };
});

// Mock Firestore dependencies
vi.mock('@/firebase.config', () => ({
  db: {}
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ aiUsage: { dailyCount: 0, lastResetDate: '2024-01-01' } })
  }),
  runTransaction: vi.fn().mockImplementation(async (_db, fn) => {
    const mockTxn = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ aiUsage: { dailyCount: 0, lastResetDate: '2024-01-01' } }),
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
}));

// Mock GoogleGenAI
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

describe('geminiService Sanitization', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateInsight sanitizes merchant names and habit titles', async () => {
    const { generateInsight } = await import('./geminiService');

    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ text: "Insight", actions: [] })
    });

    const maliciousTransaction = {
      amount: 10,
      category: 'Food',
      date: '2024-01-01',
      merchant: 'Evil " Merchant \n Injection'
    } as Transaction;

    const maliciousHabit = {
      title: 'Habit " Injection',
      type: 'positive',
      count: 0,
      streakDays: 0,
      completedDates: [],
      period: 'daily'
    } as unknown as Habit;

    await generateInsight('id', [maliciousTransaction], [maliciousHabit]);

    const callArgs = generateContentMock.mock.calls[0]![0];
    const promptText = callArgs.contents.parts[0].text;

    // Check that quotes and newlines are removed/sanitized
    // sanitizeForPrompt replaces newlines with space and removes quotes
    expect(promptText).not.toContain('Evil " Merchant');
    expect(promptText).toContain('Evil  Merchant   Injection'); // Quotes removed, newline replaced

    expect(promptText).not.toContain('Habit " Injection');
    expect(promptText).toContain('Habit  Injection');
  });

  it('analyzeHabitPoints sanitizes habit titles', async () => {
    const { analyzeHabitPoints } = await import('./geminiService');

    generateContentMock.mockResolvedValue({
      text: JSON.stringify([])
    });

    const maliciousHabit = {
      id: '1',
      title: 'Habit " Injection',
      basePoints: 10,
      period: 'daily',
      streakDays: 0,
      totalCount: 0,
      type: 'positive'
    } as unknown as Habit;

    await analyzeHabitPoints('id', [maliciousHabit]);

    const callArgs = generateContentMock.mock.calls[0]![0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).not.toContain('Habit " Injection');
    expect(promptText).toContain('Habit  Injection');
  });

  it('analyzeHabitPatterns sanitizes habit titles', async () => {
    const { analyzeHabitPatterns } = await import('./geminiService');

    generateContentMock.mockResolvedValue({
      text: JSON.stringify([])
    });

    const maliciousHabit = {
      id: '1',
      title: 'Habit " Injection',
      period: 'daily',
      streakDays: 0,
      completedDates: []
    } as unknown as Habit;

    await analyzeHabitPatterns('id', [maliciousHabit]);

    const callArgs = generateContentMock.mock.calls[0]![0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).not.toContain('Habit " Injection');
    expect(promptText).toContain('Habit  Injection');
  });
});
