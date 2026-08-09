import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HabitsModelPrimer, HabitsModelPrimerLink } from './HabitsModelPrimer';
import { getMultiplier } from '@/utils/habitLogic';
import { FREEZE_MAX_TOKENS } from '@/utils/freezeBank';

vi.mock('lucide-react', () => ({
  Target: () => <div data-testid="target" />,
  Flame: () => <div data-testid="flame" />,
  CalendarRange: () => <div data-testid="calendar-range" />,
  Snowflake: () => <div data-testid="snowflake" />,
  Trophy: () => <div data-testid="trophy" />,
  BookOpen: () => <div data-testid="book-open" />,
  X: () => <div data-testid="x" />,
}));

describe('HabitsModelPrimer', () => {
  it('renders the title and every mechanics section when open', () => {
    render(<HabitsModelPrimer isOpen onClose={vi.fn()} />);

    expect(screen.getByText('How points & streaks work')).toBeInTheDocument();
    expect(screen.getByText('Two ways a habit scores')).toBeInTheDocument();
    expect(screen.getByText('Streaks multiply your points')).toBeInTheDocument();
    expect(screen.getByText('Weekly habits streak in weeks')).toBeInTheDocument();
    expect(screen.getByText('The freeze bank has your back')).toBeInTheDocument();
    expect(screen.getByText('Points add up to rewards')).toBeInTheDocument();
  });

  it('keeps the multiplier copy in sync with getMultiplier (daily)', () => {
    render(<HabitsModelPrimer isOpen onClose={vi.fn()} />);
    const section = screen.getByText(/Keep a daily habit going/);

    // The copy names days 3 and 7 as the daily thresholds; assert those ARE
    // getMultiplier's real boundaries so the numbers can't silently drift.
    expect(getMultiplier(2, true, 'daily')).toBe(1.0);
    expect(getMultiplier(3, true, 'daily')).toBe(2.0);
    expect(getMultiplier(6, true, 'daily')).toBe(2.0);
    expect(getMultiplier(7, true, 'daily')).toBe(3.0);

    // And the rendered figures are derived from getMultiplier itself.
    expect(section.textContent).toContain(`${getMultiplier(3, true, 'daily')}× points from day 3`);
    expect(section.textContent).toContain(`${getMultiplier(7, true, 'daily')}× from day 7`);
  });

  it('keeps the multiplier copy in sync with getMultiplier (weekly)', () => {
    render(<HabitsModelPrimer isOpen onClose={vi.fn()} />);
    const section = screen.getByText(/consecutive weeks/);

    // The copy names weeks 2 and 4 as the weekly thresholds.
    expect(getMultiplier(1, true, 'weekly')).toBe(1.0);
    expect(getMultiplier(2, true, 'weekly')).toBe(2.0);
    expect(getMultiplier(3, true, 'weekly')).toBe(2.0);
    expect(getMultiplier(4, true, 'weekly')).toBe(3.0);

    expect(section.textContent).toContain(`${getMultiplier(2, true, 'weekly')}× from 2 weeks in a row`);
    expect(section.textContent).toContain(`${getMultiplier(4, true, 'weekly')}× from 4`);
  });

  it('states that multipliers never apply to negative habits, matching getMultiplier', () => {
    render(<HabitsModelPrimer isOpen onClose={vi.fn()} />);

    // Any streak, negative habit -> always 1.0 in code…
    expect(getMultiplier(30, false, 'daily')).toBe(1.0);
    expect(getMultiplier(30, false, 'weekly')).toBe(1.0);
    // …and the copy says so.
    expect(
      screen.getByText(/Multipliers only boost positive habits; a slip-up never costs extra\./)
    ).toBeInTheDocument();
  });

  it('keeps the freeze-bank stock in sync with FREEZE_MAX_TOKENS', () => {
    render(<HabitsModelPrimer isOpen onClose={vi.fn()} />);
    expect(
      screen.getByText(new RegExp(`You hold up to ${FREEZE_MAX_TOKENS} tokens`))
    ).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<HabitsModelPrimer isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('How points & streaks work')).not.toBeInTheDocument();
  });
});

describe('HabitsModelPrimerLink', () => {
  it('opens the primer drawer from the quiet text link', () => {
    render(<HabitsModelPrimerLink />);

    // Closed by default.
    expect(screen.queryByText('Streaks multiply your points')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /How points & streaks work/i }));

    expect(screen.getByText('Streaks multiply your points')).toBeInTheDocument();
    expect(screen.getByText('The freeze bank has your back')).toBeInTheDocument();
  });
});
