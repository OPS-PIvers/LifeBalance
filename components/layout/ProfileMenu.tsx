import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ isOpen, onClose, anchorRef }) => {
  const { currentUser, logout } = useAuth();
  const { household } = useHouseholdCore();
  // useFocusTrap manages focus-in on open, Tab trapping, and focus restoration on close.
  const menuRef = useFocusTrap<HTMLDivElement>(isOpen);
  const navigate = useNavigate();

  // We also need a plain ref to the container for the click-outside handler.
  // Since useFocusTrap returns a RefObject we can use it directly.
  const containerRef = menuRef as React.RefObject<HTMLDivElement>;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
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
  }, [isOpen, onClose, anchorRef, containerRef]);

  // Close menu when pressing Escape and return focus to the anchor button.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOpen && event.key === 'Escape') {
        onClose();
        anchorRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  /** Move focus between menuitems with ArrowDown/ArrowUp. */
  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
      );
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number;

      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
      } else {
        nextIndex =
          currentIndex === -1 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      }

      items[nextIndex]?.focus();
    },
    [containerRef]
  );

  const handleLogout = async () => {
    try {
      await logout();
      onClose();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
      toast.error('Logout failed. Please try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-14 right-4 z-dropdown w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-100 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right"
      role="menu"
      aria-label="Profile Menu"
      onKeyDown={handleMenuKeyDown}
    >
      {/* User Info Header */}
      <div className="bg-brand-50 dark:bg-slate-700/50 p-4 border-b border-brand-100 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-200 dark:bg-brand-700 flex items-center justify-center text-brand-700 dark:text-brand-200 font-bold text-lg">
            {currentUser?.displayName ? (
              <span>{currentUser.displayName.charAt(0)}</span>
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-brand-900 dark:text-slate-100 truncate">
              {currentUser?.displayName || 'User'}
            </p>
            <p className="text-xs text-brand-600 dark:text-slate-400 truncate">{currentUser?.email}</p>
          </div>
        </div>
        {household && (
          <div className="mt-3 text-xs font-medium text-brand-500 dark:text-brand-400 bg-brand-100/50 dark:bg-slate-600/50 py-1 px-2 rounded-md truncate">
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
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-brand-700 dark:hover:text-brand-300 rounded-lg transition-colors text-left"
          role="menuitem"
          tabIndex={-1}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>

        <hr className="my-1 border-gray-100 dark:border-slate-700" />

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-left"
          role="menuitem"
          tabIndex={-1}
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>
    </div>
  );
};

export default ProfileMenu;
