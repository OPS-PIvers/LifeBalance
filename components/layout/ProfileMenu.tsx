import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ isOpen, onClose, anchorRef }) => {
  const { currentUser, logout } = useAuth();
  const { household } = useHousehold();
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorRef]);

  // Close menu when pressing Escape for keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOpen && event.key === 'Escape') {
        onClose();
        // Return focus to profile button when closed via keyboard
        if (anchorRef.current) {
          anchorRef.current.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  // Manage focus when the profile menu opens
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const firstFocusable = menuRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    }
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      await logout();
      onClose();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-14 right-4 z-50 w-64 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right"
      role="dialog"
      aria-modal="true"
      aria-label="Profile Menu"
    >
      {/* User Info Header */}
      <div className="bg-brand-50 p-4 border-b border-brand-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-200 flex items-center justify-center text-brand-700 font-bold text-lg">
            {currentUser?.displayName ? (
              <span>{currentUser.displayName.charAt(0)}</span>
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-brand-900 truncate">
              {currentUser?.displayName || 'User'}
            </p>
            <p className="text-xs text-brand-600 truncate">{currentUser?.email}</p>
          </div>
        </div>
        {household && (
            <div className="mt-3 text-xs font-medium text-brand-500 bg-brand-100/50 py-1 px-2 rounded-md truncate">
              Household: {household.name}
            </div>
        )}
      </div>

      {/* Menu Actions */}
      <div className="p-2">
        <button
          onClick={() => {
            navigate('/settings');
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-brand-700 rounded-lg transition-colors text-left"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>

        <hr className="my-1 border-gray-100" />

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors text-left"
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>
    </div>
  );
};

export default ProfileMenu;
