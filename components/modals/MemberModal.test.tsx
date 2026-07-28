import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MemberModal from './MemberModal';
import { HouseholdMember } from '@/types/schema';

// Mock Drawer to a plain wrapper so the form renders without framer-motion's
// AnimatePresence involved. `footer` is rendered below the body exactly like the
// real Drawer does — the Save button lives there and re-associates with the form
// via its `form` attribute.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({
    children,
    footer,
    isOpen,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    isOpen: boolean;
  }) =>
    isOpen ? (
      <div data-testid="drawer">
        {children}
        {footer}
      </div>
    ) : null,
}));

const toastErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({
  default: { error: toastErrorSpy, success: vi.fn() },
}));

const baseMember: HouseholdMember = {
  uid: 'member-1',
  displayName: 'Jamie',
  email: '',
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
};

const kidMember: HouseholdMember = {
  uid: 'kid-1',
  displayName: 'Kiddo',
  email: '',
  role: 'member',
  isManaged: true,
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

  it('renders all three fields for an ordinary member', () => {
    render(
      <MemberModal isOpen={true} onClose={vi.fn()} onSave={vi.fn()} initialMember={baseMember} title="Edit Member" />
    );

    expect(screen.getByLabelText('Display Name', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText('Email', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Member' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Admin' })).toBeInTheDocument();
  });

  describe('managed kid (isManaged === true)', () => {
    it('renders only the display name field — no email, no role', () => {
      render(
        <MemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          initialMember={kidMember}
          title="Edit Kid Profile"
        />
      );

      expect(screen.getByLabelText("Kid's Name", { exact: false })).toBeInTheDocument();
      expect(screen.queryByLabelText('Email', { exact: false })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Member' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Admin' })).not.toBeInTheDocument();
    });

    it('saves with only a trimmed displayName — no email or role keys', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <MemberModal isOpen={true} onClose={vi.fn()} onSave={onSave} initialMember={kidMember} title="Edit Kid Profile" />
      );

      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: '  New Kid Name  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const payload = onSave.mock.calls[0]![0];
      expect(payload).toEqual({ displayName: 'New Kid Name' });
    });

    it('rejects a display name over 50 characters with a friendly message, and does not save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <MemberModal isOpen={true} onClose={vi.fn()} onSave={onSave} initialMember={kidMember} title="Edit Kid Profile" />
      );

      const tooLongName = 'x'.repeat(51);
      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: tooLongName },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Kid name must be 50 characters or less'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only name rather than saving an empty displayName', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <MemberModal isOpen={true} onClose={vi.fn()} onSave={onSave} initialMember={kidMember} title="Edit Kid Profile" />
      );

      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Kid name is required'));
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  // Create mode: ProfileMenu's "Add kid profile" has no `initialMember` to read
  // `isManaged` from, so it declares kid-ness via `createManagedKid`.
  describe('create mode (createManagedKid)', () => {
    const renderCreateKid = (onSave = vi.fn().mockResolvedValue(undefined)) => {
      render(
        <MemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          initialMember={null}
          createManagedKid
          title="Add Kid Profile"
        />
      );
      return onSave;
    };

    it('renders only the display name field — no email, no role', () => {
      renderCreateKid();

      expect(screen.getByLabelText("Kid's Name", { exact: false })).toBeInTheDocument();
      expect(screen.queryByLabelText('Email', { exact: false })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Member' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Admin' })).not.toBeInTheDocument();
    });

    it('saves with only a trimmed displayName — no email or role keys', async () => {
      const onSave = renderCreateKid();

      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: '  Robin  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const payload = onSave.mock.calls[0]![0];
      expect(payload).toEqual({ displayName: 'Robin' });
    });

    it('rejects a display name over 50 characters with a friendly message, and does not save', async () => {
      const onSave = renderCreateKid();

      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: 'x'.repeat(51) },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Kid name must be 50 characters or less'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only name rather than saving an empty displayName', async () => {
      const onSave = renderCreateKid();

      // HTML `required` treats "   " as filled, so this reaches handleSubmit.
      fireEvent.change(screen.getByLabelText("Kid's Name", { exact: false }), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Kid Profile' }));

      await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Kid name is required'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("defers to an existing member's own isManaged over the create-mode flag", () => {
      render(
        <MemberModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={vi.fn()}
          initialMember={baseMember}
          createManagedKid
          title="Edit Member"
        />
      );

      // baseMember is a full member, so the email/role fields must survive.
      expect(screen.getByLabelText('Email', { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Admin' })).toBeInTheDocument();
    });
  });
});
