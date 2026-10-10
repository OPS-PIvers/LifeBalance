import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ToDo } from '@/types/schema';
import { makeWallPeople } from '@/utils/wall/wallPeople';
import { WallDataContext, type WallData } from '@/components/wall/data/wallData';
import { makeWallData } from '@/components/wall/data/wallTestData';
import { WallToastContext, useWallToastController } from '@/components/wall/wallToast';
import WallBoard from './WallBoard';

const D = '2026-10-10';
const TZ = 'America/Chicago';
const NOW = new Date('2026-10-10T11:20:00-05:00');

const members = [
  { uid: 'p', displayName: 'Paul', role: 'admin' },
  { uid: 'l', displayName: 'Leo', role: 'member', isManaged: true },
] as WallData['members'];
const people = makeWallPeople(members, false);

const base = { completeByDate: D, createdAt: 'x', createdBy: 'p' };

const ToastHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toaster } = useWallToastController();
  return <WallToastContext.Provider value={toaster}>{children}</WallToastContext.Provider>;
};

function setup(todos: ToDo[]) {
  const value = makeWallData(vi.fn, { todos, members });
  render(
    <WallDataContext.Provider value={value}>
      <ToastHost>
        <WallBoard
          today={D}
          now={NOW}
          timeZone={TZ}
          people={people}
          weather={null}
          onWeather={() => {}}
          onOpenDay={() => {}}
          onOpenMeal={() => {}}
          layout={{ modules: ['coming'], day: null }}
          onLayout={() => {}}
        />
      </ToastHost>
    </WallDataContext.Provider>
  );
  return value;
}


describe('WallBoard lane to-dos', () => {
  const todos = [
    {
      ...base,
      id: 'ins',
      text: 'Renew car insurance',
      isCompleted: false,
      assignedTo: 'p',
      subtasks: [
        { id: 'a', text: 'Get two quotes', isDone: true },
        { id: 'b', text: 'Compare coverage', isDone: false },
        { id: 'c', text: 'Sign the new policy', isDone: false },
      ],
    },
    { ...base, id: 'run', text: 'Go for a run', isCompleted: true, completedAt: NOW.toISOString(), assignedTo: 'p' },
  ] as ToDo[];

  it('lists a to-do’s open steps under it, and leaves out finished steps and checked-off to-dos', () => {
    setup(todos);
    const list = screen.getByRole('region', { name: 'To-dos' });
    expect(within(list).getByRole('button', { name: /Renew car insurance/ })).toHaveTextContent('1 of 3 steps done');
    expect(within(list).getByRole('button', { name: 'Compare coverage' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Sign the new policy' })).toBeInTheDocument();
    expect(within(list).queryByText('Get two quotes')).toBeNull();
    expect(within(list).queryByText('Go for a run')).toBeNull();
    // The header still counts the checked-off one.
    expect(within(list).getByText('To do').parentElement).toHaveTextContent('1 of 2');
  });

  it('checks off a step from the lane', () => {
    const value = setup(todos);
    fireEvent.click(screen.getByRole('button', { name: 'Compare coverage' }));
    expect(value.actions.toggleTodoSubtask).toHaveBeenCalledWith('ins', 'b');
  });

  it('says "All done" once every to-do in the lane is checked off', () => {
    setup([{ ...base, id: 'run', text: 'Go for a run', isCompleted: true, completedAt: NOW.toISOString(), assignedTo: 'p' }] as ToDo[]);
    expect(within(screen.getByRole('region', { name: 'To-dos' })).getByText('All done')).toBeInTheDocument();
  });
});
