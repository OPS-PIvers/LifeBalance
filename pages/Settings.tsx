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
  User,
  Shield,
  Pencil,
  Trash2,
  Plus,
  Bell,
  Download,
  FileJson,
  FileSpreadsheet,
  Terminal,
  Sparkles,
  Baby,
  Star,
} from 'lucide-react';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import MemberModal from '@/components/modals/MemberModal';
import PointsBreakdownModal from '@/components/modals/PointsBreakdownModal';
import NotificationSettings from '@/components/settings/NotificationSettings';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import ApiKeyManager from '@/components/settings/ApiKeyManager';
import ShortcutSetupGuide from '@/components/settings/ShortcutSetupGuide';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Section, SurfaceList, Row, DisclosureRow } from '@/components/ui/Section';
import PageHeader from '@/components/ui/PageHeader';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isModuleEnabled } from '@/utils/moduleVisibility';
import type { ModuleKey } from '@/types/schema';
import { requestNotificationPermission, setupForegroundNotificationListener } from '@/services/notificationService';
import { generateJsonBackup, generateCsvExport } from '@/utils/exportUtils';
import { HouseholdMember, NotificationPreferences, Transaction } from '@/types/schema';
import toast from 'react-hot-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { computeAnyNotificationsEnabled } from '@/utils/notificationFlags';
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
    setModuleVisibility,
    setKidModePin,
    apiKeys,
  } = useHouseholdCore();
  const { habits } = useGamification();
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

  // Sub-flow drawers
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isKidModeOpen, setIsKidModeOpen] = useState(false);

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

  // The write-once API key from the current session, lifted so the setup guide
  // can pre-fill and copy the Authorization header the moment a key is created.
  const [sessionApiKey, setSessionApiKey] = useState<string | null>(null);

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

  const handleModuleToggle = async (key: ModuleKey, value: boolean) => {
    try {
      await setModuleVisibility(key, value);
    } catch (error) {
      console.error('[Settings] Failed to update module visibility:', error);
      toast.error('Failed to update modules');
    }
  };

  const hasKidPin = Boolean(householdSettings?.kidModePinHash);
  // Whether the 'Plan' module is on — gates the To-Dos/Meals/Shopping sub-toggles below.
  const planEnabled = isModuleEnabled(householdSettings, 'plan');

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
      toast.success('Signed out');
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
      void setupForegroundNotificationListener();
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

      // Recompute the denormalized fan-out flag in the SAME write as the
      // preferences save so the two can never drift (Plan 06).
      const anyNotificationsEnabled = computeAnyNotificationsEnabled(
        preferences,
        currentUser?.fcmTokens
      );

      await updateDoc(memberRef, {
        notificationPreferences: preferences,
        anyNotificationsEnabled,
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
      toast.success('Backup downloaded');
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
      <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe px-4 pt-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading settings…</span>
        <div className="max-w-2xl mx-auto space-y-6">
          <Skeleton className="h-9 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  const sortedMembers = [...members].sort((a, b) => {
    // Sort admins first
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (a.role !== 'admin' && b.role === 'admin') return 1;
    // Legacy member docs can lack displayName despite the schema type — sort them safely.
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe">
      <PageHeader title="Settings" />
      <div className="max-w-2xl mx-auto px-4 space-y-6">

        {isGlobalAdmin && (
          <SurfaceList>
            <DisclosureRow
              icon={<Terminal className="w-5 h-5 text-accent-600 dark:text-accent-400" />}
              title="Developer Console"
              value={<Badge variant="warning" size="sm">ADMIN</Badge>}
              onClick={() => setIsDevConsoleOpen(true)}
            />
          </SurfaceList>
        )}

        {/* Profile & Preferences */}
        <Section title="Profile">
          <div className="space-y-3">
            {/* Identity — compact row, not a decorative hero: the avatar/name/
                email/role are already visible in the app chrome (TopToolbar/
                ProfileMenu), so this is just enough to confirm "who am I
                signed in as" — see UX content audit Batch 4. */}
            <div className="flex items-center gap-3 px-1">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-10 h-10 rounded-full ring-1 ring-brand-200 dark:ring-brand-700"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center">
                  <User className="w-5 h-5 text-brand-400 dark:text-brand-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate text-sm">
                    {user?.displayName || 'User'}
                  </p>
                  {currentUser?.role === 'admin' ? (
                    <Crown size={12} className="text-warm-500 shrink-0" aria-label="Admin" />
                  ) : (
                    <Shield size={12} className="text-accent-600 dark:text-accent-400 shrink-0" aria-label="Member" />
                  )}
                </div>
                <p className="text-xs text-brand-500 dark:text-brand-400 truncate">{user?.email}</p>
              </div>
            </div>

            <SurfaceList>
              {/* Appearance / Theme */}
              <Row className="flex-col items-stretch gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Appearance</span>
                <ThemeToggle />
              </Row>

              {/* Currency */}
              <Row className="flex-col items-stretch gap-1.5">
                <Select
                  label="Currency"
                  value={householdSettings?.currency ?? 'USD'}
                  onChange={handleCurrencyChange}
                >
                  {CURRENCY_OPTIONS.map(({ code, symbol, label }) => (
                    <option key={code} value={code}>
                      {`${code} (${symbol}) — ${label}`}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  Used to format money throughout the app.
                </p>
              </Row>

              {/* Plan (Plan 050b) — only shown once billing is live; dormant by default. */}
              {billingEnabled && (
                <Row className="flex-col items-stretch gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">Plan</span>
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
                </Row>
              )}

              {/* Push notification permission */}
              <Row
                interactive={notificationStatus === 'default'}
                role="button"
                tabIndex={notificationStatus === 'default' ? 0 : -1}
                aria-disabled={notificationStatus !== 'default'}
                onClick={() => { if (notificationStatus === 'default') handleEnableNotifications(); }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && notificationStatus === 'default') {
                    e.preventDefault();
                    handleEnableNotifications();
                  }
                }}
                className={notificationStatus !== 'default' ? 'opacity-70 pointer-events-none' : undefined}
                aria-label={
                  notificationStatus === 'granted'
                    ? 'Push notifications enabled'
                    : notificationStatus === 'denied'
                    ? 'Push notifications denied by browser'
                    : 'Enable push notifications'
                }
                aria-describedby={notificationStatus === 'denied' ? 'notification-denied-help' : undefined}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  notificationStatus === 'granted'
                    ? 'bg-money-bgPos text-money-pos dark:bg-accent-500/15 dark:text-accent-300'
                    : 'bg-brand-100 text-brand-400 dark:bg-brand-700 dark:text-brand-500'
                }`}>
                  <Bell size={18} />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Push Notifications</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">
                    {notificationStatus === 'granted' ? 'Notifications enabled' :
                     notificationStatus === 'denied' ? 'Notifications denied in browser' :
                     'Enable alerts on this device'}
                  </p>
                </div>
                <Badge
                  variant={notificationStatus === 'granted' ? 'success' : notificationStatus === 'denied' ? 'danger' : 'brand'}
                  size="sm"
                  className="shrink-0"
                >
                  {notificationStatus === 'granted' ? 'Enabled' :
                   notificationStatus === 'denied' ? 'Denied' : 'Enable'}
                </Badge>
              </Row>

              {/* Notification preferences — opens a bottom sheet once granted */}
              {notificationStatus === 'granted' && householdId && user && (
                <DisclosureRow
                  icon={<Bell className="w-5 h-5" />}
                  title="Notification Preferences"
                  subtitle="Customize your alerts"
                  onClick={() => setIsNotificationsOpen(true)}
                />
              )}
            </SurfaceList>
            {notificationStatus === 'denied' && (
              <p id="notification-denied-help" className="sr-only">
                Notifications have been denied by your browser. To enable them, please update your browser settings to allow notifications for this site.
              </p>
            )}
          </div>
        </Section>

        {/* Household */}
        <Section title="Household">
          <div className="space-y-4">
            {/* Household identity — compact row (the icon-tile hero repeated
                Profile's pattern for info already visible elsewhere in the app
                chrome) — see UX content audit Batch 4. */}
            <div className="flex items-center gap-3 px-1">
              <div className="w-10 h-10 bg-brand-100 dark:bg-brand-700 rounded-card flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-brand-500 dark:text-brand-400" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate text-sm">
                  {householdSettings.name}
                </p>
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </p>
              </div>
            </div>

            {/* Invite Code */}
            <HouseholdInviteCard inviteCode={householdSettings.inviteCode} />

            {/* Shared Household Points — TopToolbar already shows the current
                daily/weekly totals persistently, so this collapses to a single
                link into the same breakdown modal rather than re-displaying
                all three totals here (see UX content audit Batch 4). */}
            <SurfaceList>
              <DisclosureRow
                icon={<Star className="w-5 h-5" />}
                title="Points breakdown"
                subtitle="Daily, weekly, and total household points"
                onClick={() => setActivePointsView('total')}
              />
            </SurfaceList>

            {/* Members */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                  Members
                </p>
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
                {sortedMembers.map((member) => (
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
          </div>
        </Section>

        {/* App Modules (Plan 090) — per-household page/tab on-off toggles. Any
            member can edit (like the currency picker). Default all-on. */}
        <Section title="App Modules">
          <div className="space-y-3">
            <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
              Turn off pages or tabs you don&apos;t use — they&apos;ll disappear from navigation for
              everyone in the household. Your data is kept and comes back when you re-enable a module.
            </p>

            <SurfaceList>
              {/* Top-level pages */}
              <Row>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Habits</p>
                </div>
                <Switch
                  aria-label="Toggle Habits page"
                  checked={isModuleEnabled(householdSettings, 'habits')}
                  onCheckedChange={(value) => handleModuleToggle('habits', value)}
                />
              </Row>
              <Row>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Money</p>
                </div>
                <Switch
                  aria-label="Toggle Money page"
                  checked={isModuleEnabled(householdSettings, 'money')}
                  onCheckedChange={(value) => handleModuleToggle('money', value)}
                />
              </Row>
              <Row>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Plan</p>
                  <p className="text-xs text-brand-500 dark:text-brand-400">To-Dos, Meals, and Shopping</p>
                </div>
                <Switch
                  aria-label="Toggle Plan page"
                  checked={planEnabled}
                  onCheckedChange={(value) => handleModuleToggle('plan', value)}
                />
              </Row>

              {/* Plan sub-tabs — indented under Plan */}
              <Row className="pl-10">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${planEnabled ? 'text-brand-700 dark:text-brand-300' : 'text-brand-400 dark:text-brand-500'}`}>To-Dos</p>
                </div>
                <Switch
                  aria-label="Toggle To-Dos tab"
                  disabled={!planEnabled}
                  checked={isModuleEnabled(householdSettings, 'todos')}
                  onCheckedChange={(value) => handleModuleToggle('todos', value)}
                />
              </Row>
              <Row className="pl-10">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${planEnabled ? 'text-brand-700 dark:text-brand-300' : 'text-brand-400 dark:text-brand-500'}`}>Meals</p>
                </div>
                <Switch
                  aria-label="Toggle Meals tab"
                  disabled={!planEnabled}
                  checked={isModuleEnabled(householdSettings, 'meals')}
                  onCheckedChange={(value) => handleModuleToggle('meals', value)}
                />
              </Row>
              <Row className="pl-10">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${planEnabled ? 'text-brand-700 dark:text-brand-300' : 'text-brand-400 dark:text-brand-500'}`}>Shopping</p>
                </div>
                <Switch
                  aria-label="Toggle Shopping tab"
                  disabled={!planEnabled}
                  checked={isModuleEnabled(householdSettings, 'shopping')}
                  onCheckedChange={(value) => handleModuleToggle('shopping', value)}
                />
              </Row>
            </SurfaceList>
          </div>
        </Section>

        {/* Kid Mode (Plan 080) — dormant until kidModeEnabled is flipped on. */}
        {kidModeEnabled && (
          <Section title="Kid Mode">
            <SurfaceList>
              <DisclosureRow
                icon={<Baby className="w-5 h-5" />}
                title="Exit PIN"
                subtitle="Require a PIN to leave a kid's view"
                value={
                  <Badge variant={hasKidPin ? 'success' : 'neutral'} size="sm">
                    {hasKidPin ? 'PIN set' : 'No PIN'}
                  </Badge>
                }
                onClick={() => setIsKidModeOpen(true)}
              />
            </SurfaceList>
          </Section>
        )}

        {/* Data Management */}
        <Section title="Data">
          <div className="space-y-2">
            <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
              JSON is a complete backup of everything; CSV contains transactions only, ready for Excel or Google Sheets.
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
        </Section>

        {/* Connect a bank (Plaid) — dormant until the plaidEnabled flag is on.
            Lazy + flag-gated so react-plaid-link never enters the boot bundle. */}
        {plaidEnabled && (
          <Suspense fallback={null}>
            <ConnectBankCard />
          </Suspense>
        )}

        {/* iOS Shortcuts */}
        <Section title="iOS Shortcuts">
          <div className="space-y-6">
            {/* API Key Management */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">API Keys</p>
              <ApiKeyManager
                householdId={householdId || ''}
                userId={user?.uid || ''}
                apiKeys={apiKeys || []}
                isAdmin={currentUser?.role === 'admin'}
                onKeyGenerated={setSessionApiKey}
              />
            </div>

            {/* Setup Guide */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400 px-1">Setup Guide</p>
              <ShortcutSetupGuide apiKey={sessionApiKey} />
            </div>
          </div>
        </Section>

        {/* Account */}
        <Section title="Account">
          <SurfaceList>
            <DisclosureRow
              icon={
                <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-700 flex items-center justify-center shrink-0">
                  <LogOut size={18} className="text-brand-500 dark:text-brand-400" />
                </div>
              }
              title="Sign Out"
              onClick={handleSignOut}
            />
          </SurfaceList>
        </Section>

        {/* Danger Zone — admins only; a single destructive drill-in, no red box. */}
        {currentUser?.role === 'admin' && (
          <Section title="Danger Zone">
            <SurfaceList>
              <DisclosureRow
                destructive
                icon={<Trash2 className="w-5 h-5" />}
                title="Delete Household"
                subtitle="Permanently delete this household and all of its data for every member"
                onClick={() => setIsDeleteHouseholdOpen(true)}
              />
            </SurfaceList>
          </Section>
        )}

        <p className="text-center text-xs text-brand-400 dark:text-brand-500 font-mono tabular-nums pt-2">
          LifeBalance v{APP_VERSION}
        </p>

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

      {/* Notification preferences bottom sheet */}
      <Drawer
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        title="Notifications"
        height="tall"
      >
        {householdId && user && (
          <NotificationSettings
            householdId={householdId}
            currentPreferences={currentUser?.notificationPreferences}
            onSave={handleSaveNotificationPreferences}
          />
        )}
      </Drawer>

      {/* Kid Mode PIN bottom sheet */}
      <Drawer
        isOpen={isKidModeOpen}
        onClose={() => setIsKidModeOpen(false)}
        title="Kid Mode PIN"
      >
        <div className="space-y-4">
          <p className="text-sm text-brand-500 dark:text-brand-400">
            Require a PIN to leave a kid&apos;s view and return to the parent view. Leave unset to
            allow exiting freely.
          </p>

          <div>
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
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinDraft}
              onChange={(e) => setPinDraft(sanitizePin(e.target.value))}
              placeholder={hasKidPin ? 'New PIN (4-6 digits)' : 'PIN (4-6 digits)'}
              aria-label="Kid Mode PIN"
              className="tracking-widest"
            />
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(sanitizePin(e.target.value))}
              placeholder="Confirm PIN"
              aria-label="Confirm Kid Mode PIN"
              className="tracking-widest"
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
      </Drawer>

      <ConfirmDialog
        isOpen={memberToRemove !== null}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleConfirmRemoveMember}
        isConfirming={isRemovingMember}
        title="Remove member"
        confirmLabel="Remove"
        message={`Remove ${memberToRemove?.displayName ?? 'this member'} from the household? They'll lose access to all shared household data — budgets, habits, and history. This cannot be undone.`}
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
