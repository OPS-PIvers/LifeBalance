import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { signOut } from 'firebase/auth';
import { auth } from '@/firebase.config';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Crown,
  LogOut,
  Loader2,
  User,
  Shield,
  Pencil,
  Trash2,
  Plus
} from 'lucide-react';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import MemberModal from '@/components/modals/MemberModal';
import PointsBreakdownModal from '@/components/modals/PointsBreakdownModal';
import { HouseholdMember } from '@/types/schema';
import toast from 'react-hot-toast';

const Settings: React.FC = () => {
  const { user, householdId } = useAuth();
  const { members, currentUser, dailyPoints, weeklyPoints, totalPoints, addMember, updateMember, removeMember, habits, householdSettings } = useHousehold();
  const navigate = useNavigate();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<HouseholdMember | null>(null);

  // Points Breakdown Modal
  const [activePointsView, setActivePointsView] = useState<'daily' | 'weekly' | 'total' | null>(null);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      toast.success('Signed out successfully');
      navigate('/login');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    }
  };

  if (!householdSettings) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center pb-24">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    );
  }

  const handleAddMember = () => {
    setSelectedMember(null);
    setIsModalOpen(true);
  };

  const handleEditMember = (member: HouseholdMember) => {
    setSelectedMember(member);
    setIsModalOpen(true);
  };

  const handleRemoveMember = async (member: HouseholdMember) => {
    if (!confirm(`Are you sure you want to remove ${member.displayName} from the household?`)) {
      return;
    }
    try {
      await removeMember(member.uid);
    } catch (error) {
      console.error('Error removing member:', error);
    }
  };

  const handleSaveMember = async (memberData: Partial<HouseholdMember>) => {
    try {
      if (selectedMember) {
        // Update existing
        await updateMember(selectedMember.uid, memberData);
      } else {
        // Add new
        await addMember(memberData);
      }
    } catch (error) {
      console.error('Error saving member:', error);
      throw error; // Let modal handle error state if needed
    }
  };

  return (
    <div className="min-h-screen bg-brand-50 pb-24 px-4 pt-6">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* User Profile Card */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-16 h-16 rounded-full"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-brand-200 flex items-center justify-center">
                <User className="w-8 h-8 text-brand-600" />
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold text-brand-800">
                {user?.displayName || 'User'}
              </h2>
              <p className="text-sm text-brand-500">{user?.email}</p>
              {currentUser && (
                <div className="flex items-center gap-2 mt-1">
                  {currentUser.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      <Crown size={12} />
                      Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full">
                      <Shield size={12} />
                      Member
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Household Info */}
        <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-brand-800">
                {householdSettings.name}
              </h3>
              <p className="text-sm text-brand-500">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>

          {/* Invite Code */}
          <HouseholdInviteCard inviteCode={householdSettings.inviteCode} />

            {/* Shared Household Points */}
            <div className="mt-4 p-4 bg-gradient-to-r from-brand-50 to-habit-blue-50 rounded-xl border border-brand-200">
              <h4 className="text-sm font-bold text-brand-700 mb-3">Shared Household Points</h4>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setActivePointsView('daily')}
                  className="text-center hover:bg-white/50 p-2 rounded-lg transition-colors active:scale-95"
                  aria-label="View daily points breakdown"
                >
                  <p className="text-xs text-brand-600 mb-1">Daily</p>
                  <p className="text-lg font-bold text-brand-800">{dailyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('weekly')}
                  className="text-center hover:bg-white/50 p-2 rounded-lg transition-colors active:scale-95"
                  aria-label="View weekly points breakdown"
                >
                  <p className="text-xs text-brand-600 mb-1">Weekly</p>
                  <p className="text-lg font-bold text-brand-800">{weeklyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('total')}
                  className="text-center hover:bg-white/50 p-2 rounded-lg transition-colors active:scale-95"
                  aria-label="View total points breakdown"
                >
                  <p className="text-xs text-brand-600 mb-1">Total</p>
                  <p className="text-lg font-bold text-brand-800">{totalPoints.toLocaleString()}</p>
                </button>
              </div>
            </div>
          </div>

        {/* Members List */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-brand-800">
              Household Members
            </h3>
            {currentUser?.role === 'admin' && (
              <button
                onClick={handleAddMember}
                className="p-2 bg-brand-100 text-brand-700 rounded-xl hover:bg-brand-200 transition-colors"
                title="Add Member"
              >
                <Plus size={20} />
              </button>
            )}
          </div>
          <div className="space-y-3">
            {members
              .sort((a, b) => {
                // Sort admins first
                if (a.role === 'admin' && b.role !== 'admin') return -1;
                if (a.role !== 'admin' && b.role === 'admin') return 1;
                return a.displayName.localeCompare(b.displayName);
              })
              .map((member) => (
                <div
                  key={member.uid}
                  className="flex items-center gap-3 p-3 rounded-xl bg-brand-50 border border-brand-100"
                >
                  {member.photoURL ? (
                    <img
                      src={member.photoURL}
                      alt={member.displayName}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-brand-200 flex items-center justify-center">
                      <User className="w-5 h-5 text-brand-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-brand-800 truncate">
                        {member.displayName}
                        {member.uid === user?.uid && (
                          <span className="text-brand-500 font-normal ml-1">(You)</span>
                        )}
                      </p>
                      {member.role === 'admin' && (
                        <Crown size={14} className="text-amber-600 flex-shrink-0" />
                      )}
                    </div>
                    {member.email && (
                      <p className="text-xs text-brand-500 truncate">{member.email}</p>
                    )}
                  </div>
                  {/* Admin Actions */}
                  {currentUser?.role === 'admin' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditMember(member)}
                        className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-100 rounded-lg transition-colors"
                        title="Edit Member"
                      >
                        <Pencil size={16} />
                      </button>
                      {member.uid !== currentUser.uid && (
                        <button
                          onClick={() => handleRemoveMember(member)}
                          className="p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove Member"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* Sign Out Button */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-700 font-semibold py-3 px-4 rounded-xl hover:bg-red-100 active:scale-95 transition-all duration-200 border-2 border-red-200"
          >
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>

      </div>

      <MemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveMember}
        initialMember={selectedMember}
        title={selectedMember ? 'Edit Member' : 'Add Member'}
      />

      {activePointsView && (
        <PointsBreakdownModal
          isOpen={!!activePointsView}
          onClose={() => setActivePointsView(null)}
          view={activePointsView}
          habits={habits}
        />
      )}
    </div>
  );
};

export default Settings;
