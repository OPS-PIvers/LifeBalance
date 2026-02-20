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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 p-8 space-y-6 transition-all duration-500">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-lg mb-6 ring-1 ring-white/20">
              <Home className="w-8 h-8 text-white/90" strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-2">
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
                className="w-full group bg-slate-900 text-white p-5 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all duration-300 shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)] flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                    <Plus size={20} />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-sm">Create New</div>
                    <div className="text-xs text-slate-400 font-medium">Start fresh</div>
                  </div>
                </div>
                <ArrowLeft size={16} className="rotate-180 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300" />
              </button>

              <button
                onClick={() => setMode('join')}
                className="w-full group bg-white text-slate-900 p-5 rounded-xl border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all duration-300 shadow-sm flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors text-slate-600">
                    <LogIn size={20} />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-sm">Join Existing</div>
                    <div className="text-xs text-slate-500 font-medium">Use invite code</div>
                  </div>
                </div>
                <ArrowLeft size={16} className="rotate-180 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300 text-slate-400" />
              </button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium text-sm transition-colors"
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
                  placeholder="e.g., The Smiths"
                  className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 transition-all placeholder:text-slate-400 text-slate-900"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || !householdName.trim()}
                className="w-full bg-slate-900 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Users size={18} />
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
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium text-sm transition-colors"
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
                  className="w-full px-4 py-3 bg-white/50 backdrop-blur-sm border border-slate-200/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 font-mono text-lg tracking-widest text-center uppercase placeholder:tracking-normal placeholder:text-slate-400 text-slate-900 transition-all"
                  maxLength={6}
                  required
                  disabled={loading}
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Enter the 6-character code from your admin
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                className="w-full bg-slate-900 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    <span>Joining...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    <span>Join Household</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-6">
              <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-xl p-6 text-center backdrop-blur-sm">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <p className="text-emerald-900 font-semibold tracking-tight">Household Created!</p>
                <p className="text-emerald-700/80 text-sm mt-1">
                  Invite family members to join
                </p>
              </div>

              <HouseholdInviteCard inviteCode={createdInviteCode} />

              <button
                onClick={handleContinue}
                className="w-full bg-slate-900 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-slate-800 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-slate-900/10"
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
