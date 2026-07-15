import React from 'react';
import { format, addDays, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { useHouseholdCore, useMealPlan } from '@/contexts/FirebaseHouseholdContext';
import type { MealPlanSlot } from '@/services/geminiService.types';
import { track } from '@/services/analytics';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { PhotoImportDrawer } from './PhotoImportDrawer';

interface MealRowData {
  /** Weekday index within the target week: 0 = Monday … 6 = Sunday. */
  dayIndex: number;
  type: MealPlanSlot;
  mealName: string;
}

interface MealPlanPhotoImportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Monday of the currently-displayed week (yyyy-MM-dd) — imported meals map onto it. */
  weekStartStr: string;
}

/** Monday-first weekday labels; index matches MealRowData.dayIndex. */
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const MEAL_TYPES: MealPlanSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Map a parsed weekday name to a Monday-first index; unknown/empty → Monday (0). */
const dayNameToIndex = (day: string | undefined): number => {
  if (!day) return 0;
  const cleanDay = day.trim().toLowerCase();
  const idx = WEEKDAYS.findIndex((d) => {
    const lowerD = d.toLowerCase();
    return lowerD === cleanDay || lowerD.startsWith(cleanDay) || cleanDay.startsWith(lowerD.slice(0, 3));
  });
  return idx === -1 ? 0 : idx;
};

/**
 * F-TODO-06 (owner note): snap a handwritten/whiteboard weekly menu into
 * meal-plan entries. Thin caller around the shared {@link PhotoImportDrawer} —
 * parses the photo into {day, type, mealName} rows and, after review, writes
 * each confirmed row as a MealPlanItem on the currently-displayed week.
 */
export const MealPlanPhotoImportDrawer: React.FC<MealPlanPhotoImportDrawerProps> = ({
  isOpen,
  onClose,
  weekStartStr,
}) => {
  const { householdId } = useHouseholdCore();
  const { addMealPlanItem } = useMealPlan();

  const parse = async (base64Image: string): Promise<MealRowData[]> => {
    if (!householdId) throw new Error('Household ID not found');
    const { parseMealPlan } = await import('@/services/geminiService');
    const result = await parseMealPlan(householdId, base64Image);
    track('photo_mealplan_scanned', { count: result.meals.length });
    return result.meals
      .map((m) => ({
        dayIndex: dayNameToIndex(m.day),
        type: m.type,
        mealName: m.mealName.trim(),
      }))
      .filter((m) => m.mealName.length > 0);
  };

  const onCommit = async (items: MealRowData[]): Promise<void> => {
    const weekStart = parseISO(weekStartStr);
    const results = await Promise.allSettled(
      items.map((item) =>
        addMealPlanItem(
          {
            date: format(addDays(weekStart, item.dayIndex), 'yyyy-MM-dd'),
            mealName: item.mealName,
            type: item.type,
            isCooked: false,
          },
          { suppressToast: true, throwOnError: true }
        )
      )
    );
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Failed to add meal:', result.reason);
      }
    });
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    if (succeeded === 0) throw new Error('All meal-plan writes failed');
    toast.success(`Added ${succeeded} meal${succeeded === 1 ? '' : 's'} to the plan`);
  };

  return (
    <PhotoImportDrawer<MealRowData>
      isOpen={isOpen}
      onClose={onClose}
      title="Scan a meal plan"
      titleId="mealplan-photo-import-title"
      hint="Snap a photo of a handwritten or whiteboard weekly menu and we'll add each meal to this week's plan."
      parse={parse}
      isRowValid={(item) => item.mealName.trim().length > 0}
      renderRow={(item, patch) => (
        <div className="space-y-2">
          <Input
            type="text"
            value={item.mealName}
            onChange={(e) => patch({ mealName: e.target.value })}
            placeholder="Meal name"
            aria-label="Meal name"
          />
          <div className="flex gap-2">
            <Select
              value={item.dayIndex}
              onChange={(e) => patch({ dayIndex: Number(e.target.value) })}
              aria-label="Day"
              className="flex-1"
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
            <Select
              value={item.type}
              onChange={(e) => patch({ type: e.target.value as MealPlanSlot })}
              aria-label="Meal type"
              className="flex-1"
            >
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
      onCommit={onCommit}
      commitLabel={(count) => `Add ${count} meal${count === 1 ? '' : 's'}`}
      emptyResult="No meals found in that photo. Try a clearer shot."
      getItemLabel={(item) => item.mealName}
    />
  );
};

export default MealPlanPhotoImportDrawer;
