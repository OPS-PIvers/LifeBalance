import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { MealSuggestionRequest } from './geminiService';

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

describe('geminiService - Meal Suggestion', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Calculate a future date for robust testing
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  it('suggestMeal includes expiry date in prompt and respects prioritizeExpiring flag', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse = {
      name: "Expiring Milk Pancakes",
      description: "Use up that milk!",
      ingredients: [{ name: "Milk", quantity: "1 cup", pantryItemId: "1" }],
      instructions: ["Mix", "Cook"],
      recipeUrl: "http://example.com",
      tags: ["Breakfast"],
      reasoning: "Uses expiring milk"
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    const request: MealSuggestionRequest = {
      usePantry: true,
      cheap: false,
      quick: false,
      new: false,
      prioritizeExpiring: true,
      pantryItems: [
        { id: '1', name: 'Milk', quantity: '1 gallon', category: 'Dairy', expiryDate: futureDateStr },
        { id: '2', name: 'Flour', quantity: '1 kg', category: 'Pantry' } // No expiry
      ],
      previousMeals: []
    };

    await suggestMeal('test-household', request);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    // Verify pantry item formatting
    expect(promptText).toContain(`ID:1 - Milk (1 gallon) [Exp: ${futureDateStr}]`);
    expect(promptText).toContain('ID:2 - Flour (1 kg)');

    // Verify instruction
    expect(promptText).toContain('- MUST prioritize using items that are expiring soon (marked with [Exp: YYYY-MM-DD]).');
  });

  it('suggestMeal omits prioritizeExpiring instruction when flag is false', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockResponse = {
        name: "Standard Meal",
        description: "Yum",
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
      usePantry: true,
      cheap: false,
      quick: false,
      new: false,
      prioritizeExpiring: false,
      pantryItems: [
        { id: '1', name: 'Milk', quantity: '1 gallon', category: 'Dairy', expiryDate: futureDateStr }
      ],
      previousMeals: []
    };

    await suggestMeal('test-household', request);

    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    // Verify pantry item formatting still happens
    expect(promptText).toContain(`ID:1 - Milk (1 gallon) [Exp: ${futureDateStr}]`);

    // Verify instruction is MISSING
    expect(promptText).not.toContain('- MUST prioritize using items that are expiring soon');
  });
});
