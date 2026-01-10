import { useState } from 'react';
import toast from 'react-hot-toast';
import { optimizeGroceryList, OptimizableItem } from '@/services/geminiService';
import { normalizeValue } from '@/utils/stringNormalizer';

interface UseGroceryOptimizerConfig<T> {
  items: T[];
  updateItem: (item: T) => Promise<void>;
  mapToOptimizable: (item: T) => OptimizableItem;
  mapFromOptimizable: (original: T, optimized: OptimizableItem) => T;
  availableCategories?: string[];
  emptyMessage?: string;
  errorMessage?: string;
}

/**
 * Custom hook for optimizing grocery/pantry lists with AI.
 * Handles the complete optimization flow including error handling, progress tracking,
 * and partial failure resilience.
 * 
 * @param config Configuration object with items, update function, and mapping functions
 * @returns Object with handleOptimize function and isOptimizing state
 */
export const useGroceryOptimizer = <T extends { id: string }>({
  items,
  updateItem,
  mapToOptimizable,
  mapFromOptimizable,
  availableCategories,
  emptyMessage = "List is empty",
  errorMessage = "Failed to optimize list"
}: UseGroceryOptimizerConfig<T>) => {
  const [isOptimizing, setIsOptimizing] = useState(false);

  const handleOptimize = async () => {
    if (items.length === 0) {
      toast.error(emptyMessage);
      return;
    }

    try {
      setIsOptimizing(true);

      // Convert items to optimizable format
      const optimizableItems = items.map(mapToOptimizable);

      // Call AI optimization
      const optimizedItems = await optimizeGroceryList(
        optimizableItems,
        availableCategories
      );

      // Update items concurrently with partial failure handling
      let updatedCount = 0;
      let notFoundCount = 0;
      const results = await Promise.allSettled(
        optimizedItems.map(async (optItem) => {
          const original = items.find(i => i.id === optItem.id);
          
          if (!original) {
            notFoundCount++;
            console.warn(
              `Optimized item with id "${optItem.id}" not found in original list. Skipping.`,
              { optimizedItem: optItem }
            );
            return;
          }

          // Convert back to original type for comparison
          const newItem = mapFromOptimizable(original, optItem);

          // Check if anything actually changed to avoid redundant updates
          if (hasChanges(original, newItem)) {
            await updateItem(newItem);
            updatedCount++;
          }
        })
      );

      // Count failures
      let failedCount = 0;
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failedCount++;
          console.error(
            'Failed to update optimized item:',
            optimizedItems[index],
            result.reason
          );
        }
      });

      // Display appropriate feedback
      if (notFoundCount > 0) {
        console.warn(`${notFoundCount} optimized items were not found in the original list`);
      }

      if (updatedCount > 0 && failedCount === 0) {
        toast.success(`Optimized ${updatedCount} items!`, { icon: '✨' });
      } else if (updatedCount > 0 && failedCount > 0) {
        toast.success(
          `Optimized ${updatedCount} items, but ${failedCount} updates failed.`,
          { icon: '⚠️' }
        );
      } else if (updatedCount === 0 && failedCount > 0) {
        toast.error(`${errorMessage}. Please try again.`);
      } else {
        toast.success('Everything looks good!', { icon: '✨' });
      }

    } catch (error) {
      console.error("Optimization failed:", error);
      toast.error(errorMessage);
    } finally {
      setIsOptimizing(false);
    }
  };

  return { handleOptimize, isOptimizing };
};

/**
 * Generic comparison function to check if two objects have differences.
 * Compares all enumerable properties using normalized string values.
 */
const hasChanges = <T extends Record<string, any>>(original: T, updated: T): boolean => {
  const keys = Object.keys(updated) as (keyof T)[];
  
  for (const key of keys) {
    // Skip id field as it never changes
    if (key === 'id') continue;

    const origVal = normalizeValue(String(original[key] ?? ''));
    const newVal = normalizeValue(String(updated[key] ?? ''));

    // If values differ and at least one is non-empty, there's a change
    if (origVal !== newVal) {
      // Skip update if both are empty (avoid redundant writes)
      if (origVal === '' && newVal === '') {
        continue;
      }
      return true;
    }
  }

  return false;
};
