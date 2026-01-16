import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { HouseholdMember, Role } from '@/types/schema';
import { Modal } from '../ui/Modal';

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-md"
      backdropColor="bg-black/50"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition-all"
              placeholder="e.g. John Doe"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition-all"
              placeholder="e.g. john@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
    </Modal>
  );
};

export default MemberModal;
