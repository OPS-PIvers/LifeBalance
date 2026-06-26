import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/firebase.config';
import { collection, query, getDocs, addDoc, updateDoc, doc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { readAppConfigFlags, setAppFlag, AI_ENABLED_FLAG_KEY } from '@/services/appConfig';
import { BetaTester, FeedbackReport, Household } from '@/types/schema';
import { Loader2, Plus, Trash2, Copy, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

interface DeveloperConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'testers' | 'ai_meter' | 'reports' | 'flags';

/**
 * The four operator flags on `app_config/global`. `danger` flags an action with a
 * broad blast radius (opening signup / launching paid tiers) so the UI can warn harder.
 * Descriptions state what each gates AND the fail-safe direction.
 */
interface FeatureFlagDef {
  key: string;
  label: string;
  description: string;
  danger: boolean;
}

const FEATURE_FLAGS: readonly FeatureFlagDef[] = [
  {
    key: 'kidModeEnabled',
    label: 'Kid Mode',
    description:
      'Gates the kid profile switcher and all kid views (Plan 080). Fails CLOSED: off unless explicitly enabled, so households behave normally while dormant.',
    danger: false,
  },
  {
    key: 'billingEnabled',
    label: 'Billing / Freemium',
    description:
      'Launches the paid tiers: upgrade UI plus plan-aware AI caps (Plan 050). Fails CLOSED: off keeps the legacy flat AI cap for everyone and shows no upgrade UI. Turning this ON goes live for ALL users.',
    danger: true,
  },
  {
    key: 'openSignup',
    label: 'Open Signup',
    description:
      'Opens signup to ANY Google user, bypassing the beta_testers allowlist. Fails CLOSED: off keeps Private Alpha. Turning this ON lets anyone create an account — also add the origin to Firebase Auth authorized domains.',
    danger: true,
  },
  {
    key: AI_ENABLED_FLAG_KEY,
    label: 'AI Enabled',
    description:
      'Master AI kill-switch for all Gemini features. Fails OPEN: AI stays ON unless this is explicitly turned off. Turn OFF to halt all AI usage instantly across every household.',
    danger: false,
  },
];

/** Tab strip, rendered from data so the nav stays a single horizontally-scrollable row. */
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'testers', label: 'Beta Testers' },
  { id: 'ai_meter', label: 'AI Usage Meter' },
  { id: 'reports', label: 'Feedback Reports' },
  { id: 'flags', label: 'Feature Flags' },
];

