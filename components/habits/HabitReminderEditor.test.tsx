import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HabitReminderEditor from './HabitReminderEditor';
import type { HabitReminderConfig } from '@/types/schema';

const config = (overrides: Partial<HabitReminderConfig> = {}): HabitReminderConfig => ({
  enabled: true,
  time: '08:00',
  days: [1, 2, 3, 4, 5],
  ...overrides,
});

describe('HabitReminderEditor', () => {
  it('shows only the switch until a reminder is enabled', () => {
    render(<HabitReminderEditor value={null} onChange={vi.fn()} period="daily" />);
    expect(screen.getByRole('checkbox', { name: 'Remind me' })).not.toBeChecked();
    expect(screen.queryByLabelText('Time')).not.toBeInTheDocument();
  });

  it('seeds every day for a daily habit when switched on', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={null} onChange={onChange} period="daily" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('seeds a single day for a weekly habit when switched on', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={null} onChange={onChange} period="weekly" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, time: '08:00', days: [1] });
  });

  it('emits null when switched off, clearing the schedule rather than keeping a dead one', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={config()} onChange={onChange} period="daily" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('edits the time', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={config()} onChange={onChange} period="daily" />);
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '18:45' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ time: '18:45' }));
  });

  it('adds a day, keeping the list in week order', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={config({ days: [1, 5] })} onChange={onChange} period="daily" />);
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [1, 3, 5] }));
  });

  it('removes an already-selected day', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={config({ days: [1, 3] })} onChange={onChange} period="daily" />);
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ days: [1] }));
  });

  it('names each day accessibly, since the visible letters are ambiguous', () => {
    render(<HabitReminderEditor value={config()} onChange={vi.fn()} period="daily" />);
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByRole('button', { name: day })).toBeInTheDocument();
    }
  });

  it('applies the day presets', () => {
    const onChange = vi.fn();
    render(<HabitReminderEditor value={config({ days: [1] })} onChange={onChange} period="daily" />);

    fireEvent.click(screen.getByRole('button', { name: 'Every day' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ days: [0, 1, 2, 3, 4, 5, 6] }));

    fireEvent.click(screen.getByRole('button', { name: 'Weekdays' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ days: [1, 2, 3, 4, 5] }));
  });

  it('summarizes the schedule', () => {
    render(<HabitReminderEditor value={config({ time: '18:00' })} onChange={vi.fn()} period="daily" />);
    expect(screen.getByText('6:00 PM · Weekdays')).toBeInTheDocument();
  });

  it('warns instead of summarizing when no day is selected', () => {
    render(<HabitReminderEditor value={config({ days: [] })} onChange={vi.fn()} period="daily" />);
    expect(
      screen.getByText('Pick at least one day, or this reminder never fires.'),
    ).toBeInTheDocument();
  });

  it('disables every control while the form is saving', () => {
    render(<HabitReminderEditor value={config()} onChange={vi.fn()} period="daily" disabled />);
    expect(screen.getByRole('checkbox', { name: 'Remind me' })).toBeDisabled();
    expect(screen.getByLabelText('Time')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mon' })).toBeDisabled();
  });
});
