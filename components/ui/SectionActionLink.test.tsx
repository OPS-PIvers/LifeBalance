import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import SectionActionLink from './SectionActionLink';

const renderInRouter = (ui: React.ReactNode) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('SectionActionLink', () => {
  it('renders the label as a link to the given route', () => {
    renderInRouter(<SectionActionLink to="/habits">View all</SectionActionLink>);
    const link = screen.getByRole('link', { name: /view all/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/habits');
  });

  it('renders the trailing arrow icon', () => {
    const { container } = renderInRouter(
      <SectionActionLink to="/budget">Details</SectionActionLink>
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('merges a custom className', () => {
    renderInRouter(
      <SectionActionLink to="/budget" className="mt-2">Details</SectionActionLink>
    );
    const link = screen.getByRole('link', { name: /details/i });
    expect(link).toHaveClass('mt-2', 'font-semibold');
  });
});
