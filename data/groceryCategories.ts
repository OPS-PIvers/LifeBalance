/**
 * Shared grocery/pantry categories used across the application
 * Ensures consistency between UI dropdowns and AI optimization
 */
export const GROCERY_CATEGORIES = [
  'Produce',
  'Dairy',
  'Meat',
  'Pantry',
  'Snacks',
  'Beverages',
  'Frozen',
  'Household',
  'Uncategorized'
] as const;

export type GroceryCategory = typeof GROCERY_CATEGORIES[number];
