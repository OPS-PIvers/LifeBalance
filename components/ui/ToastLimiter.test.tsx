import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import toast, { useToasterStore } from 'react-hot-toast';
import { ToastLimiter } from './ToastLimiter';

// Uses the real react-hot-toast library (no Firebase involved, and the
// store is a plain in-memory module singleton) so we can exercise the
// actual overflow-dismissal behavior end to end, rather than mocking it
// away like App.test.tsx does for its unrelated concerns.
//
// We assert against the store's `visible` flags via a probe component
// (mirroring how ToastLimiter itself reads the store) rather than the
// rendered <Toaster /> DOM: a dismissed toast is only marked
// `visible: false` and stays mounted (mid exit-animation) until its
// removal timer fires, so asserting on DOM presence would make the test
// depend on real timers instead of the limiter's actual job.
const StoreProbe: React.FC = () => {
  const { toasts } = useToasterStore();
  const visibleMessages = toasts
    .filter((t) => t.visible)
    .map((t) => (typeof t.message === 'string' ? t.message : ''));
  return <div data-testid="probe">{visibleMessages.join(',')}</div>;
};

describe('ToastLimiter', () => {
  beforeEach(() => {
    // The store is a module-level singleton shared across toast() calls;
    // clear it between tests so counts don't leak across cases.
    act(() => {
      toast.remove();
    });
  });

  it('keeps at most 2 toasts visible when a burst fires', () => {
    render(
      <>
        <ToastLimiter />
        <StoreProbe />
      </>
    );

    act(() => {
      toast('first');
      toast('second');
      toast('third');
      toast('fourth');
    });

    const visible = screen.getByTestId('probe').textContent?.split(',').filter(Boolean) ?? [];
    expect(visible.length).toBeLessThanOrEqual(2);
  });

  it('dismisses the oldest toasts first, keeping the newest ones visible', () => {
    render(
      <>
        <ToastLimiter />
        <StoreProbe />
      </>
    );

    act(() => {
      toast('oldest');
      toast('middle');
      toast('newest');
    });

    expect(screen.getByTestId('probe').textContent).toBe('newest,middle');
  });

  it('does not touch the store when only 2 or fewer toasts are showing', () => {
    render(
      <>
        <ToastLimiter />
        <StoreProbe />
      </>
    );

    act(() => {
      toast('only one');
      toast('another one');
    });

    expect(screen.getByTestId('probe').textContent).toBe('another one,only one');
  });
});
