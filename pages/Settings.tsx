import React, { useState, lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useHouseholdCore,
  useGamification,
  useFinance,
  useMealPlan,
  useShopping,
} from '@/contexts/FirebaseHouseholdContext';
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
  Terminal,
  AlertTriangle,
  Sparkles,
  Baby
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
import Select from '@/components/ui/Select';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { SurfaceList, Row } from '@/components/ui/Section';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { requestNotificationPermission, setupForegroundNotificationListener } from '@/services/notificationService';
import { generateJsonBackup, generateCsvExport } from '@/utils/exportUtils';
import { HouseholdMember, NotificationPreferences, Transaction } from '@/types/schema';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import DeveloperConsole from '@/components/modals/DeveloperConsole';
import PaywallModal from '@/components/modals/PaywallModal';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { usePlaidEnabled } from '@/hooks/usePlaidEnabled';
import { isValidPinFormat } from '@/utils/kidPin';
import { getPlan } from '@/utils/entitlements';

// Lazy so react-plaid-link stays out of the boot bundle — the chunk only loads
// when plaidEnabled is on AND this renders (dormant by default → never loads).
const ConnectBankCard = lazy(() => import('@/components/settings/ConnectBankCard'));

const APP_VERSION = '0.8.0-alpha';

// Currencies offered in the household currency picker. `symbol` is shown in the
// option label only; actual formatting is driven by the ISO code via `formatCurrency`.
const CURRENCY_OPTIONS: { code: string; symbol: string; label: string }[] = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
];

