/* eslint-disable */
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
    } catch (error: any) {
      console.error('Error creating household:', error);
      toast.error(error.message || 'Failed to create household');
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
    } catch (error: any) {
      console.error('Error joining household:', error);
      toast.error(error.message || 'Failed to join household');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-100 via-brand-50 to-money-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4">
              <Home className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-brand-800 mb-2">
              {mode === 'success' ? 'All Set!' : 'Set Up Your Household'}
            </h1>
            <p className="text-brand-500 text-sm">
              {mode === 'success'
                ? 'Your household is ready to use'
                : 'Create a new household or join an existing one'}
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
                className="w-full bg-white border-2 border-brand-200 text-brand-800 font-semibold py-4 px-6 rounded-xl hover:bg-brand-50 hover:border-brand-300 active:scale-95 transition-all duration-200 flex items-center justify-center gap-3"
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
                className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium text-sm"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 mb-2">
                  Household Name
                </label>
                <input
                  type="text"
                  value={householdName}
                  onChange={(e) => setHouseholdName(e.target.value)}
                  placeholder="e.g., Smith Family"
                  className="w-full px-4 py-3 border-2 border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
                className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium text-sm"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-semibold text-brand-700 mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full px-4 py-3 border-2 border-brand-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono text-lg tracking-wider text-center uppercase"
                  maxLength={6}
                  required
                  disabled={loading}
                />
                <p className="text-xs text-brand-500 mt-2">
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

          {/* Success View */}
          {mode === 'success' && createdInviteCode && (
            <div className="space-y-4">
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <p className="text-green-800 font-semibold">Household Created!</p>
                <p className="text-green-600 text-sm mt-1">
                  Invite family members to join
                </p>
              </div>

              <HouseholdInviteCard inviteCode={createdInviteCode} />

              <button
                onClick={handleContinue}
                className="w-full bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-brand-700 active:scale-95 transition-all duration-200"
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
