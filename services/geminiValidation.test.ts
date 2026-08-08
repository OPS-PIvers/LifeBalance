import { describe, it, expect } from 'vitest';
import {
  GeminiValidationError,
  InvalidImageError,
  MAX_IMAGE_BYTES,
  validateBase64Image,
  validateBankTransactions,
  validateMealSuggestion,
  validateSubtaskSuggestions,
  validateGroceryItems,
  validateOptimizableItems,
  validateInsight,
  validateHabitPatterns,
  validateHabitReorganization,
  validateParsedShoppingList,
  validateParsedTodoList,
  validateParsedTaskList,
  validateParsedMealPlan,
  validateParsedExpense,
  validateNaturalLanguageUnknown,
  validateRecipe,
  validateGeneratedWeeklyPlan,
  validateReceiptLineItems,
} from './geminiValidation';

// A structurally-valid base64 image data URL (1x1 transparent PNG).
const VALID_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('geminiValidation - validateBankTransactions', () => {
  it('accepts an array of well-formed transactions', () => {
    const result = validateBankTransactions([
      { merchant: 'A', amount: 1, category: 'X', date: '2026-01-01' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('accepts an empty array', () => {
    expect(validateBankTransactions([])).toEqual([]);
  });

  it('rejects a non-array', () => {
    expect(() => validateBankTransactions({})).toThrow(/expected an array/);
  });

  it('rejects an element missing date (required here)', () => {
    expect(() => validateBankTransactions([{ merchant: 'A', amount: 1, category: 'X' }]))
      .toThrow(/date must be a string/);
  });

  it('trims and passes through a well-formed rawDescriptor', () => {
    const result = validateBankTransactions([
      { merchant: 'Jimmy Johns', amount: 1, category: 'X', date: '2026-01-01', rawDescriptor: '  PURCHASE JIMMY JOHNS MPLS MN CARD7752  ' },
    ]);
    expect(result[0]?.rawDescriptor).toBe('PURCHASE JIMMY JOHNS MPLS MN CARD7752');
  });

  it('drops a rawDescriptor that is empty/whitespace-only rather than keeping ""', () => {
    const result = validateBankTransactions([
      { merchant: 'A', amount: 1, category: 'X', date: '2026-01-01', rawDescriptor: '   ' },
    ]);
    expect(result[0]?.rawDescriptor).toBeUndefined();
    expect('rawDescriptor' in (result[0] as object)).toBe(false);
  });

  it('coerces a non-string rawDescriptor to absent instead of failing the parse', () => {
    const result = validateBankTransactions([
      { merchant: 'A', amount: 1, category: 'X', date: '2026-01-01', rawDescriptor: 12345 },
    ]);
    expect(result[0]?.rawDescriptor).toBeUndefined();
  });

  it('caps rawDescriptor at 200 chars to match the firestore.rules limit', () => {
    const long = 'X'.repeat(250);
    const result = validateBankTransactions([
      { merchant: 'A', amount: 1, category: 'X', date: '2026-01-01', rawDescriptor: long },
    ]);
    expect(result[0]?.rawDescriptor).toHaveLength(200);
  });

  it('is absent when the model omits rawDescriptor entirely', () => {
    const result = validateBankTransactions([
      { merchant: 'A', amount: 1, category: 'X', date: '2026-01-01' },
    ]);
    expect(result[0]?.rawDescriptor).toBeUndefined();
  });
});

describe('geminiValidation - validateMealSuggestion', () => {
  const valid = {
    name: 'Pasta', description: 'd', recipeUrl: 'u', reasoning: 'r',
    instructions: ['a'], tags: ['t'],
    ingredients: [{ name: 'Pasta', quantity: '200g' }],
  };

  it('accepts a well-formed suggestion', () => {
    expect(validateMealSuggestion(valid).name).toBe('Pasta');
  });

  it('accepts empty arrays / empty strings', () => {
    expect(validateMealSuggestion({ ...valid, instructions: [], tags: [], ingredients: [], recipeUrl: '' }).tags)
      .toEqual([]);
  });

  it('rejects when ingredients entries are malformed', () => {
    expect(() => validateMealSuggestion({ ...valid, ingredients: [{ name: 'Pasta' }] }))
      .toThrow(/quantity must be a string/);
  });

  it('rejects when instructions are not string[]', () => {
    expect(() => validateMealSuggestion({ ...valid, instructions: [1, 2] }))
      .toThrow(/instructions must be string\[\]/);
  });
});

describe('geminiValidation - validateSubtaskSuggestions', () => {
  it('extracts trimmed non-empty subtasks', () => {
    expect(validateSubtaskSuggestions({ subtasks: ['  Book venue ', 'Order cake', '  '] }))
      .toEqual(['Book venue', 'Order cake']);
  });
  it('accepts an empty array (atomic task)', () => {
    expect(validateSubtaskSuggestions({ subtasks: [] })).toEqual([]);
  });
  it('rejects a non-object / missing subtasks', () => {
    expect(() => validateSubtaskSuggestions({})).toThrow(/subtasks/);
    expect(() => validateSubtaskSuggestions([])).toThrow(/subtaskBreakdown/);
  });
  it('rejects a non-string element', () => {
    expect(() => validateSubtaskSuggestions({ subtasks: ['ok', 3] })).toThrow(/must be a string/);
  });
});

describe('geminiValidation - validateGroceryItems', () => {
  it('accepts required-only items', () => {
    expect(validateGroceryItems([{ name: 'Milk', category: 'Dairy' }])).toHaveLength(1);
  });
  it('rejects a missing category', () => {
    expect(() => validateGroceryItems([{ name: 'Milk' }])).toThrow(/category/);
  });
});

describe('geminiValidation - validateOptimizableItems', () => {
  it('accepts well-formed items', () => {
    expect(validateOptimizableItems([{ id: '1', name: 'Milk' }])).toHaveLength(1);
  });
  it('rejects a missing id', () => {
    expect(() => validateOptimizableItems([{ name: 'Milk' }])).toThrow(/id must be a string/);
  });
});

describe('geminiValidation - validateInsight', () => {
  it('accepts text-only', () => {
    expect(validateInsight({ text: 'hi' }).text).toBe('hi');
  });
  it('accepts text with empty actions', () => {
    expect(validateInsight({ text: 'hi', actions: [] }).actions).toEqual([]);
  });
  it('accepts a well-formed action with its required payload fields', () => {
    const r = validateInsight({ text: 'hi', actions: [{ type: 'update_bucket', label: 'L', payload: { bucketName: 'Food', newLimit: 100 } }] });
    expect(r.actions).toHaveLength(1);
  });
  it('drops an action missing its type-specific payload fields', () => {
    // update_bucket needs bucketName + newLimit; an empty payload is malformed.
    const r = validateInsight({ text: 'hi', actions: [{ type: 'update_bucket', label: 'L', payload: {} }] });
    expect(r.actions).toEqual([]);
  });
  it('drops a hallucinated action type instead of failing the whole insight', () => {
    const r = validateInsight({ text: 'hi', actions: [{ type: 'delete_everything', label: 'L', payload: {} }] });
    expect(r.text).toBe('hi');
    expect(r.actions).toEqual([]);
  });
  it('rejects when text missing', () => {
    expect(() => validateInsight({ actions: [] })).toThrow(/text must be a string/);
  });
});

describe('geminiValidation - validateReceiptLineItems', () => {
  const validItem = { description: 'Milk', amount: 3.5, category: 'Groceries' };
  it('accepts a well-formed receipt with no habit suggestions', () => {
    const r = validateReceiptLineItems({ merchant: 'Target', items: [validItem] });
    expect(r.merchant).toBe('Target');
    expect(r.suggestedHabits).toBeUndefined();
  });
  it('accepts an empty items array (non-itemized image)', () => {
    const r = validateReceiptLineItems({ merchant: 'Target', items: [] });
    expect(r.items).toEqual([]);
  });
  it('normalizes documentType so callers always read a definite verdict', () => {
    expect(validateReceiptLineItems({ documentType: 'transaction_list', merchant: '', items: [] }).documentType)
      .toBe('transaction_list');
    // Absent (a response predating the field) and unrecognized both fall back to
    // 'receipt' rather than failing — the items are still usable.
    expect(validateReceiptLineItems({ merchant: 'Target', items: [validItem] }).documentType).toBe('receipt');
    expect(validateReceiptLineItems({ documentType: 'statement', merchant: 'Target', items: [validItem] }).documentType)
      .toBe('receipt');
  });
  it('rejects a non-string documentType', () => {
    expect(() => validateReceiptLineItems({ documentType: 7, merchant: 'Target', items: [validItem] }))
      .toThrow(/documentType must be a string/);
  });
  it('accepts a receipt-level suggestedHabits array', () => {
    const r = validateReceiptLineItems({ merchant: 'Target', items: [validItem], suggestedHabits: ['No eating out'] });
    expect(r.suggestedHabits).toEqual(['No eating out']);
  });
  it('rejects a non-array suggestedHabits', () => {
    expect(() => validateReceiptLineItems({ merchant: 'Target', items: [validItem], suggestedHabits: 'nope' }))
      .toThrow(/suggestedHabits must be string\[\]/);
  });
  it('rejects an item missing category', () => {
    expect(() => validateReceiptLineItems({ merchant: 'Target', items: [{ description: 'Milk', amount: 3.5 }] }))
      .toThrow(/category must be a string/);
  });
});

describe('geminiValidation - validateHabitPatterns', () => {
  it('accepts well-formed with null relatedHabitId', () => {
    const r = validateHabitPatterns([{ title: 'T', description: 'D', type: 'praise', relatedHabitId: null }]);
    expect(r).toHaveLength(1);
  });
  it('rejects a hallucinated type', () => {
    expect(() => validateHabitPatterns([{ title: 'T', description: 'D', type: 'roast' }]))
      .toThrow(/type must be one of/);
  });
});

describe('geminiValidation - validateHabitReorganization', () => {
  it('accepts well-formed', () => {
    const r = validateHabitReorganization({ reasoning: 'r', habits: [{ id: '1', category: 'C', order: 0 }] });
    expect(r.habits).toHaveLength(1);
  });
  it('rejects a non-number order', () => {
    expect(() => validateHabitReorganization({ reasoning: 'r', habits: [{ id: '1', category: 'C', order: 'first' }] }))
      .toThrow(/order must be a number/);
  });
});

describe('geminiValidation - natural language', () => {
  it('validateParsedShoppingList accepts well-formed', () => {
    expect(validateParsedShoppingList({ items: [{ item: 'Milk', quantity: 1, category: 'Dairy' }] }).items)
      .toHaveLength(1);
  });
  it('validateParsedShoppingList rejects non-number quantity', () => {
    expect(() => validateParsedShoppingList({ items: [{ item: 'Milk', quantity: 'one', category: 'Dairy' }] }))
      .toThrow(/quantity must be a number/);
  });
  it('validateParsedTodoList rejects a bad priority', () => {
    expect(() => validateParsedTodoList({ tasks: [{ task: 'x', priority: 'urgent' }] }))
      .toThrow(/priority must be/);
  });
  it('validateParsedExpense accepts an error-only response', () => {
    expect(validateParsedExpense({ error: 'No amount found' }).error).toBe('No amount found');
  });
  it('validateNaturalLanguageUnknown accepts shopping branch', () => {
    const r = validateNaturalLanguageUnknown({
      detectedType: 'shopping', confidence: 0.9, items: [{ item: 'Milk', quantity: 1, category: 'Dairy' }],
    });
    expect(r.detectedType).toBe('shopping');
  });
  it('validateNaturalLanguageUnknown rejects an invalid detectedType', () => {
    expect(() => validateNaturalLanguageUnknown({ detectedType: 'mystery', confidence: 1 }))
      .toThrow(/detectedType/);
  });
});

describe('geminiValidation - photo import (F-TODO-06)', () => {
  it('validateParsedTaskList accepts well-formed task lines', () => {
    const r = validateParsedTaskList({ tasks: [{ text: 'Take out trash' }, { text: 'Pay rent' }] });
    expect(r.tasks).toHaveLength(2);
  });
  it('validateParsedTaskList accepts an empty list', () => {
    expect(validateParsedTaskList({ tasks: [] }).tasks).toHaveLength(0);
  });
  it('validateParsedTaskList rejects a non-string text', () => {
    expect(() => validateParsedTaskList({ tasks: [{ text: 42 }] }))
      .toThrow(/text must be a string/);
  });
  it('validateParsedTaskList rejects a missing tasks array', () => {
    expect(() => validateParsedTaskList({}))
      .toThrow(GeminiValidationError);
  });

  it('validateParsedMealPlan accepts well-formed meal entries', () => {
    const r = validateParsedMealPlan({
      meals: [
        { mealName: 'Tacos', type: 'dinner', day: 'Monday' },
        { mealName: 'Oatmeal', type: 'breakfast' },
      ],
    });
    expect(r.meals).toHaveLength(2);
  });
  it('validateParsedMealPlan rejects an invalid meal type', () => {
    expect(() => validateParsedMealPlan({ meals: [{ mealName: 'X', type: 'brunch' }] }))
      .toThrow(/type must be one of/);
  });
  it('validateParsedMealPlan rejects a non-string mealName', () => {
    expect(() => validateParsedMealPlan({ meals: [{ mealName: 5, type: 'dinner' }] }))
      .toThrow(/mealName must be a string/);
  });
  it('validateParsedMealPlan rejects a non-string day', () => {
    expect(() => validateParsedMealPlan({ meals: [{ mealName: 'X', type: 'dinner', day: 3 }] }))
      .toThrow(/day must be a string/);
  });
});

describe('geminiValidation - validateRecipe (Partial<Meal>)', () => {
  it('accepts a partial recipe', () => {
    const r = validateRecipe({ name: 'Soup', ingredients: [{ name: 'Water' }], instructions: ['boil'], tags: ['easy'] });
    expect(r.name).toBe('Soup');
  });
  it('accepts an empty object (all fields optional)', () => {
    expect(validateRecipe({})).toEqual({});
  });
  it('rejects malformed ingredients', () => {
    expect(() => validateRecipe({ ingredients: [{ name: 1 }] })).toThrow(/name must be a string/);
  });
});

describe('geminiValidation - validateGeneratedWeeklyPlan', () => {
  const valid = {
    weekLabel: 'Week 1',
    stores: [{ key: 's', name: 'Grocery' }],
    meals: [{ name: 'Tacos', ingredients: ['beef'], prep: [{ t: 'chop', min: 5 }] }],
    items: [{ n: 'beef', q: '1 lb', sec: 'meat' }],
  };
  it('accepts a well-formed plan', () => {
    expect(validateGeneratedWeeklyPlan(valid).meals).toHaveLength(1);
  });
  it('rejects meals missing name', () => {
    expect(() => validateGeneratedWeeklyPlan({ ...valid, meals: [{ ingredients: ['x'] }] }))
      .toThrow(/name must be a string/);
  });
  it('rejects a step missing min', () => {
    expect(() => validateGeneratedWeeklyPlan({
      ...valid, meals: [{ name: 'T', ingredients: ['x'], prep: [{ t: 'chop' }] }],
    })).toThrow(/min must be a number/);
  });
  it('rejects items missing n', () => {
    expect(() => validateGeneratedWeeklyPlan({ ...valid, items: [{ q: '1 lb' }] }))
      .toThrow(/n must be a string/);
  });
});

describe('geminiValidation - validateBase64Image', () => {
  it('accepts a valid data-URL PNG', () => {
    expect(validateBase64Image(VALID_IMAGE)).toBeGreaterThan(0);
  });

  it('accepts a raw base64 payload (no data-URL prefix)', () => {
    const raw = VALID_IMAGE.replace(/^data:[^;]+;base64,/, '');
    expect(validateBase64Image(raw)).toBeGreaterThan(0);
  });

  it('rejects an empty string', () => {
    expect(() => validateBase64Image('')).toThrow(InvalidImageError);
  });

  it('rejects a non-image data URL', () => {
    expect(() => validateBase64Image('data:application/pdf;base64,AAAAAAAAAAAAAAAA'))
      .toThrow(/Unsupported data URL MIME type/);
  });

  it('rejects a too-short payload', () => {
    expect(() => validateBase64Image('AAAA')).toThrow(/too short/);
  });

  it('rejects invalid base64 characters', () => {
    expect(() => validateBase64Image('not-valid-base64-!!!@@@')).toThrow(/not valid base64/);
  });

  it('rejects an oversized image', () => {
    // Build a base64 string whose decoded size exceeds the cap.
    const chars = Math.ceil((MAX_IMAGE_BYTES + 1024) / 3) * 4;
    const huge = 'A'.repeat(chars);
    expect(() => validateBase64Image(huge)).toThrow(/too large/);
  });
});
