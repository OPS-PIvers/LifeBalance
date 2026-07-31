import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useHouseholdCore,
  useGamification,
  useFinance,
  useMealPlan,
  useShopping,
  useTodos,
} from '@/contexts/FirebaseHouseholdContext';
import { signOut } from 'firebase/auth';
import { auth } from '@/firebase.config';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Upload,
  RotateCcw,
  Salad,
  Newspaper,
  ArrowLeft,
  Landmark,
  LayoutGrid,
  Smartphone,
  Database,
} from 'lucide-react';
import HouseholdInviteCard from '@/components/auth/HouseholdInviteCard';
import MemberModal from '@/components/modals/MemberModal';
import PointsBreakdownModal from '@/components/modals/PointsBreakdownModal';
import NotificationSettings from '@/components/settings/NotificationSettings';
import { ThemeToggle } from '@/components/settings/ThemeToggle';
import { useTheme, type FontScale } from '@/contexts/ThemeContext';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/SegmentedControl';
import { haptic } from '@/utils/haptics';
import ApiKeyManager from '@/components/settings/ApiKeyManager';
import CalendarFeedCard from '@/components/settings/CalendarFeedCard';
import ShortcutSetupGuide from '@/components/settings/ShortcutSetupGuide';
import ActivityLogCard from '@/components/settings/ActivityLogCard';
import MerchantRulesCard from '@/components/settings/MerchantRulesCard';
import HabitPlaySettings from '@/components/settings/HabitPlaySettings';
import { ChangelogDrawer } from '@/components/settings/ChangelogDrawer';
import { CHANGELOG } from '@/data/changelog';
import { HomeWidgetOrder } from '@/components/settings/HomeWidgetOrder';
import { MemberVisibilityMatrix } from '@/components/settings/MemberVisibilityMatrix';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Section, SurfaceList, Row, DisclosureRow } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import Eyebrow from '@/components/ui/Eyebrow';
import PageHeader from '@/components/ui/PageHeader';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { LazyMount } from '@/components/ui/LazyMount';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import MemberAvatar from '@/components/ui/MemberAvatar';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { MODULE_PRESETS, type ModulePreset } from '@/utils/modulePresets';
import type { ModuleKey } from '@/types/schema';
import { requestNotificationPermission, setupForegroundNotificationListener } from '@/services/notificationService';
import { generateJsonBackup, generateCsvExport, buildExportPayload } from '@/utils/exportUtils';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { getCaptureReviewMode } from '@/utils/captureReview';
import { HouseholdMember, NotificationPreferences, Transaction, Meal, CaptureType, CaptureReviewMode, CeremonyTone, FreezeMode } from '@/types/schema';
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
import { getPlan, getLimits } from '@/utils/entitlements';

// Lazy so react-plaid-link stays out of the boot bundle — the chunk only loads
// when plaidEnabled is on AND this renders (dormant by default → never loads).
const ConnectBankCard = lazy(() => import('@/components/settings/ConnectBankCard'));

// Lazy so the CSV parser/dedup logic and its preview UI stay out of the
// Settings page's own chunk until the user actually opens the import drawer.
const CsvImportDrawer = lazy(() => import('@/components/settings/CsvImportDrawer'));
// Lazy so the Recently Deleted list UI stays out of the Settings chunk until opened.
const RecentlyDeletedDrawer = lazy(() => import('@/components/settings/RecentlyDeletedDrawer'));

// F-MEALS-03 — lazy so the meals-only DietaryProfileModal stays out of the
// Settings page's boot chunk until first opened.
const DietaryProfileModal = lazy(() => import('@/components/meals/DietaryProfileModal').then(m => ({ default: m.DietaryProfileModal })));

const APP_VERSION = '0.8.0-alpha';

// localStorage key tracking the last app version the user has opened the
// "What's New" drawer for — drives the one-time badge dot (F-PLAT-13).
const LAST_SEEN_VERSION_KEY = 'lifebalance-last-seen-version';

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

const FONT_SCALE_OPTIONS: SegmentedControlOption<FontScale>[] = [
  { value: '100', label: <span className="text-xs">A</span>, ariaLabel: 'Default text size' },
  { value: '115', label: <span className="text-sm">A</span>, ariaLabel: 'Larger text size' },
  { value: '130', label: <span className="text-base">A</span>, ariaLabel: 'Largest text size' },
];

// Quick-Add capture review mode — governs whether an iOS-Shortcut/API capture
// of each type lands immediately or is held in a review drawer. See
// utils/captureReview.ts for the per-type defaults this control overrides.
const CAPTURE_REVIEW_MODE_OPTIONS: SegmentedControlOption<CaptureReviewMode>[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'review', label: 'Manual review' },
];

const CAPTURE_REVIEW_ROWS: { type: CaptureType; label: string }[] = [
  { type: 'expense', label: 'Transactions' },
  { type: 'shopping', label: 'Shopping list' },
  { type: 'todo', label: 'To-dos' },
];

