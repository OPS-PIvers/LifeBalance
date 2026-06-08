import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAutoFocus } from './useAutoFocus';

const originalMatchMedia = window.matchMedia;

/** Mock matchMedia so '(pointer: coarse)' reports the given device type. */
function setCoarsePointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('coarse') ? coarse : !coarse,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const Field = ({ enabled }: { enabled?: boolean }) => {
  const ref = useAutoFocus<HTMLInputElement>(enabled);
  return <input ref={ref} data-testid="field" />;
};

describe('useAutoFocus', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('focuses the element on a fine-pointer (desktop) device', () => {
    setCoarsePointer(false);
    const { getByTestId } = render(<Field />);
    expect(document.activeElement).toBe(getByTestId('field'));
  });

  it('does NOT focus on a coarse-pointer (touch) device — avoids keyboard pop', () => {
    setCoarsePointer(true);
    const { getByTestId } = render(<Field />);
    expect(document.activeElement).not.toBe(getByTestId('field'));
  });

  it('does not focus when disabled, even on desktop', () => {
    setCoarsePointer(false);
    const { getByTestId } = render(<Field enabled={false} />);
    expect(document.activeElement).not.toBe(getByTestId('field'));
  });

  it('is a no-op when matchMedia is unavailable', () => {
    // jsdom has no matchMedia by default.
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { getByTestId } = render(<Field />);
    expect(document.activeElement).not.toBe(getByTestId('field'));
  });
});
