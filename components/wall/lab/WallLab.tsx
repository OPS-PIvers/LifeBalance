import React, { useEffect, useState } from 'react';
import { cn } from '@/utils/cn';
import LabAttempts from './LabAttempts';
import LabEnvironment from './LabEnvironment';
import LabMicA from './LabMicA';
import LabMicB from './LabMicB';
import LabPrototype from './LabPrototype';
import LabTimers from './LabTimers';
import LabWake from './LabWake';
import { LAUNCH_ID, isStandalone, logEvent, readAttempts, saveAttempt, type LabAttempt } from './labLog';

/**
 * Phase 0 device spike for the wall display (docs/plans/wall-display-kiosk.md §6).
 * Only routed when the build sets VITE_WALL_LAB=true, which only the
 * wall-lab preview-channel workflow does. Delete with Phase 6.
 */
type Tab = 'env' | 'a' | 'b' | 'wake' | 'proto' | 'timers';

const TABS: [Tab, string][] = [
  ['env', 'Environment'],
  ['a', 'Mic A · on-device'],
  ['b', 'Mic B · Gemini audio'],
  ['wake', 'Wake word'],
  ['proto', 'Prototype'],
  ['timers', 'Timers'],
];

const SCRIPT = [
  'Add milk and eggs',
  'We need two dozen bananas',
  'Put paper towels on the list',
  'Remind <name> to feed the cat tomorrow',
  'Add a to-do to call the dentist',
  'Add a to-do for <name> to take out the trash today',
  'Add laundry detergent',
  'Add three cans of black beans and some cilantro',
  'Remind me to renew the car registration on Friday',
  'Add sparkling water',
];

const WallLab: React.FC = () => {
  const [tab, setTab] = useState<Tab>('env');
  const [attempts, setAttempts] = useState<LabAttempt[]>(() => readAttempts());

  // Device events for the soak test (check 6) and the permission checks.
  useEffect(() => {
    logEvent('launch', isStandalone() ? 'standalone' : 'browser');
    const on = (kind: string, detail?: () => string) => {
      const handler = () => logEvent(kind, detail?.());
      return handler;
    };
    const handlers: [EventTarget, string, EventListener][] = [
      [document, 'visibilitychange', on('visibility', () => document.visibilityState)],
      [window, 'online', on('online')],
      [window, 'offline', on('offline')],
      [window, 'pagehide', on('pagehide')],
      [window, 'pageshow', ((e: PageTransitionEvent) => logEvent('pageshow', e.persisted ? 'from bfcache' : 'fresh')) as EventListener],
      [window, 'error', ((e: ErrorEvent) => logEvent('error', e.message)) as EventListener],
      [window, 'unhandledrejection', ((e: PromiseRejectionEvent) => logEvent('unhandledrejection', String(e.reason))) as EventListener],
    ];
    handlers.forEach(([target, type, fn]) => target.addEventListener(type, fn));
    return () => handlers.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
  }, []);

  const record = (attempt: LabAttempt) => setAttempts(saveAttempt(attempt));
  const verdict = (attempt: LabAttempt, v: 'ok' | 'wrong') => setAttempts(saveAttempt({ ...attempt, verdict: v }));

  if (tab === 'proto') return <LabPrototype onExit={() => setTab('env')} />;

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 text-brand-800 dark:text-brand-100 px-10 py-8 space-y-6">
      <header className="flex items-baseline gap-4">
        <h1 className="font-display text-4xl font-semibold">Wall lab</h1>
        <span className="text-brand-500">Phase 0 device spike · launch {LAUNCH_ID}</span>
      </header>
      <nav className="flex gap-2 flex-wrap" aria-label="Lab sections">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'h-14 px-6 rounded-xl text-lg font-semibold border',
              tab === key ? 'bg-accent-600 text-white border-accent-600' : 'border-brand-300 dark:border-brand-600'
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'env' && <LabEnvironment onCleared={() => setAttempts([])} />}
      {tab === 'timers' && <LabTimers />}
      {tab === 'wake' && <LabWake />}
      {(tab === 'a' || tab === 'b') && (
        <div className="grid grid-cols-[1fr_22rem] gap-10">
          <div className="space-y-6">
            {tab === 'a' ? <LabMicA onAttempt={record} /> : <LabMicB onAttempt={record} />}
            <LabAttempts engine={tab === 'a' ? 'A' : 'B'} attempts={attempts} onVerdict={verdict} />
          </div>
          <aside className="space-y-2">
            <h2 className="font-display text-2xl">Script (from 3 m)</h2>
            <ol className="list-decimal pl-6 space-y-1 text-lg">
              {SCRIPT.map(line => <li key={line}>{line}</li>)}
            </ol>
            <p className="text-brand-500 text-base">Score each attempt by hand. Pass: 9/10 correct per engine.</p>
          </aside>
        </div>
      )}
    </div>
  );
};

export default WallLab;
