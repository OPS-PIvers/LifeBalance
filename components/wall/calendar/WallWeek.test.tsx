import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MealPlanItem, ShoppingItem, ToDo, WallEvent, WallLayout } from '@/types/schema';
import { makeWallPeople } from '@/utils/wall/wallPeople';
import { WallDataContext, type WallData } from '@/components/wall/data/wallData';
import { makeWallData } from '@/components/wall/data/wallTestData';
import { WallToastContext, useWallToastController } from '@/components/wall/wallToast';
import WallToast from '@/components/wall/WallToast';
import WallWeek from './WallWeek';
import WallDay from './WallDay';
import WallMonth from './WallMonth';

const TZ = 'America/Chicago';
const D = '2026-10-03';
const NOW = new Date(`${D}T15:15:00-05:00`);
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00-05:00`;
const ev = (id: string, date: string, start?: string, end?: string, extra: Partial<WallEvent> = {}): WallEvent => ({
  id, source: 'feed', ownerKey: 'p', title: id, date, allDay: !start, ...(start ? { start } : {}), ...(end ? { end } : {}), ...extra,
});

const events: WallEvent[] = [
  ev('Soccer game', D, at(D, '09:00'), at(D, '10:30'), { ownerKey: 'l' }),
  ev('Haircut', D, at(D, '14:00'), at(D, '15:00')),
  ev('Dinner out', D, at(D, '17:00'), at(D, '19:00'), { ownerKey: 'family' }),
  ev('Farmers market', '2026-10-04', at('2026-10-04', '10:00'), at('2026-10-04', '11:30')),
  ev('Water bill', '2026-10-05', undefined, undefined, { source: 'bill', ownerKey: 'family' }),
];
const todos = [
  { id: 't1', text: 'Return library books', completeByDate: '2026-10-01', isCompleted: false },
  { id: 't2', text: 'Feed the fish', completeByDate: D, isCompleted: false, assignedTo: 'l' },
] as ToDo[];
const mealPlan = [{ id: 'm1', date: D, type: 'dinner', mealName: 'Tacos', isCooked: false }] as MealPlanItem[];
const shopping = [
  { id: 's1', name: 'Milk', category: 'Dairy', isPurchased: false, quantity: '2 gal' },
  { id: 's2', name: 'Eggs', category: 'Dairy', isPurchased: true },
] as ShoppingItem[];

const ToastHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast, dismiss, toaster } = useWallToastController();
  return (
    <WallToastContext.Provider value={toaster}>
      {children}
      {toast && <WallToast toast={toast} toaster={toaster} onDismiss={dismiss} />}
    </WallToastContext.Provider>
  );
};

function renderWeek(layout: WallLayout, data: Partial<WallData> = {}, extra: { arranging?: boolean } = {}) {
  const value = makeWallData(vi.fn, { wallEvents: events, todos, mealPlan, shoppingList: shopping, ...data });
  const onLayout = vi.fn();
  const onOpenDay = vi.fn();
  const onArrangeDone = vi.fn();
  const people = makeWallPeople(value.members, false);
  const utils = render(
    <WallDataContext.Provider value={value}>
      <ToastHost>
        <WallWeek
          today={D}
          now={NOW}
          timeZone={TZ}
          people={people}
          weather={null}
          onWeather={vi.fn()}
          layout={layout}
          onLayout={onLayout}
          onOpenDay={onOpenDay}
          arranging={extra.arranging ?? false}
          onArrangeDone={onArrangeDone}
        />
      </ToastHost>
    </WallDataContext.Provider>
  );
  return { ...utils, value, onLayout, onOpenDay, onArrangeDone };
}

describe('WallWeek', () => {
  it('leads the day with what’s next, then the rest of today, Due today and dinner', () => {
    renderWeek({ modules: ['coming'] });
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('3:15')).toHaveClass('clock');
    expect(within(today).getByText('Saturday, Oct 3')).toBeInTheDocument();
    // Haircut ran 2–3 pm: over, so it joins Soccer game under "Earlier today", one row each.
    expect(within(today).getByText('Earlier today')).toBeInTheDocument();
    expect(within(today).getByText('Soccer game')).toBeInTheDocument();
    expect(within(today).getByText('Haircut')).toBeInTheDocument();
    expect(within(today).getByText('Dinner out')).toHaveClass('nxt');
    expect(within(today).getByText('Next · in 1 hr 45 min')).toBeInTheDocument();
    expect(within(today).getByText('Overdue')).toBeInTheDocument();
    expect(within(today).getByText('0 of 2 done')).toBeInTheDocument();
    expect(within(today).getByText('Tacos')).toBeInTheDocument();
  });

  it('lists the coming days with untimed items on a quiet line, and opens a day', () => {
    const { onOpenDay } = renderWeek({ modules: ['coming'] });
    const coming = screen.getByRole('region', { name: 'Coming up' });
    expect(within(coming).getByText('Tomorrow')).toBeInTheDocument();
    expect(within(coming).getByText('Farmers market')).toBeInTheDocument();
    expect(within(coming).getByText('Water bill')).toHaveClass('bill');
    fireEvent.click(within(coming).getByRole('button', { name: /Farmers market/ }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-04');
  });

  it('switches Coming up between Week and Month in its own heading, with no editing controls at rest', () => {
    const { onOpenDay } = renderWeek({ modules: ['coming'] }, { wallEvents: [...events, ev('Orchard trip', '2026-10-20', at('2026-10-20', '13:00'))] });
    expect(screen.queryByRole('group', { name: 'Calendar view' })).not.toBeInTheDocument();
    const coming = screen.getByRole('region', { name: 'Coming up' });
    const range = within(coming).getByRole('group', { name: 'Coming up range' });
    expect(within(range).getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    // Week: every one of the next seven days, a free one said so; nothing past it.
    expect(within(coming).getAllByRole('button', { name: /^(Tomorrow|Mon(?!th)|Tue|Wed|Thu|Fri|Sat|Sun)/ })).toHaveLength(7);
    expect(within(coming).getAllByText('Nothing planned').length).toBeGreaterThan(0);
    expect(within(coming).queryByText('Orchard trip')).not.toBeInTheDocument();

    fireEvent.click(within(range).getByRole('button', { name: 'Month' }));
    expect(within(range).getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(coming).queryByText('Nothing planned')).not.toBeInTheDocument();
    fireEvent.click(within(coming).getByRole('button', { name: /Orchard trip/ }));
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-20');
    expect(screen.queryByRole('button', { name: /Switch/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a bottom module/ })).not.toBeInTheDocument();
  });

  it('switches, adds and removes modules in Arrange mode, never the top one', () => {
    const { onLayout, onArrangeDone } = renderWeek({ modules: ['coming'] }, {}, { arranging: true });
    fireEvent.click(within(screen.getByRole('region', { name: 'Coming up' })).getByRole('button', { name: /Switch/ }));
    const menu = screen.getByRole('dialog', { name: 'Panel shows' });
    expect(within(menu).getByRole('button', { name: /Coming up.*Showing/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: /Shopping/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['shopping'] });
    expect(screen.queryByRole('button', { name: 'Remove Coming up' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add a bottom module/ }));
    const add = screen.getByRole('dialog', { name: 'Add a bottom module' });
    expect(within(add).getByRole('button', { name: /Coming up.*Already showing/ })).toBeDisabled();
    fireEvent.click(within(add).getByRole('button', { name: /Dinners/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['coming', 'meals'] });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onArrangeDone).toHaveBeenCalled();
  });

  it('switches, removes and re-adds the module under today in Arrange mode', () => {
    const { onLayout } = renderWeek({ modules: ['coming', 'meals'] }, {}, { arranging: true });
    const slot = screen.getByRole('region', { name: 'Under today: Due today' });
    fireEvent.click(within(slot).getByRole('button', { name: /Switch/ }));
    const menu = screen.getByRole('dialog', { name: 'Under today shows' });
    expect(within(menu).getByRole('button', { name: /Due today.*Showing/ })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /Dinners.*Already showing/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('button', { name: /Shopping/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['coming', 'meals'], day: 'shopping' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Due today from under today' }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['coming', 'meals'], day: null });
  });

  it('shows the picked module under today, or nothing there', () => {
    const { unmount } = renderWeek({ modules: ['coming'], day: 'shopping' });
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(within(today).getByRole('region', { name: 'Shopping' })).getByText('Milk')).toBeInTheDocument();
    expect(within(today).queryByText('Due today')).not.toBeInTheDocument();
    expect(within(today).getByText('Tacos')).toBeInTheDocument();
    unmount();
    renderWeek({ modules: ['coming'], day: null }, {}, { arranging: true });
    expect(screen.getByRole('button', { name: /Add a module under today/ })).toBeInTheDocument();
  });

  it('shows a due to-do’s steps under it and checks them off', () => {
    const withSteps = [
      ...todos,
      {
        id: 't3', text: 'Tuesday chores', completeByDate: D, isCompleted: false,
        subtasks: [{ id: 'a', text: 'Dishes', isDone: true }, { id: 'b', text: 'Vacuum', isDone: false }],
      },
    ] as ToDo[];
    const { value } = renderWeek({ modules: ['coming'] }, { todos: withSteps });
    const steps = screen.getByRole('list', { name: 'Steps for Tuesday chores' });
    expect(within(screen.getByRole('region', { name: 'Today' })).getByText('1/2')).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /Vacuum/ }));
    expect(value.actions.toggleTodoSubtask).toHaveBeenCalledWith('t3', 'b');
  });

  it('removes the bottom module in Arrange mode', () => {
    const { onLayout } = renderWeek({ modules: ['coming', 'meals'] }, {}, { arranging: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dinners' }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['coming'] });
  });

  it('keeps dinner tonight with Dinners in the panel, which starts tomorrow; To-dos takes over Due today', () => {
    const plan = [...mealPlan, { id: 'm2', date: '2026-10-04', type: 'dinner', mealName: 'Chili', isCooked: false }] as MealPlanItem[];
    renderWeek({ modules: ['todos', 'meals'] }, { mealPlan: plan });
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).queryByText('Due today')).not.toBeInTheDocument();
    expect(within(today).getByText('Tacos')).toBeInTheDocument();
    const dinners = screen.getByRole('region', { name: 'Dinners' });
    expect(within(dinners).getByText('Chili')).toBeInTheDocument();
    expect(within(dinners).queryByText('Tacos')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'To-dos' })).getByText('Feed the fish')).toBeInTheDocument();
  });

  it('shows Coming up when the saved panel is empty (the old Today-only mode)', () => {
    renderWeek({ modules: [] });
    expect(screen.getByRole('region', { name: 'Coming up' })).toBeInTheDocument();
  });

  it('completes a due to-do with an Undo toast', () => {
    const { value } = renderWeek({ modules: ['coming'] });
    fireEvent.click(screen.getByRole('button', { name: /Feed the fish/ }));
    expect(value.actions.completeToDo).toHaveBeenCalledWith('t2');
    expect(screen.getByRole('status')).toHaveTextContent('Completed Feed the fish');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(value.actions.uncompleteToDo).toHaveBeenCalledWith('t2');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('checks off a shopping item from its module, and shows a failed write', async () => {
    const { value } = renderWeek({ modules: ['shopping'] });
    vi.mocked(value.actions.toggleShoppingItemPurchased).mockRejectedValueOnce(new Error('offline'));
    const mod = screen.getByRole('region', { name: 'Shopping' });
    expect(within(mod).queryByText('Eggs')).not.toBeInTheDocument();
    fireEvent.click(within(mod).getByRole('button', { name: /Milk/ }));
    expect(value.actions.toggleShoppingItemPurchased).toHaveBeenCalledWith('s1');
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeInTheDocument();
  });
});

describe('WallDay', () => {
  const W = '2026-10-07';
  const weather = {
    fetchedAt: 0,
    current: { temp: 54, icon: 'sun' as const },
    high: 61,
    low: 43,
    blocks: [],
    rainNote: null,
    days: [{ date: W, high: 58, low: 40, icon: 'rain' as const, precipMax: 80 }],
  };

  function renderDay(date: string, data: Partial<WallData>) {
    const value = makeWallData(vi.fn, data);
    const props = { onDate: vi.fn(), onAddTodo: vi.fn(), onOpenMeal: vi.fn() };
    const view = (d: string) => (
      <WallDataContext.Provider value={value}>
        <ToastHost>
          <WallDay date={d} today={D} now={NOW} timeZone={TZ} people={makeWallPeople(value.members, false)} weather={weather} {...props} />
        </ToastHost>
      </WallDataContext.Provider>
    );
    const utils = render(view(date));
    return { ...utils, value, props, show: (d: string) => utils.rerender(view(d)) };
  }

  it('lays out the day with an all-day strip, side-by-side clashes and the now line', () => {
    const day = [
      ev('Practice', W, at(W, '15:30'), at(W, '17:00'), { ownerKey: 'l' }),
      ev('Orthodontist', W, at(W, '16:00'), at(W, '17:00')),
      ev('Phone bill', W, undefined, undefined, { source: 'bill', ownerKey: 'family' }),
    ];
    const { container, props, show } = renderDay(W, { wallEvents: day });
    expect(screen.getByText('Wednesday, October 7')).toBeInTheDocument();
    expect(screen.getByText('Phone bill')).toBeInTheDocument();
    expect(screen.getByText('3:30–5:00')).toBeInTheDocument();
    expect(container.querySelectorAll('.blk')).toHaveLength(2);
    expect(container.querySelector('.nowl')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onDate).toHaveBeenCalledWith('2026-10-08');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(props.onDate).toHaveBeenCalledWith(D);

    show(D);
    expect(screen.getByText('Today', { selector: 'b' })).toBeInTheDocument();
    // Already on today: no jump-back button.
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    expect(screen.getByText('No events')).toBeInTheDocument();
    expect(container.querySelector('.nowl')).not.toBeNull();
    // Nothing all-day, so no strip.
    expect(screen.queryByText('ALL DAY')).toBeNull();
  });

  it('folds a fourth clash into "+N more", and a tap lists everything at that time in full', () => {
    const clash = ['Swim', 'Piano', 'Tutor', 'Dentist'].map((t, i) => ev(t, W, at(W, '16:00'), at(W, `17:${i}0`)));
    const { container } = renderDay(W, { wallEvents: clash });
    expect(container.querySelectorAll('.blk:not(.more)')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    const sheet = screen.getByRole('dialog', { name: 'Events at the same time' });
    expect(within(sheet).getByText('4:00–5:30 · 4 events')).toBeInTheDocument();
    expect(within(sheet).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Dentist'),
      expect.stringContaining('Tutor'),
      expect.stringContaining('Piano'),
      expect.stringContaining('Swim'),
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dentist, Paul/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the day panel: a later day’s forecast, its to-dos and its dinner', () => {
    const dayTodos = [
      { id: 'a', text: 'Pack lunches', completeByDate: W, isCompleted: false, assignedTo: 'l' },
      { id: 'b', text: 'Not this day', completeByDate: D, isCompleted: false },
    ] as ToDo[];
    const plan = [{ id: 'm', date: W, type: 'dinner', mealName: 'Chili', isCooked: false }] as MealPlanItem[];
    const { value, props } = renderDay(W, { todos: dayTodos, mealPlan: plan });
    const panel = screen.getByRole('complementary', { name: 'This day' });
    expect(within(panel).getByText('58°')).toBeInTheDocument();
    expect(within(panel).getByText('L 40° · 80% rain')).toBeInTheDocument();
    expect(within(panel).queryByText('Not this day')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /Pack lunches/ }));
    expect(value.actions.completeToDo).toHaveBeenCalledWith('a');
    fireEvent.click(within(panel).getByRole('button', { name: 'Add' }));
    expect(props.onAddTodo).toHaveBeenCalledWith(W);
    fireEvent.click(within(panel).getByRole('button', { name: /Chili/ }));
    expect(props.onOpenMeal).toHaveBeenCalledWith(W);
  });

  it('today’s panel lists overdue and due-today to-dos, skips the forecast, and a past day has no Add', () => {
    const { show } = renderDay(D, { todos, mealPlan });
    const panel = screen.getByRole('complementary', { name: 'This day' });
    expect(within(panel).getByText('Due today')).toBeInTheDocument();
    expect(within(panel).getByText('Return library books')).toBeInTheDocument();
    expect(within(panel).getByText('Overdue')).toBeInTheDocument();
    expect(within(panel).getByText('Tacos')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Forecast')).toBeNull();
    show('2026-10-01');
    expect(within(screen.getByRole('complementary')).queryByRole('button', { name: 'Add' })).toBeNull();
    expect(within(screen.getByRole('complementary')).getByText('Nothing planned')).toBeInTheDocument();
  });
});

describe('WallMonth', () => {
  it('caps a day at three lines and opens Day view on tap', () => {
    const busy = ['a', 'b', 'c', 'd'].map((id, i) => ev(id, '2026-10-07', at('2026-10-07', `1${i}:00`)));
    const value = makeWallData(vi.fn, { wallEvents: busy });
    const onOpenDay = vi.fn();
    render(
      <WallDataContext.Provider value={value}>
        <WallMonth today={D} timeZone={TZ} people={makeWallPeople(value.members, false)} onOpenDay={onOpenDay} />
      </WallDataContext.Provider>
    );
    const cell = screen.getByRole('button', { name: 'Wednesday, October 7' });
    expect(within(cell).getByText('+1 more')).toBeInTheDocument();
    fireEvent.click(cell);
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-07');
  });
});
