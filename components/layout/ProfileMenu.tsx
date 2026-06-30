import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Plus, Settings, User, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Popover } from '@/components/ui/Popover';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';

interface ProfileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ isOpen, onClose }) => {
  const { currentUser, logout } = useAuth();
  // Active-member (acting-as) state lives in the household context so the switch is
  // app-wide (the kid view in a later slice reads it), not local to this menu.
  const {
    household,
    members,
    activeMemberId,
    actAs,
    exitToParent,
    addKidProfile,
  } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();

  const kids = kidModeEnabled ? members.filter((m) => m.isManaged === true) : [];
  const activeKid = activeMemberId ? kids.find((k) => k.uid === activeMemberId) : undefined;

  const handleAddKidProfile = useCallback(async () => {
    const name = window.prompt('Kid name');
    if (!name || !name.trim()) return;
    const trimmedName = name.trim();
    // Match the firestore.rules displayName cap (isValidString ..., 50) so the user
    // gets a friendly message instead of a generic permission error.
    if (trimmedName.length > 50) {
      toast.error('Kid name must be 50 characters or less');
      return;
    }
    try {
      await addKidProfile({ displayName: trimmedName });
    } catch {
      // addKidProfile surfaces its own error toast.
    }
  }, [addKidProfile]);
  const navigate = useNavigate();

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

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      role="menu"
      ariaLabel="Profile Menu"
      position="top-14 right-4"
      className="w-64 overflow-hidden origin-top-right"
    >
      {/* User Info Header */}
      <div className="bg-brand-50 dark:bg-brand-700/50 p-4 border-b border-brand-200 dark:border-brand-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-200 dark:bg-brand-700 flex items-center justify-center text-brand-700 dark:text-brand-200 font-bold text-lg">
            {currentUser?.displayName ? (
              <span>{currentUser.displayName.charAt(0)}</span>
            ) : (
              <User className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-brand-900 dark:text-brand-100 truncate">
              {currentUser?.displayName || 'User'}
            </p>
            <p className="text-xs text-brand-600 dark:text-brand-400 truncate">{currentUser?.email}</p>
          </div>
        </div>
        {household && (
          <div className="mt-3 text-xs font-medium text-brand-600 dark:text-brand-300 bg-brand-100 dark:bg-brand-700/60 py-1 px-2 rounded-sm truncate">
            Household: {household.name}
          </div>
        )}
      </div>

      {/* Profiles section — only visible when Kid Mode is enabled (Plan 080, dormant by default) */}
      {kidModeEnabled && (
        <div className="p-2 border-b border-brand-200 dark:border-brand-700">
          <div className="px-3 py-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-500">
            <Users className="w-3.5 h-3.5" />
            Profiles
          </div>

          {/* Active-kid banner */}
          {activeKid && (
            <div className="mx-3 mb-1.5 flex items-center justify-between rounded-btn bg-warm-50 dark:bg-warm-900/30 px-3 py-1.5 text-xs text-warm-700 dark:text-warm-200">
              <span>
                Viewing as{' '}
                <span className="font-semibold">
                  {activeKid.displayName}
                </span>
              </span>
              <button
                onClick={() => {
                  exitToParent();
                  onClose();
                }}
                className="ml-2 flex items-center gap-1 font-medium hover:text-warm-900 dark:hover:text-warm-100 transition-colors"
                role="menuitem"
                tabIndex={-1}
                aria-label="Back to parent view"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to parent
              </button>
            </div>
          )}

          {/* Parent row (active when no kid is selected) */}
          <div
            className={`flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-medium text-brand-700 dark:text-brand-300 ${activeMemberId === null ? 'bg-brand-50 dark:bg-brand-700/40' : ''}`}
          >
            <div className="w-6 h-6 rounded-full bg-brand-200 dark:bg-brand-700 flex items-center justify-center text-brand-700 dark:text-brand-200 text-xs font-bold shrink-0">
              {currentUser?.displayName ? currentUser.displayName.charAt(0) : <User className="w-3.5 h-3.5" />}
            </div>
            <span className="truncate">
              {currentUser?.displayName ?? 'Parent'}{activeMemberId === null ? ' (you)' : ''}
            </span>
          </div>

          {/* Kid rows */}
          {kids.map((kid) => (
            <button
              key={kid.uid}
              onClick={() => {
                actAs(kid.uid);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700 hover:text-warm-700 dark:hover:text-warm-300 rounded-btn transition-colors text-left"
              role="menuitem"
              tabIndex={-1}
            >
              {kid.avatarColor ? (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: kid.avatarColor, color: '#fff' }}
                >
                  {kid.avatarEmoji ?? kid.displayName.charAt(0)}
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-warm-100 dark:bg-warm-900/30 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-warm-500 dark:text-warm-300" />
                </div>
              )}
              <span className="truncate">{kid.displayName}</span>
            </button>
          ))}

          {/* Add kid profile */}
          <button
            onClick={handleAddKidProfile}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700 hover:text-warm-700 dark:hover:text-warm-300 rounded-btn transition-colors text-left"
            role="menuitem"
            tabIndex={-1}
          >
            <Plus className="w-4 h-4" />
            Add kid profile
          </button>
        </div>
      )}

      {/* Menu Actions */}
      <div className="p-2">
        <button
          onClick={() => {
            navigate('/settings');
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700 hover:text-accent-700 dark:hover:text-accent-300 rounded-btn transition-colors text-left"
          role="menuitem"
          tabIndex={-1}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>

        <hr className="my-1 border-brand-200 dark:border-brand-700" />

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-money-neg dark:text-money-negDark hover:bg-money-bgNeg dark:hover:bg-money-neg/15 rounded-btn transition-colors text-left"
          role="menuitem"
          tabIndex={-1}
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>
    </Popover>
  );
};

export default ProfileMenu;
