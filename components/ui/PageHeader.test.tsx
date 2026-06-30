import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PageHeader from './PageHeader';

describe('PageHeader', () => {
  it('renders the title as a level-1 heading', () => {
    render(<PageHeader title="Habits" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Habits' })
    ).toBeInTheDocument();
  });

  it('renders an optional subtitle', () => {
    render(<PageHeader title="Habits" subtitle="Build your streak." />);
    expect(screen.getByText('Build your streak.')).toBeInTheDocument();
  });

  it('omits the subtitle paragraph when none is provided', () => {
    const { container } = render(<PageHeader title="Habits" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the actions slot', () => {
    render(<PageHeader title="Habits" actions={<button>Menu</button>} />);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('wires titleId onto the heading for aria-labelledby', () => {
    render(<PageHeader title="Habits" titleId="page-title" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute(
      'id',
      'page-title'
    );
  });

  it('defaults to items-start alignment', () => {
    const { container } = render(<PageHeader title="Hi" />);
    expect(container.querySelector('header')).toHaveClass('items-start');
  });

  it('applies items-end alignment when align="end"', () => {
    const { container } = render(<PageHeader title="Hi" align="end" />);
    expect(container.querySelector('header')).toHaveClass('items-end');
  });

  it('merges a custom className onto the wrapper', () => {
    const { container } = render(<PageHeader title="Hi" className="px-4" />);
    expect(container.querySelector('header')).toHaveClass('px-4');
  });
});
