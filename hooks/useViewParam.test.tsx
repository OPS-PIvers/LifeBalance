import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigationType, useSearchParams } from 'react-router-dom';
import { useViewParam } from '@/hooks/useViewParam';

const VALID_TABS = ['overview', 'transactions', 'trends'] as const;

/** Exposes the hook's value + the live URL search string + the last navigation
 * type, so a test can assert both the returned value and what happened to the
 * address bar/history in one render. */
const Harness: React.FC<{ next?: string }> = ({ next = 'trends' }) => {
  const [value, setValue] = useViewParam('overview', VALID_TABS);
  const [searchParams] = useSearchParams();
  const navType = useNavigationType();
  return (
    <div>
      <span data-testid="value">{value}</span>
      <span data-testid="search">{searchParams.toString()}</span>
      <span data-testid="navtype">{navType}</span>
      <button onClick={() => setValue(next)}>switch</button>
    </div>
  );
};

const renderAt = (entries: (string | { pathname: string; search?: string; state?: unknown })[]) =>
  render(
    <MemoryRouter initialEntries={entries}>
      <Harness />
    </MemoryRouter>
  );

describe('useViewParam', () => {
  it('defaults to the given tab when there is no `view` param or deep-link state', () => {
    renderAt(['/budget']);
    expect(screen.getByTestId('value').textContent).toBe('overview');
  });

  it('adopts a valid `view` param straight from the URL', () => {
    renderAt(['/budget?view=trends']);
    expect(screen.getByTestId('value').textContent).toBe('trends');
  });

  it('falls back to the default for an unknown `view` value', () => {
    renderAt(['/budget?view=nonsense']);
    expect(screen.getByTestId('value').textContent).toBe('overview');
  });

  it('a tab switch writes `view` into the URL via REPLACE (no history push)', () => {
    renderAt(['/budget']);
    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByTestId('value').textContent).toBe('trends');
    expect(screen.getByTestId('search').textContent).toBe('view=trends');
    expect(screen.getByTestId('navtype').textContent).toBe('REPLACE');
  });

  it('a tab switch preserves any OTHER param already on the URL', () => {
    renderAt(['/budget?foo=bar']);
    fireEvent.click(screen.getByText('switch'));
    const search = new URLSearchParams(screen.getByTestId('search').textContent ?? '');
    expect(search.get('foo')).toBe('bar');
    expect(search.get('view')).toBe('trends');
  });

  it('honors a one-shot `state: { tab }` deep link and mirrors it into `view`', async () => {
    renderAt([{ pathname: '/budget', state: { tab: 'transactions' } }]);
    // `value` adopts synchronously (same render, matching `useDeepLinkTab`'s
    // "correct tab on the very first paint" guarantee); the router's actual
    // history replace — mirroring it into `view` + clearing `state` — settles
    // a tick later, same as React Router itself warns navigating during
    // render always does.
    expect(screen.getByTestId('value').textContent).toBe('transactions');
    await waitFor(() =>
      expect(screen.getByTestId('search').textContent).toBe('view=transactions')
    );
  });

  it('ignores an unknown value riding in deep-link state', () => {
    renderAt([{ pathname: '/budget', state: { tab: 'nonsense' } }]);
    expect(screen.getByTestId('value').textContent).toBe('overview');
  });
});
