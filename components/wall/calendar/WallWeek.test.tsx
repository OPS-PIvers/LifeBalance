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

function renderWeek(layout: WallLayout, data: Partial<WallData> = {}) {
  const value = makeWallData(vi.fn, { wallEvents: events, todos, mealPlan, shoppingList: shopping, ...data });
  const onLayout = vi.fn();
  const people = makeWallPeople(value.members, false);
  const utils = render(
    <WallDataContext.Provider value={value}>
      <ToastHost>
        <WallWeek today={D} now={NOW} timeZone={TZ} people={people} layout={layout} onLayout={onLayout} onSeeMonth={vi.fn()} />
      </ToastHost>
    </WallDataContext.Provider>
  );
  return { ...utils, value, onLayout };
}

describe('WallWeek', () => {
  it('shows Today with past events faded, the now line, due today and dinner', () => {
    renderWeek({ modules: ['coming'] });
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Haircut')).toHaveClass('past');
    expect(within(today).getByText('Dinner out')).not.toHaveClass('past');
    expect(within(today).getByText('3:15')).toHaveClass('nowmark');
    expect(within(today).getByText('Overdue')).toBeInTheDocument();
    expect(within(today).getByText('Tacos')).toBeInTheDocument();
    expect(within(today).getAllByText('Leo').length).toBeGreaterThan(0);
  });

  it('lists the coming days with bills as muted lines', () => {
    renderWeek({ modules: ['coming'] });
    const coming = screen.getByRole('region', { name: 'Coming up' });
    expect(within(coming).getByText('Tomorrow')).toBeInTheDocument();
    expect(within(coming).getByText('Farmers market')).toBeInTheDocument();
    expect(within(coming).getByText('Water bill').closest('li')).toHaveClass('muted');
    expect(within(coming).getByRole('button', { name: 'See the month →' })).toBeInTheDocument();
  });

  it('switches, adds and removes modules through the menu', () => {
    const { onLayout } = renderWeek({ modules: ['coming'] });
    fireEvent.click(screen.getByRole('button', { name: /Switch/ }));
    const menu = screen.getByRole('dialog', { name: 'Panel shows' });
    expect(within(menu).getByRole('button', { name: /Coming up.*Showing/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: /Shopping/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['shopping'] });

    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    const add = screen.getByRole('dialog', { name: 'Add a module' });
    expect(within(add).getByRole('button', { name: /Coming up.*Already showing/ })).toBeDisabled();
    fireEvent.click(within(add).getByRole('button', { name: /To-dos/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: ['coming', 'todos'] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Coming up' }));
    expect(onLayout).toHaveBeenLastCalledWith({ modules: [] });
  });

  it('drops Today’s checklist and dinner when the panel shows To-dos and Meals', () => {
    renderWeek({ modules: ['todos', 'meals'] });
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).queryByText('Due today')).not.toBeInTheDocument();
    expect(within(today).queryByText('Tacos')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Meals this week' })).getByText('Tacos')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'To-dos' })).getByText('Feed the fish')).toBeInTheDocument();
  });

  it('goes Today-only with no modules and offers Add module', () => {
    const { container } = renderWeek({ modules: [] });
    expect(container.querySelector('.wk')).toHaveClass('solo');
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }));
    expect(screen.getByRole('dialog', { name: 'Add a module' })).toBeInTheDocument();
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
  it('lays out the day with an all-day strip, side-by-side clashes and the now line', () => {
    const day = [
      ev('Practice', '2026-10-07', at('2026-10-07', '15:30'), at('2026-10-07', '17:00'), { ownerKey: 'l' }),
      ev('Orthodontist', '2026-10-07', at('2026-10-07', '16:00'), at('2026-10-07', '17:00')),
      ev('Phone bill', '2026-10-07', undefined, undefined, { source: 'bill', ownerKey: 'family' }),
    ];
    const value = makeWallData(vi.fn, { wallEvents: day });
    const onDate = vi.fn();
    const { container, rerender } = render(
      <WallDataContext.Provider value={value}>
        <WallDay date="2026-10-07" today={D} now={NOW} timeZone={TZ} people={makeWallPeople(value.members, false)} onDate={onDate} />
      </WallDataContext.Provider>
    );
    expect(screen.getByText('Wednesday, October 7')).toBeInTheDocument();
    expect(screen.getByText('Phone bill')).toBeInTheDocument();
    expect(screen.getByText('3:30–5:00')).toBeInTheDocument();
    expect(container.querySelectorAll('.blk')).toHaveLength(2);
    expect(container.querySelector('.nowl')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(onDate).toHaveBeenCalledWith('2026-10-08');

    rerender(
      <WallDataContext.Provider value={value}>
        <WallDay date={D} today={D} now={NOW} timeZone={TZ} people={makeWallPeople(value.members, false)} onDate={onDate} />
      </WallDataContext.Provider>
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('No events')).toBeInTheDocument();
    expect(container.querySelector('.nowl')).not.toBeNull();
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
