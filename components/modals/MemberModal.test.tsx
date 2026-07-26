import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MemberModal from './MemberModal';
import { HouseholdMember } from '@/types/schema';

// Mock Drawer to a plain wrapper so the form renders without framer-motion's
// AnimatePresence involved.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
}));

const baseMember: HouseholdMember = {
  uid: 'member-1',
  displayName: 'Jamie',
  email: '',
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
};

describe('MemberModal', () => {
  it('does not include an email key in the payload when the field is left empty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberModal isOpen={true} onClose={vi.fn()} onSave={onSave} initialMember={baseMember} title="Edit Member" />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Call count just asserted above, so the first call is provably present.
    const payload = onSave.mock.calls[0]![0];
    expect(payload).not.toHaveProperty('email');
    expect(payload).toEqual({ displayName: 'Jamie', role: 'member' });
  });

  it('includes a trimmed email key when the field has a value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberModal
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        initialMember={{ ...baseMember, email: 'jamie@example.com' }}
        title="Edit Member"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]![0];
    expect(payload).toMatchObject({ email: 'jamie@example.com' });
  });

  it('omits the email key for a brand-new member left blank', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberModal isOpen={true} onClose={vi.fn()} onSave={onSave} initialMember={null} title="Add Member" />
    );

    // exact: false — the label's accessible text also carries the
    // required-field asterisk ("Display Name*").
    fireEvent.change(screen.getByLabelText('Display Name', { exact: false }), { target: { value: 'New Member' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0]![0];
    expect(payload).not.toHaveProperty('email');
  });
});
