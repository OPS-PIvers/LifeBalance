import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Habit } from '../types/schema';

// Hoist the mock function so it can be referenced inside vi.mock
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
  updateDoc: vi.fn(),
  increment: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
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
    // Set the API key before any imports of the service happen
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateInsight correctly parses JSON response with actions', async () => {
    // Dynamic import to ensure the module reads the process.env we just set
    const { generateInsight } = await import('./geminiService');

    // 1. Setup the mock response from Gemini
    const mockInsightData = {
      text: "You have been spending consistent amounts on Dining.",
      actions: [
        {
          type: "update_bucket",
          label: "Increase Dining Limit",
          payload: { bucketName: "Dining", newLimit: 500 }
        }
      ]
    };

    // 2. Configure the mock to return the JSON string
    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockInsightData)
    });

    // 3. Call the service
    const result = await generateInsight('test-household-id', [], []);

    // 4. Assertions
    expect(result).toBeDefined();
    expect(result.text).toBe(mockInsightData.text);
    expect(result.actions).toHaveLength(1);
    expect(result.actions![0]).toEqual(mockInsightData.actions[0]);

    expect(generateContentMock).toHaveBeenCalled();
  });

  it('generateInsight handles response without actions', async () => {
    const { generateInsight } = await import('./geminiService');

    const mockInsightData = {
      text: "Great job staying under budget!",
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
});
