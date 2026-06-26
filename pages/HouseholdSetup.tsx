import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, Users, Plus, LogIn, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold } from '@/services/householdService';
import { parseInviteCode } from '@/utils/inviteLink';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

type ViewMode = 'choice' | 'create' | 'join';

interface ConsentCheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * Required legal-consent checkbox (Plan 011). Links open the public legal pages
 * in a new tab (HashRouter-correct hrefs) so the half-filled setup form is not
 * lost. Rendered above each submit button in both the create and join forms.
 */
const ConsentCheckbox: React.FC<ConsentCheckboxProps> = ({ id, checked, onChange, disabled }) => (
  <div className="flex items-start gap-3">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-brand-300 dark:border-brand-600 text-accent-600 focus:ring-2 focus:ring-accent-500/40 disabled:opacity-50"
    />
    <label htmlFor={id} className="text-xs text-brand-600 dark:text-brand-300 leading-relaxed">
      I agree to the{' '}
      <a
        href="#/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-700 dark:text-accent-300 underline hover:text-accent-800 dark:hover:text-accent-200"
      >
        Terms of Service
      </a>{' '}
      and{' '}
      <a
        href="#/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-700 dark:text-accent-300 underline hover:text-accent-800 dark:hover:text-accent-200"
      >
        Privacy Policy
      </a>
      .
    </label>
  </div>
);

const HouseholdSetup: React.FC = () => {
  const { user, householdId, loading: authLoading, setHouseholdId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Deep-link support: if arriving via a shared invite link (?invite=CODE),
  // pre-fill the code and open the join view straight away. Derived once at
  // mount from the URL (which HashRouter has available on first render) so we
  // avoid a setState-in-effect cascade. We intentionally do NOT auto-submit —
  // the user still confirms by clicking Join.
  const initialInviteCode = parseInviteCode(searchParams.toString());

  const [mode, setMode] = useState<ViewMode>(initialInviteCode ? 'join' : 'choice');
  const [loading, setLoading] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? '');
  // Required legal consent (Plan 011). One flag serves both forms since only one
  // renders at a time. Captured at signup and persisted on the member doc.
  const [consentChecked, setConsentChecked] = useState(false);

  // Set just before a create/join handler navigates the user onward. Without it,
  // the "already has household" redirect below would fire on the next render
  // (setHouseholdId updates householdId synchronously) and bounce a brand-new
  // creator from /onboarding to /. The handler picks the destination explicitly.
  const navigatingAwayRef = useRef(false);

  // Redirect if already has household (e.g. an existing user navigates to /setup
  // directly). Skipped while a create/join handler is steering the user itself.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    } else if (!authLoading && householdId && !navigatingAwayRef.current) {
      navigate('/');
    }
  }, [user, householdId, authLoading, navigate]);

  const handleCreateHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !householdName.trim() || !consentChecked) return;

    setLoading(true);
    try {
      const householdId = await createHousehold(user.uid, householdName.trim());
      // Claim the navigation before householdId propagates so the redirect effect
      // doesn't race us to '/'.
      navigatingAwayRef.current = true;
      setHouseholdId(householdId);
      toast.success('Household created successfully!');
      // Route new creators into the first-run onboarding wizard (which seeds a
      // starting balance + habits and surfaces the invite code). The join flow
      // below goes straight to the dashboard instead.
      navigate('/onboarding');
    } catch (error: unknown) {
      console.error('Error creating household:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create household';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !inviteCode.trim() || !consentChecked) return;

    setLoading(true);
    try {
      const householdId = await joinHousehold(user.uid, inviteCode.trim().toUpperCase());
      navigatingAwayRef.current = true;
      setHouseholdId(householdId);
      toast.success('Successfully joined household!');
      navigate('/');
    } catch (error: unknown) {
      console.error('Error joining household:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to join household';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-brand-800 rounded-lg border border-brand-200 dark:border-brand-700 shadow-raised p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-600 dark:bg-accent-500 rounded-2xl mb-4">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-800 dark:text-brand-100 mb-2">
              Set up your household
            </h1>
            <p className="text-brand-500 dark:text-brand-400 text-sm">
              Create a new household or join an existing one
            </p>
          </div>

          {/* Choice View */}
          {mode === 'choice' && (
            <div className="space-y-3">
              <Button
                size="lg"
                className="w-full"
                leftIcon={<Plus size={20} />}
                onClick={() => setMode('create')}
              >
                Create new household
              </Button>

              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                leftIcon={<LogIn size={20} />}
                onClick={() => setMode('join')}
              >
                Join existing household
              </Button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-4">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-brand-500 dark:text-brand-400 hover:text-accent-600 dark:hover:text-accent-300 font-medium text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard)"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 dark:text-brand-200 mb-2">
                  Household name
                </label>
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="e.g., Smith Family"
                  className="w-full px-4 py-3 bg-white border border-brand-200 dark:border-brand-700 dark:bg-brand-900/40 text-brand-800 dark:text-brand-100 placeholder:text-brand-400 dark:placeholder:text-brand-500 rounded-card focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-400"
                  required
                  disabled={loading}
                />
              </div>

              <ConsentCheckbox
                id="consent-create"
                checked={consentChecked}
                onChange={setConsentChecked}
                disabled={loading}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading || !householdName.trim() || !consentChecked}
                isLoading={loading}
                leftIcon={<Users size={20} />}
              >
                {loading ? 'Creating…' : 'Create household'}
              </Button>
            </form>
          )}

          {/* Join View */}
          {mode === 'join' && (
            <form onSubmit={handleJoinHousehold} className="space-y-4">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-brand-500 dark:text-brand-400 hover:text-accent-600 dark:hover:text-accent-300 font-medium text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard)"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 dark:text-brand-200 mb-2">
                  Invite code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full px-4 py-3 bg-white border border-brand-200 dark:border-brand-700 dark:bg-brand-900/40 text-brand-800 dark:text-brand-100 placeholder:text-brand-400 dark:placeholder:text-brand-500 rounded-card focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-400 font-mono text-lg tracking-wider text-center uppercase"
                  maxLength={6}
                  required
                  disabled={loading}
                />
                <p className="text-xs text-brand-500 dark:text-brand-400 mt-2">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <ConsentCheckbox
                id="consent-join"
                checked={consentChecked}
                onChange={setConsentChecked}
                disabled={loading}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading || inviteCode.length !== 6 || !consentChecked}
                isLoading={loading}
                leftIcon={<LogIn size={20} />}
              >
                {loading ? 'Joining…' : 'Join household'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default HouseholdSetup;