const Settings: React.FC = () => {
  const { user, householdId } = useAuth();
  const {
    members,
    currentUser,
    addMember,
    updateMember,
    removeMember,
    deleteHousehold,
    householdSettings,
    setHouseholdCurrency,
    setKidModePin,
    apiKeys,
  } = useHouseholdCore();
  const {
    dailyPoints,
    weeklyPoints,
    totalPoints,
    habits,
  } = useGamification();
  const {
    transactions,
    buckets,
    calendarItems,
    hasMoreTransactions,
    isLoadingOlderTransactions,
    loadAllTransactions,
  } = useFinance();
  const { meals } = useMealPlan();
  const { shoppingList } = useShopping();
  const navigate = useNavigate();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDevConsoleOpen, setIsDevConsoleOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<HouseholdMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<HouseholdMember | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);

  // Billing / upgrade (Plan 050b) — dormant until billingEnabled is turned on.
  const billingEnabled = useBillingEnabled();
  const [showPaywall, setShowPaywall] = useState(false);

  // Kid Mode (Plan 080) — dormant until kidModeEnabled is turned on. Manages the
  // parent PIN required to EXIT a kid's scoped view.
  const kidModeEnabled = useKidModeEnabled();
  const plaidEnabled = usePlaidEnabled();
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);

  // Danger zone: delete household
  const [isDeleteHouseholdOpen, setIsDeleteHouseholdOpen] = useState(false);
  const [isDeletingHousehold, setIsDeletingHousehold] = useState(false);

  // Points Breakdown Modal
  const [activePointsView, setActivePointsView] = useState<'daily' | 'weekly' | 'total' | null>(null);

  const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID;

  // Section State
  const [openSection, setOpenSection] = useState<string | null>('profile');

  const handleToggleSection = (id: string) => {
    setOpenSection(prev => prev === id ? null : id);
  };

  const handleCurrencyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCurrency = e.target.value;
    try {
      await setHouseholdCurrency(newCurrency);
      toast.success('Currency updated');
    } catch (error) {
      console.error('[Settings] Failed to update currency:', error);
      toast.error('Failed to update currency');
    }
  };

  const hasKidPin = Boolean(householdSettings?.kidModePinHash);

  const handleSaveKidPin = async () => {
    if (!isValidPinFormat(pinDraft)) {
      toast.error('PIN must be 4-6 digits');
      return;
    }
    if (pinDraft !== pinConfirm) {
      toast.error('PINs do not match');
      return;
    }
    setIsSavingPin(true);
    try {
      await setKidModePin(pinDraft);
      toast.success('Kid Mode PIN saved');
      setPinDraft('');
      setPinConfirm('');
    } catch (error) {
      console.error('[Settings] Failed to set Kid Mode PIN:', error);
      toast.error('Failed to save PIN');
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleRemoveKidPin = async () => {
    setIsSavingPin(true);
    try {
      await setKidModePin(null);
      toast.success('Kid Mode PIN removed');
      setPinDraft('');
      setPinConfirm('');
    } catch (error) {
      console.error('[Settings] Failed to remove Kid Mode PIN:', error);
      toast.error('Failed to remove PIN');
    } finally {
      setIsSavingPin(false);
    }
  };

  // Digits only, max 6 — keeps the PIN inputs well-formed as the user types.
  const sanitizePin = (value: string) => value.replace(/\D/g, '').slice(0, 6);

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

  const handleConfirmDeleteHousehold = async () => {
    setIsDeletingHousehold(true);
    try {
      // On success this triggers a hard reload, so there is nothing to reset here.
      await deleteHousehold();
    } catch (error) {
      console.error('Error deleting household:', error);
      toast.error('Failed to delete household');
      setIsDeletingHousehold(false);
      setIsDeleteHouseholdOpen(false);
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
        // Destructure to remove sensitive fields (prefixed with _ to suppress unused-var warnings)
        const { fcmTokens: _fcmTokens, email: _email, telegramChatId: _telegramChatId, ...safeMember } = m;
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
      <div className="min-h-screen bg-brand-50 dark:bg-brand-900 flex items-center justify-center pb-24">
        <Loader2 className="w-8 h-8 text-accent-600 dark:text-accent-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-24 px-4 pt-6">
      <div className="max-w-2xl mx-auto space-y-6">

        <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-900 dark:text-brand-50 px-1">
          Settings
        </h1>

        {isGlobalAdmin && (
          <Card className="overflow-hidden">
            <button
              onClick={() => setIsDevConsoleOpen(true)}
              className="w-full flex items-center justify-between p-4 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) group text-left"
            >
              <div className="flex items-center gap-3">
                <Terminal className="w-5 h-5 text-accent-600 dark:text-accent-400" />
                <h3 className="font-display text-lg font-semibold tracking-tight text-brand-900 dark:text-brand-100">Developer Console</h3>
              </div>
              <span className="text-xxs font-bold uppercase tracking-wider text-accent-700 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/40 px-2 py-1 rounded-sm border border-accent-200 dark:border-accent-800">
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
          contentClassName="space-y-6"
        >
          {/* User Profile Card */}
          <div>
            <div className="flex items-center gap-5">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-16 h-16 rounded-full ring-1 ring-brand-200 dark:ring-brand-700"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center">
                  <User className="w-8 h-8 text-brand-400 dark:text-brand-500" />
                </div>
              )}
              <div className="flex-1">
                <h2 className="font-display text-xl font-semibold text-brand-900 dark:text-brand-50 tracking-tight">
                  {user?.displayName || 'User'}
                </h2>
                <p className="text-sm text-brand-500 dark:text-brand-400 font-medium">{user?.email}</p>
                {currentUser && (
                  <div className="flex items-center gap-2 mt-2">
                    {currentUser.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warm-700 bg-warm-50 border border-warm-200 px-2.5 py-0.5 rounded-full dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/30">
                        <Crown size={12} />
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-accent-700 bg-accent-50 border border-accent-200 px-2.5 py-0.5 rounded-full dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30">
                        <Shield size={12} />
                        Member
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Appearance / Theme */}
            <div className="mt-6 pt-6 border-t border-brand-200 dark:border-brand-700">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-3">Appearance</h4>
              <ThemeToggle />
            </div>

            {/* Currency */}
            <div className="mt-6 pt-6 border-t border-brand-200 dark:border-brand-700">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-3">Currency</h4>
              <Select
                label="Display currency"
                value={householdSettings?.currency ?? 'USD'}
                onChange={handleCurrencyChange}
              >
                {CURRENCY_OPTIONS.map(({ code, symbol, label }) => (
                  <option key={code} value={code}>
                    {`${code} (${symbol}) — ${label}`}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-brand-500 dark:text-brand-400 mt-2">
                Used to format money throughout the app.
              </p>
            </div>

            {/* Plan (Plan 050b) — only shown once billing is live; dormant by default. */}
            {billingEnabled && (
              <div className="mt-6 pt-6 border-t border-brand-200 dark:border-brand-700">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-3">Plan</h4>
                {getPlan(householdSettings) === 'premium' ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warm-700 bg-warm-50 border border-warm-200 px-2.5 py-0.5 rounded-full dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/30">
                      <Sparkles size={12} />
                      Premium
                    </span>
                    <span className="text-xs text-brand-500 dark:text-brand-400">Thanks for supporting LifeBalance.</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-100 border border-brand-200 px-2.5 py-0.5 rounded-full dark:bg-brand-700/50 dark:text-brand-300 dark:border-brand-600">
                        Free
                      </span>
                      <p className="text-xs text-brand-500 dark:text-brand-400 mt-2">
                        Upgrade for more AI, more members, and premium features.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Sparkles className="w-4 h-4" />}
                      onClick={() => setShowPaywall(true)}
                    >
                      Upgrade
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-brand-200 dark:border-brand-700">
              <button
                onClick={handleEnableNotifications}
                disabled={notificationStatus === 'granted' || notificationStatus === 'denied'}
                className="w-full flex items-center justify-between p-3.5 surface-section hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard) group disabled:opacity-70 disabled:cursor-not-allowed"
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
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    notificationStatus === 'granted'
                      ? 'bg-money-bgPos text-money-pos dark:bg-accent-500/15 dark:text-accent-300'
                      : 'bg-brand-100 text-brand-400 group-hover:text-accent-600 dark:bg-brand-700 dark:text-brand-500 dark:group-hover:text-accent-300'
                  }`}>
                    <Bell size={18} />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Push Notifications</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      {notificationStatus === 'granted' ? 'Notifications enabled' :
                       notificationStatus === 'denied' ? 'Notifications denied in browser' :
                       'Enable alerts on this device'}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-btn border ${
                  notificationStatus === 'granted' ? 'text-money-pos bg-money-bgPos border-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30' :
                  notificationStatus === 'denied' ? 'text-money-neg bg-money-bgNeg border-money-neg/30 dark:bg-money-neg/15 dark:text-money-neg dark:border-money-neg/30' :
                  'text-accent-700 bg-accent-50 border-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30'
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
            <div className="mt-6 border-t border-brand-200 dark:border-brand-700 pt-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-4">Notification Preferences</h4>
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
          contentClassName="space-y-6"
        >
          {/* Household Info */}
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-brand-100 dark:bg-brand-700 rounded-card flex items-center justify-center">
                <Users className="w-7 h-7 text-brand-500 dark:text-brand-400" />
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold text-brand-900 dark:text-brand-50 tracking-tight">
                  {householdSettings.name}
                </h3>
                <p className="text-sm text-brand-500 dark:text-brand-400 font-medium">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </p>
              </div>
            </div>

            {/* Invite Code */}
            <HouseholdInviteCard inviteCode={householdSettings.inviteCode} />

            {/* Shared Household Points */}
            <div className="p-5 surface-section bg-warm-50 dark:bg-warm-500/10 border-warm-200 dark:border-warm-500/25">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-700 dark:text-warm-300 mb-4">Shared Household Points</h4>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setActivePointsView('daily')}
                  className="text-center hover:bg-white/70 dark:hover:bg-brand-800/60 p-3 rounded-btn transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group"
                  aria-label="View daily points breakdown"
                >
                  <p className="text-xs text-brand-500 dark:text-brand-400 mb-1 font-semibold uppercase tracking-wider group-hover:text-warm-700 dark:group-hover:text-warm-300">Daily</p>
                  <p className="font-mono tabular-nums text-xl font-bold text-brand-900 dark:text-brand-50">{dailyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('weekly')}
                  className="text-center hover:bg-white/70 dark:hover:bg-brand-800/60 p-3 rounded-btn transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group"
                  aria-label="View weekly points breakdown"
                >
                  <p className="text-xs text-brand-500 dark:text-brand-400 mb-1 font-semibold uppercase tracking-wider group-hover:text-warm-700 dark:group-hover:text-warm-300">Weekly</p>
                  <p className="font-mono tabular-nums text-xl font-bold text-brand-900 dark:text-brand-50">{weeklyPoints}</p>
                </button>
                <button
                  onClick={() => setActivePointsView('total')}
                  className="text-center hover:bg-white/70 dark:hover:bg-brand-800/60 p-3 rounded-btn transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] group"
                  aria-label="View total points breakdown"
                >
                  <p className="text-xs text-brand-500 dark:text-brand-400 mb-1 font-semibold uppercase tracking-wider group-hover:text-warm-700 dark:group-hover:text-warm-300">Total</p>
                  <p className="font-mono tabular-nums text-xl font-bold text-brand-900 dark:text-brand-50">{totalPoints.toLocaleString()}</p>
                </button>
              </div>
            </div>
          </div>

          {/* Members List */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-100 tracking-tight">
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
            <SurfaceList>
              {members
                .sort((a, b) => {
                  // Sort admins first
                  if (a.role === 'admin' && b.role !== 'admin') return -1;
                  if (a.role !== 'admin' && b.role === 'admin') return 1;
                  return a.displayName.localeCompare(b.displayName);
                })
                .map((member) => (
                  <Row key={member.uid}>
                    {member.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt={member.displayName}
                        className="w-10 h-10 rounded-full ring-1 ring-brand-200 dark:ring-brand-700"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center">
                        <User className="w-5 h-5 text-brand-400 dark:text-brand-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-brand-900 dark:text-brand-100 truncate tracking-tight">
                          {member.displayName}
                          {member.uid === user?.uid && (
                            <span className="text-brand-400 dark:text-brand-500 font-normal ml-1 text-sm">(You)</span>
                          )}
                        </p>
                        {member.role === 'admin' && (
                          <Crown size={14} className="text-warm-500 shrink-0" />
                        )}
                      </div>
                      {member.email && (
                        <p className="text-xs text-brand-500 dark:text-brand-400 truncate font-medium">{member.email}</p>
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
                  </Row>
                ))}
            </SurfaceList>
          </div>
        </CollapsibleCard>

        {/* Kid Mode (Plan 080) — dormant until kidModeEnabled is flipped on. */}
        {kidModeEnabled && (
          <CollapsibleCard
            id="kidmode"
            title="Kid Mode"
            icon={<Baby className="w-5 h-5" />}
            isOpen={openSection === 'kidmode'}
            onToggle={() => handleToggleSection('kidmode')}
            contentClassName="space-y-5"
          >
            <div>
              <h4 className="text-sm font-semibold text-brand-900 dark:text-brand-100 mb-1 tracking-tight">
                Exit PIN
              </h4>
              <p className="text-xs text-brand-500 dark:text-brand-400 mb-4">
                Require a PIN to leave a kid&apos;s view and return to the parent view. Leave
                unset to allow exiting freely.
              </p>

              <div className="mb-4">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                    hasKidPin
                      ? 'text-money-pos bg-money-bgPos border-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30'
                      : 'text-brand-600 bg-brand-100 border-brand-200 dark:bg-brand-700/50 dark:text-brand-300 dark:border-brand-600'
                  }`}
                >
                  {hasKidPin ? 'PIN set' : 'No PIN'}
                </span>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(sanitizePin(e.target.value))}
                  placeholder={hasKidPin ? 'New PIN (4-6 digits)' : 'PIN (4-6 digits)'}
                  aria-label="Kid Mode PIN"
                  className="w-full rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-4 py-2.5 text-brand-900 dark:text-brand-50 tracking-widest outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard)"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(sanitizePin(e.target.value))}
                  placeholder="Confirm PIN"
                  aria-label="Confirm Kid Mode PIN"
                  className="w-full rounded-btn border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-4 py-2.5 text-brand-900 dark:text-brand-50 tracking-widest outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard)"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveKidPin}
                    isLoading={isSavingPin}
                    disabled={isSavingPin || pinDraft.length === 0}
                    variant="primary"
                    className="flex-1"
                  >
                    {hasKidPin ? 'Update PIN' : 'Set PIN'}
                  </Button>
                  {hasKidPin && (
                    <Button
                      onClick={handleRemoveKidPin}
                      isLoading={isSavingPin}
                      disabled={isSavingPin}
                      variant="ghost-danger"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CollapsibleCard>
        )}

        {/* Danger Zone - admins only */}
        {currentUser?.role === 'admin' && (
          <Card className="overflow-hidden border-money-neg/30 dark:border-money-neg/40 bg-money-bgNeg dark:bg-money-neg/10">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-card bg-money-neg/10 dark:bg-money-neg/20 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-money-neg" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-money-neg tracking-tight">
                    Danger Zone
                  </h3>
                  <p className="text-sm text-money-neg/80 font-medium">
                    Irreversible actions for this household
                  </p>
                </div>
              </div>

              <div className="rounded-card bg-white/70 dark:bg-brand-900/40 border border-money-neg/25 dark:border-money-neg/30 p-4">
                <p className="text-sm font-bold text-brand-900 dark:text-brand-100 tracking-tight">
                  Delete Household
                </p>
                <p className="mt-1 text-xs text-brand-600 dark:text-brand-400">
                  Permanently deletes this household and all of its data for every
                  member. This cannot be undone.
                </p>
                <Button
                  onClick={() => setIsDeleteHouseholdOpen(true)}
                  variant="destructive"
                  className="mt-4 w-full sm:w-auto"
                  leftIcon={<Trash2 size={18} />}
                >
                  Delete Household
                </Button>
              </div>
            </div>
          </Card>
        )}

        <CollapsibleCard
          id="data"
          title="Data Management"
          icon={<Download className="w-5 h-5" />}
          isOpen={openSection === 'data'}
          onToggle={() => handleToggleSection('data')}
          contentClassName="space-y-6"
        >
          {/* Data Management */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 mb-3">
              Export your household data
            </p>

            <SurfaceList>
              <Row
                interactive
                role="button"
                tabIndex={isLoadingOlderTransactions ? -1 : 0}
                aria-disabled={isLoadingOlderTransactions}
                onClick={() => { if (!isLoadingOlderTransactions) requestExport('json'); }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isLoadingOlderTransactions) {
                    e.preventDefault();
                    requestExport('json');
                  }
                }}
                className={isLoadingOlderTransactions ? 'opacity-60 pointer-events-none' : undefined}
                aria-label="Export full household data backup as JSON file"
              >
                <div className="w-10 h-10 rounded-full bg-accent-50 dark:bg-accent-500/15 flex items-center justify-center shrink-0">
                  <FileJson size={18} className="text-accent-600 dark:text-accent-300" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Export Full Backup</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">Download all data as JSON</p>
                </div>
                <Download size={16} className="text-brand-400 dark:text-brand-500 shrink-0" />
              </Row>

              <Row
                interactive
                role="button"
                tabIndex={isLoadingOlderTransactions ? -1 : 0}
                aria-disabled={isLoadingOlderTransactions}
                onClick={() => { if (!isLoadingOlderTransactions) requestExport('csv'); }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isLoadingOlderTransactions) {
                    e.preventDefault();
                    requestExport('csv');
                  }
                }}
                className={isLoadingOlderTransactions ? 'opacity-60 pointer-events-none' : undefined}
                aria-label="Export transaction history as CSV file"
              >
                <div className="w-10 h-10 rounded-full bg-money-bgPos dark:bg-accent-500/15 flex items-center justify-center shrink-0">
                  <FileSpreadsheet size={18} className="text-money-pos dark:text-accent-300" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Export Transactions</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">Download for Excel/Sheets (CSV)</p>
                </div>
                <Download size={16} className="text-brand-400 dark:text-brand-500 shrink-0" />
              </Row>
            </SurfaceList>
          </div>
        </CollapsibleCard>

        {/* Connect a bank (Plaid) — dormant until the plaidEnabled flag is on.
            Lazy + flag-gated so react-plaid-link never enters the boot bundle. */}
        {plaidEnabled && (
          <Suspense fallback={null}>
            <ConnectBankCard />
          </Suspense>
        )}

        {/* iOS Shortcuts Section */}
        <CollapsibleCard
          id="shortcuts"
          title="iOS Shortcuts"
          icon={<Smartphone className="w-5 h-5" />}
          isOpen={openSection === 'shortcuts'}
          onToggle={() => handleToggleSection('shortcuts')}
          contentClassName="space-y-6"
        >
          <div className="space-y-8">
            {/* API Key Management */}
            <div>
              <h4 className="font-semibold mb-4 tracking-wider uppercase text-xs text-brand-500 dark:text-brand-400">API Keys</h4>
              <ApiKeyManager
                householdId={householdId || ''}
                userId={user?.uid || ''}
                apiKeys={apiKeys || []}
                isAdmin={currentUser?.role === 'admin'}
              />
            </div>

            {/* Setup Guide */}
            <div className="border-t border-brand-200 dark:border-brand-700 pt-6">
              <h4 className="font-semibold mb-4 tracking-wider uppercase text-xs text-brand-500 dark:text-brand-400">Setup Guide</h4>
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
          contentClassName="space-y-6"
        >
          <div className="py-2">
             <Button
              onClick={handleSignOut}
              variant="destructive"
              size="lg"
              className="w-full"
              leftIcon={<LogOut size={20} />}
            >
              Sign Out
            </Button>

            <div className="pt-6 text-center">
              <p className="text-xs text-brand-400 dark:text-brand-500 font-mono tabular-nums">v{APP_VERSION}</p>
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

      <ConfirmDialog
        isOpen={isDeleteHouseholdOpen}
        onClose={() => setIsDeleteHouseholdOpen(false)}
        onConfirm={handleConfirmDeleteHousehold}
        isConfirming={isDeletingHousehold}
        title="Delete household?"
        confirmLabel="Delete forever"
        message={
          <>
            This permanently deletes <span className="font-semibold">{householdSettings.name}</span> and{' '}
            <span className="font-semibold">all of its data</span> — habits, transactions, budgets, meals,
            and everything else — for <span className="font-semibold">every member</span>, not just you.
            This action cannot be undone. Only household admins can do this.
          </>
        }
      />

      {householdId && (
        <PaywallModal
          isOpen={showPaywall}
          onClose={() => setShowPaywall(false)}
          householdId={householdId}
        />
      )}
    </div>
  );
};

export default Settings;
