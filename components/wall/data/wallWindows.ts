import { addDays, addMonths, format, startOfMonth } from 'date-fns';

/**
 * Date windows the wall listens to. Calendar lines cover the previous month
 * through three months out (the server's sync window, plan §4.4); the meal
 * plan covers yesterday through two weeks out ("Meals this week" + Coming up).
 */
export function wallEventWindow(today: Date): { start: string; end: string } {
  return {
    start: format(startOfMonth(addMonths(today, -1)), 'yyyy-MM-dd'),
    end: format(addMonths(today, 3), 'yyyy-MM-dd'),
  };
}

export function wallMealPlanWindow(today: Date): { start: string; end: string } {
  return {
    start: format(addDays(today, -1), 'yyyy-MM-dd'),
    end: format(addDays(today, 14), 'yyyy-MM-dd'),
  };
}
