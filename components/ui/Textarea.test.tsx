import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Textarea from './Textarea';

describe('Textarea', () => {
  it('renders a labelled <textarea> wired by id', () => {
    render(<Textarea label="Notes" />);
    const ta = screen.getByLabelText('Notes');
    expect(ta.tagName).toBe('TEXTAREA');
  });

  it('shares the field recipe (accent focus ring at /40)', () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByLabelText('Notes')).toHaveClass(
      'focus:ring-accent-500/40'
    );
  });

  it('renders an error message and marks the field invalid', () => {
    render(<Textarea label="Notes" error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('shows a live character count for an uncontrolled field', () => {
    render(<Textarea label="Bio" showCount maxLength={100} />);
    expect(screen.getByText('0/100')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bio'), {
      target: { value: 'hello' },
    });
    expect(screen.getByText('5/100')).toBeInTheDocument();
  });

  it('merges a custom className', () => {
    render(<Textarea label="Notes" className="h-40" />);
    expect(screen.getByLabelText('Notes')).toHaveClass('h-40');
  });
});
