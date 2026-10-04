import React, { useMemo, useRef } from 'react';
import prototypeHtml from '@/docs/plans/wall-display-prototype.html?raw';
import { buildPrototypeDoc } from './labSupport';

/**
 * Check 1/3 of the Phase 0 protocol: the approved prototype rendered at its
 * real 1366×1024 size on the iPad's own Safari, with the app's self-hosted
 * fonts instead of Google Fonts. The prototype's page chrome is hidden; its
 * theme and text-size toggles are driven from the strip below the artboard.
 */
interface LabPrototypeProps {
  onExit: () => void;
}

const LabPrototype: React.FC<LabPrototypeProps> = ({ onExit }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildPrototypeDoc(prototypeHtml, window.location.origin), []);

  // The prototype's own (hidden) toggle buttons own its state; click them.
  const press = (t: string, v: string) => {
    const doc = frameRef.current?.contentDocument;
    doc?.querySelector<HTMLButtonElement>(`[data-t="${t}"][data-v="${v}"]`)?.click();
  };

  return (
    <div className="fixed inset-0 z-modal bg-black overflow-auto">
      <iframe
        ref={frameRef}
        title="Wall prototype"
        srcDoc={srcDoc}
        className="block border-0 bg-white"
        style={{ width: 1366, height: 1024 }}
      />
      <div className="flex flex-wrap gap-2 p-3 bg-brand-900 text-white text-base">
        <button type="button" className="h-12 px-4 rounded-lg bg-white text-brand-900 font-semibold" onClick={onExit}>
          Back to lab
        </button>
        {[
          ['theme', 'light', 'Light'],
          ['theme', 'dark', 'Dark'],
          ['text', 'normal', 'Normal text'],
          ['text', 'large', 'Large text'],
          ['offline', '1', 'Offline'],
          ['stale', '1', 'Offline 15+ min'],
        ].map(([t, v, label]) => (
          <button
            key={`${t}-${v}`}
            type="button"
            className="h-12 px-4 rounded-lg border border-white/40"
            onClick={() => press(t ?? '', v ?? '')}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LabPrototype;
