import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, Plus, LogIn, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold, getHouseholdDetails } from '@/services/householdService';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import toast from 'react-hot-toast';

type ViewMode = 'choice' | 'create' | 'join' | 'success';

const HouseholdSetup: React.FC = () => {
  const [mode, setMode] = useState<ViewMode>('choice');
  const [loading, setLoading] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createdInviteCode, setCreatedInviteCode] = useState('');
  const { user, householdId, loading: authLoading, setHouseholdId } = useAuth();
  const navigate = useNavigate();

  // Redirect if already has household
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login');
    } else if (!authLoading && householdId) {
      navigate('/');
    }
  }, [user, householdId, authLoading, navigate]);

  const handleCreateHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !householdName.trim()) return;

    setLoading(true);
    try {
      const householdId = await createHousehold(user.uid, householdName.trim());
      setHouseholdId(householdId);

      // Get the invite code we just created
      const details = await getHouseholdDetails(householdId);
      if (details) {
        setCreatedInviteCode(details.inviteCode);
      }

      setMode('success');
      toast.success('Household created successfully!');
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

  const handleContinue = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-3xl mix-blend-multiply opacity-70 animate-blob" />
        <div className="absolute top-[20%] -right-[10%] w-[60%] h-[60%] bg-indigo-100/40 rounded-full blur-3xl mix-blend-multiply opacity-70 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-[10%] left-[20%] w-[40%] h-[40%] bg-slate-200/40 rounded-full blur-3xl mix-blend-multiply opacity-70 animate-blob animation-delay-4000" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl p-8 space-y-8">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-900 rounded-2xl mb-6 shadow-[0_8px_16px_rgb(15,23,42,0.2)] ring-1 ring-white/20">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
              {mode === 'success' ? 'All Set!' : 'Set Up Your Household'}
            </h1>
            <p className="text-slate-500 text-sm leading-relaxed">
              {mode === 'success'
                ? 'Your household is ready to use'
                : 'Create a new household or join an existing one'}
            </p>
          </div>

          {/* Choice View */}
          {mode === 'choice' && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('create')}
                className="w-full bg-slate-900 text-white font-semibold py-4 px-6 rounded-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:shadow-lg hover:shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3 group"
              >
                <Plus size={20} className="text-slate-300 group-hover:text-white transition-colors" />
                <span>Create New Household</span>
              </button>

              <button
                onClick={() => setMode('join')}
                className="w-full bg-white/50 border border-slate-200/60 backdrop-blur-sm text-slate-700 font-semibold py-4 px-6 rounded-2xl shadow-sm hover:bg-white/80 hover:text-slate-900 hover:shadow-md active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3"
              >
                <LogIn size={20} />
                <span>Join Existing Household</span>
              </button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-medium text-sm transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 ml-1">
                  Household Name
                </label>
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="e.g., Smith Family"
                  className="w-full px-4 py-3 bg-white/50 border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-300 transition-all duration-200 placeholder:text-slate-400"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !householdName.trim()}
                className="w-full bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:shadow-lg hover:shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Users size={20} className="text-slate-300" />
                    <span>Create Household</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Join View */}
          {mode === 'join' && (
            <form onSubmit={handleJoinHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-medium text-sm transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2 ml-1">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full px-4 py-3 bg-white/50 border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-300 font-mono text-lg tracking-wider text-center uppercase placeholder:text-slate-300 transition-all duration-200"
                  maxLength={6}
                  required
                  disabled={loading}
                />
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                className="w-full bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:shadow-lg hover:shadow-slate-900/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    <span>Joining...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={20} className="text-slate-300" />
                    <span>Join Household</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-6">
              <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-6 text-center backdrop-blur-sm">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/20 ring-4 ring-emerald-500/10">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <p className="text-emerald-900 font-semibold tracking-tight">Household Created!</p>
                <p className="text-emerald-600/80 text-sm mt-1">
                  Invite family members to join
                </p>
              </div>

              <HouseholdInviteCard inviteCode={createdInviteCode} />

              <button
                onClick={handleContinue}
                className="w-full bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:shadow-lg hover:shadow-slate-900/20 active:scale-[0.98] transition-all duration-200"
              >
                Continue to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HouseholdSetup;
