import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, Plus, LogIn, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold, getHouseholdDetails } from '@/services/householdService';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white shadow-sm border border-slate-100 rounded-2xl mb-4">
              <Home className="w-8 h-8 text-brand-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
              {mode === 'success' ? 'All Set!' : 'Set Up Your Household'}
            </h1>
            <p className="text-slate-500 text-sm font-medium">
              {mode === 'success'
                ? 'Your household is ready to use'
                : 'Create a new household or join an existing one'}
            </p>
          </div>

          {/* Choice View */}
          {mode === 'choice' && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode('create')}
                className="flex flex-col items-center justify-center p-6 bg-white/50 border border-slate-200/60 rounded-2xl hover:bg-white hover:border-brand-200 hover:shadow-md transition-all group ring-1 ring-black/5"
              >
                <div className="bg-indigo-50 text-indigo-600 p-4 rounded-2xl mb-3 group-hover:scale-110 transition-transform shadow-sm">
                  <Plus size={24} />
                </div>
                <span className="text-slate-900 font-bold tracking-tight text-sm">Create New</span>
              </button>

              <button
                onClick={() => setMode('join')}
                className="flex flex-col items-center justify-center p-6 bg-white/50 border border-slate-200/60 rounded-2xl hover:bg-white hover:border-brand-200 hover:shadow-md transition-all group ring-1 ring-black/5"
              >
                <div className="bg-violet-50 text-violet-600 p-4 rounded-2xl mb-3 group-hover:scale-110 transition-transform shadow-sm">
                  <LogIn size={24} />
                </div>
                <span className="text-slate-900 font-bold tracking-tight text-sm">Join Existing</span>
              </button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <Input
                label="Household Name"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="e.g., Smith Family"
                required
                disabled={loading}
                autoFocus
              />

              <Button
                type="submit"
                disabled={loading || !householdName.trim()}
                isLoading={loading}
                className="w-full py-6"
                leftIcon={!loading && <Users size={20} />}
              >
                Create Household
              </Button>
            </form>
          )}

          {/* Join View */}
          {mode === 'join' && (
            <form onSubmit={handleJoinHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div className="space-y-2">
                <Input
                  label="Invite Code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={6}
                  required
                  disabled={loading}
                  className="font-mono text-lg tracking-wider text-center uppercase"
                  autoFocus
                />
                <p className="text-xs text-slate-500 text-center font-medium">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <Button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                isLoading={loading}
                className="w-full py-6"
                leftIcon={!loading && <LogIn size={20} />}
              >
                Join Household
              </Button>
            </form>
          )}

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-6">
              <div className="bg-emerald-50/50 border border-emerald-100/50 rounded-2xl p-6 text-center shadow-sm">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <p className="text-emerald-900 font-bold text-lg">Household Created!</p>
                <p className="text-emerald-600/80 text-sm mt-1 font-medium">
                  Invite family members to join
                </p>
              </div>

              <HouseholdInviteCard inviteCode={createdInviteCode} />

              <Button
                onClick={handleContinue}
                className="w-full py-6 shadow-lg shadow-brand-500/20"
              >
                Continue to Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HouseholdSetup;
