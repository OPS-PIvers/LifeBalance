import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Habit } from '../types/schema';

// Hoist the mock function so it can be referenced inside vi.mock
const { generateContentMock } = vi.hoisted(() => {
  return { generateContentMock: vi.fn() };
});

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
    const result = await generateInsight([], []);

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

    const result = await generateInsight([], []);

    expect(result.text).toBe(mockInsightData.text);
    expect(result.actions).toEqual([]);
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

    const result = await analyzeHabitPoints(habits);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockSuggestions[0]);
  });
});
