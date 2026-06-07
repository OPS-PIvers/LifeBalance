import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { MealSuggestionRequest, MealSuggestionResponse } from './geminiService';

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

// Mock Firebase to avoid network calls in tests
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({
    exists: () => true,
    data: () => ({ aiUsage: { dailyCount: 0, lastResetDate: '2026-01-01' } })
  })),
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
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  increment: vi.fn((n) => n),
  serverTimestamp: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve({ id: 'mock-doc-id' }))
}));

vi.mock('@/firebase.config', () => ({
  db: {}
}));

describe('geminiService - Meal Suggestion', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggestMeal generates meal suggestions based on preferences', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse: MealSuggestionResponse = {
      name: "Quick Pasta",
      description: "Simple pasta dish",
      ingredients: [{ name: "Pasta", quantity: "200g" }, { name: "Tomato Sauce", quantity: "1 cup" }],
      instructions: ["Boil pasta", "Add sauce", "Serve"],
      recipeUrl: "http://example.com/pasta",
      tags: ["Quick", "Italian"],
      reasoning: "Quick to prepare"
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const request: MealSuggestionRequest = {
      cheap: false,
      quick: true,
      new: false,
      previousMeals: []
    };

    const result = await suggestMeal('test-household', request);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("Quick Pasta");
    expect(result.ingredients).toHaveLength(2);
  });

  it('suggestMeal includes budget and time constraints in prompt', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse: MealSuggestionResponse = {
      name: "Budget Meal",
      description: "Cheap and quick",
      ingredients: [],
      instructions: [],
      recipeUrl: "",
      tags: [],
      reasoning: ""
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const request: MealSuggestionRequest = {
      cheap: true,
      quick: true,
      new: false,
      previousMeals: []
    };

    await suggestMeal('test-household', request);

    const callArgs = generateContentMock.mock.calls[0]![0];
    const promptText = callArgs.contents.parts[0].text;

    // Verify constraints are included
    expect(promptText).toContain('budget-friendly');
    expect(promptText).toContain('quick to prepare');
  });

  it('suggestMeal avoids previous meals when new flag is set', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse: MealSuggestionResponse = {
      name: "New Meal",
      description: "Something different",
      ingredients: [],
      instructions: [],
      recipeUrl: "",
      tags: [],
      reasoning: ""
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const request: MealSuggestionRequest = {
      cheap: false,
      quick: false,
      new: true,
      previousMeals: [
        { id: '1', name: 'Pizza', ingredients: [], tags: [] },
        { id: '2', name: 'Burger', ingredients: [], tags: [] }
      ]
    };

    await suggestMeal('test-household', request);

    const callArgs = generateContentMock.mock.calls[0]![0];
    const promptText = callArgs.contents.parts[0].text;

    // Verify previous meals are mentioned
    expect(promptText).toContain('Pizza');
    expect(promptText).toContain('Burger');
    expect(promptText).toContain('DIFFERENT');
  });
});
