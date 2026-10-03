import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { clearLab, readAttempts, readEvents, toMarkdown, LAUNCH_ID } from './labLog';
import { environmentSummary, probes } from './labSupport';

const LabEnvironment: React.FC<{ onCleared: () => void }> = ({ onCleared }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const events = readEvents();

  const exportMarkdown = async () => {
    const md = toMarkdown(readAttempts(), events, environmentSummary());
    try {
      await navigator.clipboard.writeText(md);
      setCopied('Copied. Paste it into docs/plans/wall-display-phase0-results.md.');
    } catch {
      // Clipboard can be blocked; show the text so it can be selected by hand.
      setCopied(md);
    }
  };

  return (
    <div className="space-y-6 text-lg">
      <p className="font-mono text-sm break-all">{navigator.userAgent}</p>
      <dl className="grid grid-cols-[22rem_1fr] gap-y-1">
        {probes().map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-brand-500">{k}</dt>
            <dd className={v === false ? 'text-money-neg font-semibold' : undefined}>{String(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="flex gap-3">
        <Button size="lg" onClick={() => void exportMarkdown()}>Copy results as Markdown</Button>
        <Button
          size="lg"
          variant="danger"
          onClick={() => {
            if (window.confirm('Clear every recorded attempt and event on this iPad?')) {
              clearLab();
              onCleared();
            }
          }}
        >
          Clear lab data
        </Button>
      </div>
      {copied && <textarea readOnly className="w-full h-48 font-mono text-sm p-2 rounded-lg border border-brand-300 bg-transparent" value={copied} />}
      <section>
        <h2 className="font-display text-2xl mb-2">Device events ({events.length})</h2>
        <ul className="font-mono text-sm space-y-1 max-h-96 overflow-y-auto">
          {events.slice().reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {new Date(e.at).toLocaleString()} · {e.launchId === LAUNCH_ID ? 'this launch' : e.launchId} · {e.kind}
              {e.detail ? ` · ${e.detail}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default LabEnvironment;
