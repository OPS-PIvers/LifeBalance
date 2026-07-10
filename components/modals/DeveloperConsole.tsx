import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/firebase.config';
import { collection, query, getDocs, getDoc, addDoc, updateDoc, doc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { readAppConfigFlags, setAppFlag, AI_ENABLED_FLAG_KEY, POWER_TOOLS_FLAG_KEY } from '@/services/appConfig';
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
  {
    key: 'plaidEnabled',
    label: 'Plaid Bank Link',
    description:
      "Gates the \"Connect a bank (Plaid)\" entry and all Plaid linking UI. Fails CLOSED: off unless explicitly enabled, so no bank-link UI shows while dormant. Requires the PLAID_* secrets in Secret Manager and the deployed plaidcreatelinktoken / plaidexchangepublictoken functions (see docs/PLAID_SETUP_RUNBOOK.md) BEFORE turning ON.",
    danger: false,
  },
  {
    key: POWER_TOOLS_FLAG_KEY,
    label: 'Power Tools',
    description:
      'Gates power-user/AI-heavy surfaces: HabitCoach, Smart Adjust/Reorder, grocery "Optimize with AI", Budget History, Saved View chips, and Yearly Goal UI (Plan 17). Fails OPEN: these stay ON unless this is explicitly turned off. Turn OFF to simplify the app / reduce AI cost surface for all households.',
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
  // Ops-only Plaid status (count of connected bank items; never reads a token).
  const [plaidItemCount, setPlaidItemCount] = useState<number | null>(null);

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
        // Server-maintained count (incremented by plaidexchangepublictoken); a
        // plain number, never a token. Best-effort — a read error just hides it.
        try {
          const cfgSnap = await getDoc(doc(db, 'app_config', 'global'));
          const count = cfgSnap.exists() ? cfgSnap.data().plaidItemCount : 0;
          setPlaidItemCount(typeof count === 'number' ? count : 0);
        } catch {
          setPlaidItemCount(null);
        }
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
    const email = newTesterEmail.trim();
    if (!email) return;
    try {
      const newTester: Omit<BetaTester, 'id'> = {
        email,
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
    if (!navigator.clipboard) {
      toast.error('Clipboard not available in this browser');
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      .then(() => toast.success('Report JSON copied'))
      .catch(err => {
        console.error('Failed to copy report:', err);
        toast.error('Failed to copy to clipboard');
      });
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
        <div className="sticky top-0 z-10 shrink-0 px-4 py-3 sm:p-4 border-b border-brand-200 dark:border-brand-700/60 bg-white dark:bg-brand-800 flex justify-between items-center">
            <h2 id="dev-console-title" className="font-display text-lg sm:text-xl font-semibold">Developer Console</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center -mr-2 hover:bg-brand-100/50 dark:hover:bg-brand-700/50 rounded-full text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors"
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
          className="shrink-0 flex gap-1.5 overflow-x-auto no-scrollbar px-3 py-2 sm:px-4 border-b border-brand-200 dark:border-brand-700/60 bg-brand-50/50 dark:bg-brand-700/30 [scroll-snap-type:x_proximity]"
        >
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[44px] items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors [scroll-snap-align:start] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 ${
                  isActive
                    ? 'bg-accent-600 text-white dark:bg-accent-500'
                    : 'bg-white text-brand-600 border border-brand-200 hover:bg-brand-100/70 hover:text-brand-800 dark:bg-brand-800 dark:text-brand-400 dark:border-brand-700 dark:hover:bg-brand-700/50 dark:hover:text-brand-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 scroll-contain-y p-4 sm:p-6 bg-white dark:bg-brand-800">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 text-brand-600 dark:text-brand-300 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'testers' && (
                <div className="space-y-6">
                  {/* Add form stacks on mobile so neither the input nor the button overflows. */}
                  <form
                    onSubmit={e => { e.preventDefault(); handleAddTester(); }}
                    className="flex flex-col sm:flex-row gap-2 p-4 bg-brand-50/50 dark:bg-brand-700/30 rounded-xl border border-brand-200 dark:border-brand-700/60"
                  >
                    <input
                      type="email"
                      required
                      placeholder="new@tester.com"
                      className="flex-1 min-w-0 h-11 px-3 border border-brand-200 dark:border-brand-600 rounded-lg bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-100 placeholder:text-brand-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                      value={newTesterEmail}
                      onChange={e => setNewTesterEmail(e.target.value)}
                    />
                    <button type="submit" className="h-11 bg-accent-600 dark:bg-accent-500 text-white px-4 rounded-btn flex items-center justify-center gap-2 font-semibold hover:bg-accent-700 dark:hover:bg-accent-400 active:scale-[0.98] transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40">
                      <Plus size={16} /> Add Tester
                    </button>
                  </form>

                  {testers.length === 0 && (
                    <div className="text-center py-12 text-brand-400 dark:text-brand-450">No beta testers yet.</div>
                  )}

                  {/* Mobile: stacked cards (no cramped horizontal table). */}
                  <div className="space-y-3 md:hidden">
                    {testers.map(t => (
                      <div key={t.id} className="p-4 rounded-xl border border-brand-200 dark:border-brand-700/60 bg-white dark:bg-brand-800">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-brand-800 dark:text-brand-100 break-all min-w-0">{t.email}</p>
                          <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="sm">
                            {t.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-brand-500 dark:text-brand-400">Added {new Date(t.addedAt).toLocaleDateString()}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => toggleTesterStatus(t.id, t.status)}
                            className="flex-1 min-h-[44px] rounded-lg text-sm font-bold border border-brand-200 dark:border-brand-600 text-habit-blue hover:bg-habit-blue/10 active:scale-[0.98] transition"
                          >
                            {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                          </button>
                          <button
                            onClick={() => deleteTester(t.id)}
                            className="flex h-11 w-11 items-center justify-center shrink-0 rounded-lg text-money-neg dark:text-money-negDark hover:bg-money-neg/10 active:scale-[0.98] transition"
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
                      <thead className="bg-brand-100/50 dark:bg-brand-700/30 text-brand-600 dark:text-brand-300 font-medium">
                        <tr>
                          <th className="p-3">Email</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Added</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-200">
                        {testers.map(t => (
                          <tr key={t.id} className="hover:bg-brand-50/50 dark:hover:bg-brand-700/30">
                            <td className="p-3 font-medium">{t.email}</td>
                            <td className="p-3">
                              <Badge variant={t.status === 'active' ? 'success' : 'danger'} size="md">
                                {t.status}
                              </Badge>
                            </td>
                            <td className="p-3 text-brand-500 dark:text-brand-400">{new Date(t.addedAt).toLocaleDateString()}</td>
                            <td className="p-3 flex gap-2">
                              <button onClick={() => toggleTesterStatus(t.id, t.status)} className="text-habit-blue hover:underline text-xs font-bold">
                                {t.status === 'active' ? 'REVOKE' : 'ACTIVATE'}
                              </button>
                              <button onClick={() => deleteTester(t.id)} className="text-money-neg dark:text-money-negDark hover:bg-money-neg/10 p-1 rounded-sm ml-2" aria-label={`Delete tester ${t.email}`}>
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
                    <div className="bg-habit-blue/10 dark:bg-habit-blue/15 p-4 rounded-xl border border-habit-blue/30">
                      <h3 className="text-sm font-medium text-habit-blue">Total Active Households</h3>
                      <p className="text-3xl font-bold text-habit-blue">{households.length}</p>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-brand-50/50 dark:bg-brand-700/30 px-4 py-3 border-b font-medium text-brand-700 dark:text-brand-200">Household Usage (Daily)</div>
                    <div className="divide-y">
                        {households.map(h => {
                            const usage = h.aiUsage?.dailyCount || 0;
                            const percentage = Math.min((usage / 20) * 100, 100);
                            return (
                                <div key={h.id} className="p-4 hover:bg-brand-50/50 dark:hover:bg-brand-700/30">
                                    {/* Stack name + a full-width bar on mobile; side-by-side at sm+. */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                        <div className="min-w-0 sm:flex-1">
                                            <p className="font-bold text-brand-800 dark:text-brand-100 truncate">{h.name}</p>
                                            <p className="text-xs text-brand-400 dark:text-brand-450 font-mono truncate">{h.id}</p>
                                            <p className="text-xs text-brand-500 dark:text-brand-400">Last Reset: {h.aiUsage?.lastResetDate || 'Never'}</p>
                                        </div>
                                        <div className="flex items-center gap-3 w-full sm:w-1/2 shrink-0">
                                            <div className="flex-1 h-3 bg-brand-200/50 dark:bg-brand-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${percentage > 90 ? 'bg-money-neg' : 'bg-brand-500'}`}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                            <span className={`text-sm font-mono font-bold w-12 text-right shrink-0 ${percentage > 90 ? 'text-money-neg dark:text-money-negDark' : 'text-brand-600 dark:text-brand-300'}`}>
                                                {usage}/20
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {households.length === 0 && (
                            <div className="text-center py-12 text-brand-400 dark:text-brand-450">No households found.</div>
                        )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'reports' && (
                <div className="space-y-4">
                    {reports.map(report => (
                        <div key={report.id} className="p-4 rounded-xl border border-brand-200 dark:border-brand-700/60 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)">
                            <div className="flex justify-between items-start gap-2 mb-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                                    <span className="text-xs font-mono bg-brand-100/50 dark:bg-brand-700/30 px-2 py-1 rounded-sm text-brand-600 dark:text-brand-300 font-bold">{report.version}</span>
                                    <span className="text-xs text-brand-400 dark:text-brand-450">{new Date(report.timestamp).toLocaleString()}</span>
                                </div>
                                <button onClick={() => copyReport(report)} className="flex h-11 w-11 items-center justify-center shrink-0 -mr-1 -mt-1 text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-lg active:scale-[0.98] transition" title="Copy JSON" aria-label="Copy report as JSON">
                                    <Copy size={18} />
                                </button>
                            </div>
                            <p className="text-brand-800 dark:text-brand-100 whitespace-pre-wrap break-words mb-3">{report.message}</p>
                            <div className="pt-3 border-t border-brand-200 dark:border-brand-700/60 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-brand-500 dark:text-brand-400 font-mono">
                                <span className="break-all">Route: {report.route}</span>
                                <span className="break-all">UID: {report.userId}</span>
                                <span className="break-all">HID: {report.householdId}</span>
                            </div>
                            {report.errorContext && (
                                <div className="mt-2 bg-money-bgNeg dark:bg-money-neg/15 p-2 rounded-sm text-xs text-money-neg dark:text-money-negDark font-mono overflow-x-auto border border-money-neg/30">
                                    <strong>Error Context:</strong><br/>
                                    {report.errorContext}
                                </div>
                            )}
                        </div>
                    ))}
                    {reports.length === 0 && <div className="text-center py-12 text-brand-400 dark:text-brand-450">No feedback reports found.</div>}
                </div>
              )}

              {activeTab === 'flags' && (
                <div className="space-y-3 sm:space-y-4">
                  <p className="text-sm text-brand-500 dark:text-brand-400">
                    Global switches on <span className="font-mono">app_config/global</span>, effective for ALL users within ~60 s. Changes are confirmed before they apply.
                  </p>
                  {FEATURE_FLAGS.map(flag => {
                    const isOn = flags[flag.key] === true;
                    return (
                      <div
                        key={flag.key}
                        className={`flex items-start justify-between gap-3 sm:gap-4 p-4 rounded-xl border ${
                          flag.danger
                            ? 'border-warm-300/70 bg-warm-50/60 dark:border-warm-800/60 dark:bg-warm-900/20'
                            : 'border-brand-200 bg-brand-50/50 dark:border-brand-700/60 dark:bg-brand-700/30'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <h3 className="font-bold text-brand-800 dark:text-brand-100">{flag.label}</h3>
                            <Badge variant={isOn ? 'success' : 'neutral'} size="sm">
                              {isOn ? 'ON' : 'OFF'}
                            </Badge>
                            {flag.danger && (
                              <Badge variant="warning" size="sm" className="inline-flex items-center gap-1">
                                <AlertTriangle size={11} aria-hidden="true" /> High impact
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-brand-500 dark:text-brand-400">{flag.description}</p>
                        </div>
                        {/* Confirm-gated: onCheckedChange opens the dialog. */}
                        <Switch
                          checked={isOn}
                          onCheckedChange={() => requestFlagFlip(flag)}
                          aria-label={`Turn ${flag.label} ${isOn ? 'OFF' : 'ON'}`}
                        />
                      </div>
                    );
                  })}

                  {/* Read-only Plaid status. The secret lives in Secret Manager
                      (set via CLI) — never surfaced here. This only shows the
                      flag state + a connected-account COUNT (no tokens). */}
                  <div className="mt-1 rounded-xl border border-brand-200 bg-brand-50/50 p-4 text-xs text-brand-500 dark:border-brand-700/60 dark:bg-brand-700/30 dark:text-brand-400">
                    Plaid: {flags['plaidEnabled'] ? 'enabled ✓' : 'disabled ✗'} · connected accounts: {plaidItemCount ?? '—'}
                    <span className="mt-1 block opacity-80">
                      Secret is set via <span className="font-mono">firebase functions:secrets:set</span> (see docs/PLAID_SETUP_RUNBOOK.md), not here.
                    </span>
                  </div>
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
