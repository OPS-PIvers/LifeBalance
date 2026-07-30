import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import HabitPlaySettings from './HabitPlaySettings';
import type { Household } from '@/types/schema';

// Stage 6 — the admin surface for `Household.freezeMode` + `ceremonyTone`.
// The properties worth pinning: the ABSENT fields present as today's behaviour,
// all three options of each setting are offered, and a non-admin gets a
// read-only statement rather than controls they cannot use.

const settings = (overrides: Partial<Household> = {}) =>
  overrides as Household;

function renderCard(opts: {
  settings?: Household | null;
  isAdmin?: boolean;
} = {}) {
  const onChangeFreezeMode = vi.fn();
  const onChangeCeremonyTone = vi.fn();
  render(
    <HabitPlaySettings
      settings={opts.settings === undefined ? settings() : opts.settings}
      isAdmin={opts.isAdmin ?? true}
      onChangeFreezeMode={onChangeFreezeMode}
      onChangeCeremonyTone={onChangeCeremonyTone}
    />
  );
  return { onChangeFreezeMode, onChangeCeremonyTone };
}

const freezeGroup = () => screen.getByRole('radiogroup', { name: 'Streak freezes' });
const wrapUpGroup = () => screen.getByRole('radiogroup', { name: 'Weekly wrap-up' });

describe('HabitPlaySettings', () => {
  it('offers all three freeze modes and all three wrap-up tones', () => {
    renderCard();
    expect(within(freezeGroup()).getAllByRole('radio')).toHaveLength(3);
    expect(within(wrapUpGroup()).getAllByRole('radio')).toHaveLength(3);
  });

  it('shows the inert defaults when both fields are absent', () => {
    renderCard({ settings: settings() });
    // 'shared' and 'household_first' — i.e. exactly what the household already
    // experiences, stated rather than left blank.
    expect(within(freezeGroup()).getByRole('radio', { name: /One shared bank/ }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(wrapUpGroup()).getByRole('radio', { name: /Household first/ }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('reflects a stored value, and treats a null household as the default', () => {
    const { unmount } = render(
      <HabitPlaySettings
        settings={settings({ freezeMode: 'per_member', ceremonyTone: 'podium' })}
        isAdmin
        onChangeFreezeMode={vi.fn()}
        onChangeCeremonyTone={vi.fn()}
      />
    );
    expect(within(freezeGroup()).getByRole('radio', { name: /A bank each/ }))
      .toHaveAttribute('aria-checked', 'true');
    expect(within(wrapUpGroup()).getByRole('radio', { name: /Podium/ }))
      .toHaveAttribute('aria-checked', 'true');
    unmount();

    renderCard({ settings: null });
    expect(within(freezeGroup()).getByRole('radio', { name: /One shared bank/ }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('reports the picked freeze mode, including the deliberately-pinned freeze_both', async () => {
    const user = userEvent.setup();
    const { onChangeFreezeMode } = renderCard();

    await user.click(within(freezeGroup()).getByRole('radio', { name: /A bank each/ }));
    expect(onChangeFreezeMode).toHaveBeenCalledWith('per_member');

    await user.click(within(freezeGroup()).getByRole('radio', { name: /freeze us both/ }));
    expect(onChangeFreezeMode).toHaveBeenCalledWith('freeze_both');
  });

  it('reports the picked wrap-up tone', async () => {
    const user = userEvent.setup();
    const { onChangeCeremonyTone } = renderCard();
    await user.click(within(wrapUpGroup()).getByRole('radio', { name: /Read the room/ }));
    expect(onChangeCeremonyTone).toHaveBeenCalledWith('adaptive');
  });

  it('does not re-write the value already selected', async () => {
    const user = userEvent.setup();
    const { onChangeFreezeMode } = renderCard();
    await user.click(within(freezeGroup()).getByRole('radio', { name: /One shared bank/ }));
    expect(onChangeFreezeMode).not.toHaveBeenCalled();
  });

  it('gives a non-admin a read-only statement instead of unusable controls', () => {
    renderCard({ settings: settings({ freezeMode: 'per_member' }), isAdmin: false });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    // The household's answer is still visible, with the reason it is fixed.
    expect(screen.getByText('A bank each')).toBeInTheDocument();
    expect(screen.getAllByText(/Only an admin can change it/).length).toBe(2);
  });
});
