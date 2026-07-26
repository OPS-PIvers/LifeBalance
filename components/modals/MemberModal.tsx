import React, { useState } from 'react';
import { Save } from 'lucide-react';
import { HouseholdMember, Role } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (memberData: Partial<HouseholdMember>) => Promise<void>;
  initialMember?: HouseholdMember | null;
  title: string;
}

const MemberModal: React.FC<MemberModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialMember,
  title,
}) => {
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
      const trimmedEmail = email.trim();
      await onSave({
        displayName,
        // Omit the key entirely when blank rather than writing email: '' — an
        // empty-string value still updates the field on a partial `updateDoc`,
        // which (a) is meaningless for a member who simply has no email and
        // (b) permanently breaks firestore.rules' member-update allowlist for
        // managed kid profiles until #1112 lands (see MemberModal usage note).
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        role,
      });
      onClose();
    } catch (error) {
      console.error('Error saving member:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={title} disableClose={loading}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Display Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. John Doe"
          required
        />

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. john@example.com"
        />

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

        <div className="pt-4 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" isLoading={loading} leftIcon={<Save size={18} />}>
            Save Member
          </Button>
        </div>
      </form>
    </Drawer>
  );
};

export default MemberModal;
