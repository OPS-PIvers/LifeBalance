import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MainLayout from './MainLayout';
import { HashRouter } from 'react-router-dom';

// Mock child components to avoid complexity
vi.mock('./TopToolbar', () => ({
  default: () => <div data-testid="top-toolbar">TopToolbar</div>
}));

vi.mock('./BottomNav', () => ({
  default: () => <div data-testid="bottom-nav">BottomNav</div>
}));

describe('MainLayout', () => {
  it('renders children correctly', () => {
    render(
      <HashRouter>
        <MainLayout>
          <div data-testid="child-content">Child Content</div>
        </MainLayout>
      </HashRouter>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders Skip to Content link with correct attributes', () => {
    render(
      <HashRouter>
        <MainLayout>
          <div>Content</div>
        </MainLayout>
      </HashRouter>
    );

    const skipLink = screen.getByRole('link', { name: /skip to content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');

    // Check for sr-only class (visually hidden)
    expect(skipLink).toHaveClass('sr-only');

    // Check for focus classes (visible on focus)
    expect(skipLink.className).toContain('focus:not-sr-only');
  });

  it('renders main element with correct ID and tabIndex', () => {
    render(
      <HashRouter>
        <MainLayout>
          <div>Content</div>
        </MainLayout>
      </HashRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabIndex', '-1');
    expect(main).toHaveClass('outline-none');
  });
});
