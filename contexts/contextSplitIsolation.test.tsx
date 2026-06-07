import { describe, it, expect, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  HouseholdSliceProviders,
  useFinance,
  useMeals,
  useTodos,
  useGamification,
  useHousehold,
  type FinanceContextValue,
  type MealPlanContextValue,
  type ShoppingContextValue,
  type TodosContextValue,
  type GamificationContextValue,
  type HouseholdCoreContextValue,
} from './FirebaseHouseholdContext';

// Verifies the core acceptance criterion of the context split: a change in one
// domain slice (Finance) must NOT re-render components subscribed to unrelated
// slices (Meals / Todos / Gamification). This exercises the real provider
// nesting (`HouseholdSliceProviders`) used by both the Firestore and Mock
// providers, so it guards the render-isolation win against regressions.

const makeFinance = (transactions: unknown[]): FinanceContextValue =>
  ({ transactions } as unknown as FinanceContextValue);

// Stable references for the slices we are NOT changing — mirrors how the real
// provider memoizes each slice with a tight dependency array, so these keep the
// same identity across a finance-only update.
const MEAL_PLAN = {} as unknown as MealPlanContextValue;
const SHOPPING = {} as unknown as ShoppingContextValue;
const TODOS = {} as unknown as TodosContextValue;
const GAMIFICATION = {} as unknown as GamificationContextValue;
const CORE = {} as unknown as HouseholdCoreContextValue;

let financeRenders = 0;
let mealsRenders = 0;
let todosRenders = 0;
let gamificationRenders = 0;
let shimRenders = 0;

const FinanceConsumer: React.FC = () => {
  useFinance();
  financeRenders++;
  return null;
};
const MealsConsumer: React.FC = () => {
  useMeals();
  mealsRenders++;
  return null;
};
const TodosConsumer: React.FC = () => {
  useTodos();
  todosRenders++;
  return null;
};
const GamificationConsumer: React.FC = () => {
  useGamification();
  gamificationRenders++;
  return null;
};
const ShimConsumer: React.FC = () => {
  useHousehold();
  shimRenders++;
  return null;
};

// Children are created once by the test and passed in as a stable element, so
// the only thing that can re-render a consumer is a context value it reads —
// exactly the situation in the real app (the provider's `children` is stable).
const Harness: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [finance, setFinance] = useState<FinanceContextValue>(() => makeFinance([]));
  return (
    <>
      <button onClick={() => setFinance(makeFinance([{ id: 'tx1' }]))}>change-finance</button>
      <HouseholdSliceProviders
        finance={finance}
        gamification={GAMIFICATION}
        mealPlan={MEAL_PLAN}
        shopping={SHOPPING}
        todos={TODOS}
        core={CORE}
      >
        {children}
      </HouseholdSliceProviders>
    </>
  );
};

describe('context split render isolation', () => {
  beforeEach(() => {
    financeRenders = 0;
    mealsRenders = 0;
    todosRenders = 0;
    gamificationRenders = 0;
    shimRenders = 0;
  });

  it('does not re-render Meals/Todos/Gamification consumers when only Finance changes', () => {
    render(
      <Harness>
        <FinanceConsumer />
        <MealsConsumer />
        <TodosConsumer />
        <GamificationConsumer />
      </Harness>
    );

    expect(financeRenders).toBe(1);
    expect(mealsRenders).toBe(1);
    expect(todosRenders).toBe(1);
    expect(gamificationRenders).toBe(1);

    // Simulate "editing a transaction" — a Finance-only state change.
    fireEvent.click(screen.getByText('change-finance'));

    // The finance consumer re-renders…
    expect(financeRenders).toBe(2);
    // …but unrelated-domain consumers (MealPlanTab/ToDosPage equivalents) do not.
    expect(mealsRenders).toBe(1);
    expect(todosRenders).toBe(1);
    expect(gamificationRenders).toBe(1);
  });

  it('the useHousehold() shim still re-renders on any slice change (documented trade-off)', () => {
    render(
      <Harness>
        <ShimConsumer />
      </Harness>
    );

    expect(shimRenders).toBe(1);
    fireEvent.click(screen.getByText('change-finance'));
    expect(shimRenders).toBe(2);
  });
});
