import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { GroceryCatalogItem, Meal, MealPlanItem, ShoppingItem, Store, ToDo } from '@/types/schema';
import { makeWallPeople } from '@/utils/wall/wallPeople';
import { WallDataContext, type WallData } from '@/components/wall/data/wallData';
import { makeWallData } from '@/components/wall/data/wallTestData';
import { WallToastContext, useWallToastController } from '@/components/wall/wallToast';
import WallToast from '@/components/wall/WallToast';
import WallShopping from './WallShopping';
import WallTodos from './WallTodos';
import WallMeals from './WallMeals';
import WallAddSheet from './WallAddSheet';
import { useWallListActions } from './useWallListActions';

const D = '2026-10-03';
const TZ = 'America/Chicago';

const shopping = [
  { id: 's1', name: 'Milk', category: 'Dairy', store: 'Cub Foods', isPurchased: false, quantity: '2 gal' },
  { id: 's2', name: 'Eggs', category: 'Dairy', store: 'Cub Foods', isPurchased: true },
  { id: 's3', name: 'Batteries', category: 'Home', store: 'Target', isPurchased: false },
] as ShoppingItem[];
const stores = [{ id: 'c', name: 'Cub Foods', order: 0 }, { id: 't', name: 'Target', order: 1 }] as Store[];
const todos = [
  { id: 't1', text: 'Return library books', completeByDate: '2026-10-01', isCompleted: false, createdAt: 'x', createdBy: 'p' },
  { id: 't2', text: 'Feed the fish', completeByDate: D, isCompleted: false, assignedTo: 'l', points: 5, createdAt: 'x', createdBy: 'p' },
  { id: 't3', text: 'Sign field trip form', completeByDate: '2026-10-08', isCompleted: false, assignedTo: 'p', createdAt: 'x', createdBy: 'p' },
] as ToDo[];

const ToastHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast, dismiss, toaster } = useWallToastController();
  return (
    <WallToastContext.Provider value={toaster}>
      {children}
      {toast && <WallToast toast={toast} toaster={toaster} onDismiss={dismiss} />}
    </WallToastContext.Provider>
  );
};

function setup(ui: React.ReactElement, data: Partial<WallData> = {}) {
  const value = makeWallData(vi.fn, { shoppingList: shopping, stores, todos, ...data });
  const utils = render(
    <WallDataContext.Provider value={value}>
      <ToastHost>{ui}</ToastHost>
    </WallDataContext.Provider>
  );
  const rerenderWith = (patch: Partial<WallData>) => {
    Object.assign(value, patch);
    utils.rerender(
      <WallDataContext.Provider value={{ ...value }}>
        <ToastHost>{ui}</ToastHost>
      </WallDataContext.Provider>
    );
  };
  return { ...utils, value, rerenderWith };
}

const swipeLeft = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { clientX: 300, clientY: 10 });
  fireEvent.pointerMove(el, { clientX: 200, clientY: 12 });
  fireEvent.pointerUp(el);
};

const people = makeWallPeople(
  [
    { uid: 'p', displayName: 'Paul', role: 'admin' },
    { uid: 'l', displayName: 'Leo', role: 'member', isManaged: true },
  ] as WallData['members'],
  false
);

