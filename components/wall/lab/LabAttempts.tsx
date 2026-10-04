import React from 'react';
import { cn } from '@/utils/cn';
import { summarize, type LabAttempt, type LabEngine } from './labLog';

interface LabAttemptsProps {
  engine: LabEngine;
  attempts: LabAttempt[];
  onVerdict: (attempt: LabAttempt, verdict: 'ok' | 'wrong') => void;
}

const fmtMs = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(2)} s`);

/** Score each attempt by hand: the protocol's pass bar is 9/10 correct. */
const LabAttempts: React.FC<LabAttemptsProps> = ({ engine, attempts, onVerdict }) => {
  const s = summarize(attempts, engine);
  const mine = attempts.filter(a => a.engine === engine).slice().reverse();
  return (
    <section className="space-y-3">
      <p className="text-lg">
        <b>{s.correct}</b>/{s.scored} correct · {s.errors} errors · median {fmtMs(s.medianMs)} ·{' '}
        {s.launches} launch{s.launches === 1 ? '' : 'es'}
      </p>
      <ul className="divide-y divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700">
        {mine.map(a => (
          <li key={a.id} className="py-3 flex gap-4 items-start">
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-lg">{a.transcript || <i className="text-brand-500">(nothing heard)</i>}</p>
              <p className={cn('font-mono text-sm break-all', a.error ? 'text-money-neg' : 'text-brand-600 dark:text-brand-300')}>
                {a.error ? `Error: ${a.error}` : a.intentJson}
              </p>
              <p className="text-sm text-brand-500">
                {new Date(a.at).toLocaleTimeString()} · {fmtMs(a.latencyMs)} · {a.standalone ? 'standalone' : 'browser'} · {a.detail}
              </p>
            </div>
            <div className="flex gap-2 flex-none">
              {(['ok', 'wrong'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onVerdict(a, v)}
                  aria-pressed={a.verdict === v}
                  className={cn(
                    'h-12 px-4 rounded-lg border text-base font-semibold',
                    a.verdict === v
                      ? v === 'ok'
                        ? 'bg-accent-600 text-white border-accent-600'
                        : 'bg-money-neg text-white border-money-neg'
                      : 'border-brand-300 dark:border-brand-600'
                  )}
                >
                  {v === 'ok' ? 'Correct' : 'Wrong'}
                </button>
              ))}
            </div>
          </li>
        ))}
        {mine.length === 0 && <li className="py-3 text-brand-500">No attempts yet.</li>}
      </ul>
    </section>
  );
};

export default LabAttempts;
