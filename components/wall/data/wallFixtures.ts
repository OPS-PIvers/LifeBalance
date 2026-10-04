import { addDays, format } from 'date-fns';
import type { WallEvent, WallSettings } from '@/types/schema';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';

/**
 * Test Mode fixtures for the wall (docs/plans/wall-display-kiosk.md §8). Only
 * loaded behind `import.meta.env.DEV` + the Test Mode session flag, so
 * production builds tree-shake this module away.
 */
export function wallTestFixtures(today = new Date()): { events: WallEvent[]; settings: WallSettings } {
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
    { id: 'fx3', source: 'feed', ownerKey: 'family', title: 'Dinner at Grandma’s', allDay: false, date: day(0), start: at(0, '17:00'), end: at(0, '19:00') },
    { id: 'fx4', source: 'bill', ownerKey: 'family', title: 'Water bill', allDay: true, date: day(1) },
    { id: 'fx5', source: 'feed', ownerKey: 'test-user-id', title: 'Dentist', allDay: false, date: day(1), start: at(1, '08:00'), end: at(1, '09:00') },
    { id: 'fx6', source: 'holiday', ownerKey: 'family', title: 'Columbus Day', allDay: true, date: day(2) },
  ];
  return { events, settings: { ...DEFAULT_WALL_SETTINGS, weather: { lat: 44.97, lon: -93.59, label: 'Test City' } } };
}
