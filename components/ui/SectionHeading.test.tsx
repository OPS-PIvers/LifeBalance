import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SectionHeading, { sectionHeadingClasses } from './SectionHeading';

describe('SectionHeading', () => {
  it('renders the editorial serif heading classes (not the uppercase eyebrow)', () => {
    render(<SectionHeading>Members</SectionHeading>);
    const heading = screen.getByText('Members');
    expect(heading).toHaveClass('font-display', 'text-sm', 'font-semibold', 'tracking-tight');
    // The whole point of the second voice: it is NOT the uppercase micro-caps.
    expect(heading).not.toHaveClass('uppercase');
  });

  it('defaults to an h3 (sub-heading under a Section h2)', () => {
    render(<SectionHeading>Setup Guide</SectionHeading>);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Setup Guide' })
    ).toBeInTheDocument();
  });

  it('renders the level given by `as`', () => {
    render(<SectionHeading as="h2">Household</SectionHeading>);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Household' })
    ).toBeInTheDocument();
  });

  it('renders an optional description beneath the heading', () => {
    render(<SectionHeading description="Two per household">Members</SectionHeading>);
    expect(screen.getByText('Two per household')).toBeInTheDocument();
  });

  it('renders an optional action slot', () => {
    render(
      <SectionHeading action={<button>Add</button>}>Members</SectionHeading>
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('wires an id onto the heading for aria-labelledby', () => {
    render(<SectionHeading id="members-heading">Members</SectionHeading>);
    expect(screen.getByText('Members')).toHaveAttribute('id', 'members-heading');
  });

  it('exports the shared class string so Section and SectionHeading never drift', () => {
    expect(sectionHeadingClasses).toContain('font-display');
    expect(sectionHeadingClasses).not.toContain('uppercase');
  });
});
