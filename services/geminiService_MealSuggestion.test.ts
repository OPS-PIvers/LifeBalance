import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

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

describe('geminiService - Meal Suggestions', () => {
  beforeAll(() => {
    process.env.VITE_GEMINI_API_KEY = 'test-api-key';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggestMeal includes expiry dates and prioritization prompt when requested', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockPantryItems: any[] = [
      { id: '1', name: 'Milk', quantity: '1 gal', expiryDate: '2023-10-25' },
      { id: '2', name: 'Pasta', quantity: '1 box' } // No expiry
    ];

    const request: any = {
      usePantry: true,
      prioritizeExpiring: true,
      cheap: false,
      quick: false,
      new: false,
      pantryItems: mockPantryItems,
      previousMeals: []
    };

    const mockResponse = {
        name: "Test Meal",
        description: "Test Desc",
        ingredients: [],
        instructions: [],
        recipeUrl: "http://test",
        tags: [],
        reasoning: "Test"
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockResponse)
    });

    await suggestMeal(request);

    expect(generateContentMock).toHaveBeenCalled();
    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    // Check for expiry date in pantry list
    expect(promptText).toContain('Milk (1 gal) [Exp: 2023-10-25]');
    expect(promptText).toContain('Pasta (1 box)');

    // Check for prioritization instruction
    expect(promptText).toContain('MUST prioritize using items that are expiring soon');
  });

  it('suggestMeal does NOT include prioritization prompt when flag is false', async () => {
    const { suggestMeal } = await import('./geminiService');

    const mockPantryItems: any[] = [
      { id: '1', name: 'Milk', quantity: '1 gal' }
    ];

    const request: any = {
      usePantry: true,
      prioritizeExpiring: false,
      cheap: false,
      quick: false,
      new: false,
      pantryItems: mockPantryItems,
      previousMeals: []
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify({ name: "Test", description: "", ingredients: [], instructions: [], recipeUrl: "", tags: [], reasoning: "" })
    });

    await suggestMeal(request);

    const callArgs = generateContentMock.mock.calls[0][0];
    const promptText = callArgs.contents.parts[0].text;

    expect(promptText).not.toContain('MUST prioritize using items that are expiring soon');
  });
});
