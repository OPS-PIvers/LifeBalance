import React, { useState } from 'react';
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
  Plus,
  Bell,
  Download,
  FileJson,
  FileSpreadsheet,
  Smartphone,
  Terminal
} from 'lucide-react';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import MemberModal from '@/components/modals/MemberModal';
import PointsBreakdownModal from '@/components/modals/PointsBreakdownModal';
import NotificationSettings from '@/components/settings/NotificationSettings';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import ApiKeyManager from '@/components/settings/ApiKeyManager';
import ShortcutSetupGuide from '@/components/settings/ShortcutSetupGuide';
import Card from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { requestNotificationPermission, setupForegroundNotificationListener } from '@/services/notificationService';
import { generateJsonBackup, generateCsvExport } from '@/utils/exportUtils';
import { HouseholdMember, NotificationPreferences, Transaction } from '@/types/schema';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import DeveloperConsole from '@/components/modals/DeveloperConsole';

const APP_VERSION = '0.8.0-alpha';

const Settings: React.FC = () => {
  const { user, householdId } = useAuth();
  const {
    members,
    currentUser,
    dailyPoints,
    weeklyPoints,
    totalPoints,
    addMember,
    updateMember,
    removeMember,
    habits,
    householdSettings,
    transactions,
    buckets,
    meals,
    shoppingList,
    calendarItems,
    apiKeys,
    hasMoreTransactions,
    isLoadingOlderTransactions,
    loadAllTransactions
  } = useHousehold();
  const navigate = useNavigate();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDevConsoleOpen, setIsDevConsoleOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<HouseholdMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<HouseholdMember | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);

  // Points Breakdown Modal
  const [activePointsView, setActivePointsView] = useState<'daily' | 'weekly' | 'total' | null>(null);

  const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID;

  // Section State
  const [openSection, setOpenSection] = useState<string | null>('profile');

  const handleToggleSection = (id: string) => {
    setOpenSection(prev => prev === id ? null : id);
  };

  // Notification State
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'default'
  );

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

  const handleAddMember = () => {
    setSelectedMember(null);
    setIsModalOpen(true);
  };

  const handleEditMember = (member: HouseholdMember) => {
    setSelectedMember(member);
    setIsModalOpen(true);
  };

  const handleRemoveMember = (member: HouseholdMember) => {
    setMemberToRemove(member);
  };

  const handleConfirmRemoveMember = async () => {
    if (!memberToRemove) return;
    setIsRemovingMember(true);
    try {
      await removeMember(memberToRemove.uid);
      setMemberToRemove(null);
    } catch (error) {
      console.error('Error removing member:', error);
    } finally {
      setIsRemovingMember(false);
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

  const handleEnableNotifications = async () => {
    if (!householdId || !user) return;
    const success = await requestNotificationPermission(householdId, user.uid);
    if (success) {
      setNotificationStatus('granted');
      // Set up foreground listener to show in-app notifications when app is open
      // Background notifications on iOS 16.4+ are handled by the service worker
      setupForegroundNotificationListener();
    } else if ('Notification' in window) {
      // Always reflect the actual browser permission state on failure
      setNotificationStatus(Notification.permission);
    }
  };

  const handleSaveNotificationPreferences = async (preferences: NotificationPreferences) => {
    if (!householdId || !user) {
      throw new Error('Missing household or user information');
    }

    try {
      const memberRef = doc(db, 'households', householdId, 'members', user.uid);

      await updateDoc(memberRef, {
        notificationPreferences: preferences
      });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      throw error;
    }
  };

  const doExportJson = (txList: Transaction[]) => {
    try {
      // Filter out sensitive data from members
      const safeMembers = members.map(m => {
        // Destructure to remove sensitive fields
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fcmTokens, email, telegramChatId, ...safeMember } = m;
        return safeMember;
      });

      const exportData = {
        meta: {
          exportedAt: new Date().toISOString(),
          householdId,
          exportedBy: user?.uid
        },
        household: householdSettings,
        members: safeMembers,
        habits,
        transactions: txList,
        buckets,
        calendarItems,
        meals,
        shoppingList
      };

      generateJsonBackup(exportData);
      toast.success('Backup downloaded successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to generate backup');
    }
  };

  const doExportCsv = (txList: Transaction[]) => {
    try {
      if (txList.length === 0) {
        toast.error('No transactions to export');
        return;
      }

      // Flatten transactions for CSV
      // Note: Only exporting core fields to keep CSV simple.
      // Power users can use JSON export for full data including isRecurring, autoCategorized, etc.
      const flatTransactions = txList.map(tx => ({
        Date: tx.date,
        Merchant: tx.merchant,
        Amount: tx.amount,
        Category: tx.category,
        Status: tx.status,
        Source: tx.source,
        'Pay Period': tx.payPeriodId || 'N/A'
      }));

      generateCsvExport(flatTransactions, 'transactions');
      toast.success('Transactions CSV downloaded');
    } catch (error) {
      console.error('CSV Export failed:', error);
      toast.error('Failed to generate CSV');
    }
  };

  // Exports must include the FULL transaction history, but the household context
  // only keeps the recent window live. Pull every older transaction first (a
  // no-op when nothing is windowed), then export the complete list it returns.
  const requestExport = async (kind: 'json' | 'csv') => {
    let txList = transactions;
    if (hasMoreTransactions) {
      toast.loading('Loading full transaction history…', { id: 'export-load' });
      txList = await loadAllTransactions();
      toast.dismiss('export-load');
    }
    if (kind === 'json') doExportJson(txList);
    else doExportCsv(txList);
  };

  if (!householdSettings) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-brand-900 flex items-center justify-center pb-24">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-brand-900 pb-24 px-4 pt-6">
      <div className="max-w-2xl mx-auto space-y-6">

        {isGlobalAdmin && (
          <Card className="overflow-hidden border border-indigo-200/50 shadow-indigo-100/50">
            <button
              onClick={() => setIsDevConsoleOpen(true)}
              className="w-full flex items-center justify-between p-4 bg-indigo-50/50 hover:bg-indigo-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Terminal className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-indigo-900 tracking-tight">Developer Console</h3>
              </div>
              <span className="text-xs font-bold text-indigo-600 bg-white px-2 py-1 rounded border border-indigo-200 group-hover:border-indigo-300 shadow-sm">
                ADMIN
              </span>
            </button>
          </Card>
        )}

        <CollapsibleCard
          id="profile"
          title="Profile & Preferences"
          icon={<User className="w-5 h-5" />}
          isOpen={openSection === 'profile'}
          onToggle={() => handleToggleSection('profile')}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl"
          contentClassName="space-y-6"
        >
          {/* User Profile Card */}
          <div>
            <div className="flex items-center gap-5">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-16 h-16 rounded-full shadow-sm ring-2 ring-white"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center shadow-inner">
                  <User className="w-8 h-8 text-slate-400" />
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  {user?.displayName || 'User'}
                </h2>
                <p className="text-sm text-slate-500 font-medium">{user?.email}</p>
                {currentUser && (
                  <div className="flex items-center gap-2 mt-2">
                    {currentUser.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-0.5 rounded-full shadow-sm">
                        <Crown size={12} />
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-0.5 rounded-full shadow-sm">
                        <Shield size={12} />
                        Member
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Appearance / Theme */}
            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-tight">Appearance</h4>
              <ThemeToggle />
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={handleEnableNotifications}
                disabled={notificationStatus === 'granted' || notificationStatus === 'denied'}
                className="w-full flex items-center justify-between p-3.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group disabled:opacity-70 disabled:cursor-not-allowed border border-transparent hover:border-slate-200"
                aria-label={
                  notificationStatus === 'granted'
                    ? 'Push notifications enabled'
                    : notificationStatus === 'denied'
                    ? 'Push notifications denied by browser'
                    : 'Enable push notifications'
                }
                aria-describedby={notificationStatus === 'denied' ? 'notification-denied-help' : undefined}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shadow-sm ${
                    notificationStatus === 'granted' ? 'bg-green-100 text-green-600' : 'bg-white text-slate-400 group-hover:text-brand-500'
                  }`}>
                    <Bell size={18} />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-slate-900 text-sm tracking-tight">Push Notifications</p>
                    <p className="text-xs text-slate-500">
                      {notificationStatus === 'granted' ? 'Notifications enabled' :
                       notificationStatus === 'denied' ? 'Notifications denied in browser' :
                       'Enable alerts on this device'}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm ${
                  notificationStatus === 'granted' ? 'text-green-700 bg-green-100 border border-green-200' :
                  notificationStatus === 'denied' ? 'text-rose-700 bg-rose-100 border border-rose-200' :
                  'text-brand-600 bg-white border border-brand-200'
                }`}>
                  {notificationStatus === 'granted' ? 'Enabled' :
                   notificationStatus === 'denied' ? 'Denied' : 'Enable'}
                </span>
              </button>
              {notificationStatus === 'denied' && (
                <p id="notification-denied-help" className="sr-only">
                  Notifications have been denied by your browser. To enable them, please update your browser settings to allow notifications for this site.
                </p>
              )}
            </div>
          </div>

          {/* Notification Settings - Only show if notifications are granted */}
          {notificationStatus === 'granted' && householdId && user && (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h4 className="text-sm font-bold text-slate-900 mb-4 tracking-tight">Notification Preferences</h4>
              <NotificationSettings
                householdId={householdId}
                currentPreferences={currentUser?.notificationPreferences}
                onSave={handleSaveNotificationPreferences}
              />
            </div>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          id="household"
          title="Household"
          icon={<Users className="w-5 h-5" />}
          isOpen={openSection === 'household'}
          onToggle={() => handleToggleSection('household')}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl"
          contentClassName="space-y-6"
        >
          {/* Household Info */}
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center shadow-inner">
                <Users className="w-7 h-7 text-slate-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                  {householdSettings.name}
                </h3>
                <p className="text-sm text-slate-500 font-medium">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </p>
              </div>
            </div>

            {/* Invite Code */}
            <HouseholdInviteCard inviteCode={householdSettings.inviteCode} />

            {/* Shared Household Points */}
            <div className="p-5 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-2xl border border-slate-200/60 shadow-sm">
              <h4 className="text-sm font-bold text-slate-700 mb-4 tracking-tight">Shared Household Points</h4>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setActivePointsView('daily')}
                  className="text-center hover:bg-white/80 p-3 rounded-xl transition-all active:scale-[0.98] group"
                  aria-label="View daily points breakdown"
                >
                  <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider group-hover:text-brand-600">Daily</p>
                  <p className="text-xl font-bold text-slate-900 group-hover:text-brand-700">{dailyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('weekly')}
                  className="text-center hover:bg-white/80 p-3 rounded-xl transition-all active:scale-[0.98] group"
                  aria-label="View weekly points breakdown"
                >
                  <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider group-hover:text-brand-600">Weekly</p>
                  <p className="text-xl font-bold text-slate-900 group-hover:text-brand-700">{weeklyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('total')}
                  className="text-center hover:bg-white/80 p-3 rounded-xl transition-all active:scale-[0.98] group"
                  aria-label="View total points breakdown"
                >
                  <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider group-hover:text-brand-600">Total</p>
                  <p className="text-xl font-bold text-slate-900 group-hover:text-brand-700">{totalPoints.toLocaleString()}</p>
                </button>
              </div>
            </div>
          </div>

          {/* Members List */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                Household Members
              </h3>
              {currentUser?.role === 'admin' && (
                <Button
                  onClick={handleAddMember}
                  variant="subtle"
                  size="icon-sm"
                  title="Add Member"
                  aria-label="Add Member"
                  className="rounded-full"
                >
                  <Plus size={18} />
                </Button>
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
                    className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200/60 shadow-sm hover:shadow-md transition-shadow"
                  >
                    {member.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt={member.displayName}
                        className="w-10 h-10 rounded-full ring-2 ring-slate-50"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 truncate tracking-tight">
                          {member.displayName}
                          {member.uid === user?.uid && (
                            <span className="text-slate-400 font-normal ml-1 text-sm">(You)</span>
                          )}
                        </p>
                        {member.role === 'admin' && (
                          <Crown size={14} className="text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      {member.email && (
                        <p className="text-xs text-slate-500 truncate font-medium">{member.email}</p>
                      )}
                    </div>
                    {/* Admin Actions */}
                    {currentUser?.role === 'admin' && (
                      <div className="flex items-center gap-1">
                        <Button
                          onClick={() => handleEditMember(member)}
                          variant="ghost"
                          size="icon"
                          title="Edit Member"
                          aria-label="Edit Member"
                        >
                          <Pencil size={16} />
                        </Button>
                        {member.uid !== currentUser.uid && (
                          <Button
                            onClick={() => handleRemoveMember(member)}
                            variant="ghost-danger"
                            size="icon"
                            title="Remove Member"
                            aria-label="Remove Member"
                          >
                            <Trash2 size={16} />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </CollapsibleCard>

        <CollapsibleCard
          id="data"
          title="Data Management"
          icon={<Download className="w-5 h-5" />}
          isOpen={openSection === 'data'}
          onToggle={() => handleToggleSection('data')}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl"
          contentClassName="space-y-6"
        >
          {/* Data Management */}
          <div>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center shadow-sm">
                <Download className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  Data Management
                </h3>
                <p className="text-sm text-slate-500 font-medium">
                  Export your household data
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => requestExport('json')}
                disabled={isLoadingOlderTransactions}
                className="w-full flex items-center justify-between p-4 bg-slate-50/50 rounded-xl hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 transition-all group disabled:opacity-60"
                aria-label="Export full household data backup as JSON file"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <FileJson size={18} className="text-brand-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-slate-900 text-sm tracking-tight">Export Full Backup</p>
                    <p className="text-xs text-slate-500">Download all data as JSON</p>
                  </div>
                </div>
                <Download size={16} className="text-slate-400 group-hover:text-brand-600 transition-colors" />
              </button>

              <button
                onClick={() => requestExport('csv')}
                disabled={isLoadingOlderTransactions}
                className="w-full flex items-center justify-between p-4 bg-slate-50/50 rounded-xl hover:bg-white hover:shadow-md border border-transparent hover:border-slate-100 transition-all group disabled:opacity-60"
                aria-label="Export transaction history as CSV file"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                    <FileSpreadsheet size={18} className="text-emerald-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-slate-900 text-sm tracking-tight">Export Transactions</p>
                    <p className="text-xs text-slate-500">Download for Excel/Sheets (CSV)</p>
                  </div>
                </div>
                <Download size={16} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
              </button>
            </div>
          </div>
        </CollapsibleCard>

        {/* iOS Shortcuts Section */}
        <CollapsibleCard
          id="shortcuts"
          title="iOS Shortcuts"
          icon={<Smartphone className="w-5 h-5" />}
          isOpen={openSection === 'shortcuts'}
          onToggle={() => handleToggleSection('shortcuts')}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl"
          contentClassName="space-y-6"
        >
          <div className="space-y-8">
            {/* API Key Management */}
            <div>
              <h4 className="font-bold mb-4 tracking-tight uppercase text-xs text-slate-500">API Keys</h4>
              <ApiKeyManager
                householdId={householdId || ''}
                userId={user?.uid || ''}
                apiKeys={apiKeys || []}
                isAdmin={currentUser?.role === 'admin'}
              />
            </div>

            {/* Setup Guide */}
            <div className="border-t border-slate-100 pt-6">
              <h4 className="font-bold mb-4 tracking-tight uppercase text-xs text-slate-500">Setup Guide</h4>
              <ShortcutSetupGuide />
            </div>
          </div>
        </CollapsibleCard>

        {/* Account Section */}
        <CollapsibleCard
          id="account"
          title="Account"
          icon={<LogOut className="w-5 h-5" />}
          isOpen={openSection === 'account'}
          onToggle={() => handleToggleSection('account')}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl"
          contentClassName="space-y-6"
        >
          <div className="py-2">
             <Button
              onClick={handleSignOut}
              variant="destructive"
              size="lg"
              className="w-full shadow-lg shadow-rose-500/20"
              leftIcon={<LogOut size={20} />}
            >
              Sign Out
            </Button>

            <div className="pt-6 text-center">
              <p className="text-xs text-slate-400 font-mono">v{APP_VERSION}</p>
            </div>
          </div>
        </CollapsibleCard>

      </div>

      <DeveloperConsole
        isOpen={isDevConsoleOpen}
        onClose={() => setIsDevConsoleOpen(false)}
      />

      <MemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveMember}
        initialMember={selectedMember}
        title={selectedMember ? 'Edit Member' : 'Add Member'}
      />

      {activePointsView && (
        <PointsBreakdownModal
          isOpen={true}
          onClose={() => setActivePointsView(null)}
          view={activePointsView}
          habits={habits}
        />
      )}

      <ConfirmDialog
        isOpen={memberToRemove !== null}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleConfirmRemoveMember}
        isConfirming={isRemovingMember}
        title="Remove member"
        confirmLabel="Remove"
        message={`Are you sure you want to remove ${memberToRemove?.displayName ?? 'this member'} from the household?`}
      />
    </div>
  );
};

export default Settings;
