import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LazyMount } from './LazyMount';

describe('LazyMount', () => {
  it('renders nothing before it is first opened', () => {
    render(
      <LazyMount when={false}>
        <div data-testid="modal">content</div>
      </LazyMount>
    );
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('mounts children when opened', () => {
    render(
      <LazyMount when={true}>
        <div data-testid="modal">content</div>
      </LazyMount>
    );
    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  it('keeps children mounted after closing so exit animations can play', () => {
    const { rerender } = render(
      <LazyMount when={true}>
        <div data-testid="modal">content</div>
      </LazyMount>
    );
    rerender(
      <LazyMount when={false}>
        <div data-testid="modal">content</div>
      </LazyMount>
    );
    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  it('shows the backdrop fallback while a lazy child is loading and open', () => {
    const NeverResolves = React.lazy<React.ComponentType>(() => new Promise(() => {}));
    render(
      <LazyMount when={true}>
        <NeverResolves />
      </LazyMount>
    );
    expect(screen.getByTestId('lazy-mount-fallback')).toBeInTheDocument();
  });
});
