import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ContextualSuggestions } from './ContextualSuggestions';

describe('ContextualSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows morning suggestions between 5am and 11am', () => {
    // Set time to 8:00 AM
    const date = new Date(2023, 1, 1, 8, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Daily Tasks')).toBeInTheDocument();
    expect(screen.getByText('Breakfast')).toBeInTheDocument();
  });

  it('shows lunch suggestions between 11am and 2pm', () => {
    // Set time to 12:00 PM
    const date = new Date(2023, 1, 1, 12, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    expect(screen.getByText('Log Lunch')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('shows afternoon suggestions between 2pm and 6pm', () => {
    // Set time to 3:00 PM
    const date = new Date(2023, 1, 1, 15, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    expect(screen.getByText('Shopping')).toBeInTheDocument();
    expect(screen.getByText('Coffee Break')).toBeInTheDocument();
    expect(screen.getByText('Commute')).toBeInTheDocument();
  });

  it('shows evening suggestions between 6pm and 10pm', () => {
    // Set time to 7:00 PM
    const date = new Date(2023, 1, 1, 19, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    expect(screen.getByText('Log Dinner')).toBeInTheDocument();
    expect(screen.getByText('Wind Down')).toBeInTheDocument();
  });

  it('shows night suggestions between 10pm and 5am', () => {
    // Set time to 11:00 PM
    const date = new Date(2023, 1, 1, 23, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    expect(screen.getByText('Sleep')).toBeInTheDocument();
    expect(screen.getByText('Late Snack')).toBeInTheDocument();
  });

  it('calls onSelect with the correct prompt when clicked', () => {
    const date = new Date(2023, 1, 1, 8, 0, 0);
    vi.setSystemTime(date);

    const onSelect = vi.fn();
    render(<ContextualSuggestions onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Coffee'));
    expect(onSelect).toHaveBeenCalledWith('Coffee $5');
  });
});
