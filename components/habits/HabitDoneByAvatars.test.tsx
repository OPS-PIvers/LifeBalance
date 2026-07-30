import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HabitDoneByAvatars, { type DoneByEntry } from './HabitDoneByAvatars';

const entry = (overrides: Partial<DoneByEntry> = {}): DoneByEntry => ({
  memberId: 'paul-uid',
  displayName: 'Paul',
  color: '#285742',
  units: 1,
  streak: 0,
  ...overrides,
});

const rings = (container: HTMLElement): SVGSVGElement[] =>
  Array.from(container.querySelectorAll<SVGSVGElement>('svg[viewBox="0 0 48 48"]'));

describe('HabitDoneByAvatars', () => {
  it('renders nothing when nobody is credited (untouched rows stay clean)', () => {
    const { container } = render(<HabitDoneByAvatars entries={[]} streakUnit="day" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one avatar per credited member, in the given order', () => {
    render(
      <HabitDoneByAvatars
        entries={[entry(), entry({ memberId: 'jen-uid', displayName: 'Jen', color: '#b87a29' })]}
        streakUnit="day"
      />
    );
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.getByText('Jen completed this')).toBeInTheDocument();
  });

  it('counts multiple completions in the screen-reader text', () => {
    render(<HabitDoneByAvatars entries={[entry({ units: 3 })]} streakUnit="day" />);
    expect(screen.getByText('Paul completed this 3 times')).toBeInTheDocument();
  });

  it('shows NO ring below the ember threshold', () => {
    const { container } = render(<HabitDoneByAvatars entries={[entry({ streak: 2 })]} streakUnit="day" />);
    expect(rings(container)).toHaveLength(0);
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
  });

  it('lights the ember ring at 3 and announces the streak as text', () => {
    const { container } = render(<HabitDoneByAvatars entries={[entry({ streak: 3 })]} streakUnit="day" />);
    expect(rings(container)).toHaveLength(1);
    expect(container.querySelector('circle')?.getAttribute('stroke-width')).toBe('2');
    // The ring is decoration; this is the text that carries the same meaning.
    expect(screen.getByText('Paul completed this, 3 days streak')).toBeInTheDocument();
  });

  it('steps up to flame at 7 and blaze at 30', () => {
    const flame = render(<HabitDoneByAvatars entries={[entry({ streak: 7 })]} streakUnit="day" />);
    expect(flame.container.querySelector('circle')?.getAttribute('stroke-width')).toBe('2.5');
    expect(rings(flame.container)[0]?.getAttribute('style')).not.toContain('drop-shadow');

    const blaze = render(<HabitDoneByAvatars entries={[entry({ streak: 30 })]} streakUnit="day" />);
    expect(blaze.container.querySelector('circle')?.getAttribute('stroke-width')).toBe('3');
    // Only the top tier glows.
    expect(rings(blaze.container)[0]?.getAttribute('style')).toContain('drop-shadow');
  });

  it('uses the habit’s own cadence word for a weekly habit', () => {
    render(<HabitDoneByAvatars entries={[entry({ streak: 4 })]} streakUnit="week" />);
    expect(screen.getByText('Paul completed this, 4 weeks streak')).toBeInTheDocument();
  });

  it('gives every avatar its own gradient ids so two rings never share a fill', () => {
    const { container } = render(
      <HabitDoneByAvatars
        entries={[
          entry({ streak: 30 }),
          entry({ memberId: 'jen-uid', displayName: 'Jen', color: '#b87a29', streak: 3 }),
        ]}
        streakUnit="day"
      />
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map(g => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
