import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SectionActionLinkProps {
  /** Route path to navigate to. */
  to: string;
  /**
   * Optional router state passed through to the `Link` — e.g.
   * `{ tab: 'calendar' }` to deep-link a sub-tab via `useDeepLinkTab`.
   */
  state?: unknown;
  /** The link label (rendered before the trailing arrow). */
  children: React.ReactNode;
  className?: string;
}

/**
 * The "View all →" / "Details →" action link rendered in a `Section` header
 * (its `action` slot). Consolidates the byte-identical Link + trailing
 * `ArrowRight` markup duplicated across the dashboard widgets.
 */
const SectionActionLink: React.FC<SectionActionLinkProps> = ({
  to,
  state,
  children,
  className,
}) => (
  <Link
    to={to}
    state={state}
    className={cn(
      // min 44px hit target; negative margins keep the Section header's
      // visual rhythm (the link previously measured ~16px tall).
      'text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 min-h-11 -my-3 px-2 -mx-2 transition-colors',
      className
    )}
  >
    {children} <ArrowRight size={12} className="shrink-0" />
  </Link>
);

export default SectionActionLink;