/**
 * Settings IA (impeccable r4): the /settings route is an INDEX of grouped
 * navigation rows; each row drills into a sub-screen selected by the
 * `?section=` search param. Using a search param (rather than local state)
 * gives every sub-screen a real history entry — the browser Back button
 * returns to the index — and makes sections deep-linkable (the Dashboard
 * setup checklist links straight to `?section=notifications` etc.) without
 * any App.tsx route churn.
 */
const SETTINGS_SECTIONS = [
  'profile',
  'notifications',
  'household',
  'money',
  'modules',
  'shortcuts',
  'data',
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const isSettingsSection = (value: string | null): value is SettingsSection =>
  value !== null && (SETTINGS_SECTIONS as readonly string[]).includes(value);

/** Stable DOM id for an index navigation row — used to restore focus on back. */
const sectionRowId = (key: SettingsSection) => `settings-section-row-${key}`;

const SECTION_TITLES: Record<SettingsSection, string> = {
  profile: 'Profile & Appearance',
  notifications: 'Notifications',
  household: 'Household',
  money: 'Money',
  modules: 'Modules & Dashboard',
  shortcuts: 'iOS Shortcuts',
  data: 'Data & Account',
};

const Settings: React.FC = () => {
  const { user, householdId } = useAuth();
  const { fontScale, setFontScale, highContrast, setHighContrast } = useTheme();
  const {
    members,
    currentUser,
    addMember,
    updateMember,
    removeMember,
    deleteHousehold,
    household,
    householdSettings,
    setHouseholdCurrency,
    setModuleVisibility,
    updateModuleVisibility,
    setCaptureReviewMode,
    setKidModePin,
    setFreezeMode,
    setCeremonyTone,
    apiKeys,
    activityLog,
    updateKidProfile,
  } = useHouseholdCore();
  const { habits, challenges, rewardsInventory } = useGamification();
  const {
    transactions,
    buckets,
    calendarItems,
    hasMoreTransactions,
    isLoadingOlderTransactions,
    loadAllTransactions,
  } = useFinance();
  const { mealPlan, loadAllMeals } = useMealPlan();
  const { shoppingList, stores } = useShopping();
  const { todos } = useTodos();
  // Resolves each exported row's friendly name for the CSV's `Name` column;
  // the raw descriptor still ships in `Merchant` (see doExportCsv).
  const { displayNameFor } = useMerchantRules();
  const navigate = useNavigate();

  // ---- Index ↔ sub-screen drill-down --------------------------------------
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section: SettingsSection | null = isSettingsSection(sectionParam) ? sectionParam : null;

  // True when the current sub-screen was pushed from the index in this
  // mounted page (vs. arriving by deep link) — lets the on-screen back button
  // pop the real history entry instead of piling on a duplicate index entry.
  const pushedFromIndexRef = useRef(false);

  const openSection = (next: SettingsSection) => {
    pushedFromIndexRef.current = true;
    // Only touch the `section` key — any other query params (e.g. tracking
    // or referral params) survive the drill-down untouched.
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    setSearchParams(params);
  };

  const goBackToIndex = () => {
    if (pushedFromIndexRef.current) {
      pushedFromIndexRef.current = false;
      navigate(-1);
    } else {
      // Deep-linked straight into a sub-screen — there is no index entry
      // behind us, so replace instead of popping out of Settings entirely.
      // Delete only the `section` key so other query params are preserved.
      const params = new URLSearchParams(searchParams);
      params.delete('section');
      setSearchParams(params, { replace: true });
    }
  };

  // On push: reset scroll and move focus to the sub-screen heading so
  // keyboard and screen-reader users land on the new context. On pop back
  // to the index: restore focus to the row that opened the sub-screen
  // (falling back to the index heading if it can't be found — e.g. after
  // an unexpected DOM change), instead of dropping focus to <body>.
  const headingRef = useRef<HTMLSpanElement>(null);
  const indexHeadingRef = useRef<HTMLSpanElement>(null);
  const lastSectionRef = useRef<SettingsSection | null>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (section !== null) {
      lastSectionRef.current = section;
      headingRef.current?.focus();
    } else if (lastSectionRef.current !== null) {
      const row = document.getElementById(sectionRowId(lastSectionRef.current));
      lastSectionRef.current = null;
      (row ?? indexHeadingRef.current)?.focus();
    }
  }, [section]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDevConsoleOpen, setIsDevConsoleOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<HouseholdMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<HouseholdMember | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);

  // Sub-flow drawers
  const [isKidModeOpen, setIsKidModeOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [isRecentlyDeletedOpen, setIsRecentlyDeletedOpen] = useState(false);
  const [isDietaryProfileOpen, setIsDietaryProfileOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  // One-time "new version" badge: compare the last-seen version stashed in
  // localStorage to APP_VERSION. Lazy initializer (not an effect) so there's
  // no synchronous setState-in-effect cascading render — this page is never
  // server-rendered, so reading localStorage during init is safe.
  const [hasUnseenChangelog, setHasUnseenChangelog] = useState(() => {
    try {
      return window.localStorage.getItem(LAST_SEEN_VERSION_KEY) !== APP_VERSION;
    } catch {
      // localStorage unavailable (private browsing, etc.) — badge stays off.
      return false;
    }
  });

  const handleOpenChangelog = () => {
    setIsChangelogOpen(true);
    setHasUnseenChangelog(false);
    try {
      window.localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION);
    } catch {
      // localStorage unavailable — badge will just reappear next visit.
    }
  };

  // Billing / upgrade (Plan 050b) — dormant until billingEnabled is turned on.
  const billingEnabled = useBillingEnabled();
  const [showPaywall, setShowPaywall] = useState(false);

  // Kid Mode (Plan 080) — dormant until kidModeEnabled is turned on. Manages the
  // parent PIN required to EXIT a kid's scoped view.
  const kidModeEnabled = useKidModeEnabled(householdId);
  const plaidEnabled = usePlaidEnabled(householdId);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);

  // Danger zone: delete household
  const [isDeleteHouseholdOpen, setIsDeleteHouseholdOpen] = useState(false);
  const [isDeletingHousehold, setIsDeletingHousehold] = useState(false);

  // Self-serve leave household (F-XCUT-05) — any member can remove themselves,
  // except the last remaining admin (they must promote someone else or use
  // Delete Household instead).
  const [isLeaveHouseholdOpen, setIsLeaveHouseholdOpen] = useState(false);
  const [isLeavingHousehold, setIsLeavingHousehold] = useState(false);

  // Points Breakdown Modal
  const [isPointsBreakdownOpen, setIsPointsBreakdownOpen] = useState(false);

  const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID;

  // The write-once API key from the current session, lifted so the setup guide
  // can pre-fill and copy the Authorization header the moment a key is created.
  // Lives here (not in the sub-screen) so it survives drilling in and out of
  // the iOS Shortcuts destination while the page stays mounted.
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

  const handleCaptureReviewModeChange = async (type: CaptureType, mode: CaptureReviewMode) => {
    try {
      await setCaptureReviewMode(type, mode);
    } catch (error) {
      console.error('[Settings] Failed to update capture review mode:', error);
      toast.error('Failed to update review settings');
    }
  };

  // Per-member habit points (stage 6) — the two household habit settings.
  const handleFreezeModeChange = async (mode: FreezeMode) => {
    try {
      await setFreezeMode(mode);
      toast.success('Freeze setting updated');
    } catch (error) {
      console.error('[Settings] Failed to update freeze mode:', error);
      toast.error('Failed to update freeze setting');
    }
  };

  const handleCeremonyToneChange = async (tone: CeremonyTone) => {
    try {
      await setCeremonyTone(tone);
      toast.success('Weekly wrap-up updated');
    } catch (error) {
      console.error('[Settings] Failed to update ceremony tone:', error);
      toast.error('Failed to update weekly wrap-up');
    }
  };

  // F-PLAT-07 — module presets. Picking a preset from the dropdown expands it
  // in place to show exactly what it will turn on/off before committing;
  // nothing is written until Apply. The matrix's manual household switches
  // remain the escape hatch for anything a preset doesn't cover exactly.
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);
  const [isApplyingPreset, setIsApplyingPreset] = useState(false);

  // The placeholder option's empty value clears the preview, so Cancel and
  // re-selecting the placeholder are the same state.
  const handlePresetSelect = (presetId: string) => {
    setPreviewPresetId(presetId || null);
  };

  const handleApplyPreset = async (preset: ModulePreset) => {
    setIsApplyingPreset(true);
    try {
      await updateModuleVisibility(preset.visibility);
      toast.success(`Applied "${preset.label}"`);
      setPreviewPresetId(null);
    } catch (error) {
      console.error('[Settings] Failed to apply module preset:', error);
      toast.error('Failed to apply preset');
    } finally {
      setIsApplyingPreset(false);
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

  // Managed kid profiles have no login/email/role — the generic MemberModal
  // itself renders only the displayName field for a member with
  // `isManaged === true` (email is meaningless with no login; role is actively
  // dangerous since changing it away from 'kid' would un-manage them), so
  // opening the SAME modal is safe here. Routing to the right mutation happens
  // in handleSaveMember below.
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

  const handleConfirmLeaveHousehold = async () => {
    if (!currentUser) return;
    setIsLeavingHousehold(true);
    try {
      await removeMember(currentUser.uid);
      toast.success('You left the household');
      // Hard reload so AuthContext re-resolves (no household -> routes to
      // /setup), matching deleteHousehold's flow above.
      window.location.reload();
    } catch (error) {
      console.error('Error leaving household:', error);
      toast.error('Failed to leave household');
      setIsLeavingHousehold(false);
      setIsLeaveHouseholdOpen(false);
    }
  };

  const handleSaveMember = async (memberData: Partial<HouseholdMember>) => {
    try {
      if (selectedMember) {
        if (selectedMember.isManaged) {
          // MemberModal only ever sends `{ displayName }` for a managed kid —
          // route it to the purpose-built kid-profile mutation, never
          // updateMember (which firestore.rules' managed-kid branch restricts).
          await updateKidProfile(selectedMember.uid, {
            displayName: memberData.displayName ?? selectedMember.displayName,
          });
        } else {
          // Update existing
          await updateMember(selectedMember.uid, memberData);
        }
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

  const doExportJson = (txList: Transaction[], mealsList: Meal[]) => {
    try {
      const exportData = buildExportPayload({
        householdId,
        exportedBy: user?.uid,
        household: householdSettings,
        members,
        habits,
        transactions: txList,
        buckets,
        calendarItems,
        meals: mealsList,
        shoppingList,
        todos,
        mealPlan,
        challenges,
        rewards: rewardsInventory,
        stores
      });

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
      // `Merchant` stays the RAW bank descriptor (an export is a record of what
      // the bank sent); `Name` is the additive friendly name a merchant rule
      // resolves, and repeats the descriptor when no rule matches.
      const flatTransactions = txList.map(tx => ({
        Date: tx.date,
        Merchant: tx.merchant,
        Name: displayNameFor(tx),
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

  // Exports must include the FULL transaction history (and, for the JSON
  // backup, the full recipe cookbook), but the household context only keeps
  // bounded live windows for both (see utils/listenerWindows.ts). Pull every
  // older transaction / recipe first (a no-op when nothing is windowed), then
  // export the complete lists.
  const requestExport = async (kind: 'json' | 'csv') => {
    let txList = transactions;
    if (hasMoreTransactions) {
      toast.loading('Loading full transaction history…', { id: 'export-load' });
      txList = await loadAllTransactions();
      toast.dismiss('export-load');
    }
    if (kind === 'json') {
      const mealsList = await loadAllMeals();
      doExportJson(txList, mealsList);
    } else {
      doExportCsv(txList);
    }
  };

  if (!householdSettings) {
    return (
      <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe px-4 pt-6" aria-busy="true" aria-live="polite">
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

  // F-MEALS-03 — one-line summary of the recorded dietary profile for the Meals row.
  const dietaryProfileCount = (householdSettings.dietaryProfile?.allergens?.length ?? 0)
    + (householdSettings.dietaryProfile?.restrictions?.length ?? 0);
  const dietaryProfileSummary = dietaryProfileCount > 0
    ? `${dietaryProfileCount} restriction${dietaryProfileCount === 1 ? '' : 's'} applied to AI meal suggestions`
    : 'Applied automatically to AI meal suggestions';

  // Built from the FULL, unsorted `members` roster (never `sortedMembers`
  // below, which re-orders admins first) — `buildMemberColorMap` assigns
  // default colors POSITIONALLY, so a re-sorted copy would color members
  // differently than every other surface sharing this same roster.
  // NOT memoized, unlike the other call sites in this sweep: this line sits
  // after an early return in this component, so `useMemo` here is a
  // conditional hook (`react-hooks/rules-of-hooks` rejects it, and tsc/eslint
  // both fail). The map is a cheap walk of a household-sized roster.
  const memberColors = buildMemberColorMap(members);

  const sortedMembers = [...members].sort((a, b) => {
    // Sort admins first
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (a.role !== 'admin' && b.role === 'admin') return 1;
    // Legacy member docs can lack displayName despite the schema type — sort them safely.
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  // Self-serve leave household: block the LAST admin from leaving via this
  // path — they'd orphan the household. They must promote another member to
  // admin first, or use Delete Household instead.
  const adminCount = members.filter((m) => m.role === 'admin').length;
  const canLeaveHousehold = Boolean(
    currentUser && !(currentUser.role === 'admin' && adminCount <= 1)
  );

  // ---- Sub-screen bodies ---------------------------------------------------

  const profileBody = (
    <>
      <Section title="Profile">
        <div className="space-y-3">
          {/* Identity — compact row, not a decorative hero: the avatar/name/
              email/role are already visible in the app chrome (TopToolbar/
              ProfileMenu), so this is just enough to confirm "who am I
              signed in as" — see UX content audit Batch 4. */}
          <div className="flex items-center gap-3 px-1">
            <MemberAvatar
              name={user?.displayName || 'User'}
              photoURL={user?.photoURL}
              color={memberColorFor(memberColors, currentUser?.uid ?? '')}
              size={40}
              alt={user?.displayName || 'User'}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate text-sm">
                  {user?.displayName || 'User'}
                </p>
                {currentUser && (currentUser.role === 'admin' ? (
                  <Crown size={12} className="text-warm-500 shrink-0" aria-label="Admin" />
                ) : (
                  <Shield size={12} className="text-accent-600 dark:text-accent-400 shrink-0" aria-label="Member" />
                ))}
              </div>
              <p className="text-xs text-brand-500 dark:text-brand-400 truncate">{user?.email}</p>
            </div>
          </div>

          <SurfaceList>
            {/* Appearance / Theme */}
            <Row className="flex-col items-stretch gap-3">
              <Eyebrow>Appearance</Eyebrow>
              <ThemeToggle />
            </Row>

            {/* Text size */}
            <Row className="flex-col items-stretch gap-3">
              <Eyebrow>Text Size</Eyebrow>
              <SegmentedControl
                name="Text size"
                options={FONT_SCALE_OPTIONS}
                value={fontScale}
                onChange={(value) => {
                  setFontScale(value);
                  haptic('light');
                }}
              />
            </Row>

            {/* High contrast */}
            <Row>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">High Contrast</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">Stronger text and border contrast</p>
              </div>
              <Switch
                aria-label="Toggle high contrast"
                checked={highContrast}
                onCheckedChange={(value) => {
                  setHighContrast(value);
                  haptic('light');
                }}
              />
            </Row>

            {/* Plan (Plan 050b) — only shown once billing is live; dormant by default. */}
            {billingEnabled && (
              <Row className="flex-col items-stretch gap-2">
                <Eyebrow>Plan</Eyebrow>
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
          </SurfaceList>
        </div>
      </Section>
    </>
  );

  const notificationsBody = (
    <>
      <Section title="This Device">
        <SurfaceList>
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
                : 'bg-brand-100 text-brand-400 dark:bg-brand-700 dark:text-brand-450'
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
        </SurfaceList>
        {notificationStatus === 'denied' && (
          <p id="notification-denied-help" className="sr-only">
            Notifications have been denied by your browser. To enable them, please update your browser settings to allow notifications for this site.
          </p>
        )}
      </Section>

      {/* Notification preferences — inline now that Notifications has its own
          destination (previously a bottom sheet reached from a row). */}
      {notificationStatus === 'granted' && householdId && user && (
        <Section title="Preferences">
          <div className="surface-section p-4">
            <NotificationSettings
              householdId={householdId}
              currentPreferences={currentUser?.notificationPreferences}
              onSave={handleSaveNotificationPreferences}
            />
          </div>
        </Section>
      )}
    </>
  );

  const householdBody = (
    <>
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

          {/* Members — the shared household points breakdown is folded in as
              the first row of this surface so the Household group stays to a
              single members box (fewer bordered panels). */}
          <div className="space-y-2">
            <SectionHeading
              as="h3"
              className="px-1"
              action={
                currentUser?.role === 'admin' && (
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
                )
              }
            >
              Members
            </SectionHeading>
            <SurfaceList>
              {/* Shared Household Points — TopToolbar already shows the current
                  daily/weekly totals persistently, so this collapses to a single
                  link into the same breakdown modal rather than re-displaying
                  all three totals here (see UX content audit Batch 4). */}
              <DisclosureRow
                icon={<Star className="w-5 h-5" />}
                title="Points breakdown"
                subtitle="Lifetime points by habit"
                onClick={() => setIsPointsBreakdownOpen(true)}
              />
              {sortedMembers.map((member) => (
                <Row key={member.uid}>
                  <MemberAvatar
                    name={member.displayName}
                    photoURL={member.photoURL}
                    color={memberColorFor(memberColors, member.uid)}
                    fallbackGlyph={member.avatarEmoji}
                    size={40}
                    alt={member.displayName}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-brand-900 dark:text-brand-100 truncate tracking-tight">
                        {member.displayName}
                        {member.uid === user?.uid && (
                          <span className="text-brand-400 dark:text-brand-450 font-normal ml-1 text-sm">(You)</span>
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
                        title={member.isManaged ? 'Edit Kid Profile' : 'Edit Member'}
                        aria-label={member.isManaged ? 'Edit Kid Profile' : 'Edit Member'}
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

      {/* Per-member habit points (stage 6) — the two household-wide habit
          settings (freeze mode, weekly wrap-up tone). Admin-editable, read-only
          for everyone else; both are inert until an admin picks a mode. */}
      <HabitPlaySettings
        settings={householdSettings}
        isAdmin={currentUser?.role === 'admin'}
        onChangeFreezeMode={(mode) => void handleFreezeModeChange(mode)}
        onChangeCeremonyTone={(tone) => void handleCeremonyToneChange(tone)}
      />

      {/* F-MEALS-03 — standing household dietary restrictions/allergens,
          auto-applied to every AI meal suggestion + weekly plan and matched
          against recipe ingredients for the allergen warning badge. */}
      <Section title="Meals">
        <SurfaceList>
          <DisclosureRow
            icon={<Salad className="w-5 h-5" />}
            title="Dietary profile"
            subtitle={dietaryProfileSummary}
            onClick={() => setIsDietaryProfileOpen(true)}
          />
        </SurfaceList>
      </Section>

      {/* Household activity log / audit trail (F-XCUT-01) — admin-only, to
          respect member privacy (mirrors the removeMember admin gate). */}
      {currentUser?.role === 'admin' && <ActivityLogCard activityLog={activityLog} />}
    </>
  );

  const moneyBody = (
    <>
      <Section title="Currency">
        <SurfaceList>
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
        </SurfaceList>
      </Section>

      {/* Merchant rules (F-MONEY-14) — household-authored cleanup for ugly bank
          descriptors. Sits with the other money-display settings; renaming is
          display-time only, so nothing here rewrites stored transactions. */}
      <MerchantRulesCard />

      <CalendarFeedCard />

      {/* Connect a bank (Plaid) — dormant until the plaidEnabled flag is on.
          Lazy + flag-gated so react-plaid-link never enters the boot bundle. */}
      {plaidEnabled && (
        <Suspense fallback={null}>
          <ConnectBankCard />
        </Suspense>
      )}
    </>
  );

  const modulesBody = (
    <>
      {/* ONE matrix, one place (PC#2). "App Modules" (household page/tab
          toggles), "What I see" (this member's own leaves) and the old
          admin-only "Member visibility" table all said the same thing three
          times; the matrix already IS both layers — section headers are the
          household switches, columns are each person's nav — so it's now the
          single editor here. Rendered for EVERY member: an admin gets all
          columns, a non-admin gets just their own, so nobody loses the ability
          to edit their own nav. The household switches inside it stay
          any-member-editable (they always were — `handleModuleToggle`, no
          rules change). */}
      <Section title="Who sees what">
        <div className="space-y-3">
          {/* Only the promise the matrix's own legend below doesn't make.
              The old copy here ("...for everyone in the household") described
              the household layer as if it were the whole screen, which now
              reads as wrong: most rows below are per-person. */}
          <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
            Turning something off never deletes anything — the data comes back when you switch it
            back on.
          </p>

          {/* Presets — one pick sets several modules at once. The manual
              switches in the matrix below remain the escape hatch for anything
              a preset doesn't cover exactly. */}
          <div className="px-1">
            <Eyebrow className="block mb-2">Quick presets</Eyebrow>
            <Select
              aria-label="Quick presets"
              value={previewPresetId ?? ''}
              onChange={(e) => handlePresetSelect(e.target.value)}
            >
              <option value="">Choose a preset…</option>
              {MODULE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>

            {previewPresetId && (() => {
              const preset = MODULE_PRESETS.find(p => p.id === previewPresetId);
              if (!preset) return null;
              const onKeys = (Object.keys(preset.visibility) as ModuleKey[]).filter(k => preset.visibility[k]);
              const offKeys = (Object.keys(preset.visibility) as ModuleKey[]).filter(k => !preset.visibility[k]);
              return (
                <div className="mt-2 rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/50 p-3 space-y-2 animate-in fade-in slide-in-from-top-1">
                  <p className="text-sm text-brand-700 dark:text-brand-300">{preset.description}</p>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {onKeys.map(k => (
                      <span key={k} className="px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300 font-medium capitalize">
                        {k} on
                      </span>
                    ))}
                    {offKeys.map(k => (
                      <span key={k} className="px-2 py-0.5 rounded-full bg-brand-200 text-brand-600 dark:bg-brand-700 dark:text-brand-400 font-medium capitalize">
                        {k} off
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewPresetId(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      isLoading={isApplyingPreset}
                      onClick={() => handleApplyPreset(preset)}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>

          {currentUser && (
            <MemberVisibilityMatrix
              // An admin sees every column; anyone else sees only their own,
              // which is what keeps a non-admin's per-member editor alive now
              // that the standalone "What I see" section is gone. This filters
              // COLUMNS only — hidden-key derivation is untouched (still the
              // one set, from `getVisibilityMatrixSections`).
              members={currentUser.role === 'admin' ? sortedMembers : [currentUser]}
              settings={householdSettings}
              onToggleModule={(key, value) => void handleModuleToggle(key, value)}
              onUpdateMember={(memberId, updates) => void updateMember(memberId, updates)}
            />
          )}
        </div>
      </Section>

      {/* The one thing the matrix can't express: the ORDER of this member's
          Home widgets (their on/off switches are matrix rows). Shared
          implementation with the onboarding wizard's "What I see" step. */}
      {currentUser && (
        <Section title="Home widget order">
          <HomeWidgetOrder
            member={currentUser}
            onSave={(updates) => void updateMember(currentUser.uid, updates)}
          />
        </Section>
      )}
    </>
  );

  const shortcutsBody = (
    <Section title="iOS Shortcuts">
      <div className="space-y-6">
        {/* API Key Management */}
        <div className="space-y-2">
          <SectionHeading as="h3" className="px-1">API Keys</SectionHeading>
          <ApiKeyManager
            householdId={householdId || ''}
            userId={user?.uid || ''}
            apiKeys={apiKeys || []}
            isAdmin={currentUser?.role === 'admin'}
            onKeyGenerated={setSessionApiKey}
          />
        </div>

        {/* Capture review mode — per-type auto vs. held-for-review routing for
            iOS-Shortcut/API captures. See utils/captureReview.ts. */}
        <div className="space-y-2">
          <SectionHeading
            as="h3"
            className="px-1"
            description="Automatic: new captures skip the review drawer. Manual review: hold them until you open the app and confirm."
          >
            Review captured items
          </SectionHeading>
          <SurfaceList>
            {CAPTURE_REVIEW_ROWS.map(({ type, label }) => (
              <Row key={type} className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <p className="flex-1 min-w-0 font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">
                  {label}
                </p>
                <SegmentedControl
                  name={`${label} review mode`}
                  size="sm"
                  options={CAPTURE_REVIEW_MODE_OPTIONS}
                  value={getCaptureReviewMode(householdSettings, type)}
                  onChange={(mode) => handleCaptureReviewModeChange(type, mode)}
                />
              </Row>
            ))}
          </SurfaceList>
        </div>

        {/* Setup Guide */}
        <div className="space-y-2">
          <SectionHeading as="h3" className="px-1">Setup Guide</SectionHeading>
          <ShortcutSetupGuide apiKey={sessionApiKey} />
        </div>
      </div>
    </Section>
  );

  const dataBody = (
    <>
      {/* Data Management */}
      <Section title="Backups & Import">
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
              <Download size={16} className="text-brand-400 dark:text-brand-450 shrink-0" />
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
              <Download size={16} className="text-brand-400 dark:text-brand-450 shrink-0" />
            </Row>

            <Row
              interactive
              role="button"
              tabIndex={0}
              onClick={() => setIsCsvImportOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCsvImportOpen(true);
                }
              }}
              aria-label="Import transactions from a CSV file"
            >
              <div className="w-10 h-10 rounded-full bg-warm-50 dark:bg-warm-900/30 flex items-center justify-center shrink-0">
                <Upload size={18} className="text-warm-600 dark:text-warm-300" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Import Transactions</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">From a bank, YNAB, or Mint CSV export</p>
              </div>
            </Row>

            <Row
              interactive
              role="button"
              tabIndex={0}
              onClick={() => setIsRecentlyDeletedOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsRecentlyDeletedOpen(true);
                }
              }}
              aria-label="Open recently deleted items to restore them"
            >
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-800 flex items-center justify-center shrink-0">
                <RotateCcw size={18} className="text-brand-600 dark:text-brand-300" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight">Recently Deleted</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">Restore items deleted in the last 30 days</p>
              </div>
            </Row>
          </SurfaceList>
        </div>
      </Section>

      {/* Account — routine account rows only; destructive actions live in the
          separated Danger Zone group at the very bottom of this screen. */}
      <Section title="Account">
        <SurfaceList>
          {billingEnabled && household && (
            <Row className="flex-col items-stretch gap-1">
              <div className="flex items-center gap-2">
                <span
                  className={
                    getPlan(household) === 'premium'
                      ? 'inline-flex items-center gap-1.5 text-xs font-bold text-warm-700 bg-warm-50 border border-warm-200 px-2.5 py-0.5 rounded-full dark:bg-warm-500/15 dark:text-warm-300 dark:border-warm-500/30'
                      : 'inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-100 border border-brand-200 px-2.5 py-0.5 rounded-full dark:bg-brand-700/50 dark:text-brand-300 dark:border-brand-600'
                  }
                >
                  {getPlan(household) === 'premium' ? 'Premium plan' : 'Free plan'}
                </span>
              </div>
              <p className="text-xs text-brand-500 dark:text-brand-400">
                {members.length} of {getLimits(household).maxMembers} members
                {' · '}
                {getLimits(household).aiDailyCap} AI actions/day
                {' · '}
                {getLimits(household).historyMonths} mo history
              </p>
            </Row>
          )}
          <DisclosureRow
            icon={<LogOut className="w-5 h-5" />}
            title="Sign Out"
            onClick={handleSignOut}
          />
        </SurfaceList>
      </Section>

      <Section title="About">
        <SurfaceList>
          <DisclosureRow
            icon={<Newspaper className="w-5 h-5" />}
            title="What's New"
            subtitle={`v${CHANGELOG[0]?.version ?? APP_VERSION}`}
            value={hasUnseenChangelog ? <Badge variant="warning" size="sm">NEW</Badge> : undefined}
            onClick={handleOpenChangelog}
          />
        </SurfaceList>
      </Section>

      {/* Danger Zone — deliberately the terminal group on this screen, with
          extra separation so the irreversible actions never sit next to
          routine rows. Both keep their existing confirmation dialogs. */}
      {(canLeaveHousehold || currentUser?.role === 'admin') && (
        <Section title="Danger Zone" className="pt-4">
          <div className="space-y-2">
            <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
              These actions are permanent and cannot be undone.
            </p>
            <SurfaceList className="border-money-neg/30 dark:border-money-negDark/30">
              {canLeaveHousehold && (
                <DisclosureRow
                  destructive
                  icon={<Users className="w-5 h-5" />}
                  title="Leave Household"
                  subtitle="Remove yourself from this household — you'll lose access to shared budgets, habits, and history"
                  onClick={() => setIsLeaveHouseholdOpen(true)}
                />
              )}
              {currentUser?.role === 'admin' && (
                <DisclosureRow
                  destructive
                  icon={<Trash2 className="w-5 h-5" />}
                  title="Delete Household"
                  subtitle="Permanently delete this household and all of its data for every member"
                  onClick={() => setIsDeleteHouseholdOpen(true)}
                />
              )}
            </SurfaceList>
          </div>
        </Section>
      )}
    </>
  );

  const sectionBodies: Record<SettingsSection, React.ReactNode> = {
    profile: profileBody,
    notifications: notificationsBody,
    household: householdBody,
    money: moneyBody,
    modules: modulesBody,
    shortcuts: shortcutsBody,
    data: dataBody,
  };

  return (
    <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe">
      {section === null ? (
        <>
          <PageHeader
            title={
              <span ref={indexHeadingRef} tabIndex={-1} className="focus:outline-hidden">
                Settings
              </span>
            }
          />
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

            <nav aria-label="Settings sections">
              <SurfaceList>
                <DisclosureRow
                  id={sectionRowId('profile')}
                  icon={<User className="w-5 h-5" />}
                  title="Profile & Appearance"
                  subtitle="Theme, text size, high contrast"
                  onClick={() => openSection('profile')}
                />
                <DisclosureRow
                  id={sectionRowId('notifications')}
                  icon={<Bell className="w-5 h-5" />}
                  title="Notifications"
                  subtitle="Alerts and reminders on this device"
                  onClick={() => openSection('notifications')}
                />
                <DisclosureRow
                  id={sectionRowId('household')}
                  icon={<Users className="w-5 h-5" />}
                  title="Household"
                  subtitle="Members, invite code, points"
                  onClick={() => openSection('household')}
                />
                <DisclosureRow
                  id={sectionRowId('money')}
                  icon={<Landmark className="w-5 h-5" />}
                  title="Money"
                  subtitle="Currency and calendar feed"
                  onClick={() => openSection('money')}
                />
                <DisclosureRow
                  id={sectionRowId('modules')}
                  icon={<LayoutGrid className="w-5 h-5" />}
                  title="Modules & Dashboard"
                  subtitle="Pages, tabs, and widgets"
                  onClick={() => openSection('modules')}
                />
                <DisclosureRow
                  id={sectionRowId('shortcuts')}
                  icon={<Smartphone className="w-5 h-5" />}
                  title="iOS Shortcuts"
                  subtitle="Capture from your iPhone"
                  onClick={() => openSection('shortcuts')}
                />
                <DisclosureRow
                  id={sectionRowId('data')}
                  icon={<Database className="w-5 h-5" />}
                  title="Data & Account"
                  subtitle="Backups, sign out, danger zone"
                  onClick={() => openSection('data')}
                />
              </SurfaceList>
            </nav>

            <p className="text-center text-xs text-brand-400 dark:text-brand-450 font-mono tabular-nums pt-2">
              LifeBalance v{APP_VERSION}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="max-w-2xl mx-auto px-3 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={goBackToIndex}
              leftIcon={<ArrowLeft size={16} />}
              aria-label="Back to Settings"
            >
              Settings
            </Button>
          </div>
          <PageHeader
            className="pt-1"
            title={
              <span ref={headingRef} tabIndex={-1} className="focus:outline-hidden">
                {SECTION_TITLES[section]}
              </span>
            }
          />
          <div className="max-w-2xl mx-auto px-4 space-y-6">
            {sectionBodies[section]}
          </div>
        </>
      )}

      {/* Page-level modals/drawers — mounted regardless of the active
          sub-screen so open flows survive navigation. */}
      <LazyMount when={isDietaryProfileOpen}>
        <DietaryProfileModal isOpen={isDietaryProfileOpen} onClose={() => setIsDietaryProfileOpen(false)} />
      </LazyMount>

      {/* CSV transaction import — lazy so the parser/dedup logic and its preview
          UI stay out of the Settings page's own chunk until first opened; stays
          mounted after that so the drawer's exit animation still plays. */}
      <LazyMount when={isCsvImportOpen}>
        <CsvImportDrawer isOpen={isCsvImportOpen} onClose={() => setIsCsvImportOpen(false)} />
      </LazyMount>

      {/* Recently Deleted (F-XCUT-03) — lazy + mount-on-first-open so the
          recovery list UI stays out of the Settings chunk until needed. */}
      <LazyMount when={isRecentlyDeletedOpen}>
        <RecentlyDeletedDrawer isOpen={isRecentlyDeletedOpen} onClose={() => setIsRecentlyDeletedOpen(false)} />
      </LazyMount>

      <ChangelogDrawer isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />

      <DeveloperConsole
        isOpen={isDevConsoleOpen}
        onClose={() => setIsDevConsoleOpen(false)}
      />

      <MemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveMember}
        initialMember={selectedMember}
        title={
          selectedMember?.isManaged
            ? 'Edit Kid Profile'
            : selectedMember
            ? 'Edit Member'
            : 'Add Member'
        }
      />

      {isPointsBreakdownOpen && (
        <PointsBreakdownModal
          isOpen={true}
          onClose={() => setIsPointsBreakdownOpen(false)}
          habits={habits}
        />
      )}

      {/* Kid Mode PIN bottom sheet */}
      <Drawer
        isOpen={isKidModeOpen}
        onClose={() => setIsKidModeOpen(false)}
        title="Kid Mode PIN"
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
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
        }
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

      <ConfirmDialog
        isOpen={isLeaveHouseholdOpen}
        onClose={() => setIsLeaveHouseholdOpen(false)}
        onConfirm={handleConfirmLeaveHousehold}
        isConfirming={isLeavingHousehold}
        title="Leave household?"
        confirmLabel="Leave"
        message={`Leave ${householdSettings.name}? You'll lose access to all shared household data — budgets, habits, and history. This cannot be undone.`}
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
