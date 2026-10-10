import { addDays, format } from 'date-fns';
import type { Meal, MealPlanItem, ShoppingItem, WallCalendarFeed, WallEvent, WallSettings, WallTravel } from '@/types/schema';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';

/**
 * Test Mode fixtures for the wall (docs/plans/wall-display-kiosk.md §8). Only
 * loaded behind `import.meta.env.DEV` + the Test Mode session flag, so
 * production builds tree-shake this module away.
 */
export function wallTestFixtures(
  today = new Date(),
  /** The wall's theme; the screenshot spec sets dark through the session flag the provider reads. */
  theme: WallSettings['theme'] = 'light',
  /**
   * `#/wall?board=1`: the Board with a fuller household day, so each person's lane has something in it.
   * Without it Test Mode shows Week, which the e2e specs drive.
   */
  board = false
): {
  events: WallEvent[];
  feeds: WallCalendarFeed[];
  travel: WallTravel[];
  settings: WallSettings;
  meals: Meal[];
  mealPlan: MealPlanItem[];
  shopping: ShoppingItem[];
} {
  const day = (offset: number) => format(addDays(today, offset), 'yyyy-MM-dd');
  const at = (offset: number, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = addDays(today, offset);
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  };
  const events: WallEvent[] = [
    { id: 'fx1', source: 'feed', ownerKey: 'family', title: 'Farmers market', allDay: false, date: day(0), start: at(0, '09:00'), end: at(0, '10:00') },
    { id: 'fx2', source: 'feed', ownerKey: 'test-user-id', title: 'Haircut', allDay: false, date: day(0), start: at(0, '14:00'), end: at(0, '14:45') },
    // Clashes with the haircut, so Day view shows side-by-side blocks.
    { id: 'fx7', source: 'feed', ownerKey: 'family', title: 'Soccer practice', allDay: false, date: day(0), start: at(0, '13:30'), end: at(0, '15:00') },
    { id: 'fx3', source: 'feed', ownerKey: 'family', title: 'Dinner at Grandma’s', allDay: false, date: day(0), start: at(0, '17:00'), end: at(0, '19:00') },
    { id: 'fx4', source: 'bill', ownerKey: 'family', title: 'Water bill', allDay: true, date: day(1) },
    { id: 'fx5', source: 'feed', ownerKey: 'test-user-id', title: 'Dentist', allDay: false, date: day(1), start: at(1, '08:00'), end: at(1, '09:00') },
    { id: 'fx6', source: 'holiday', ownerKey: 'family', title: 'Columbus Day', allDay: true, date: day(2) },
    // On the Kids calendar (alerts on) with a 20-minute drive: a heads-up at 4:00, "Time to leave" at 4:10.
    { id: 'fx8', source: 'feed', feedId: 'kids', ownerKey: 'test-user-id', title: 'Piano lesson', allDay: false, date: day(0), start: at(0, '16:30'), end: at(0, '17:00'), location: 'Lakeside Music, Wayzata' },
  ];
  if (board) {
    const piano = events.find(e => e.id === 'fx8');
    if (piano) piano.ownerKey = 'kid_leo';
    const soccer = events.find(e => e.id === 'fx7');
    if (soccer) soccer.ownerKey = 'kid_leo';
    events.push(
      { id: 'fb1', source: 'feed', ownerKey: 'test-partner-id', title: 'Pick up dry cleaning', allDay: false, date: day(0), start: at(0, '12:00'), end: at(0, '12:30') },
      { id: 'fb2', source: 'feed', ownerKey: 'test-partner-id', title: 'Book club at Maya’s', allDay: false, date: day(0), start: at(0, '19:30'), end: at(0, '21:00') },
      { id: 'fb3', source: 'feed', ownerKey: 'test-user-id', title: 'Call Mom', allDay: false, date: day(0), start: at(0, '18:30'), end: at(0, '19:00') },
      { id: 'fb4', source: 'feed', ownerKey: 'kid_leo', title: 'Bath and books', allDay: false, date: day(0), start: at(0, '19:45'), end: at(0, '20:15') },
      { id: 'fb5', source: 'feed', ownerKey: 'kid_leo', title: 'Soccer game', allDay: false, date: day(3), start: at(3, '10:00'), end: at(3, '11:00') },
      { id: 'fb6', source: 'feed', ownerKey: 'test-partner-id', title: 'Parent–teacher conferences', allDay: false, date: day(5), start: at(5, '17:00'), end: at(5, '17:30') },
      { id: 'fb7', source: 'feed', ownerKey: 'family', title: 'Pumpkin patch', allDay: false, date: day(4), start: at(4, '13:00'), end: at(4, '15:00') }
    );
  }
  const feeds: WallCalendarFeed[] = [
    { id: 'kids', label: 'Kids', ownerKey: 'family', kind: 'ics', createdBy: 'test-user-id', eventCount: 1, stale: false, alerts: true, travelMode: 'drive' },
  ];
  const travel: WallTravel[] = [{ id: 'fx8', minutes: 20, mode: 'drive', start: at(0, '16:30'), checkedAt: at(0, '15:00') }];
  // Test Mode's household seeds no meals, so the wall brings its own week.
  const meals: Meal[] = [
    {
      id: 'fxm1',
      name: 'Tacos',
      tags: [],
      ingredients: [{ name: 'Tortillas' }, { name: 'Ground beef', quantity: '1 lb' }, { name: 'Salsa' }],
      instructions: ['Brown the beef with taco seasoning.', 'Warm the tortillas.'],
    },
  ];
  const mealPlan: MealPlanItem[] = [
    { id: 'fxp1', date: day(0), type: 'dinner', mealId: 'fxm1', mealName: 'Tacos', isCooked: false },
    { id: 'fxp2', date: day(0), type: 'breakfast', mealName: 'Pancakes', isCooked: false },
    { id: 'fxp3', date: day(1), type: 'dinner', mealName: 'Roast chicken', isCooked: false },
  ];
  const shopping: ShoppingItem[] = board
    ? ['Milk', 'Bananas', 'Paper towels', 'Granola bars', 'Coffee filters', 'Dish soap', 'Taco shells'].map((name, i) => ({
        id: `fxs${i}`,
        name,
        category: 'Other',
        isPurchased: false,
      }))
    : [];
  return { events, feeds, travel, meals, mealPlan, shopping, settings: { ...DEFAULT_WALL_SETTINGS, theme, home: board ? 'board' : 'week', weather: { lat: 44.97, lon: -93.59, label: 'Test City' } } };
}
