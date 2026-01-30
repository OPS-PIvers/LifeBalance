import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Habit } from '../types/schema';

// Hoist the mock function so it can be referenced inside vi.mock
const { generateContentMock } = vi.hoisted(() => {
  return { generateContentMock: vi.fn() };
});

// Mock firebase config to prevent crash
vi.mock('@/firebase.config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ aiEnabled: true, aiUsage: { dailyCount: 0, lastResetDate: new Date().toISOString().split('T')[0] } })
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

describe('geminiService', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-key';
  });

  beforeEach(() => {
     vi.clearAllMocks();
  });

  describe('reorganizeHabits', () => {
    it('should return a plan when habits are provided', async () => {
      // Import after setting env
      const { reorganizeHabits } = await import('./geminiService');

      const mockHabits = [
        { id: '1', title: 'Habit 1', category: 'Old', order: 1 },
        { id: '2', title: 'Habit 2', category: 'Old', order: 2 },
      ] as Habit[];

      const mockResponse = {
        habits: [
          { id: '1', category: 'New', order: 0 },
          { id: '2', category: 'New', order: 1 },
        ],
        reasoning: 'Better flow'
      };

      generateContentMock.mockResolvedValue({
        text: JSON.stringify(mockResponse)
      });

      const result = await reorganizeHabits('household-1', mockHabits);

      expect(result).toEqual(mockResponse);
      expect(generateContentMock).toHaveBeenCalled();
    });

    it('should handle empty habits', async () => {
       const { reorganizeHabits } = await import('./geminiService');
       const result = await reorganizeHabits('household-1', []);
       expect(result.habits).toEqual([]);
    });
  });

  it('generateInsight correctly parses JSON response without actions', async () => {
    const { generateInsight } = await import('./geminiService');

    const mockInsightData = {
      text: "You have been spending consistent amounts on Dining.",
      actions: []
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockInsightData)
    });

    const result = await generateInsight('test-household-id', [], []);

    expect(result.text).toBe(mockInsightData.text);
    expect(result.actions).toEqual([]);
  });

  it('generateInsight includes previous insights in prompt', async () => {
    const { generateInsight } = await import('./geminiService');

    const mockInsightData = {
      text: "New insight.",
      actions: []
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockInsightData)
    });

    const previousInsights = ["Old insight 1", "Old insight 2"];
    await generateInsight('test-household-id', [], [], previousInsights);

    expect(generateContentMock).toHaveBeenCalled();
    // Check if the prompt (which is inside contents.parts[0].text) contains the previous insights
    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).toContain("PREVIOUS INSIGHTS");
    expect(promptText).toContain("Old insight 1");
    expect(promptText).toContain("Old insight 2");
  });

  it('parseMagicAction correctly parses transaction', async () => {
    const { parseMagicAction } = await import('./geminiService');

    const mockResponse = {
      type: 'transaction',
      confidence: 0.95,
      data: {
        merchant: 'Target',
        amount: 45.20,
        category: 'Shopping',
        date: '2025-02-18'
      }
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseMagicAction('test-household', 'Spent 45.20 at Target', {
      categories: ['Shopping', 'Dining'],
      groceryCategories: ['Food'],
      todayDate: '2025-02-18'
    });

    expect(result.type).toBe('transaction');
    expect(result.data.merchant).toBe('Target');
    expect(result.data.amount).toBe(45.20);
    expect(result.data.category).toBe('Shopping');
  });

  it('parseMagicAction correctly parses todo', async () => {
    const { parseMagicAction } = await import('./geminiService');

    const mockResponse = {
      type: 'todo',
      confidence: 0.9,
      data: {
        text: 'Pay electricity bill',
        completeByDate: '2025-02-19'
      }
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseMagicAction('test-household', 'Remind me to pay electricity bill tomorrow', {
      categories: [],
      groceryCategories: [],
      todayDate: '2025-02-18'
    });

    expect(result.type).toBe('todo');
    expect(result.data.text).toBe('Pay electricity bill');
    expect(result.data.completeByDate).toBe('2025-02-19');
  });

  it('parseMagicAction correctly parses shopping item', async () => {
    const { parseMagicAction } = await import('./geminiService');

    const mockResponse = {
      type: 'shopping',
      confidence: 0.9,
      data: {
        item: 'Milk',
        quantity: '2 gallons',
        category: 'Dairy',
        store: 'Walmart'
      }
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseMagicAction('test-household', 'Buy 2 gallons of Milk from Walmart', {
      categories: [],
      groceryCategories: ['Dairy', 'Produce'],
      todayDate: '2025-02-18'
    });

    expect(result.type).toBe('shopping');
    expect(result.data.item).toBe('Milk');
    expect(result.data.quantity).toBe('2 gallons');
    expect(result.data.category).toBe('Dairy');
    expect(result.data.store).toBe('Walmart');
  });

  it('parseMagicAction correctly parses habit', async () => {
    const { parseMagicAction } = await import('./geminiService');

    const mockResponse = {
      type: 'habit',
      confidence: 0.95,
      data: {
        habitId: 'habit-123',
        habitTitle: 'Drink Water'
      }
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseMagicAction('test-household', 'Drank water', {
      categories: [],
      groceryCategories: [],
      todayDate: '2025-02-18',
      habits: [{ id: 'habit-123', title: 'Drink Water' }]
    });

    expect(result.type).toBe('habit');
    expect(result.data.habitId).toBe('habit-123');
    expect(result.data.habitTitle).toBe('Drink Water');
  });

  it('analyzeHabitPoints correctly parses suggestions', async () => {
    const { analyzeHabitPoints } = await import('./geminiService');

    const mockSuggestions = [
      {
        habitId: '1',
        habitTitle: 'Run',
        currentPoints: 10,
        suggestedPoints: 15,
        reasoning: 'Increase motivation.'
      }
    ];

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockSuggestions)
    });

    const habits = [{
      id: '1',
      title: 'Run',
      basePoints: 10,
      completedDates: [],
      streakDays: 0,
      period: 'daily',
      totalCount: 0,
      type: 'positive',
      category: 'Health',
      scoringType: 'threshold',
      targetCount: 1,
      count: 0,
      lastUpdated: ''
    }] as unknown as Habit[];

    const result = await analyzeHabitPoints('test-household', habits);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockSuggestions[0]);
  });

  it('analyzeHabitPoints handles empty input', async () => {
    const { analyzeHabitPoints } = await import('./geminiService');
    const result = await analyzeHabitPoints('test-household', []);
    expect(result).toEqual([]);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('analyzeHabitPoints handles invalid habit ID from AI', async () => {
    const { analyzeHabitPoints } = await import('./geminiService');

    const mockSuggestions = [
      {
        habitId: 'non-existent-id',
        habitTitle: 'Run',
        currentPoints: 10,
        suggestedPoints: 15,
        reasoning: 'Increase motivation.'
      }
    ];

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockSuggestions)
    });

    const habits = [{
      id: '1',
      title: 'Run',
      basePoints: 10,
    }] as unknown as Habit[];

    const result = await analyzeHabitPoints('test-household', habits);
    expect(result).toHaveLength(0); // Should be filtered out
  });

  it('parseNaturalLanguageCommand handles unknown type by detecting shopping list', async () => {
    const { parseNaturalLanguageCommand } = await import('./geminiService');

    const mockResponse = {
      detectedType: 'shopping',
      confidence: 0.95,
      items: [
        { item: 'Milk', quantity: 1, category: 'Dairy' }
      ]
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseNaturalLanguageCommand('test-id', 'Buy milk', 'unknown');

    expect(result.detectedType).toBe('shopping');
    // TS narrowing check
    if (result.detectedType === 'shopping') {
        expect(result.items).toHaveLength(1);
        expect(result.items[0].item).toBe('Milk');
    } else {
        throw new Error('Expected detectedType to be shopping');
    }
  });

  it('parseNaturalLanguageCommand handles unknown type by detecting expense', async () => {
    const { parseNaturalLanguageCommand } = await import('./geminiService');

    const mockResponse = {
      detectedType: 'expense',
      confidence: 0.9,
      amount: 20,
      merchant: 'Target',
      category: 'Shopping'
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const result = await parseNaturalLanguageCommand('test-id', 'Spent 20 at Target', 'unknown');

    expect(result.detectedType).toBe('expense');
    if (result.detectedType === 'expense') {
        expect(result.amount).toBe(20);
        expect(result.merchant).toBe('Target');
    } else {
        throw new Error('Expected detectedType to be expense');
    }
  });

  it('parseNaturalLanguageCommand handles known type correctly (forcing type)', async () => {
    const { parseNaturalLanguageCommand } = await import('./geminiService');

    const mockResponse = {
      items: [
        { item: 'Milk', quantity: 1, category: 'Dairy' }
      ]
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    // Even if detection wasn't part of the prompt, the wrapper adds it
    const result = await parseNaturalLanguageCommand('test-id', 'Buy milk', 'shopping');

    expect(result.detectedType).toBe('shopping');
    expect(result.confidence).toBe(1);
    if (result.detectedType === 'shopping') {
        expect(result.items).toHaveLength(1);
    }
  });

  it('analyzeReceipt prompt includes correct date from local time', async () => {
    const { analyzeReceipt } = await import('./geminiService');

    // Mock date to 2026-02-15
    const mockDate = new Date(2026, 1, 15); // Month is 0-indexed (1 = Feb)
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    const mockResponse = {
        merchant: 'Target',
        amount: 25.00,
        category: 'Shopping'
    };

    generateContentMock.mockResolvedValue({
        text: JSON.stringify(mockResponse)
    });

    await analyzeReceipt('test-id', 'base64-img');

    // Verify the prompt sent to Gemini contains the date
    // We access the first argument of the first call, which is the model options/config object
    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[1].text; // The second part is text

    expect(promptText).toContain("Today's date is 2026-02-15");

    vi.useRealTimers();
  });

  it('parseBankStatement prompt includes correct date from local time', async () => {
    const { parseBankStatement } = await import('./geminiService');

    // Mock date to 2026-03-10
    const mockDate = new Date(2026, 2, 10);
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    const mockResponse = [{
        merchant: 'Starbucks',
        amount: 5.50,
        category: 'Dining',
        date: '2026-03-10'
    }];

    generateContentMock.mockResolvedValue({
        text: JSON.stringify(mockResponse)
    });

    await parseBankStatement('test-id', 'base64-img');

    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[1].text;

    expect(promptText).toContain("Today's date is 2026-03-10");

    vi.useRealTimers();
  });
});
