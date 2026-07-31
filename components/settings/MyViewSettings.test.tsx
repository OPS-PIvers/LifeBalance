import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyViewSettings } from '@/components/settings/MyViewSettings';
import type { Household, HouseholdMember } from '@/types/schema';

const baseMember = (overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
  uid: 'member-1',
  displayName: 'Test Member',
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const settings: Household['moduleVisibility'] | undefined = undefined;

/**
 * 2F.2 — Home becomes toggleable, and the landing-screen picker only ever
 * offers destinations actually reachable for this member.
 */
describe('MyViewSettings — Home + landing screen (2F.2)', () => {
  it('Home is on by default and appears alongside every page as a landing option', () => {
    render(<MyViewSettings member={baseMember()} settings={settings} onSave={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Show Home in your navigation' })).toBeChecked();

    const landing = screen.getByRole('radiogroup', { name: 'Landing screen' });
    expect(landing).toBeInTheDocument();
    // An un-customized member's effective landing screen is Home.
    expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked();
  });

  it('toggling Home off calls onSave with "home" added to hiddenKeys', async () => {
    const onSave = vi.fn();
    render(<MyViewSettings member={baseMember()} settings={settings} onSave={onSave} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show Home in your navigation' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ hiddenKeys: expect.arrayContaining(['home']) })
    );
  });

  it('hiding Home removes it from the landing-screen options and re-centers on the next destination', () => {
    render(
      <MyViewSettings
        member={baseMember({ hiddenKeys: ['home'] })}
        settings={settings}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByRole('radio', { name: 'Home' })).not.toBeInTheDocument();
    // Habits is the first remaining nav destination in registry order.
    expect(screen.getByRole('radio', { name: 'Habits' })).toBeChecked();
  });

  it('picking a landing screen calls onSave with that destination as homeScreen', async () => {
    const onSave = vi.fn();
    render(<MyViewSettings member={baseMember()} settings={settings} onSave={onSave} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Budget' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ homeScreen: 'money' }));
  });

  it('a chosen homeScreen for a page the member has since hidden shows the fallback as checked instead', () => {
    render(
      <MyViewSettings
        member={baseMember({
          homeScreen: 'money',
          hiddenKeys: ['overview', 'transactions', 'trends', 'calendar', 'subscriptions', 'buckets', 'accounts'],
        })}
        settings={settings}
        onSave={vi.fn()}
      />
    );
    // Budget itself dropped out of the page list entirely (no visible leaf) —
    // the picker never offers a page that would silently do nothing.
    expect(screen.queryByRole('radio', { name: 'Budget' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked();
  });

  // PC#4 — the widget list moved into the shared `HomeWidgetOrder` component
  // (Settings mounts the same one) and swapped its chevron pair for a
  // framer-motion drag list. The grip is deliberately a REAL button with
  // arrow-key support, unlike this app's other pointer-only grips, because it
  // replaced keyboard-operable controls.
  describe('Home widgets (shared HomeWidgetOrder)', () => {
    it('renders a keyboard-operable grip per widget instead of up/down chevrons', () => {
      render(<MyViewSettings member={baseMember()} settings={settings} onSave={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Reorder This Week Pulse' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Move This Week Pulse down' })
      ).not.toBeInTheDocument();
    });

    it('moves a widget with the arrow keys, persisting the whole reordered layout', async () => {
      const onSave = vi.fn();
      render(<MyViewSettings member={baseMember()} settings={settings} onSave={onSave} />);

      // "Since You Were Here" is second in the default order; ArrowUp swaps it
      // with the pulse strip ahead of it.
      await userEvent.type(
        screen.getByRole('button', { name: 'Reorder Since You Were Here' }),
        '{arrowup}'
      );

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          dashboardLayout: expect.arrayContaining(['partnerActivity', 'pulseStrip']),
        })
      );
      const layout = onSave.mock.calls[0]?.[0]?.dashboardLayout as string[];
      expect(layout.slice(0, 2)).toEqual(['partnerActivity', 'pulseStrip']);
    });

    it('still toggles a widget off through the same hiddenKeys list', async () => {
      const onSave = vi.fn();
      render(<MyViewSettings member={baseMember()} settings={settings} onSave={onSave} />);

      await userEvent.click(screen.getByRole('checkbox', { name: 'Show This Week Pulse on Home' }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ hiddenKeys: expect.arrayContaining(['pulseStrip']) })
      );
    });
  });

  it('hides the landing-screen picker entirely once only one destination remains', () => {
    const allButHome = [
      'track', 'history', 'insights', 'coach', 'rewards', 'challenges',
      'overview', 'transactions', 'trends', 'calendar', 'subscriptions', 'buckets', 'accounts',
      'todos', 'meals', 'shopping',
    ];
    render(
      <MyViewSettings
        member={baseMember({ hiddenKeys: allButHome })}
        settings={settings}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByRole('radiogroup', { name: 'Landing screen' })).not.toBeInTheDocument();
  });
});
