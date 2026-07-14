/**
 * Plain TypeScript types for the Gemini service.
 *
 * This file intentionally imports nothing from `@google/genai` so that
 * callers who only need the type definitions do not pull the SDK into their
 * bundle at import time.
 *
 * `services/geminiService.ts` re-exports everything defined here so that
 * existing import paths (`import { ParsedExpense } from '@/services/geminiService'`)
 * continue to compile without changes.
 */

// ---------------------------------------------------------------------------
// Receipt scanning
// ---------------------------------------------------------------------------

export interface ReceiptData {
  merchant: string;
  amount: number;
  category: string;
  date?: string; // Optional - may not be visible on all receipts
  suggestedHabits?: string[];
  store?: string;
}

// ---------------------------------------------------------------------------
// Natural-language command parsing
// ---------------------------------------------------------------------------

export interface ParsedShoppingList {
  items: Array<{
    item: string;
    quantity: number;
    category: string;
  }>;
}

export interface ParsedTodoList {
  tasks: Array<{
    task: string;
    priority: 'low' | 'medium' | 'high';
  }>;
}

// ---------------------------------------------------------------------------
// Photo-to-tasklist (F-TODO-06): parse a handwritten/whiteboard note into
// discrete task lines. Distinct from ParsedTodoList (natural-language command
// parse) — this is an image OCR parse and carries no priority.
// ---------------------------------------------------------------------------

export interface ParsedTaskList {
  tasks: Array<{
    text: string;
  }>;
}

// ---------------------------------------------------------------------------
// Photo-to-meal-plan (F-TODO-06 owner note): parse a handwritten/whiteboard
// weekly menu into meal-plan entries. `day` is a weekday name the client maps
// onto the currently-displayed week; `type` is the meal slot.
// ---------------------------------------------------------------------------

export type MealPlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface ParsedMealPlan {
  meals: Array<{
    /** Weekday name (Monday…Sunday). Empty/absent when the note has no day column. */
    day?: string;
    type: MealPlanSlot;
    mealName: string;
  }>;
}

export interface ParsedExpense {
  amount?: number;
  merchant?: string;
  category?: string;
  notes?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Grocery list optimisation
// ---------------------------------------------------------------------------

/**
 * Interface for items that can be optimized by AI.
 * Used to normalize grocery items across components.
 * The optional fields allow for flexibility in what data is available
 * for optimization.
 */
export interface OptimizableItem {
  id: string;
  name: string;
  category?: string;
  quantity?: string;
  store?: string;
}

// ---------------------------------------------------------------------------
// Habit coaching
// ---------------------------------------------------------------------------

export interface HabitPatternInsight {
  title: string;
  description: string;
  type: 'praise' | 'critique' | 'suggestion';
  relatedHabitId?: string;
}

export interface HabitReorganizationPlan {
  habits: {
    id: string;
    category: string;
    order: number;
  }[];
  reasoning: string;
}

export interface HabitPointAdjustmentSuggestion {
  habitId: string;
  habitTitle: string;
  currentPoints: number;
  suggestedPoints: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Magic action (natural-language quick-add)
// ---------------------------------------------------------------------------

export type MagicActionType = 'transaction' | 'todo' | 'shopping' | 'unknown';

export interface MagicActionResponse {
  type: MagicActionType;
  confidence: number;
  data: {
    // Transaction fields
    merchant?: string;
    amount?: number;
    category?: string;
    date?: string;

    // Todo fields
    text?: string;
    completeByDate?: string;

    // Shopping fields
    item?: string;
    quantity?: string;
    store?: string;
  };
}
