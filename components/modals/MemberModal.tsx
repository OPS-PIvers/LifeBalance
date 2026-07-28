import React, { useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { HouseholdMember, Role } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';

// Match the firestore.rules displayName cap (isValidString ..., 50) for a
// managed kid profile. Enforced here on submit — for BOTH the add and the edit
// flow, which share this modal — so the user gets a friendly message instead of
// a raw permission error when firestore.rules' managed-kid branch rejects the
// write.
const KID_DISPLAY_NAME_MAX_LENGTH = 50;

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (memberData: Partial<HouseholdMember>) => Promise<void>;
  initialMember?: HouseholdMember | null;
  title: string;
  /**
   * Create mode for a managed kid profile (ProfileMenu's "Add kid profile").
   * There is no `initialMember` to read `isManaged` from when adding, so the
   * caller declares it. Ignored when `initialMember` is present — an existing
   * member's own `isManaged` is always the authority there.
   */
  createManagedKid?: boolean;
}

const MemberModal: React.FC<MemberModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialMember,
  title,
  createManagedKid = false,
}) => {
  // Managed kid profiles (Plan 080) have no login, so no email — and no role,
  // since changing a managed kid's role away from 'kid' would un-manage them
  // and firestore.rules' managed-kid branch forbids it anyway; offering the
  // control at all would be a lie. Only the display name is editable.
  const isManagedKid = initialMember ? initialMember.isManaged === true : createManagedKid;

  // Initialize the form from the member being edited (lazy initializers, so the
  // first render is already populated for the edit case).
  const [displayName, setDisplayName] = useState(() => initialMember?.displayName ?? '');
  const [email, setEmail] = useState(() => initialMember?.email || '');
  const [role, setRole] = useState<Role>(() => initialMember?.role ?? 'member');
  const [loading, setLoading] = useState(false);

  // Re-populate (or reset) the form when the member being edited or the open
  // state changes. Done during render on that change edge rather than in an
  // effect so it doesn't trigger a cascading render. Mirrors the previous effect
  // keyed on `[initialMember, isOpen]`; the initial population is handled by the
  // initializers above.
  const [prevKey, setPrevKey] = useState({ initialMember, isOpen });
  if (prevKey.initialMember !== initialMember || prevKey.isOpen !== isOpen) {
    setPrevKey({ initialMember, isOpen });
    if (initialMember) {
      setDisplayName(initialMember.displayName);
      setEmail(initialMember.email || '');
      setRole(initialMember.role);
    } else {
      setDisplayName('');
      setEmail('');
      setRole('member');
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isManagedKid) {
        const trimmedName = displayName.trim();
        // HTML `required` counts a whitespace-only value as filled, so "   "
        // sails past the browser check and would reach addKidProfile /
        // updateKidProfile as an empty displayName — which comes back as a raw
        // firestore.rules permission error. Catch it here, where both the add
        // and edit flows share one validation block.
        if (!trimmedName) {
          toast.error('Kid name is required');
          return;
        }
        if (trimmedName.length > KID_DISPLAY_NAME_MAX_LENGTH) {
          toast.error(`Kid name must be ${KID_DISPLAY_NAME_MAX_LENGTH} characters or less`);
          return;
        }
        // Only displayName — a kid has no email/role for the caller to route
        // onto updateMember/addMember; the caller routes this payload to
        // updateKidProfile (edit) or addKidProfile (create).
        await onSave({ displayName: trimmedName });
      } else {
        const trimmedEmail = email.trim();
        await onSave({
          displayName,
          // Omit the key entirely when blank rather than writing email: '' — an
          // empty-string value still updates the field on a partial `updateDoc`,
          // which is meaningless for a member who simply has no email.
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
          role,
        });
      }
      onClose();
    } catch (error) {
      console.error('Error saving member:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      disableClose={loading}
      footer={
        // The submit button lives outside the <form>, so it re-associates via
        // `form="member-form"` — without that, submit silently stops working.
        <div className="flex justify-end gap-3 border-t border-brand-200 dark:border-brand-700 p-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="member-form" isLoading={loading} leftIcon={<Save size={18} />}>
            {isManagedKid ? 'Save Kid Profile' : 'Save Member'}
          </Button>
        </div>
      }
    >
      <form id="member-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={isManagedKid ? "Kid's Name" : 'Display Name'}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={isManagedKid ? 'e.g. Jamie' : 'e.g. John Doe'}
          required
        />

        {!isManagedKid && (
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. john@example.com"
          />
        )}

        {!isManagedKid && (
          <div>
            <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase block mb-1">
              Role
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="role"
                  value="member"
                  checked={role === 'member'}
                  onChange={() => setRole('member')}
                  className="accent-accent-600 focus:ring-2 focus:ring-accent-500/40"
                />
                <span className="text-brand-700 dark:text-brand-200">Member</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="role"
                  value="admin"
                  checked={role === 'admin'}
                  onChange={() => setRole('admin')}
                  className="accent-accent-600 focus:ring-2 focus:ring-accent-500/40"
                />
                <span className="text-brand-700 dark:text-brand-200">Admin</span>
              </label>
            </div>
          </div>
        )}
      </form>
    </Drawer>
  );
};

export default MemberModal;
