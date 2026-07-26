import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigationType, useSearchParams } from 'react-router-dom';
import { useViewParam } from '@/hooks/useViewParam';
import { useDeepLinkHighlight } from '@/hooks/useDeepLinkHighlight';

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

/**
 * Regression coverage for the race described in the finding this fixes:
 * `Budget.tsx` mounts `useViewParam` AND `useDeepLinkHighlight` side by side,
 * both reading the SAME `location.state` object set by `SearchOverlay`
 * (`{ tab, highlightId }`). `useViewParam` used to clear that state from a
 * post-commit `useEffect`, which forced a second render that
 * `useDeepLinkHighlight`'s own render-phase check reacted to — nulling out a
 * `highlightId` that had just arrived. This harness mounts both hooks
 * together, the same way `Budget.tsx` does, and asserts the highlight
 * survives.
 */
const SiblingHarness: React.FC = () => {
  const [value] = useViewParam('overview', VALID_TABS);
  const highlightId = useDeepLinkHighlight();
  return (
    <div>
      <span data-testid="value">{value}</span>
      <span data-testid="highlight">{highlightId ?? ''}</span>
    </div>
  );
};

describe('useViewParam + useDeepLinkHighlight (sibling hooks on the same page)', () => {
  it('a highlightId riding alongside a tab deep link survives the state clear', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/budget', state: { tab: 'transactions', highlightId: 'txn-abc' } },
        ]}
      >
        <SiblingHarness />
      </MemoryRouter>
    );

    // Correct tab paints immediately (unchanged behavior).
    expect(screen.getByTestId('value').textContent).toBe('transactions');
    // The highlight must survive `useViewParam` mirroring the deep-link into
    // `?view=` and clearing `location.state` out from under the sibling hook.
    expect(screen.getByTestId('highlight').textContent).toBe('txn-abc');

    // Give the state-clearing navigation a chance to fully settle and
    // re-render — the highlight must still be there afterward, not just on
    // the very first paint.
    await waitFor(() => {
      expect(screen.getByTestId('highlight').textContent).toBe('txn-abc');
    });
  });
});
