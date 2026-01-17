import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { PantryItem, Meal } from '@/types/schema';

// Hoist the mock function
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

describe('geminiService - suggestMeal', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggestMeal includes expiry dates in pantry list', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockPantryItems: PantryItem[] = [
      { id: '1', name: 'Milk', quantity: '1 gal', category: 'Dairy', expiryDate: '2023-12-31' },
      { id: '2', name: 'Rice', quantity: '1 bag', category: 'Grains' } // No expiry
    ];

    const mockResponse = {
      name: "Rice Pudding",
      description: "Delicious dessert",
      ingredients: [],
      instructions: [],
      recipeUrl: "http://example.com",
      tags: [],
      reasoning: "Uses milk and rice"
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    await suggestMeal({
      usePantry: true,
      cheap: false,
      quick: false,
      new: false,
      pantryItems: mockPantryItems,
      previousMeals: []
    });

    // Verify the prompt contains the expiry date
    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).toContain('Milk (1 gal) [Exp: 2023-12-31]');
    expect(promptText).toContain('Rice (1 bag)');
  });

  it('suggestMeal adds prioritization instruction when prioritizeExpiring is true', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse = {
      name: "Test Meal",
      description: "Test",
      ingredients: [],
      instructions: [],
      recipeUrl: "",
      tags: [],
      reasoning: ""
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    await suggestMeal({
      usePantry: true,
      cheap: false,
      quick: false,
      new: false,
      prioritizeExpiring: true,
      pantryItems: [],
      previousMeals: []
    });

    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).toContain('MUST prioritize using items that are expiring soon');
  });

  it('suggestMeal does NOT add prioritization instruction when prioritizeExpiring is false', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse = {
        name: "Test Meal",
        description: "Test",
        ingredients: [],
        instructions: [],
        recipeUrl: "",
        tags: [],
        reasoning: ""
      };

      generateContentMock.mockResolvedValue({
        text: JSON.stringify(mockResponse)
      });

      await suggestMeal({
        usePantry: true,
        cheap: false,
        quick: false,
        new: false,
        prioritizeExpiring: false,
        pantryItems: [],
        previousMeals: []
      });

      const callArgs = generateContentMock.mock.calls[0][0];
      const promptText = callArgs.contents.parts[0].text;

      expect(promptText).not.toContain('MUST prioritize using items that are expiring soon');
  });
});
