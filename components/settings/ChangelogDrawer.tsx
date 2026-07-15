import React from 'react';
import { Sparkles } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { CHANGELOG } from '@/data/changelog';

interface ChangelogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Settings → "What's New" — lists recent release highlights from the
 * hand-maintained `data/changelog.ts`. Purely presentational, no
 * Firestore/backend involvement (Plan F-PLAT-13).
 */
export const ChangelogDrawer: React.FC<ChangelogDrawerProps> = ({ isOpen, onClose }) => (
  <Drawer isOpen={isOpen} onClose={onClose} title="What's New" height="tall">
    <div className="space-y-6">
      {CHANGELOG.map((entry) => (
        <div key={entry.version} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display text-base font-semibold text-brand-900 dark:text-brand-50">
              v{entry.version}
            </h3>
            <span className="text-xs text-brand-450 dark:text-brand-400 font-mono tabular-nums">
              {entry.date}
            </span>
          </div>
          <ul className="space-y-1.5">
            {entry.highlights.map((highlight, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-brand-700 dark:text-brand-300"
              >
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-accent-600 dark:text-accent-400" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </Drawer>
);

export default ChangelogDrawer;
