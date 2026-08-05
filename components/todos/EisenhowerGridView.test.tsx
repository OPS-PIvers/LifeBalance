import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDays, format } from 'date-fns';
import { ToDo } from '@/types/schema';
import { type Quadrant } from '@/utils/eisenhower';
import { EisenhowerGridView, type EisenhowerGridViewProps } from './EisenhowerGridView';

const makeTodo = (overrides: Partial<ToDo> & Pick<ToDo, 'id' | 'text'>): ToDo => ({
  completeByDate: format(addDays(new Date(), 3), 'yyyy-MM-dd'),
  isCompleted: false,
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
  ...overrides,
});

// An ACTIVE later-quadrant task, due today — the positive control proving the
// "no due date" assertions below are non-vacuous (an active chip with the
// exact same day DOES render a date label).
const activeLaterToday = makeTodo({
  id: 'active-later-today',
  text: 'Water the plants',
  completeByDate: format(new Date(), 'yyyy-MM-dd'),
});

// A parked to-do. Deliberately dated in the PAST — an active row with this
// date would render a red "Overdue" label — so the no-due-date test would
// notice a regression rather than passing on a neutral fixture.
const parkedOverdueDated = makeTodo({
  id: 'parked-1',
  text: 'Look into a bike rack',
  completeByDate: format(addDays(new Date(), -5), 'yyyy-MM-dd'),
  savedForLater: true,
});

const emptyQuadrants: Record<Quadrant, ToDo[]> = { do: [], schedule: [], delegate: [], later: [] };

const handlers = {
  onComplete: vi.fn(),
  onEdit: vi.fn(),
  onToggleImportant: vi.fn(),
  onPromote: vi.fn(),
  onExit: vi.fn(),
};

const baseProps: EisenhowerGridViewProps = {
  quadrants: emptyQuadrants,
  parkedTodos: [],
  escapeDisabled: false,
  ...handlers,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EisenhowerGridView — parked chips in the later quadrant', () => {
  it('positive control: an ACTIVE later chip due today DOES render a due-date label', () => {
    render(
      <EisenhowerGridView
        {...baseProps}
        quadrants={{ ...emptyQuadrants, later: [activeLaterToday] }}
      />,
    );
    const laterCell = screen.getByTestId('grid-cell-later');
    expect(within(laterCell).getByText('Today')).toBeInTheDocument();
  });

  it('renders NO due date for a parked chip — the stored date is an inert placeholder', () => {
    render(<EisenhowerGridView {...baseProps} parkedTodos={[parkedOverdueDated]} />);
    const laterCell = screen.getByTestId('grid-cell-later');
    // The fixture's date is 5 days in the past — an active chip would show
    // "Overdue (...)"; a parked one must show neither that nor any date text.
    expect(within(laterCell).queryByText(/Overdue/)).toBeNull();
    expect(within(laterCell).queryByText('Today')).toBeNull();
    expect(within(laterCell).queryByText('Tomorrow')).toBeNull();
  });

  it('renders a "+" control that opens the promote sheet, not a complete checkbox', () => {
    render(<EisenhowerGridView {...baseProps} parkedTodos={[parkedOverdueDated]} />);
    expect(screen.queryByRole('checkbox', { name: `Complete task: ${parkedOverdueDated.text}` })).toBeNull();
    const promote = screen.getByRole('button', { name: `Add to your list: ${parkedOverdueDated.text}` });
    fireEvent.click(promote);
    expect(handlers.onPromote).toHaveBeenCalledWith(parkedOverdueDated);
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it('places a parked item in the later cell regardless of its stored date — quadrant assignment is unconditional', () => {
    // A completeByDate of today + isImportant would compute to the "do"
    // quadrant via quadrantForTodo; a parked item must never take that path.
    const urgentLookingParked = makeTodo({
      id: 'parked-urgent-looking',
      text: 'Sort the garage',
      completeByDate: format(new Date(), 'yyyy-MM-dd'),
      isImportant: true,
      savedForLater: true,
    });
    render(<EisenhowerGridView {...baseProps} parkedTodos={[urgentLookingParked]} />);
    expect(within(screen.getByTestId('grid-cell-later')).getByText(urgentLookingParked.text)).toBeInTheDocument();
    ['grid-cell-do', 'grid-cell-schedule', 'grid-cell-delegate'].forEach(testId => {
      expect(within(screen.getByTestId(testId)).queryByText(urgentLookingParked.text)).toBeNull();
    });
  });

  it('splits the later-quadrant header count once parked items are present', () => {
    const activeLater = [
      makeTodo({ id: 'l1', text: 'Later one' }),
      makeTodo({ id: 'l2', text: 'Later two' }),
    ];
    const parked = [
      { ...parkedOverdueDated, id: 'p1', text: 'Parked one' },
      { ...parkedOverdueDated, id: 'p2', text: 'Parked two' },
    ];
    render(
      <EisenhowerGridView
        {...baseProps}
        quadrants={{ ...emptyQuadrants, later: activeLater }}
        parkedTodos={parked}
      />,
    );
    const laterCell = screen.getByTestId('grid-cell-later');
    expect(within(laterCell).getByText('2 + 2')).toBeInTheDocument();
  });

  it('does not split the count for a quadrant with no parked items', () => {
    render(
      <EisenhowerGridView
        {...baseProps}
        quadrants={{ ...emptyQuadrants, do: [makeTodo({ id: 'd1', text: 'Do one' })] }}
      />,
    );
    const doCell = screen.getByTestId('grid-cell-do');
    expect(within(doCell).getByText('1')).toBeInTheDocument();
    expect(within(doCell).queryByText(/\+/)).toBeNull();
  });

  it('does not render the "Saved for later" subheader or any parked chip when there are none', () => {
    render(<EisenhowerGridView {...baseProps} quadrants={{ ...emptyQuadrants, later: [activeLaterToday] }} />);
    const laterCell = screen.getByTestId('grid-cell-later');
    expect(within(laterCell).queryByText('Saved for later')).toBeNull();
  });

  it('renders the "Saved for later" subheader below the real later tasks', () => {
    const activeLater = [makeTodo({ id: 'l1', text: 'Later one' })];
    render(
      <EisenhowerGridView
        {...baseProps}
        quadrants={{ ...emptyQuadrants, later: activeLater }}
        parkedTodos={[parkedOverdueDated]}
      />,
    );
    const laterCell = screen.getByTestId('grid-cell-later');
    const texts = within(laterCell).getAllByText(/Later one|Saved for later|Look into a bike rack/).map(el => el.textContent);
    expect(texts).toEqual(['Later one', 'Saved for later', 'Look into a bike rack']);
  });

  it('still lets the star toggle fire for a parked chip without moving it out of later', () => {
    render(<EisenhowerGridView {...baseProps} parkedTodos={[parkedOverdueDated]} />);
    const starButton = screen.getByRole('button', { name: `Mark important: ${parkedOverdueDated.text}` });
    fireEvent.click(starButton);
    expect(handlers.onToggleImportant).toHaveBeenCalledWith(parkedOverdueDated);
  });

  it('tapping a parked chip body still opens the edit drawer', () => {
    render(<EisenhowerGridView {...baseProps} parkedTodos={[parkedOverdueDated]} />);
    fireEvent.click(screen.getByRole('button', { name: `Edit task: ${parkedOverdueDated.text}` }));
    expect(handlers.onEdit).toHaveBeenCalledWith(parkedOverdueDated);
  });
});
