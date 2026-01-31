import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { HouseholdMember, Role } from '@/types/schema';
import { Drawer } from '../ui/Drawer';
import Input from '../ui/Input';

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
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialMember) {
      setDisplayName(initialMember.displayName);
      setEmail(initialMember.email || '');
      setRole(initialMember.role);
    } else {
      setDisplayName('');
      setEmail('');
      setRole('member');
    }
  }, [initialMember, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave({
        displayName,
        email,
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
    <Drawer isOpen={isOpen} onClose={onClose} title={title}>
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
          <label className="text-xs font-bold text-brand-400 uppercase block mb-1">
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
                className="text-brand-600 focus:ring-brand-500"
              />
              <span className="text-gray-700">Member</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="role"
                value="admin"
                checked={role === 'admin'}
                onChange={() => setRole('admin')}
                className="text-brand-600 focus:ring-brand-500"
              />
              <span className="text-gray-700">Admin</span>
            </label>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="animate-spin">⌛</span>
            ) : (
              <Save size={18} />
            )}
            Save Member
          </button>
        </div>
      </form>
    </Drawer>
  );
};

export default MemberModal;
