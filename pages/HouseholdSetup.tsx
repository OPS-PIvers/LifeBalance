import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, Users, Plus, LogIn, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold } from '@/services/householdService';
import { parseInviteCode } from '@/utils/inviteLink';
import toast from 'react-hot-toast';

type ViewMode = 'choice' | 'create' | 'join';

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
    if (!user || !householdName.trim()) return;

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
    if (!user || !inviteCode.trim()) return;

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
    <div className="min-h-screen bg-linear-to-br from-brand-100 via-brand-50 to-money-50 dark:from-brand-900 dark:via-brand-900 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-brand-800 dark:text-slate-100 mb-2">
              Set Up Your Household
            </h1>
            <p className="text-brand-500 dark:text-slate-400 text-sm">
              Create a new household or join an existing one
            </p>
          </div>

          {/* Choice View */}
          {mode === 'choice' && (
            <div className="space-y-3">
              <button
                onClick={() => setMode('create')}
                className="w-full bg-brand-600 text-white font-semibold py-4 px-6 rounded-xl hover:bg-brand-700 active:scale-95 transition-all duration-200 flex items-center justify-center gap-3"
              >
                <Plus size={20} />
                <span>Create New Household</span>
              </button>

              <button
                onClick={() => setMode('join')}
                className="w-full bg-white dark:bg-slate-800 border-2 border-brand-200 dark:border-slate-700 text-brand-800 dark:text-slate-100 font-semibold py-4 px-6 rounded-xl hover:bg-brand-50 dark:hover:bg-slate-700/50 hover:border-brand-300 dark:hover:border-slate-600 active:scale-95 transition-all duration-200 flex items-center justify-center gap-3"
              >
                <LogIn size={20} />
                <span>Join Existing Household</span>
              </button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-4">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-brand-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-slate-200 font-medium text-sm"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 dark:text-slate-200 mb-2">
                  Household Name
                </label>
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="e.g., Smith Family"
                  className="w-full px-4 py-3 border-2 border-brand-200 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !householdName.trim()}
                className="w-full bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-brand-700 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Users size={20} />
                    <span>Create Household</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Join View */}
          {mode === 'join' && (
            <form onSubmit={handleJoinHousehold} className="space-y-4">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-brand-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-slate-200 font-medium text-sm"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 dark:text-slate-200 mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full px-4 py-3 border-2 border-brand-200 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:placeholder:text-slate-500 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-lg tracking-wider text-center uppercase"
                  maxLength={6}
                  required
                  disabled={loading}
                />
                <p className="text-xs text-brand-500 dark:text-slate-400 mt-2">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                className="w-full bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-brand-700 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Joining...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={20} />
                    <span>Join Household</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default HouseholdSetup;