describe('WallShopping', () => {
  it('groups by store with the checked items in the cart', () => {
    setup(<WallShopping />);
    const cub = screen.getByRole('region', { name: 'Cub Foods' });
    expect(within(cub).getByText('1 left')).toBeInTheDocument();
    expect(within(cub).getByText('In the cart')).toBeInTheDocument();
    expect(within(cub).getByRole('button', { name: /Eggs/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Target' })).toBeInTheDocument();
  });

  it('checks off with Undo, and swipes to delete with Undo restoring the item', () => {
    const { value } = setup(<WallShopping />);
    fireEvent.click(screen.getByRole('button', { name: /Milk/ }));
    expect(value.actions.toggleShoppingItemPurchased).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.toggleShoppingItemPurchased).toHaveBeenCalledTimes(2);

    const row = screen.getByRole('button', { name: /Batteries/ }).closest('.row') as HTMLElement;
    swipeLeft(row);
    expect(row).toHaveClass('swiped');
    // The click that ends a swipe doesn't toggle.
    fireEvent.click(within(row).getByRole('button', { name: /Batteries/ }));
    expect(value.actions.toggleShoppingItemPurchased).toHaveBeenCalledTimes(2);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(value.actions.deleteShoppingItem).toHaveBeenCalledWith('s3');
    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Batteries”');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.addShoppingItem).toHaveBeenCalledWith({ name: 'Batteries', category: 'Home', store: 'Target', isPurchased: false });
  });

  it('shows an empty list plainly', () => {
    setup(<WallShopping />, { shoppingList: [] });
    expect(screen.getByText('List is empty')).toBeInTheDocument();
  });
});

describe('clear checked items', () => {
  const ClearButton: React.FC = () => {
    const act = useWallListActions();
    return (
      <button type="button" onClick={act.clearCart}>
        Clear
      </button>
    );
  };

  it('clears and re-adds exactly what was cleared on Undo', () => {
    const { value } = setup(<ClearButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(value.actions.clearPurchasedShoppingItems).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Cleared 1 checked item');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.addShoppingItem).toHaveBeenCalledWith({ name: 'Eggs', category: 'Dairy', store: 'Cub Foods', isPurchased: true });
  });
});

describe('WallTodos', () => {
  it('groups Overdue / Today / This week and filters by person', () => {
    setup(<WallTodos today={D} timeZone={TZ} people={people} />);
    expect(screen.getByRole('region', { name: 'Overdue' })).toHaveTextContent('Return library books');
    expect(screen.getByRole('region', { name: 'This week' })).toHaveTextContent('Sign field trip form');
    fireEvent.click(screen.getByRole('button', { name: 'Leo' }));
    expect(screen.queryByRole('region', { name: 'Overdue' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent('Feed the fish');
  });

  it('completes through the shared action (kid points) and undoes it', () => {
    const { value } = setup(<WallTodos today={D} timeZone={TZ} people={people} />);
    fireEvent.click(screen.getByRole('button', { name: /Feed the fish/ }));
    expect(value.actions.completeToDo).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.uncompleteToDo).toHaveBeenCalledWith('t2');
  });

  it('deletes with Undo re-adding the same fields', () => {
    const { value } = setup(<WallTodos today={D} timeZone={TZ} people={people} />);
    const row = screen.getByRole('button', { name: /Feed the fish/ }).closest('.row') as HTMLElement;
    swipeLeft(row);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(value.actions.deleteToDo).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.addToDo).toHaveBeenCalledWith({ text: 'Feed the fish', completeByDate: D, isCompleted: false, assignedTo: 'l', points: 5 });
  });
});

describe('WallAddSheet', () => {
  const catalog = [
    { id: 'c1', name: 'Avocados', category: 'Produce', defaultStore: 'Cub Foods', defaultQuantity: '2', purchaseCount: 9 },
  ] as GroceryCatalogItem[];

  it('adds shopping items from suggestions and typing, staying open; Undo removes the new item', () => {
    const onDone = vi.fn();
    const { value, rerenderWith } = setup(<WallAddSheet kind="shopping" today={D} people={people} onDone={onDone} />, { groceryCatalog: catalog });
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'avo' } });
    fireEvent.click(screen.getByRole('button', { name: /Avocados.*Cub Foods · usually 2/ }));
    expect(value.actions.addShoppingItem).toHaveBeenLastCalledWith({
      name: 'Avocados', category: 'Produce', isPurchased: false, source: 'manual', quantity: '2', store: 'Cub Foods',
    });
    expect(screen.getByLabelText('Item')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Target' }));
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Birthday card' } });
    fireEvent.submit(screen.getByLabelText('Item').closest('form') as HTMLFormElement);
    expect(value.actions.addShoppingItem).toHaveBeenLastCalledWith({ name: 'Birthday card', category: 'Other', isPurchased: false, source: 'manual', store: 'Target' });

    // The listener shows the new item (pending write); Undo deletes exactly it.
    act(() => rerenderWith({ shoppingList: [...shopping, { id: 'new1', name: 'Birthday card', category: 'Other', isPurchased: false }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.deleteShoppingItem).toHaveBeenCalledWith('new1');
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('adds a to-do for a person, due tomorrow', () => {
    const { value } = setup(<WallAddSheet kind="todo" today={D} people={people} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('To-do'), { target: { value: 'Practice piano' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'For' })).getByRole('button', { name: /Leo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(value.actions.addToDo).toHaveBeenCalledWith({
      text: 'Practice piano', completeByDate: '2026-10-04', isCompleted: false, source: 'manual', assignedTo: 'l',
    });
  });

  it('starts on the day Day view was showing', () => {
    const { unmount } = setup(<WallAddSheet kind="todo" today={D} people={people} dueDate="2026-10-04" onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    const { value } = setup(<WallAddSheet kind="todo" today={D} people={people} dueDate="2026-10-09" onDone={vi.fn()} />);
    expect(screen.getByText('Friday, October 9')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('To-do'), { target: { value: 'Pack for the trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(value.actions.addToDo).toHaveBeenCalledWith({ text: 'Pack for the trip', completeByDate: '2026-10-09', isCompleted: false, source: 'manual' });
  });
});

describe('WallMeals', () => {
  const plan = [
    { id: 'p1', date: D, type: 'dinner', mealId: 'm1', mealName: 'Tacos', isCooked: false },
    { id: 'p2', date: D, type: 'lunch', mealName: 'Leftover pasta', isCooked: false },
    { id: 'p3', date: '2026-10-04', type: 'dinner', mealName: 'Pizza night', isCooked: false },
  ] as MealPlanItem[];
  const meals = [
    {
      id: 'm1', name: 'Tacos', tags: [],
      ingredients: [{ name: 'Tortillas' }, { name: 'Ground beef', quantity: '1 lb' }, { name: 'Milk' }],
      instructions: ['Brown the beef.'],
    },
  ] as Meal[];

  it('shows dinners with the small breakfast/lunch line, and a recipe that adds what’s missing', () => {
    const Host: React.FC = () => {
      const [open, setOpen] = React.useState<string | null>(null);
      return <WallMeals today={D} openDate={open} onOpen={setOpen} />;
    };
    const { value } = setup(<Host />, { mealPlan: plan, meals });
    expect(screen.getByText('Lunch: Leftover pasta')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing planned')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: /Tacos/ }));
    const recipe = screen.getByRole('complementary', { name: 'Tacos recipe' });
    expect(within(recipe).getByText('Tonight')).toBeInTheDocument();
    expect(within(recipe).getByText('On the list')).toBeInTheDocument(); // Milk
    fireEvent.click(within(recipe).getByRole('button', { name: 'Add 2 missing to Shopping' }));
    expect(value.actions.addShoppingItem).toHaveBeenCalledTimes(2);
    expect(value.actions.addShoppingItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ground beef', quantity: '1 lb', addedFromMealId: 'm1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Added 2 items to Shopping');

    fireEvent.click(screen.getByRole('button', { name: /Pizza night/ }));
    expect(screen.getByText('No recipe saved for this meal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close recipe' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
