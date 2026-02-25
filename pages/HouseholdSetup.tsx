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
      {/* Sophisticated Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 opacity-80" />

      {/* Decorative Blur Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-100/30 rounded-full blur-3xl" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-100/30 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] rounded-3xl p-8 md:p-10 space-y-8">
          {/* Header */}
          <div className="text-center flex flex-col items-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-6 shadow-lg shadow-indigo-600/30 ring-1 ring-white/20">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">
              {mode === 'success' ? 'All Set!' : 'Set Up Your Household'}
            </h1>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
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
                className="w-full bg-indigo-600 text-white font-semibold py-4 px-6 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3 shadow-lg shadow-indigo-500/20 group"
              >
                <Plus size={20} className="group-hover:scale-110 transition-transform" />
                <span>Create New Household</span>
              </button>

              <button
                onClick={() => setMode('join')}
                className="w-full bg-white border border-slate-200/60 text-slate-700 font-semibold py-4 px-6 rounded-xl hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3 shadow-sm"
              >
                <LogIn size={20} className="text-slate-400 group-hover:text-slate-600" />
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
                className="flex items-center gap-2 text-slate-400 hover:text-slate-600 font-medium text-sm transition-colors -ml-1"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">
                  Household Name
                </label>
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="e.g., Smith Family"
                  className="w-full px-4 py-3.5 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || !householdName.trim()}
                className="w-full bg-indigo-600 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shadow-lg shadow-indigo-500/20"
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
            <form onSubmit={handleJoinHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-600 font-medium text-sm transition-colors -ml-1"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full px-4 py-3.5 bg-slate-50/50 border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-mono text-lg tracking-wider text-center uppercase text-slate-900 placeholder:text-slate-400"
                  maxLength={6}
                  required
                  disabled={loading}
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-2 text-center">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                className="w-full bg-indigo-600 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shadow-lg shadow-indigo-500/20"
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

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-6">
              <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-6 text-center shadow-sm">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/20 text-white">
                  <Users className="w-6 h-6" />
                </div>
                <p className="text-emerald-900 font-semibold tracking-tight">Household Created!</p>
                <p className="text-emerald-600/80 text-sm mt-1">
                  Invite family members to join
                </p>
              </div>

              <div className="relative">
                <HouseholdInviteCard inviteCode={createdInviteCode} />
              </div>

              <button
                onClick={handleContinue}
                className="w-full bg-indigo-600 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-indigo-700 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-indigo-500/20"
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
