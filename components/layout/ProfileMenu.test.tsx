import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ProfileMenu from './ProfileMenu';
import { pickAvatarColor } from '@/utils/avatarColor';
import type { HouseholdMember } from '@/types/schema';

const addKidProfile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Test User', email: 'test@example.com' }, logout: vi.fn() }),
}));
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    household: { name: 'Test Household' },
    members: [] as HouseholdMember[],
    activeMemberId: null,
    actAs: vi.fn(),
    exitToParent: vi.fn(),
    addKidProfile,
  }),
}));
// Kid Mode on, so the Profiles section (and its "Add kid profile" row) renders.
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => true,
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// Render lazy children as soon as they're requested, so the modal-open flow is
// observable without waiting on a real chunk.
vi.mock('@/components/ui/LazyMount', () => ({
  LazyMount: ({ when, children }: { when: boolean; children: React.ReactNode }) =>
    when ? <>{children}</> : null,
}));

// Stand in for the kid-aware MemberModal: surfaces the props ProfileMenu must
// pass (create mode + title) and a Save button that fires the real onSave. Like
// the real modal it catches a rejected save and stays open, which also keeps a
// failure from escaping as an unhandled rejection.
vi.mock('@/components/modals/MemberModal', () => {
  const MockMemberModal = ({
    isOpen,
    title,
    createManagedKid,
    onSave,
  }: {
    isOpen: boolean;
    title: string;
    createManagedKid?: boolean;
    onSave: (memberData: Partial<HouseholdMember>) => Promise<void>;
    onClose: () => void;
  }) => {
    const [saveError, setSaveError] = React.useState<string | null>(null);
    if (!isOpen) return null;
    return (
      <div data-testid="member-modal" data-title={title} data-create-managed-kid={String(createManagedKid)}>
        <button
          onClick={() => {
            onSave({ displayName: 'Robin' }).catch((error: unknown) => setSaveError(String(error)));
          }}
        >
          Save Kid Profile
        </button>
        {saveError && <span data-testid="save-error">{saveError}</span>}
      </div>
    );
  };
  return { default: MockMemberModal };
});

const ADD_KID_LABEL = 'Add kid profile';

const renderMenu = (onClose = vi.fn()) => {
  render(
    <MemoryRouter>
      <ProfileMenu isOpen={true} onClose={onClose} />
    </MemoryRouter>
  );
  return onClose;
};

describe('ProfileMenu — add kid profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addKidProfile.mockResolvedValue(undefined);
  });

  it('opens the kid-aware MemberModal in create mode instead of a native prompt', async () => {
    // Regression guard: the add-kid flow used to be the app's last browser-native
    // text prompt — an off-design system dialog in an installed PWA.
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const onClose = renderMenu();

    expect(screen.queryByTestId('member-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: ADD_KID_LABEL }));

    // MemberModal is `React.lazy`-loaded, so it resolves asynchronously even
    // with the module mocked.
    const modal = await screen.findByTestId('member-modal');
    expect(modal).toHaveAttribute('data-title', 'Add Kid Profile');
    expect(modal).toHaveAttribute('data-create-managed-kid', 'true');
    expect(promptSpy).not.toHaveBeenCalled();
    // The menu dismisses behind the sheet.
    expect(onClose).toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('saves through addKidProfile with a palette-derived avatar color', async () => {
    renderMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: ADD_KID_LABEL }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Kid Profile' }));

    await waitFor(() => expect(addKidProfile).toHaveBeenCalledTimes(1));
    expect(addKidProfile).toHaveBeenCalledWith({
      displayName: 'Robin',
      avatarColor: pickAvatarColor('Robin'),
    });
  });

  it('propagates an addKidProfile failure to the modal instead of swallowing it', async () => {
    // The old native-prompt path caught and dropped the error; the sheet needs it
    // so it can stay open for a retry.
    addKidProfile.mockRejectedValueOnce(new Error('permission-denied'));
    renderMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: ADD_KID_LABEL }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Kid Profile' }));

    expect(await screen.findByTestId('save-error')).toHaveTextContent('permission-denied');
  });
});
