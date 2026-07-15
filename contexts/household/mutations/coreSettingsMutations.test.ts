import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Firestore mock --------------------------------------------------------
// Captures every updateDoc(ref, patch) so tests can assert the single-doc
// household-settings writes (setDietaryProfile / setMealCookedHabitId /
// setModuleVisibility / setKidModePin clear semantics).

interface CapturedUpdate {
  ref: { __path: string };
  data: Record<string, unknown>;
}

let capturedUpdates: CapturedUpdate[] = [];

const DELETE_FIELD_SENTINEL = { __deleteField: true };

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` })),
  updateDoc: vi.fn(async (ref: { __path: string }, data: Record<string, unknown>) => {
    capturedUpdates.push({ ref, data });
  }),
  deleteField: vi.fn(() => DELETE_FIELD_SENTINEL),
  addDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/utils/kidPin', () => ({
  hashKidPin: vi.fn(async (pin: string) => `hashed:${pin}`),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@/services/analytics', () => ({
  track: vi.fn(),
}));

import { makeHouseholdSettingsMutations } from './coreMutations';
import type { DietaryProfile } from '@/types/schema';

const db = {} as never;

beforeEach(() => {
  capturedUpdates = [];
});

describe('makeHouseholdSettingsMutations — household settings single-doc writes', () => {
  it('setDietaryProfile persists the profile to the household doc (F-MEALS-03)', async () => {
    const { setDietaryProfile } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    const profile: DietaryProfile = { restrictions: ['vegetarian'], allergens: ['peanuts'] };
    await setDietaryProfile(profile);
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0]?.ref.__path).toBe('households/h1');
    expect(capturedUpdates[0]?.data).toEqual({ dietaryProfile: profile });
  });

  it('setDietaryProfile is a no-op without a household id', async () => {
    const { setDietaryProfile } = makeHouseholdSettingsMutations({ db, householdId: null });
    await setDietaryProfile({ restrictions: [], allergens: [] });
    expect(capturedUpdates).toHaveLength(0);
  });

  it('setMealCookedHabitId writes the habit id when set (F-MEALS-04)', async () => {
    const { setMealCookedHabitId } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    await setMealCookedHabitId('habit-9');
    expect(capturedUpdates[0]?.data).toEqual({ mealCookedHabitId: 'habit-9' });
  });

  it('setMealCookedHabitId deletes the field when cleared with null', async () => {
    const { setMealCookedHabitId } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    await setMealCookedHabitId(null);
    expect(capturedUpdates[0]?.data).toEqual({ mealCookedHabitId: DELETE_FIELD_SENTINEL });
  });

  it('setModuleVisibility merge-writes a single dotted field path', async () => {
    const { setModuleVisibility } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    await setModuleVisibility('meals', false);
    expect(capturedUpdates[0]?.data).toEqual({ 'moduleVisibility.meals': false });
  });

  it('setKidModePin hashes and writes; null clears via deleteField', async () => {
    const { setKidModePin } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    await setKidModePin('1234');
    expect(capturedUpdates[0]?.data).toEqual({ kidModePinHash: 'hashed:1234' });
    capturedUpdates = [];
    await setKidModePin(null);
    expect(capturedUpdates[0]?.data).toEqual({ kidModePinHash: DELETE_FIELD_SENTINEL });
  });

  it('completeOnboarding and setHouseholdCurrency write their fields', async () => {
    const { completeOnboarding, setHouseholdCurrency } = makeHouseholdSettingsMutations({ db, householdId: 'h1' });
    await completeOnboarding();
    expect(capturedUpdates[0]?.data).toEqual({ onboardingComplete: true });
    capturedUpdates = [];
    await setHouseholdCurrency('EUR');
    expect(capturedUpdates[0]?.data).toEqual({ currency: 'EUR' });
  });
});
