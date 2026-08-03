import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimezoneAutoHeal, type TimezoneAutoHealMember } from './useTimezoneAutoHeal';

const flush = () => act(async () => { await Promise.resolve(); });

describe('useTimezoneAutoHeal', () => {
  let healTimezone: ReturnType<typeof vi.fn<(memberUid: string, timezone: string) => void>>;
  const detectTimezone = () => 'America/Chicago';

  beforeEach(() => {
    healTimezone = vi.fn<(memberUid: string, timezone: string) => void>();
  });

  const member = (timezone?: string): TimezoneAutoHealMember => ({
    uid: 'member-1',
    notificationPreferences: timezone === undefined ? undefined : { timezone },
  });

  it('heals when the stored timezone is missing entirely', async () => {
    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: 'hh1',
        currentUser: { uid: 'member-1' }, // no notificationPreferences at all
        healTimezone,
        detectTimezone,
      })
    );
    await flush();

    expect(healTimezone).toHaveBeenCalledTimes(1);
    expect(healTimezone).toHaveBeenCalledWith('member-1', 'America/Chicago');
  });

  it('heals when the stored timezone is empty', async () => {
    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: 'hh1',
        currentUser: member(''),
        healTimezone,
        detectTimezone,
      })
    );
    await flush();

    expect(healTimezone).toHaveBeenCalledTimes(1);
    expect(healTimezone).toHaveBeenCalledWith('member-1', 'America/Chicago');
  });

  it('does NOT heal when the stored timezone differs from the detected zone (explicit override respected)', async () => {
    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: 'hh1',
        currentUser: member('UTC'),
        healTimezone,
        detectTimezone,
      })
    );
    await flush();

    // A member who set an explicit override in the Settings picker must not
    // have it silently reverted the next time they open the app from a
    // device reporting a different zone — only missing/empty is healed.
    expect(healTimezone).not.toHaveBeenCalled();
  });

  it('does NOT write when the stored timezone already matches the detected zone', async () => {
    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: 'hh1',
        currentUser: member('America/Chicago'),
        healTimezone,
        detectTimezone,
      })
    );
    await flush();

    expect(healTimezone).not.toHaveBeenCalled();
  });

  it('heals at most once per (household, member) session even across re-renders', async () => {
    const { rerender } = renderHook(
      (props: { uid: string }) =>
        useTimezoneAutoHeal({
          householdId: 'hh1',
          currentUser: { uid: props.uid }, // missing timezone every render
          healTimezone,
          detectTimezone,
        }),
      { initialProps: { uid: 'member-1' } }
    );
    await flush();
    expect(healTimezone).toHaveBeenCalledTimes(1);

    rerender({ uid: 'member-1' });
    await flush();
    // Same household+member — must not re-fire even though the input still
    // shows a missing timezone (the write hasn't round-tripped back yet).
    expect(healTimezone).toHaveBeenCalledTimes(1);
  });

  it('heals again for a different member under the same household', async () => {
    const { rerender } = renderHook(
      (props: { uid: string }) =>
        useTimezoneAutoHeal({
          householdId: 'hh1',
          currentUser: { uid: props.uid },
          healTimezone,
          detectTimezone,
        }),
      { initialProps: { uid: 'member-1' } }
    );
    await flush();
    expect(healTimezone).toHaveBeenCalledTimes(1);

    rerender({ uid: 'member-2' });
    await flush();
    expect(healTimezone).toHaveBeenCalledTimes(2);
    expect(healTimezone).toHaveBeenLastCalledWith('member-2', 'America/Chicago');
  });

  it('does nothing without a householdId or a signed-in member', async () => {
    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: null,
        currentUser: member(undefined),
        healTimezone,
        detectTimezone,
      })
    );
    await flush();
    expect(healTimezone).not.toHaveBeenCalled();

    renderHook(() =>
      useTimezoneAutoHeal({
        householdId: 'hh1',
        currentUser: null,
        healTimezone,
        detectTimezone,
      })
    );
    await flush();
    expect(healTimezone).not.toHaveBeenCalled();
  });

  it('is resilient to a failed write and does not throw', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    healTimezone.mockImplementation(() => {
      throw new Error('offline');
    });

    expect(() => {
      renderHook(() =>
        useTimezoneAutoHeal({
          householdId: 'hh1',
          currentUser: member(undefined),
          healTimezone,
          detectTimezone,
        })
      );
    }).not.toThrow();
    await flush();

    consoleErrorSpy.mockRestore();
  });
});
