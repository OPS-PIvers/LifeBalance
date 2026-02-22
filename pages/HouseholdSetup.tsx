import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, Plus, LogIn, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold, getHouseholdDetails } from '@/services/householdService';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/80 backdrop-blur-xl ring-1 ring-black/5 shadow-glass rounded-2xl p-8 space-y-8 transition-all duration-500 hover:shadow-2xl">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-800 rounded-2xl shadow-lg ring-1 ring-white/20 mb-2">
              <Home className="w-8 h-8 text-white/90" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
                {mode === 'success' ? 'All Set!' : 'Set Up Your Household'}
              </h1>
              <p className="text-slate-500 text-sm leading-relaxed">
                {mode === 'success'
                  ? 'Your household is ready to use'
                  : 'Create a new household or join an existing one'}
              </p>
            </div>
          </div>

          {/* Choice View */}
          {mode === 'choice' && (
            <div className="space-y-4">
              <Button
                onClick={() => setMode('create')}
                variant="primary"
                size="lg"
                className="w-full h-16 text-base shadow-lg hover:shadow-xl transition-all duration-300 justify-between px-6 group"
                rightIcon={<Plus className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" />}
              >
                Create New Household
              </Button>

              <Button
                onClick={() => setMode('join')}
                variant="secondary"
                size="lg"
                className="w-full h-16 text-base border-slate-200/60 shadow-sm hover:border-slate-300 hover:bg-slate-50 justify-between px-6 group"
                rightIcon={<LogIn className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />}
              >
                Join Existing Household
              </Button>
            </div>
          )}

          {/* Create View */}
          {mode === 'create' && (
            <form onSubmit={handleCreateHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium text-sm transition-colors group"
              >
                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
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
                variant="primary"
                size="lg"
                className="w-full shadow-md mt-2"
                isLoading={loading}
                leftIcon={!loading && <Users size={20} />}
              >
                {loading ? 'Creating...' : 'Create Household'}
              </Button>
            </form>
          )}

          {/* Join View */}
          {mode === 'join' && (
            <form onSubmit={handleJoinHousehold} className="space-y-6">
              <button
                type="button"
                onClick={() => setMode('choice')}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium text-sm transition-colors group"
              >
                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                <span>Back</span>
              </button>

              <div>
                <Input
                  label="Invite Code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={6}
                  required
                  disabled={loading}
                  className="font-mono text-lg tracking-widest text-center uppercase"
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-2 text-center">
                  Enter the 6-character code shared by your household admin
                </p>
              </div>

              <Button
                type="submit"
                disabled={loading || inviteCode.length !== 6}
                variant="primary"
                size="lg"
                className="w-full shadow-md mt-2"
                isLoading={loading}
                leftIcon={!loading && <LogIn size={20} />}
              >
                {loading ? 'Joining...' : 'Join Household'}
              </Button>
            </form>
          )}

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-6">
              <div className="bg-emerald-50/50 border border-emerald-100 ring-1 ring-emerald-500/10 rounded-xl p-6 text-center backdrop-blur-sm">
                <div className="w-12 h-12 bg-emerald-500 shadow-md shadow-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 ring-4 ring-emerald-50">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-emerald-900 font-semibold tracking-tight">Household Created!</h3>
                <p className="text-emerald-600/80 text-sm mt-1 leading-relaxed">
                  Invite family members to join
                </p>
              </div>

              <HouseholdInviteCard inviteCode={createdInviteCode} />

              <Button
                onClick={handleContinue}
                variant="primary"
                size="lg"
                className="w-full shadow-lg hover:shadow-xl transition-all"
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