const DeveloperConsole: React.FC<DeveloperConsoleProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('testers');
  const [testers, setTesters] = useState<(BetaTester & { id: string })[]>([]);
  const [reports, setReports] = useState<(FeedbackReport & { id: string })[]>([]);
  const [households, setHouseholds] = useState<(Household & { id: string })[]>([]);
  const [loading, setLoading] = useState(false);

  // Tester Form
  const [newTesterEmail, setNewTesterEmail] = useState('');

  // Confirm delete tester dialog
  const [deleteTesterConfirmId, setDeleteTesterConfirmId] = useState<string | null>(null);

  // Feature flags: current effective values + the flip awaiting confirmation.
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pendingFlag, setPendingFlag] = useState<FeatureFlagDef | null>(null);
  const [flagSaving, setFlagSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'testers') {
        const q = query(collection(db, 'beta_testers'), orderBy('addedAt', 'desc'));
        const snap = await getDocs(q);
        setTesters(snap.docs.map(d => ({ ...d.data(), id: d.id } as BetaTester & { id: string })));
      } else if (activeTab === 'reports') {
        const q = query(collection(db, 'feedback'), orderBy('timestamp', 'desc'), limit(50));
        const snap = await getDocs(q);
        setReports(snap.docs.map(d => ({ ...d.data(), id: d.id } as FeedbackReport & { id: string })));
      } else if (activeTab === 'ai_meter') {
        const q = query(collection(db, 'households'), limit(50)); // Limit to 50 for safety
        const snap = await getDocs(q);
        setHouseholds(snap.docs.map(d => ({ ...d.data(), id: d.id } as Household & { id: string })));
      } else if (activeTab === 'flags') {
        setFlags(await readAppConfigFlags());
      }
    } catch (error) {
      console.error("Failed to load data", error);
      toast.error("Failed to load data (Check console)");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isOpen) {
      // loadData() is an async Firestore fetch that synchronously flips the
      // loading flag before awaiting. This is legitimate external-system
      // synchronization (re-fetched on open and on tab change), not derivable
      // state — deferring the loading flag would cause a content flash before
      // the spinner. loadData is also invoked from event handlers, so it must
      // remain a callable that owns its loading transitions.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load-on-open; see comment above
      loadData();
    }
  }, [isOpen, activeTab, loadData]);

  const handleAddTester = async () => {
    if (!newTesterEmail) return;
    try {
      const newTester: Omit<BetaTester, 'id'> = {
        email: newTesterEmail,
        addedAt: new Date().toISOString(),
        status: 'active',
        usageLimit: 20
      };
      await addDoc(collection(db, 'beta_testers'), newTester);
      toast.success("Tester added");
      setNewTesterEmail('');
      loadData();
    } catch (error) {
      console.error(error);
      toast.error("Failed to add tester");
    }
  };

  const toggleTesterStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'revoked' : 'active';
    await updateDoc(doc(db, 'beta_testers', id), { status: newStatus });
    loadData();
  };

  const deleteTester = (id: string) => {
    setDeleteTesterConfirmId(id);
  };

  const confirmDeleteTester = async () => {
    if (!deleteTesterConfirmId) return;
    try {
      await deleteDoc(doc(db, 'beta_testers', deleteTesterConfirmId));
    } catch (error) {
      console.error('Failed to delete tester:', error);
    } finally {
      // Always reset state so the confirmation dialog can't get stuck open.
      setDeleteTesterConfirmId(null);
      loadData();
    }
  };

  // Open the confirm dialog for a flag flip — never write directly; these are
  // global switches affecting ALL users.
  const requestFlagFlip = (flag: FeatureFlagDef) => {
    setPendingFlag(flag);
  };

  const confirmFlagFlip = async () => {
    if (!pendingFlag) return;
    const { key, label } = pendingFlag;
    const nextValue = !flags[key];
    setFlagSaving(true);
    try {
      await setAppFlag(key, nextValue);
      // The AI kill-switch has its own cache inside geminiService; reset it lazily so
      // we don't pull the Gemini SDK into this statically-imported modal's chunk.
      if (key === AI_ENABLED_FLAG_KEY) {
        const { resetAiEnabledCache } = await import('@/services/geminiService');
        resetAiEnabledCache();
      }
      toast.success(`${label} turned ${nextValue ? 'ON' : 'OFF'}`);
      setPendingFlag(null);
      await loadData(); // Re-read so the row reflects the new effective state.
    } catch (error) {
      console.error('Failed to update feature flag:', error);
      toast.error(`Failed to update ${label}`);
    } finally {
      setFlagSaving(false);
    }
  };

  const copyReport = (report: FeedbackReport) => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast.success("Report JSON copied");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="dev-console-title"
      maxWidth="max-w-none sm:max-w-4xl"
      fullScreenOnMobile
    >
      {/* Fill the sheet on mobile; keep a comfortable fixed height on desktop. */}
      <div className="flex flex-col h-full sm:h-[70vh]">
        {/* Sticky header so the title + close stay reachable while the body scrolls. */}
        <div className="sticky top-0 z-10 shrink-0 px-4 py-3 sm:p-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 flex justify-between items-center">
            <h2 id="dev-console-title" className="text-lg sm:text-xl font-bold">Developer Console</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center -mr-2 hover:bg-slate-100/50 dark:hover:bg-slate-700/50 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <X size={22} />
            </button>
        </div>

        {/* Tabs — a single horizontally-scrollable pill row so all four fit on a phone
            without wrapping or overflowing the sheet. Momentum scroll, hidden bar. */}
        <div
          role="tablist"
          aria-label="Developer Console sections"
          className="shrink-0 flex gap-1.5 overflow-x-auto no-scrollbar px-3 py-2 sm:px-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-700/30 [scroll-snap-type:x_proximity]"
        >
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[40px] items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors [scroll-snap-align:start] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                    : 'bg-white text-slate-600 border border-slate-200/60 hover:bg-slate-100/70 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-700/50 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 scroll-contain-y p-4 sm:p-6 bg-white dark:bg-slate-800">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-brand-600 dark:text-slate-300 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'testers' && (
                <div className="space-y-6">
                  {/* Add form stacks on mobile so neither the input nor the button overflows. */}
                  <div className="flex flex-col sm:flex-row gap-2 p-4 bg-slate-50/50 dark:bg-slate-700/30 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    <input
                      type="email"
                      placeholder="new@tester.com"
                      className="flex-1 min-w-0 h-11 px-3 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      value={newTesterEmail}
                      onChange={e => setNewTesterEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddTester(); }}
                    />
                    <button onClick={handleAddTester} className="h-11 bg-brand-600 text-white px-4 rounded-lg flex items-center justify-center gap-2 font-semibold hover:bg-brand-700 active:scale-[0.98] transition shrink-0">
                      <Plus size={16} /> Add Tester
                    </button>
                  </div>

                  {testers.length === 0 && (
                    <div className="text-center py-12 text-slate-400 dark:text-slate-500">No beta testers yet.</div>
                  )}

                  {/* Mobile: stacked cards (no cramped horizontal table). */}
                  <div className="space-y-3 md:hidden">
                    {testers.map(t => (
                      <div key={t.id} className="p-4 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-slate-800 dark:text-slate-100 break-all min-w-0">{t.email}</p>
                          <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="sm">
                            {t.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Added {new Date(t.addedAt).toLocaleDateString()}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => toggleTesterStatus(t.id, t.status)}
                            className="flex-1 min-h-[44px] rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-600 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 active:scale-[0.98] transition"
                          >
                            {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                          </button>
                          <button
                            onClick={() => deleteTester(t.id)}
                            className="flex h-11 w-11 items-center justify-center shrink-0 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/20 active:scale-[0.98] transition"
                            aria-label={`Delete tester ${t.email}`}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop (md+): the compact table. */}
                  <div className="hidden md:block border rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-100/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-300 font-medium">
                        <tr>
                          <th className="p-3">Email</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Added</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/50">
                        {testers.map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                            <td className="p-3 font-medium">{t.email}</td>
                            <td className="p-3">
                              <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="md">
                                {t.status}
                              </Badge>
                            </td>
                            <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(t.addedAt).toLocaleDateString()}</td>
                            <td className="p-3 flex gap-2">
                              <button onClick={() => toggleTesterStatus(t.id, t.status)} className="text-blue-600 dark:text-blue-300 hover:underline text-xs font-bold">
                                {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                              </button>
                              <button onClick={() => deleteTester(t.id)} className="text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/20 p-1 rounded-sm ml-2" aria-label={`Delete tester ${t.email}`}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'ai_meter' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-500/15 p-4 rounded-xl border border-blue-100 dark:border-blue-500/30">
                      <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Total Active Households</h3>
                      <p className="text-3xl font-bold text-blue-900 dark:text-blue-200">{households.length}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-slate-50/50 dark:bg-slate-700/30 px-4 py-3 border-b font-medium text-slate-700 dark:text-slate-200">Household Usage (Daily)</div>
                    <div className="divide-y">
                        {households.map(h => {
                            const usage = h.aiUsage?.dailyCount || 0;
                            const percentage = Math.min((usage / 20) * 100, 100);
                            return (
                                <div key={h.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                                    {/* Stack name + a full-width bar on mobile; side-by-side at sm+. */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                        <div className="min-w-0 sm:flex-1">
                                            <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{h.name}</p>
                                            <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">{h.id}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">Last Reset: {h.aiUsage?.lastResetDate || 'Never'}</p>
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-1/2 shrink-0">
                                            <div className="flex-1 h-3 bg-slate-200/50 dark:bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${percentage > 90 ? 'bg-red-500' : 'bg-brand-500'}`}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                            <span className={`text-sm font-mono font-bold w-12 text-right shrink-0 ${percentage > 90 ? 'text-red-600 dark:text-red-300' : 'text-slate-600 dark:text-slate-300'}`}>
                                                {usage}/20
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {households.length === 0 && (
                            <div className="text-center py-12 text-slate-400 dark:text-slate-500">No households found.</div>
                        )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-4">
                    {reports.map(report => (
                        <div key={report.id} className="p-4 rounded-xl border border-slate-200/60 dark:border-slate-700/60 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start gap-2 mb-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                                    <span className="text-xs font-mono bg-slate-100/50 dark:bg-slate-700/30 px-2 py-1 rounded-sm text-slate-600 dark:text-slate-300 font-bold">{report.version}</span>
                                    <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(report.timestamp).toLocaleString()}</span>
                                </div>
                                <button onClick={() => copyReport(report)} className="flex h-11 w-11 items-center justify-center shrink-0 -mr-1 -mt-1 text-brand-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-slate-700/50 rounded-lg active:scale-[0.98] transition" title="Copy JSON" aria-label="Copy report as JSON">
                                    <Copy size={18} />
                                </button>
                            </div>
                            <p className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words mb-3">{report.message}</p>
                            <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                                <span className="break-all">Route: {report.route}</span>
                                <span className="break-all">UID: {report.userId}</span>
                                <span className="break-all">HID: {report.householdId}</span>
                            </div>
                            {report.errorContext && (
                                <div className="mt-2 bg-red-50 dark:bg-red-500/15 p-2 rounded-sm text-xs text-red-700 dark:text-red-300 font-mono overflow-x-auto border border-red-100 dark:border-red-500/30">
                                    <strong>Error Context:</strong><br/>
                                    {report.errorContext}
                                </div>
                            )}
                        </div>
                    ))}
                    {reports.length === 0 && <div className="text-center py-12 text-slate-400 dark:text-slate-500">No feedback reports found.</div>}
                </div>
              )}

              {activeTab === 'flags' && (
                <div className="space-y-3 sm:space-y-4">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Global switches on <span className="font-mono">app_config/global</span>, effective for ALL users within ~60 s. Changes are confirmed before they apply.
                  </p>
                  {FEATURE_FLAGS.map(flag => {
                    const isOn = flags[flag.key] === true;
                    return (
                      <div
                        key={flag.key}
                        className={`flex items-start justify-between gap-3 sm:gap-4 p-4 rounded-xl border ${
                          flag.danger
                            ? 'border-amber-300/70 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10'
                            : 'border-slate-200/60 bg-slate-50/50 dark:border-slate-700/60 dark:bg-slate-700/30'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{flag.label}</h3>
                            <Badge variant={isOn ? 'success' : 'neutral'} size="sm">
                              {isOn ? 'ON' : 'OFF'}
                            </Badge>
                            {flag.danger && (
                              <Badge variant="warning" size="sm" className="inline-flex items-center gap-1">
                                <AlertTriangle size={11} aria-hidden="true" /> High impact
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{flag.description}</p>
                        </div>
                        {/* Reuse the shared Switch primitive (44px touch row, accessible
                            checkbox). Confirm-gated: onCheckedChange opens the dialog. */}
                        <div className="flex min-h-[44px] shrink-0 items-center">
                          <Switch
                            checked={isOn}
                            onCheckedChange={() => requestFlagFlip(flag)}
                            aria-label={`Turn ${flag.label} ${isOn ? 'OFF' : 'ON'}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTesterConfirmId}
        onClose={() => setDeleteTesterConfirmId(null)}
        onConfirm={confirmDeleteTester}
        title="Remove Tester"
        message="Are you sure you want to remove this tester?"
        confirmLabel="Remove"
      />

      <ConfirmDialog
        isOpen={!!pendingFlag}
        onClose={() => setPendingFlag(null)}
        onConfirm={confirmFlagFlip}
        title={pendingFlag ? `Turn ${pendingFlag.label} ${flags[pendingFlag.key] ? 'OFF' : 'ON'}?` : ''}
        message={
          pendingFlag
            ? `This ${flags[pendingFlag.key] ? 'turns OFF' : 'turns ON'} "${pendingFlag.label}" for ALL users (effective within ~60 s). ${pendingFlag.description}`
            : ''
        }
        confirmLabel={pendingFlag && flags[pendingFlag.key] ? 'Turn OFF' : 'Turn ON'}
        confirmVariant={pendingFlag?.danger ? 'destructive' : 'primary'}
        isConfirming={flagSaving}
      />
    </Modal>
  );
};

export default DeveloperConsole;
